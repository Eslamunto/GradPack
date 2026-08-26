/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { describe, expect, it, vi } from "vitest";
import type { ArchiveManifest } from "../../src/archive/manifest";
import {
  createRunPlan,
  runCourses,
  type MultiCourseDependencies,
} from "../../src/page/run-courses";
import { RunSafetyError } from "../../src/page/run-course";
import type { CoursePlan, CourseSummary } from "../../src/shared/model";
import { MAX_ARCHIVE_BYTES } from "../../src/shared/constants";

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
  modules: [],
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
    gradPackVersion: "0.1.0-alpha.3",
    createdAt: "2026-08-17T12:00:00.000Z",
    canvasHost: "frankfurtschool.instructure.com",
    course: { id: course.id, name: course.name, courseCode: course.courseCode },
    totals: {
      success: 1,
      failed: 0,
      unavailable: 0,
      unsupported: 0,
      external: 0,
      advertisedBytes: 10,
      archivedBytes: 10,
    },
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
      courses.map((course) => [course.id, planFor(course)]),
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
    expect(plan.summary).toMatchObject({
      requestedPackaging: "combined",
      effectivePackaging: "combined",
      advertisedBytes: 20,
      unknownSizeCount: 0,
      resourceCount: 2,
      fallbackReason: null,
    });
    expect(plan.courses[0]).not.toBe(sourcePlans.get(101));
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

  it("prefers the unknown-size fallback when combined ZIP entries also exceed capacity", async () => {
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
      fallbackReason: "unknown-size-files",
      unknownSizeCount: 1,
    });
    expect(deps.buildCourseArchive).not.toHaveBeenCalled();
  });

  it("stops before retrieval when one individual course exceeds the limit", async () => {
    const deps = baseDependencies(
      vi.fn(async (course) =>
        planFor(course, course.id === 202 ? MAX_ARCHIVE_BYTES + 1 : 10),
      ),
    );
    await expect(
      createRunPlan({
        courses: courses.slice(0, 2),
        requestedPackaging: "per-course",
        signal: new AbortController().signal,
        dependencies: deps,
      }),
    ).rejects.toThrow("202");
    expect(deps.buildCourseArchive).not.toHaveBeenCalled();
  });
});

describe("runCourses", () => {
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
    expect(deps.buildCourseArchive).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        combinedRoot: "courses/First Course-101",
      }),
    );
    expect(deps.buildCourseArchive).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        combinedRoot: "courses/Second Course-202",
      }),
    );
    expect(deps.buildCombinedZip).toHaveBeenCalledOnce();
    expect(deps.download).toHaveBeenCalledWith(
      "gradpack-combined.zip",
      expect.any(Uint8Array),
    );
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
