/* eslint-disable @typescript-eslint/require-await -- async callbacks model browser operations in focused tests */
import { unzipSync, strFromU8, strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { ARCHIVE_CSS } from "../../src/archive/style";
import {
  buildCourseArchive,
  RunSafetyError,
  runCourse,
  type Retrieval,
  type RunDependencies,
} from "../../src/page/run-course";
import type { CoursePlan, PlannedResource } from "../../src/shared/model";
import { syntheticCourse } from "../fixtures/course-plan";

const file = (id: number, size = 4): PlannedResource => ({
  key: `file:${id}`,
  kind: "file",
  title: `file-${id}.bin`,
  sourceId: String(id),
  archivePath: `files/file-${id}.bin`,
  advertisedBytes: size,
  sourceUrl: `https://frankfurtschool.instructure.com/files/${id}/download`,
});

const page: PlannedResource = {
  key: "page:welcome",
  kind: "page",
  title: "Welcome",
  sourceId: "welcome",
  archivePath: "pages/welcome.html",
  advertisedBytes: 0,
  sourceUrl: null,
};

const external: PlannedResource = {
  key: "external:9",
  kind: "external",
  title: "Reference",
  sourceId: "9",
  archivePath: null,
  advertisedBytes: 0,
  sourceUrl: "https://reference.example/item",
};

const plan = (resources: PlannedResource[]): CoursePlan => ({
  course: { ...syntheticCourse },
  modules: [],
  resources: resources.map((resource) => ({ ...resource })),
  advertisedBytes: resources.reduce(
    (total, resource) =>
      total + (resource.kind === "file" ? (resource.advertisedBytes ?? 0) : 0),
    0,
  ),
});

const dependencies = (
  coursePlan: CoursePlan,
  retrieve: (
    resource: PlannedResource,
    signal: AbortSignal,
  ) => Promise<Retrieval>,
): RunDependencies & { download: ReturnType<typeof vi.fn> } => {
  const download = vi.fn();
  return {
    discover: vi.fn(async () => coursePlan),
    retrieve: vi.fn(
      (resource: PlannedResource, _plan: CoursePlan, signal: AbortSignal) =>
        retrieve(resource, signal),
    ),
    archiveCss: ARCHIVE_CSS,
    now: () => "2026-08-16T12:00:00.000Z",
    fileName: () => "gradpack-synthetic-course.zip",
    download,
  };
};

describe("runCourse", () => {
  it("builds a discovered course plan without handing off a download", async () => {
    const deps = dependencies(plan([file(1)]), async () => ({
      status: "success",
      bytes: strToU8("data"),
    }));

    const result = await buildCourseArchive({
      course: syntheticCourse,
      plan: plan([file(1)]),
      combinedRoot: null,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });

    expect(result.manifest.course.id).toBe(syntheticCourse.id);
    expect(Array.from(unzipSync(result.zipBytes)["files/file-1.bin"]!)).toEqual(
      Array.from(strToU8("data")),
    );
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("builds a complete synthetic ZIP and reports exact scalar progress", async () => {
    const fileBytes = strToU8("data");
    const pageBytes = strToU8(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome</title><link rel="stylesheet" href="../assets/archive.css"></head><body><main><p>Safe</p></main></body></html>',
    );
    const deps = dependencies(
      plan([file(1), page, external]),
      async (resource) => ({
        status: "success",
        bytes: resource.kind === "page" ? pageBytes : fileBytes,
      }),
    );
    const progress = vi.fn();

    const result = await runCourse({
      course: syntheticCourse,
      signal: new AbortController().signal,
      progress,
      dependencies: deps,
    });

    const zip = unzipSync(result.zipBytes);
    expect(Object.keys(zip).sort()).toEqual([
      "assets/archive.css",
      "files.html",
      "files/file-1.bin",
      "index.html",
      "manifest.json",
      "modules.html",
      "pages.html",
      "pages/welcome.html",
      "status.html",
    ]);
    expect(JSON.parse(strFromU8(zip["manifest.json"]!))).toEqual(
      result.manifest,
    );
    expect(result.manifest.totals).toMatchObject({
      success: 2,
      external: 1,
      failed: 0,
    });
    expect(progress.mock.calls.at(-1)?.[0]).toEqual({
      stage: "package",
      completed: 3,
      total: 3,
      failed: 0,
    });
    expect(deps.download).toHaveBeenCalledOnce();
    expect(fileBytes.every((value) => value === 0)).toBe(true);
    expect(pageBytes.every((value) => value === 0)).toBe(true);
    expect(Array.from(unzipSync(result.zipBytes)["files/file-1.bin"]!)).toEqual(
      Array.from(strToU8("data")),
    );
  });

  it.each([
    ["unavailable", "not-found"],
    ["unavailable", "access-denied"],
    ["failed", "transient-exhausted"],
  ] as const)(
    "continues after an individual %s outcome",
    async (status, failureCategory) => {
      const deps = dependencies(plan([file(1), file(2)]), async (resource) =>
        resource.key === "file:1"
          ? { status, failureCategory }
          : { status: "success", bytes: strToU8("data") },
      );

      const result = await runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      });

      expect(result.manifest.totals).toMatchObject({ success: 1, [status]: 1 });
      expect(result.manifest.resources[0]).toMatchObject({
        status,
        failureCategory,
      });
      expect(deps.download).toHaveBeenCalledOnce();
    },
  );

  it("never retrieves external or unsupported resources", async () => {
    const unsupported = {
      ...external,
      key: "unsupported:10",
      kind: "unsupported" as const,
      sourceUrl: null,
    };
    const retrieve = vi.fn(async () => ({
      status: "success" as const,
      bytes: strToU8("bad"),
    }));
    const deps = dependencies(plan([external, unsupported]), retrieve);

    const result = await runCourse({
      course: syntheticCourse,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });

    expect(retrieve).not.toHaveBeenCalled();
    expect(result.manifest.totals).toMatchObject({
      external: 1,
      unsupported: 1,
    });
  });

  it("limits retrieval concurrency to two", async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const deps = dependencies(
      plan([file(1), file(2), file(3), file(4)]),
      async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return { status: "success", bytes: strToU8("data") };
      },
    );
    const action = runCourse({
      course: syntheticCourse,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());
    await action;
    expect(maximum).toBe(2);
  });

  it("latches a run-level failure, aborts siblings, and starts no later work", async () => {
    const started: string[] = [];
    const stopped = vi.fn();
    const deps = dependencies(
      plan([file(1), file(2), file(3)]),
      async (resource, signal) => {
        started.push(resource.key);
        if (resource.key === "file:1")
          throw new RunSafetyError("synthetic safety");
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              stopped();
              reject(new DOMException("cancelled", "AbortError"));
            },
            { once: true },
          );
        });
        return { status: "success", bytes: strToU8("data") };
      },
    );

    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toBeInstanceOf(RunSafetyError);
    expect(started).toEqual(["file:1", "file:2"]);
    expect(stopped).toHaveBeenCalledOnce();
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("stops when successful resources exceed the aggregate archive-byte cap", async () => {
    const deps = dependencies(plan([file(1, 4)]), async () => ({
      status: "success",
      bytes: new Uint8Array(4),
    }));
    deps.maxArchiveBytes = 3;
    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toBeInstanceOf(RunSafetyError);
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("does not claim success when cancellation occurs during package or download", async () => {
    for (const phase of ["package", "download"] as const) {
      const controller = new AbortController();
      const deps = dependencies(plan([file(1)]), async () => ({
        status: "success",
        bytes: strToU8("data"),
      }));
      if (phase === "package")
        deps.beforePackage = () =>
          controller.abort(new DOMException("cancelled", "AbortError"));
      else
        deps.download.mockImplementation(() => {
          controller.abort(new DOMException("cancelled", "AbortError"));
        });
      await expect(
        runCourse({
          course: syntheticCourse,
          signal: controller.signal,
          progress: vi.fn(),
          dependencies: deps,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
    }
  });

  it("propagates a download exception without a completed result", async () => {
    const resourceBytes = strToU8("data");
    const deps = dependencies(plan([file(1)]), async () => ({
      status: "success",
      bytes: resourceBytes,
    }));
    deps.download.mockImplementation(() => {
      throw new TypeError("download failed");
    });
    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toThrow("download failed");
    expect(Array.from(resourceBytes)).toEqual([0, 0, 0, 0]);
  });

  it("rejects a discovered plan for a different selected course before retrieval", async () => {
    const other = plan([file(1)]);
    other.course.id = 999;
    const deps = dependencies(other, async () => ({
      status: "success",
      bytes: strToU8("data"),
    }));
    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toBeInstanceOf(RunSafetyError);
    expect(deps.retrieve).not.toHaveBeenCalled();
  });

  it("normalizes a non-error retrieval rejection into a latched safety failure", async () => {
    const deps = dependencies(plan([file(1), file(2)]), () =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- verifies hostile non-Error rejection normalization
      Promise.reject(undefined),
    );
    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toBeInstanceOf(RunSafetyError);
    expect(deps.download).not.toHaveBeenCalled();
  });
});
