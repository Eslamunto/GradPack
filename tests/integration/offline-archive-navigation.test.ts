import { posix } from "node:path";
import { strFromU8, strToU8, unzipSync, type Unzipped } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildCombinedZip,
  type CourseArchiveOutput,
} from "../../src/archive/combined";
import {
  normalizeArchiveManifest,
  type ArchiveManifest,
} from "../../src/archive/manifest";
import { ARCHIVE_CSS } from "../../src/archive/style";
import {
  buildCourseArchive,
  type CourseArchiveDependencies,
} from "../../src/page/run-course";
import {
  createRunPlan,
  runCourses,
  type MultiCourseDependencies,
} from "../../src/page/run-courses";
import { MAX_ARCHIVE_BYTES } from "../../src/shared/constants";
import type { CoursePlan, CourseSummary } from "../../src/shared/model";
import {
  runSyntheticPilot,
  SYNTHETIC_PAGE_ONLY_FILE_CONTENT,
  SYNTHETIC_PAGE_ONLY_FILE_ID,
  syntheticArchivePlan,
} from "../fixtures/course-plan";

type PageOnlyPilotOptions = Parameters<typeof runSyntheticPilot>[0] & {
  pageOnlyFile: true;
};

const pageOnlyPilotOptions = (
  unavailableFile = false,
): PageOnlyPilotOptions => ({
  pageOnlyFile: true,
  unavailableFile,
});

const course = (id: number, name: string): CourseSummary => ({
  id,
  name,
  courseCode: `SYN-${id}`,
  workflowState: "available",
  concluded: false,
});

const planFor = (selected: CourseSummary): CoursePlan => ({
  ...structuredClone(syntheticArchivePlan),
  course: { ...selected },
  resources: structuredClone(syntheticArchivePlan.resources.slice(0, 2)),
  modules: syntheticArchivePlan.modules.map((module) => ({
    ...structuredClone(module),
    items: structuredClone(module.items.slice(0, 1)),
  })),
});

const dependencies: CourseArchiveDependencies = {
  retrieve: (resource) =>
    Promise.resolve({
      status: "success",
      bytes:
        resource.kind === "page"
          ? strToU8('<p>Read the <a href="../files/slides.pdf">slides</a>.</p>')
          : strToU8("synthetic-file-data"),
    }),
  archiveCss: ARCHIVE_CSS,
  now: () => "2026-08-21T12:00:00.000Z",
  fileName: (selected) => `gradpack-${selected.id}.zip`,
};

const buildCourse = async (
  selected: CourseSummary,
  combinedRoot: string | null,
): Promise<CourseArchiveOutput> => {
  const result = await buildCourseArchive({
    course: selected,
    plan: planFor(selected),
    combinedRoot,
    signal: new AbortController().signal,
    progress: () => {},
    dependencies,
  });
  return {
    course: selected,
    fileName: `gradpack-${selected.id}.zip`,
    manifest: result.manifest,
    moduleCount: planFor(selected).modules.length,
    itemCount: planFor(selected).modules.reduce(
      (total, module) => total + module.items.length,
      0,
    ),
    zipBytes: result.zipBytes,
  };
};

const localTarget = (from: string, href: string): string | null => {
  if (href.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(href)) return null;
  const withoutFragment = href.split("#", 1)[0]!;
  const decoded = withoutFragment
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
  const target = posix.normalize(posix.join(posix.dirname(from), decoded));
  if (target === ".." || target.startsWith("../")) {
    throw new TypeError(`Link escapes archive: ${from} -> ${href}`);
  }
  return target;
};

