/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { describe, expect, it, vi } from "vitest";
import type { ArchiveManifest } from "../../src/archive/manifest";
import {
  createRunPlan,
  runCourses,
  type MultiCourseDependencies,
} from "../../src/page/run-courses";
import { RunSafetyError } from "../../src/page/run-course";
import type {
  CourseDiscoveryProgress,
  CoursePlan,
  CourseSummary,
} from "../../src/shared/model";
import { CanvasResponseError, CanvasSessionError } from "../../src/canvas/http";
import {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_RESOURCES,
} from "../../src/shared/constants";

const courses: CourseSummary[] = [
  {
    id: 101,
    name: "First Course",
    courseCode: "SYN-101",
    workflowState: "available",
    concluded: false,
  },
  {
    id: 202,
    name: "Second Course",
    courseCode: "SYN-202",
    workflowState: "completed",
    concluded: false,
  },
  {
    id: 303,
    name: "Concluded Course",
    courseCode: "SYN-303",
    workflowState: "completed",
    concluded: true,
  },
];

const planFor = (
  course: CourseSummary,
  advertisedBytes = 10,
  unknownSize = false,
): CoursePlan => ({
  course: { ...course },
  moduleDiscovery: "available",
  modules: [],
  folderPathFallbackKeys: [],
  advertisedBytes: unknownSize ? 0 : advertisedBytes,
  resources: [
    {
      key: `file:${course.id}`,
      kind: "file",
      title: "file.bin",
      sourceId: String(course.id),
      archivePath: "files/file.bin",
      advertisedBytes: unknownSize ? null : advertisedBytes,
      sourceUrl: `https://frankfurtschool.instructure.com/files/${course.id}/download`,
    },
  ],
});

const manifest = (course: CourseSummary): ArchiveManifest =>
  ({
    schemaVersion: 1,
    gradPackVersion: "0.1.0-alpha.6",
    createdAt: "2026-08-17T12:00:00.000Z",
    canvasHost: "frankfurtschool.instructure.com",
    course: { id: course.id, name: course.name, courseCode: course.courseCode },
    moduleDiscovery: "available",
    part: { index: 1, total: 1 },
    courseTotals: {
      advertisedBytes: 10,
      resourceCount: 0,
      unknownSizeCount: 0,
      folderPathFallbackCount: 0,
    },
    totals: {
      success: 1,
      failed: 0,
      unavailable: 0,
      unsupported: 0,
      external: 0,
      advertisedBytes: 10,
      archivedBytes: 10,
    },
    resourceCatalog: [],
    resources: [],
  }) as ArchiveManifest;

const baseDependencies = (
  discover: MultiCourseDependencies["discover"],
): MultiCourseDependencies => ({
  discover,
  retrieve: vi.fn(
    async (...args: Parameters<MultiCourseDependencies["retrieve"]>) => {
      void args;
      return {
        status: "success" as const,
        bytes: new Uint8Array([1]),
      };
    },
  ),
  buildCourseArchive: vi.fn(async ({ course, progress }) => {
    progress({ stage: "package", completed: 1, total: 1, failed: 0 });
    return {
      manifest: manifest(course),
      zipBytes: new Uint8Array([course.id % 256]),
    };
  }),
  buildCombinedZip: vi.fn(
    (input: Parameters<MultiCourseDependencies["buildCombinedZip"]>[0]) =>
      ({
        ...(() => {
          const { archives } = input;
          return {
            manifest: {
              schemaVersion: 1 as const,
              kind: "combined" as const,
              createdAt: "2026-08-17T12:00:00.000Z",
              courses: archives.map(
                ({ course, fileName, manifest: value }) => ({
                  courseId: course.id,
                  fileName,
                  manifest: value,
                }),
              ),
              totals: {
                success: archives.length,
                failed: 0,
                unavailable: 0,
                unsupported: 0,
                external: 0,
              },
            },
            zipBytes: new Uint8Array([9]),
          };
        })(),
      }) as ReturnType<MultiCourseDependencies["buildCombinedZip"]>,
  ),
  archiveCss: "body{}",
  now: () => "2026-08-17T12:00:00.000Z",
  fileName: (course) => `gradpack-${course.id}.zip`,
  combinedFileName: () => "gradpack-combined.zip",
  download: vi.fn(),
});

