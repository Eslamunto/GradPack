import { posix } from "node:path";
import { strFromU8, strToU8, unzipSync, type Unzipped } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildCombinedZip,
  combinedCourseRoot,
  type CourseArchiveOutput,
} from "../../src/archive/combined";
import { ARCHIVE_CSS } from "../../src/archive/style";
import {
  buildCourseArchive,
  type CourseArchiveDependencies,
} from "../../src/page/run-course";
import type { CoursePlan, CourseSummary } from "../../src/shared/model";
import { syntheticArchivePlan } from "../fixtures/course-plan";

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

    const second = course(202, "Second Course");
    const archives = await Promise.all(
      [first, second].map((selected) =>
        buildCourse(selected, combinedCourseRoot(selected)),
      ),
    );
    const combined = buildCombinedZip({
      archives,
      archiveCss: ARCHIVE_CSS,
      now: () => "2026-08-21T12:00:00.000Z",
      fileName: () => "gradpack-combined.zip",
    });
    const combinedEntries = unzipSync(combined.zipBytes);
    verifyOfflineArchive(combinedEntries);
    expect(combined.manifest.courses).toHaveLength(2);
    expect(combined.manifest.totals.success).toBe(4);
  });
});