const verifyOfflineArchive = (entries: Unzipped): void => {
  const htmlPaths = Object.keys(entries).filter((path) =>
    path.endsWith(".html"),
  );
  expect(htmlPaths.length).toBeGreaterThan(0);
  for (const path of htmlPaths) {
    const html = strFromU8(entries[path]!);
    expect(html).not.toMatch(/https?:\/\//iu);
    const fileUrl = new URL(`file:///gradpack/${path}`);
    expect(fileUrl.protocol).toBe("file:");
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector("script, iframe, object, embed")).toBeNull();
    expect(document.querySelector("main")).not.toBeNull();
    expect(document.querySelector('a[href="#archive-main"]')).not.toBeNull();
    for (const element of document.querySelectorAll("a[href], link[href]")) {
      const href = element.getAttribute("href")!;
      const target = localTarget(path, href);
      if (target !== null)
        expect(entries[target], `${path} -> ${href}`).toBeDefined();
    }
  }
  expect(strFromU8(entries["assets/archive.css"]!)).not.toMatch(
    /url\s*\(|@import/iu,
  );
};

describe("extracted offline archive navigation", () => {
  it("archives an unknown-size file discovered only from a synthetic page", async () => {
    const result = await runSyntheticPilot(pageOnlyPilotOptions());
    const entries = unzipSync(result.zipBytes);
    const manifest = JSON.parse(
      strFromU8(entries["manifest.json"]!),
    ) as ArchiveManifest;
    const page = new DOMParser().parseFromString(
      strFromU8(entries["pages/welcome.html"]!),
      "text/html",
    );

    verifyOfflineArchive(entries);
    expect(Object.keys(entries)).toContain(
      `files/file-${SYNTHETIC_PAGE_ONLY_FILE_ID}`,
    );
    expect(
      page.querySelector(
        `a[href="../files/file-${SYNTHETIC_PAGE_ONLY_FILE_ID}"]`,
      )?.textContent,
    ).toContain("Open the page-only file");
    expect(manifest.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `file:${SYNTHETIC_PAGE_ONLY_FILE_ID}`,
          archivePath: `files/file-${SYNTHETIC_PAGE_ONLY_FILE_ID}`,
          advertisedBytes: null,
          status: "success",
          actualBytes: strToU8(SYNTHETIC_PAGE_ONLY_FILE_CONTENT).byteLength,
          failureCategory: null,
        }),
      ]),
    );
  });

  it("keeps page-only unavailable file text without a broken local link", async () => {
    const result = await runSyntheticPilot(pageOnlyPilotOptions(true));
    const entries = unzipSync(result.zipBytes);
    const manifest = JSON.parse(
      strFromU8(entries["manifest.json"]!),
    ) as ArchiveManifest;
    const page = new DOMParser().parseFromString(
      strFromU8(entries["pages/welcome.html"]!),
      "text/html",
    );
    const status = new DOMParser().parseFromString(
      strFromU8(entries["status.html"]!),
      "text/html",
    );

    verifyOfflineArchive(entries);
    expect(
      entries[`files/file-${SYNTHETIC_PAGE_ONLY_FILE_ID}`],
    ).toBeUndefined();
    expect(page.body.textContent).toContain("Open the page-only file");
    expect(page.querySelector('a[href*="file-777"]')).toBeNull();
    expect(status.body.textContent).toContain("file-777");
    expect(status.body.textContent).toContain("unavailable");
    expect(manifest.totals).toMatchObject({ unavailable: 1 });
    expect(manifest.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `file:${SYNTHETIC_PAGE_ONLY_FILE_ID}`,
          archivePath: `files/file-${SYNTHETIC_PAGE_ONLY_FILE_ID}`,
          advertisedBytes: null,
          status: "unavailable",
          actualBytes: null,
          failureCategory: "not-found",
        }),
      ]),
    );
  });

  it("resolves every individual and combined local link without network access", async () => {
    const first = course(101, "First Course");
    const individual = await buildCourse(first, null);
    const individualEntries = unzipSync(individual.zipBytes);
    verifyOfflineArchive(individualEntries);
    expect(
      new DOMParser()
        .parseFromString(
          strFromU8(individualEntries["modules.html"]!),
          "text/html",
        )
        .querySelector('.course-navigation a[aria-current="page"]')
        ?.textContent,
    ).toBe("Modules");
    expect(
      new DOMParser()
        .parseFromString(
          strFromU8(individualEntries["pages/welcome.html"]!),
          "text/html",
        )
        .querySelector('.course-navigation a[aria-current="page"]')
        ?.textContent,
    ).toBe("Pages");
    const standaloneModules = new DOMParser().parseFromString(
      strFromU8(individualEntries["modules.html"]!),
      "text/html",
    );
    expect(
      [...standaloneModules.querySelectorAll("a.courses-home-link")].map(
        (link) => link.getAttribute("href"),
      ),
    ).toEqual(["index.html", "index.html"]);
    const standaloneSavedPage = new DOMParser().parseFromString(
      strFromU8(individualEntries["pages/welcome.html"]!),
      "text/html",
    );
    expect(
      [...standaloneSavedPage.querySelectorAll("a.courses-home-link")].map(
        (link) => link.getAttribute("href"),
      ),
    ).toEqual(["../index.html", "../index.html"]);

    const second = course(202, "Second Course");
    const archives = await Promise.all(
      [first, second].map((selected) => buildCourse(selected, null)),
    );
    const combined = buildCombinedZip({
      archives,
      archiveCss: ARCHIVE_CSS,
      now: () => "2026-08-21T12:00:00.000Z",
      fileName: () => "gradpack-combined.zip",
    });
    const combinedEntries = unzipSync(combined.zipBytes);
    verifyOfflineArchive(combinedEntries);
    const nestedHome = new DOMParser().parseFromString(
      strFromU8(combinedEntries["courses/First Course-101/index.html"]!),
      "text/html",
    );
    expect(
      [...nestedHome.querySelectorAll("a.courses-home-link")].map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["../../index.html", "../../index.html"]);
    const nestedPage = new DOMParser().parseFromString(
      strFromU8(
        combinedEntries["courses/First Course-101/pages/welcome.html"]!,
      ),
      "text/html",
    );
    expect(
      [...nestedPage.querySelectorAll("a.courses-home-link")].map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["../../../index.html", "../../../index.html"]);
    expect(combined.manifest.courses).toHaveLength(2);
    expect(combined.manifest.totals.success).toBe(4);
  });

  it("downloads a mixed single-part, disabled, unfiled, and multipart course set", async () => {
    const selected = [
      course(101, "ordinary"),
      course(202, "disabled"),
      course(303, "unfiled"),
      course(404, "multipart"),
    ];
    const fileResource = (
      id: number,
      archivePath: string,
      advertisedBytes: number,
    ) => ({
      key: `file:${id}`,
      kind: "file" as const,
      title: `file-${id}.bin`,
      sourceId: String(id),
      archivePath,
      advertisedBytes,
      sourceUrl: `https://frankfurtschool.instructure.com/files/${id}/download`,
    });
    const plans = new Map<number, CoursePlan>([
      [
        101,
        {
          course: selected[0]!,
          moduleDiscovery: "available",
          modules: [],
          resources: [fileResource(101, "files/file-101.bin", 1)],
          folderPathFallbackKeys: [],
          advertisedBytes: 1,
        },
      ],
      [
        202,
        {
          course: selected[1]!,
          moduleDiscovery: "disabled",
          modules: [],
          resources: [fileResource(202, "files/file-202.bin", 1)],
          folderPathFallbackKeys: [],
          advertisedBytes: 1,
        },
      ],
      [
        303,
        {
          course: selected[2]!,
          moduleDiscovery: "available",
          modules: [],
          resources: [
            fileResource(3031, "files/unfiled/reading.bin", 1),
            fileResource(3032, "files/unfiled/reading-2.bin", 1),
          ],
          folderPathFallbackKeys: ["file:3031", "file:3032"],
          advertisedBytes: 2,
        },
      ],
      [
        404,
        {
          course: selected[3]!,
          moduleDiscovery: "available",
          modules: [
            {
              id: 1,
              name: "Module One",
              position: 1,
              items: [
                {
                  id: 1,
                  title: "Second part file",
                  position: 1,
                  indent: 0,
                  resourceKey: "file:4042",
                  type: "File",
                },
              ],
            },
          ],
          resources: [
            fileResource(4041, "files/large.bin", MAX_ARCHIVE_BYTES),
            fileResource(4042, "files/second.bin", 1),
          ],
          folderPathFallbackKeys: [],
          advertisedBytes: MAX_ARCHIVE_BYTES + 1,
        },
      ],
    ]);
    const downloads: Array<{ name: string; bytes: Uint8Array }> = [];
    const buildErrors: string[] = [];
    const multiDependencies: MultiCourseDependencies = {
      discover: (selectedCourse) =>
        Promise.resolve(plans.get(selectedCourse.id)!),
      retrieve: () =>
        Promise.resolve({ status: "success", bytes: new Uint8Array([7]) }),
      buildCourseArchive: async (options) => {
        try {
          return await buildCourseArchive(options);
        } catch (error) {
          buildErrors.push(error instanceof Error ? error.message : "unknown");
          throw error;
        }
      },
      buildCombinedZip,
      archiveCss: ARCHIVE_CSS,
      now: () => "2026-08-29T12:00:00.000Z",
      fileName: (selectedCourse) => `gradpack-${selectedCourse.name}.zip`,
      combinedFileName: () => "gradpack-combined.zip",
      download: (name, bytes) => downloads.push({ name, bytes: bytes.slice() }),
    };
    const runPlan = await createRunPlan({
      courses: selected,
      requestedPackaging: "per-course",
      signal: new AbortController().signal,
      dependencies: multiDependencies,
    });

    const result = await runCourses({
      plan: runPlan,
      signal: new AbortController().signal,
      progress: () => {},
      dependencies: multiDependencies,
    });

    expect(buildErrors).toEqual([]);
    expect(result.failedParts).toEqual([]);
    expect(downloads.map(({ name }) => name)).toEqual([
      "gradpack-ordinary.zip",
      "gradpack-disabled.zip",
      "gradpack-unfiled.zip",
      "gradpack-multipart-part-01-of-02.zip",
      "gradpack-multipart-part-02-of-02.zip",
    ]);
    expect(result.completedCourseIds).toEqual([101, 202, 303, 404]);
    const archives = downloads.map(({ bytes }) => unzipSync(bytes));
    for (const entries of archives) {
      verifyOfflineArchive(entries);
      expect(() =>
        normalizeArchiveManifest(
          JSON.parse(strFromU8(entries["manifest.json"]!)),
        ),
      ).not.toThrow();
    }
    expect(strFromU8(archives[1]!["index.html"]!)).toContain(
      "Module navigation is unavailable",
    );
    expect(strFromU8(archives[2]!["status.html"]!)).toContain("files/unfiled");
    const firstPart = archives[3]!;
    const secondPart = archives[4]!;
    expect(strFromU8(firstPart["modules.html"]!)).toContain(
      "Available in Part 2",
    );
    expect(strFromU8(firstPart["modules.html"]!)).not.toContain(
      'href="files/second.bin"',
    );
    expect(firstPart["files/large.bin"]).toBeDefined();
    expect(firstPart["files/second.bin"]).toBeUndefined();
    expect(secondPart["files/large.bin"]).toBeUndefined();
    expect(secondPart["files/second.bin"]).toBeDefined();
  });
});