describe("createRunPlan", () => {
  it("discovers every selected course before retrieval and freezes copied plans", async () => {
    const calls: string[] = [];
    const sourcePlans = new Map(
      courses.map((course) => [
        course.id,
        {
          ...planFor(course),
          moduleDiscovery:
            course.id === 202 ? ("disabled" as const) : ("available" as const),
        },
      ]),
    );
    const deps = baseDependencies(
      vi.fn(async (course) => {
        calls.push(`discover:${course.id}`);
        return sourcePlans.get(course.id)!;
      }),
    );
    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "combined",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    expect(calls).toEqual(["discover:101", "discover:202"]);
    expect(Object.isFrozen(plan.courses)).toBe(true);
    expect(Object.isFrozen(plan.courses[0])).toBe(true);
    expect(Object.isFrozen(plan.courses[0]?.parts)).toBe(true);
    expect(plan.summary).toMatchObject({
      requestedPackaging: "combined",
      effectivePackaging: "combined",
      advertisedBytes: 20,
      unknownSizeCount: 0,
      resourceCount: 2,
      fallbackReason: null,
    });
    expect(plan.summary.selected).toEqual([
      expect.objectContaining({
        courseId: 101,
        moduleDiscovery: "available",
      }),
      expect.objectContaining({
        courseId: 202,
        moduleDiscovery: "disabled",
      }),
    ]);
    expect(plan.courses[0]?.plan).not.toBe(sourcePlans.get(101));
  });

  it("falls back to per-course output before retrieval for unknown file sizes", async () => {
    const deps = baseDependencies(
      vi.fn(async (course) => planFor(course, 10, course.id === 101)),
    );
    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "combined",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    expect(plan.summary).toMatchObject({
      effectivePackaging: "per-course",
      fallbackReason: "unknown-size-files",
      unknownSizeCount: 1,
      selected: [
        { courseId: 101, unknownSizeCount: 1 },
        { courseId: 202, unknownSizeCount: 0 },
      ],
    });
    expect(deps.buildCourseArchive).not.toHaveBeenCalled();
  });

  it("keeps a direct per-course request without a fallback for unknown file sizes", async () => {
    const deps = baseDependencies(
      vi.fn(async (course) => planFor(course, 10, course.id === 101)),
    );
    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "per-course",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    expect(plan.summary).toMatchObject({
      effectivePackaging: "per-course",
      fallbackReason: null,
      unknownSizeCount: 1,
    });
  });

  it("allows a safe direct per-course aggregate above one course resource cap", async () => {
    const resourcesPerCourse = Math.floor(MAX_ARCHIVE_RESOURCES / 2) + 1;
    const deps = baseDependencies(
      vi.fn(async (course) => ({
        ...planFor(course, 0),
        resources: Array.from({ length: resourcesPerCourse }, (_, index) => ({
          key: `file:${course.id}:${index}`,
          kind: "file" as const,
          title: `file-${index}.bin`,
          sourceId: `${course.id}:${index}`,
          archivePath: `files/file-${index}.bin`,
          advertisedBytes: 0,
          sourceUrl: `https://frankfurtschool.instructure.com/files/${course.id}-${index}/download`,
        })),
      })),
    );

    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "per-course",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    expect(plan.summary).toMatchObject({
      requestedPackaging: "per-course",
      effectivePackaging: "per-course",
      resourceCount: resourcesPerCourse * 2,
      fallbackReason: null,
    });
    expect(plan.summary.resourceCount).toBeGreaterThan(MAX_ARCHIVE_RESOURCES);
    expect(plan.summary.selected).toEqual([
      expect.objectContaining({ resourceCount: resourcesPerCourse }),
      expect.objectContaining({ resourceCount: resourcesPerCourse }),
    ]);
  });

  it("falls back before retrieval when combined advertised bytes exceed the limit", async () => {
    const deps = baseDependencies(
      vi.fn(async (course) => planFor(course, MAX_ARCHIVE_BYTES)),
    );
    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "combined",
      signal: new AbortController().signal,
      dependencies: deps,
    });
    expect(plan.summary.effectivePackaging).toBe("per-course");
    expect(plan.summary.fallbackReason).toBe("combined-size-exceeded");
    expect(deps.buildCourseArchive).not.toHaveBeenCalled();
  });

  it("falls back before retrieval when nested core entries exceed classic ZIP capacity", async () => {
    const counts = new Map([
      [101, 32_759],
      [202, 32_759],
    ]);
    const deps = baseDependencies(
      vi.fn(async (course) => ({
        ...planFor(course, 0),
        resources: Array.from(
          { length: counts.get(course.id)! },
          (_, index) => ({
            key: `file:${course.id}:${index}`,
            kind: "file" as const,
            title: `file-${index}.bin`,
            sourceId: `${course.id}:${index}`,
            archivePath: `files/file-${index}.bin`,
            advertisedBytes: 0,
            sourceUrl: `https://frankfurtschool.instructure.com/files/${course.id}-${index}/download`,
          }),
        ),
      })),
    );
    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "combined",
      signal: new AbortController().signal,
      dependencies: deps,
    });
    expect(plan.summary.resourceCount).toBe(65_518);
    expect(plan.summary.effectivePackaging).toBe("per-course");
    expect(plan.summary.fallbackReason).toBe(
      "combined-resource-limit-exceeded",
    );
    expect(deps.buildCourseArchive).not.toHaveBeenCalled();
  });

  it("prefers multipart fallback when an unknown file is one of several parts", async () => {
    const counts = new Map([
      [101, 32_759],
      [202, 32_759],
    ]);
    const deps = baseDependencies(
      vi.fn(async (course) => ({
        ...planFor(course, 0),
        resources: Array.from(
          { length: counts.get(course.id)! },
          (_, index) => ({
            key: `file:${course.id}:${index}`,
            kind: "file" as const,
            title: `file-${index}.bin`,
            sourceId: `${course.id}:${index}`,
            archivePath: `files/file-${index}.bin`,
            advertisedBytes: course.id === 101 && index === 0 ? null : 0,
            sourceUrl: `https://frankfurtschool.instructure.com/files/${course.id}-${index}/download`,
          }),
        ),
      })),
    );
    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "combined",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    expect(plan.summary).toMatchObject({
      effectivePackaging: "per-course",
      fallbackReason: "multipart-course",
      unknownSizeCount: 1,
    });
    expect(deps.buildCourseArchive).not.toHaveBeenCalled();
  });

  it("keeps a known individually oversized file in a dedicated ready part", async () => {
    const deps = baseDependencies(
      vi.fn(async (course) =>
        course.id === 101
          ? planFor(course, MAX_ARCHIVE_BYTES + 1)
          : planFor(course, 10),
      ),
    );
    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "per-course",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    expect(plan.courses.map(({ plan: value }) => value.course.id)).toEqual([
      101, 202,
    ]);
    expect(plan.courses[0]?.parts).toMatchObject([
      { index: 1, total: 1, resourceKeys: ["file:101"] },
    ]);
    expect(plan.summary).toMatchObject({
      requestedCourseCount: 2,
      selected: [{ courseId: 101 }, { courseId: 202 }],
      skipped: [],
      advertisedBytes: MAX_ARCHIVE_BYTES + 11,
      resourceCount: 2,
    });
    expect(deps.buildCourseArchive).not.toHaveBeenCalled();
  });

  it("partitions an oversized aggregate and forces combined output to parts", async () => {
    const deps = baseDependencies(
      vi.fn(async (course) => ({
        ...planFor(course, MAX_ARCHIVE_BYTES),
        resources: [
          ...planFor(course, MAX_ARCHIVE_BYTES).resources,
          {
            ...planFor(course, 1).resources[0]!,
            key: `file:${course.id}:second`,
            sourceId: `${course.id}2`,
            archivePath: "files/second.bin",
            sourceUrl: `https://frankfurtschool.instructure.com/files/${course.id}2/download`,
          },
        ],
        advertisedBytes: MAX_ARCHIVE_BYTES + 1,
      })),
    );

    const runPlan = await createRunPlan({
      courses: courses.slice(0, 1),
      requestedPackaging: "combined",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    expect(runPlan.courses[0]?.parts.map((part) => part.resourceKeys)).toEqual([
      ["file:101"],
      ["file:101:second"],
    ]);
    expect(runPlan.summary).toMatchObject({
      effectivePackaging: "per-course",
      fallbackReason: "multipart-course",
    });
  });

  it("classifies course-local failures and reports ordered progress", async () => {
    const failures = new Map<number, unknown>([
      [101, new CanvasResponseError("private Canvas response")],
      [202, new RunSafetyError("private safety detail")],
      [303, new Error("private local detail")],
    ]);
    const deps = baseDependencies(
      vi.fn<MultiCourseDependencies["discover"]>(async (course) => {
        const failure = failures.get(course.id);
        if (!(failure instanceof Error)) {
          throw new Error("Missing synthetic discovery failure");
        }
        throw failure;
      }),
    );
    const onProgress = vi.fn<(progress: CourseDiscoveryProgress) => void>();

    const plan = await createRunPlan({
      courses,
      requestedPackaging: "combined",
      signal: new AbortController().signal,
      dependencies: deps,
      onProgress,
    });

    expect(plan.courses).toEqual([]);
    expect(plan.summary).toMatchObject({
      requestedCourseCount: 3,
      selected: [],
      skipped: [
        { courseId: 101, category: "canvas-unavailable" },
        { courseId: 202, category: "safety-validation" },
        { courseId: 303, category: "unexpected-local" },
      ],
      advertisedBytes: 0,
      resourceCount: 0,
    });
    expect(onProgress.mock.calls.map(([value]) => value)).toEqual([
      { completed: 1, total: 3, currentCourseId: 101 },
      { completed: 2, total: 3, currentCourseId: 202 },
      { completed: 3, total: 3, currentCourseId: 303 },
    ]);
  });

  it("turns mismatched discovery IDs into a local safety failure", async () => {
    const deps = baseDependencies(
      vi.fn(async (course) =>
        course.id === 101 ? planFor(courses[1]!) : planFor(course),
      ),
    );

    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "per-course",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    expect(plan.courses.map(({ plan: value }) => value.course.id)).toEqual([
      202,
    ]);
    expect(plan.summary.skipped).toEqual([
      { courseId: 101, category: "safety-validation" },
    ]);
  });

  it.each([
    ["session", new CanvasSessionError("private session detail")],
    ["cancellation", new DOMException("cancelled", "AbortError")],
  ])("stops globally on %s", async (_name, failure) => {
    const discover = vi.fn(async () => Promise.reject(failure));
    const deps = baseDependencies(discover);

    await expect(
      createRunPlan({
        courses: courses.slice(0, 2),
        requestedPackaging: "per-course",
        signal: new AbortController().signal,
        dependencies: deps,
      }),
    ).rejects.toBe(failure);
    expect(discover).toHaveBeenCalledTimes(1);
  });
});

