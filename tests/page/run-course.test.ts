/* eslint-disable @typescript-eslint/require-await -- async callbacks model browser operations in focused tests */
import { unzipSync, strFromU8, strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { ARCHIVE_CSS } from "../../src/archive/style";
import { sanitizePageFragment } from "../../src/archive/sanitize";
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

const unknownFile = (id: number): PlannedResource => ({
  ...file(id),
  advertisedBytes: null,
  sourceUrl: `https://frankfurtschool.instructure.com/courses/${syntheticCourse.id}/files/${id}/download`,
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
    remainingBytes: number,
  ) => Promise<Retrieval>,
): RunDependencies & { download: ReturnType<typeof vi.fn> } => {
  const download = vi.fn();
  return {
    discover: vi.fn(async () => coursePlan),
    retrieve: vi.fn(
      (
        resource: PlannedResource,
        _plan: CoursePlan,
        signal: AbortSignal,
        remainingBytes: number,
      ) => retrieve(resource, signal, remainingBytes),
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
    const pageBytes = strToU8("<p>Safe</p>");
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

  it("allows known-size file and page retrievals to share concurrency", async () => {
    let active = 0;
    let maximum = 0;
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const deps = dependencies(
      plan([file(1), page, file(2), file(3)]),
      async (resource) => {
        started.push(resource.key);
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
    expect(started).toEqual(["file:1", "page:welcome"]);
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

  it("zeroes success bytes returned by a sibling after terminal cancellation", async () => {
    const lateBytes = new Uint8Array([7, 8]);
    const deps = dependencies(
      plan([file(1), file(2)]),
      async (resource, signal) => {
        if (resource.key === "file:1") {
          throw new RunSafetyError("synthetic safety");
        }
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { status: "success", bytes: lateBytes };
      },
    );

    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toThrow("synthetic safety");
    expect(lateBytes).toEqual(new Uint8Array(2));
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("zeroes success bytes rejected by post-retrieval path validation", async () => {
    const invalidPath = { ...file(1), archivePath: "../escape.bin" };
    const returnedBytes = new Uint8Array([7, 8]);
    const deps = dependencies(plan([invalidPath]), async () => ({
      status: "success",
      bytes: returnedBytes,
    }));

    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toThrow("Invalid planned archive path");
    expect(returnedBytes).toEqual(new Uint8Array(2));
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

  it("passes the current remaining course budget to every retrieval", async () => {
    const observed: Array<[string, number]> = [];
    const beforePackage = vi.fn(() => {
      throw new Error("Task 4 pre-package boundary");
    });
    const deps = dependencies(
      plan([file(1, 2), file(2, 2), unknownFile(3)]),
      async (resource, _signal, remainingBytes) => {
        observed.push([resource.key, remainingBytes]);
        return { status: "success", bytes: new Uint8Array(2) };
      },
    );
    deps.maxArchiveBytes = 6;
    deps.beforePackage = beforePackage;

    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toThrow("Task 4 pre-package boundary");

    expect(observed).toEqual([
      ["file:1", 6],
      ["file:2", 6],
      ["file:3", 2],
    ]);
    expect(beforePackage).toHaveBeenCalledOnce();
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("waits for an active known retrieval before authorizing an unknown remainder", async () => {
    const knownBytes = new Uint8Array([1, 2, 3]);
    const unknownBytes = new Uint8Array([4, 5]);
    const started: Array<[string, number]> = [];
    let active = 0;
    let maximum = 0;
    let releaseKnown!: () => void;
    let markKnownStarted!: () => void;
    const knownRelease = new Promise<void>((resolve) => {
      releaseKnown = resolve;
    });
    const knownStarted = new Promise<void>((resolve) => {
      markKnownStarted = resolve;
    });
    const beforePackage = vi.fn(() => {
      throw new Error("Task 4 pre-package boundary");
    });
    const deps = dependencies(
      plan([file(1, 3), unknownFile(2)]),
      async (resource, _signal, remainingBytes) => {
        started.push([resource.key, remainingBytes]);
        active += 1;
        maximum = Math.max(maximum, active);

        try {
          if (resource.key === "file:1") {
            markKnownStarted();
            await knownRelease;
            return { status: "success", bytes: knownBytes };
          }

          return { status: "success", bytes: unknownBytes };
        } finally {
          active -= 1;
        }
      },
    );
    deps.maxArchiveBytes = 5;
    deps.beforePackage = beforePackage;

    const action = runCourse({
      course: syntheticCourse,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });

    await knownStarted;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const startedBeforeKnownCompleted = [...started];
    releaseKnown();

    await expect(action).rejects.toThrow("Task 4 pre-package boundary");
    expect(startedBeforeKnownCompleted).toEqual([["file:1", 5]]);
    expect(started).toEqual([
      ["file:1", 5],
      ["file:2", 2],
    ]);
    expect(maximum).toBe(1);
    expect(knownBytes).toEqual(new Uint8Array(knownBytes.length));
    expect(unknownBytes).toEqual(new Uint8Array(unknownBytes.length));
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("serializes overlapping unknown retrievals against the updated course remainder", async () => {
    const firstBytes = new Uint8Array([1, 2, 3]);
    const secondBytes = new Uint8Array([4, 5]);
    const started: Array<[string, number]> = [];
    let activeAuthorization = 0;
    let maximumAuthorization = 0;
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const beforePackage = vi.fn(() => {
      throw new Error("Task 4 pre-package boundary");
    });
    const deps = dependencies(
      plan([unknownFile(1), unknownFile(2)]),
      async (resource, _signal, remainingBytes) => {
        started.push([resource.key, remainingBytes]);
        activeAuthorization += remainingBytes;
        maximumAuthorization = Math.max(
          maximumAuthorization,
          activeAuthorization,
        );

        try {
          if (resource.key === "file:1") {
            markFirstStarted();
            await firstRelease;
            return { status: "success", bytes: firstBytes };
          }

          return { status: "success", bytes: secondBytes };
        } finally {
          activeAuthorization -= remainingBytes;
        }
      },
    );
    deps.maxArchiveBytes = 5;
    deps.beforePackage = beforePackage;

    const action = runCourse({
      course: syntheticCourse,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });

    await firstStarted;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const startedBeforeFirstCompleted = [...started];
    releaseFirst();

    await expect(action).rejects.toThrow("Task 4 pre-package boundary");
    expect(startedBeforeFirstCompleted).toEqual([["file:1", 5]]);
    expect(started).toEqual([
      ["file:1", 5],
      ["file:2", 2],
    ]);
    expect(maximumAuthorization).toBe(5);
    expect(firstBytes).toEqual(new Uint8Array(firstBytes.length));
    expect(secondBytes).toEqual(new Uint8Array(secondBytes.length));
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("aborts queued unknown retrievals without deadlocking after a failure", async () => {
    const started: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const deps = dependencies(
      plan([unknownFile(1), unknownFile(2)]),
      async (resource) => {
        started.push(resource.key);
        if (resource.key === "file:1") {
          markFirstStarted();
          await firstRelease;
          throw new RunSafetyError("serialized unknown failure");
        }

        return { status: "success", bytes: new Uint8Array([1]) };
      },
    );
    deps.maxArchiveBytes = 5;

    const action = runCourse({
      course: syntheticCourse,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });

    await firstStarted;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const startedBeforeFailure = [...started];
    releaseFirst();

    await expect(action).rejects.toThrow("serialized unknown failure");
    expect(startedBeforeFailure).toEqual(["file:1"]);
    expect(started).toEqual(["file:1"]);
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("accepts an exact-budget unknown file through the pre-package gate", async () => {
    const resourceBytes = new Uint8Array([1, 2, 3]);
    const beforePackage = vi.fn(() => {
      throw new Error("Task 4 pre-package boundary");
    });
    const deps = dependencies(
      plan([unknownFile(3)]),
      async (_resource, _signal, remainingBytes) => {
        expect(remainingBytes).toBe(3);
        return { status: "success", bytes: resourceBytes };
      },
    );
    deps.maxArchiveBytes = 3;
    deps.beforePackage = beforePackage;

    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toThrow("Task 4 pre-package boundary");

    expect(beforePackage).toHaveBeenCalledOnce();
    expect(deps.download).not.toHaveBeenCalled();
    expect(resourceBytes).toEqual(new Uint8Array(3));
  });

  it("keeps the aggregate cap as defense in depth and zeroes all bytes", async () => {
    const retained = new Uint8Array([1, 2]);
    const overflow = new Uint8Array([3, 4, 5]);
    const beforePackage = vi.fn();
    const observed: Array<[string, number]> = [];
    const deps = dependencies(
      plan([file(1, 2), unknownFile(3)]),
      async (resource, _signal, remainingBytes) => {
        observed.push([resource.key, remainingBytes]);
        if (resource.key === "file:1") {
          return { status: "success", bytes: retained };
        }
        return { status: "success", bytes: overflow };
      },
    );
    deps.maxArchiveBytes = 4;
    deps.beforePackage = beforePackage;

    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toThrow("Archive byte limit exceeded");
    expect(observed).toEqual([
      ["file:1", 4],
      ["file:3", 2],
    ]);
    expect(retained).toEqual(new Uint8Array(2));
    expect(overflow).toEqual(new Uint8Array(3));
    expect(beforePackage).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("rejects an unknown source URL for another course before retrieval", async () => {
    const mismatched = {
      ...unknownFile(3),
      sourceUrl:
        "https://frankfurtschool.instructure.com/courses/202/files/3/download",
    };
    const deps = dependencies(plan([mismatched]), async () => ({
      status: "success",
      bytes: new Uint8Array([1]),
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
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("rechecks the byte cap after a sanitized page fragment is shell-wrapped", async () => {
    const fragment = strToU8("<p>x</p>");
    const deps = dependencies(plan([page]), async () => ({
      status: "success",
      bytes: fragment,
    }));
    deps.maxArchiveBytes = fragment.byteLength;
    await expect(
      runCourse({
        course: syntheticCourse,
        signal: new AbortController().signal,
        progress: vi.fn(),
        dependencies: deps,
      }),
    ).rejects.toThrow("Archive byte limit exceeded");
    expect(deps.download).not.toHaveBeenCalled();
    expect(fragment.every((value) => value === 0)).toBe(true);
  });

  it("packages rich sanitized Canvas content under the final shell policy", async () => {
    const fragment = sanitizePageFragment({
      title: "Welcome",
      body: '<h1>Source heading</h1><h3 aria-expanded="false">Details</h3><img src="https://remote.test/image.png" alt="Diagram"><a href="https://reference.test/path?q=ok#part">Reference</a><a href="mailto:reader@example.test">Email</a>',
      resolveLocalHref: () => null,
    });
    const deps = dependencies(plan([page]), async () => ({
      status: "success",
      bytes: strToU8(fragment),
    }));
    const result = await runCourse({
      course: syntheticCourse,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies: deps,
    });
    const html = strFromU8(unzipSync(result.zipBytes)["pages/welcome.html"]!);
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector(".saved-page-content h2")?.textContent).toBe(
      "Source heading",
    );
    expect(document.querySelector("h3")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(document.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(
      document.querySelector('a[href="https://reference.test/path?q=ok#part"]'),
    ).not.toBeNull();
    expect(document.querySelector('a[href^="mailto:"]')).not.toBeNull();
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