describe("runCourses", () => {
  it("builds multipart courses sequentially and clears each handed-off ZIP", async () => {
    const order: string[] = [];
    let previousBytes: Uint8Array | null = null;
    const deps = baseDependencies(
      vi.fn(async (course) =>
        course.id === 101
          ? {
              ...planFor(course, MAX_ARCHIVE_BYTES),
              advertisedBytes: MAX_ARCHIVE_BYTES + 1,
              resources: [
                ...planFor(course, MAX_ARCHIVE_BYTES).resources,
                {
                  ...planFor(course, 1).resources[0]!,
                  key: "file:101:second",
                  sourceId: "1012",
                  archivePath: "files/second.bin",
                  sourceUrl:
                    "https://frankfurtschool.instructure.com/files/1012/download",
                },
              ],
            }
          : planFor(course),
      ),
    );
    deps.buildCourseArchive = vi.fn(async ({ course, partPlan }) => {
      if (previousBytes) expect(Array.from(previousBytes)).toEqual([0]);
      order.push(`build:${course.id}:${partPlan.index}`);
      const zipBytes = new Uint8Array([partPlan.index]);
      previousBytes = zipBytes;
      return {
        manifest: {
          ...manifest(course),
          part: { index: partPlan.index, total: partPlan.total },
        },
        zipBytes,
      };
    });
    deps.download = vi.fn((fileName) => {
      const match = /gradpack-(\d+)(?:-part-(\d+)-of-\d+)?\.zip/u.exec(
        fileName,
      )!;
      order.push(`download:${match[1]}:${Number(match[2] ?? 1)}`);
    });
    const runPlan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "per-course",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    const result = await runCourses({
      plan: runPlan,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });

    expect(order).toEqual([
      "build:101:1",
      "download:101:1",
      "build:101:2",
      "download:101:2",
      "build:202:1",
      "download:202:1",
    ]);
    expect(result.outputCount).toBe(3);
    expect(result.completedCourseIds).toEqual([101, 202]);
    expect(result.failedParts).toEqual([]);
  });

  it("continues after a local part failure and marks the course incomplete", async () => {
    const deps = baseDependencies(
      vi.fn(async (course) =>
        course.id === 101
          ? {
              ...planFor(course, MAX_ARCHIVE_BYTES),
              advertisedBytes: MAX_ARCHIVE_BYTES + 1,
              resources: [
                ...planFor(course, MAX_ARCHIVE_BYTES).resources,
                {
                  ...planFor(course, 1).resources[0]!,
                  key: "file:101:second",
                  sourceId: "1012",
                  archivePath: "files/second.bin",
                  sourceUrl:
                    "https://frankfurtschool.instructure.com/files/1012/download",
                },
              ],
            }
          : planFor(course),
      ),
    );
    deps.buildCourseArchive = vi.fn(async ({ course, partPlan }) => {
      if (course.id === 101 && partPlan.index === 2) {
        throw new RunSafetyError("part-local");
      }
      return {
        manifest: {
          ...manifest(course),
          part: { index: partPlan.index, total: partPlan.total },
        },
        zipBytes: new Uint8Array([partPlan.index]),
      };
    });
    const runPlan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "per-course",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    const result = await runCourses({
      plan: runPlan,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });

    expect(
      result.completedParts.map(({ courseId, partIndex }) => [
        courseId,
        partIndex,
      ]),
    ).toEqual([
      [101, 1],
      [202, 1],
    ]);
    expect(result.failedParts).toEqual([
      { courseId: 101, partIndex: 2, totalParts: 2 },
    ]);
    expect(result.completedCourseIds).toEqual([202]);
    expect(result.failedCourseIds).toEqual([101]);
    expect(result.outputCount).toBe(2);
  });

  it.each([
    ["session loss", new CanvasSessionError("private session detail")],
    ["cancellation", new DOMException("cancelled", "AbortError")],
  ])(
    "stops globally on %s after clearing an already handed-off part",
    async (_label, failure) => {
      const deps = baseDependencies(vi.fn(async (course) => planFor(course)));
      let handedOffBytes: Uint8Array | null = null;
      deps.buildCourseArchive = vi.fn(async ({ course }) => {
        if (course.id === 202) throw failure;
        handedOffBytes = new Uint8Array([7]);
        return { manifest: manifest(course), zipBytes: handedOffBytes };
      });
      const runPlan = await createRunPlan({
        courses: courses.slice(0, 2),
        requestedPackaging: "per-course",
        signal: new AbortController().signal,
        dependencies: deps,
      });

      await expect(
        runCourses({
          plan: runPlan,
          signal: new AbortController().signal,
          progress: vi.fn(),
          dependencies: deps,
        }),
      ).rejects.toBe(failure);

      expect(deps.download).toHaveBeenCalledTimes(1);
      expect(Array.from(handedOffBytes!)).toEqual([0]);
    },
  );

  it("runs courses sequentially, aggregates progress, and preserves a successful course after a local failure", async () => {
    const order: number[] = [];
    const deps = baseDependencies(vi.fn(async (course) => planFor(course)));
    deps.buildCourseArchive = vi.fn(async ({ course, progress }) => {
      order.push(course.id);
      progress({ stage: "package", completed: 1, total: 1, failed: 0 });
      if (course.id === 202) throw new RunSafetyError("course-local");
      return {
        manifest: manifest(course),
        zipBytes: new Uint8Array([course.id % 256]),
      };
    });
    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "per-course",
      signal: new AbortController().signal,
      dependencies: deps,
    });
    const progress = vi.fn();
    const result = await runCourses({
      plan,
      signal: new AbortController().signal,
      progress,
      dependencies: deps,
    });

    expect(order).toEqual([101, 202]);
    expect(result.completed.map(({ course }) => course.id)).toEqual([101]);
    expect(result.failedCourseIds).toEqual([202]);
    expect(deps.download).toHaveBeenCalledWith(
      "gradpack-101.zip",
      expect.any(Uint8Array),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        currentCourseId: 202,
        currentCourseIndex: 1,
        totalCourses: 2,
      }),
    );
  });

  it("builds one combined output only after every course succeeds", async () => {
    const deps = baseDependencies(vi.fn(async (course) => planFor(course)));
    const plan = await createRunPlan({
      courses: courses.slice(0, 2),
      requestedPackaging: "combined",
      signal: new AbortController().signal,
      dependencies: deps,
    });
    const result = await runCourses({
      plan,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });
    expect(result.combined?.fileName).toBe("gradpack-combined.zip");
    expect(result.effectivePackaging).toBe("combined");
    expect(deps.buildCourseArchive).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        combinedRoot: null,
      }),
    );
    expect(deps.buildCourseArchive).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        combinedRoot: null,
      }),
    );
    expect(deps.buildCombinedZip).toHaveBeenCalledOnce();
    expect(deps.download).toHaveBeenCalledWith(
      "gradpack-combined.zip",
      expect.any(Uint8Array),
    );
  });

  it("hands off standalone successes when one requested combined course fails", async () => {
    const deps = baseDependencies(vi.fn(async (course) => planFor(course)));
    deps.buildCourseArchive = vi.fn(async ({ course, combinedRoot }) => {
      expect(combinedRoot).toBeNull();
      if (course.id === 202) throw new RunSafetyError("course-local");
      return {
        manifest: manifest(course),
        zipBytes: new Uint8Array([course.id % 256]),
      };
    });
    const plan = await createRunPlan({
      courses,
      requestedPackaging: "combined",
      signal: new AbortController().signal,
      dependencies: deps,
    });

    const result = await runCourses({
      plan,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });

    expect(deps.buildCourseArchive).toHaveBeenCalledTimes(3);
    expect(deps.buildCombinedZip).not.toHaveBeenCalled();
    expect(deps.download).toHaveBeenCalledTimes(2);
    expect(deps.download).toHaveBeenNthCalledWith(
      1,
      "gradpack-101.zip",
      expect.any(Uint8Array),
    );
    expect(deps.download).toHaveBeenNthCalledWith(
      2,
      "gradpack-303.zip",
      expect.any(Uint8Array),
    );
    expect(result).toMatchObject({
      effectivePackaging: "per-course",
      combined: null,
      failedCourseIds: [202],
    });
    expect(result.completed.map(({ course }) => course.id)).toEqual([101, 303]);
  });

  it("does not supply a combined root in per-course mode", async () => {
    const deps = baseDependencies(vi.fn(async (course) => planFor(course)));
    const plan = await createRunPlan({
      courses: courses.slice(0, 1),
      requestedPackaging: "per-course",
      signal: new AbortController().signal,
      dependencies: deps,
    });
    await runCourses({
      plan,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });
    expect(deps.buildCourseArchive).toHaveBeenCalledWith(
      expect.objectContaining({ combinedRoot: null }),
    );
  });
});
