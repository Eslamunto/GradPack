import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildCourseZip } from "../../src/archive/build-zip";
import { ARCHIVE_CSS } from "../../src/archive/style";
import {
  buildCombinedZip,
  combinedCourseRoot,
  type CourseArchiveOutput,
} from "../../src/archive/combined";
import { renderCoursePages } from "../../src/archive/course-pages";
import { relativeArchiveHref } from "../../src/archive/archive-links";
import { buildArchiveNavigationModel } from "../../src/archive/navigation-model";
import { renderSavedPageHtml } from "../../src/archive/sanitize";
import {
  syntheticArchiveInput,
  syntheticArchivePlan,
  syntheticArchiveOutcomes,
} from "../fixtures/course-plan";

const courseArchive = (id: number, name: string): CourseArchiveOutput => {
  const plan = {
    ...structuredClone(syntheticArchivePlan),
    course: {
      ...syntheticArchivePlan.course,
      id,
      name,
      courseCode: `SYN-${id}`,
    },
  };
  const outcomes = structuredClone(syntheticArchiveOutcomes);
  const root = combinedCourseRoot(plan.course);
  let model = buildArchiveNavigationModel(
    plan,
    outcomes,
    "2026-08-17T12:00:00.000Z",
  );
  const entries = new Map(
    [...syntheticArchiveInput.entries].map(([path, bytes]) => [
      path,
      bytes.slice(),
    ]),
  );
  const pagePath = "pages/welcome.html";
  const savedPage = strToU8(
    renderSavedPageHtml({
      model,
      pagePath,
      title: "Welcome",
      sanitizedFragment: "<p>Welcome</p>",
      combinedHomeHref: relativeArchiveHref(
        `${root}/${pagePath}`,
        "index.html",
      ),
    }),
  );
  entries.set(pagePath, savedPage);
  outcomes[1] = { ...outcomes[1]!, actualBytes: savedPage.byteLength };
  model = buildArchiveNavigationModel(
    plan,
    outcomes,
    "2026-08-17T12:00:00.000Z",
  );
  const manifest = model.manifest;
  const zipBytes = buildCourseZip({
    pages: renderCoursePages(model, {
      combinedHomeHref: relativeArchiveHref(`${root}/index.html`, "index.html"),
    }),
    archiveCss: ARCHIVE_CSS,
    manifest,
    entries,
  });
  return {
    course: plan.course,
    fileName: `gradpack-${id}.zip`,
    manifest,
    zipBytes,
  };
};

describe("buildCombinedZip", () => {
  it("namespaces colliding course entries and aggregates the manifest", () => {
    const result = buildCombinedZip({
      archives: [
        courseArchive(101, "First Course"),
        courseArchive(202, "Second Course"),
      ],
      archiveCss: "body{font-family:system-ui}",
      now: () => "2026-08-17T12:00:00.000Z",
      fileName: () => "gradpack-combined.zip",
    });
    const entries = unzipSync(result.zipBytes);
    const index = new DOMParser().parseFromString(
      strFromU8(entries["index.html"]!),
      "text/html",
    );
    expect(index.querySelectorAll(".course-card")).toHaveLength(2);
    expect(
      [...index.querySelectorAll("a")].map((link) => ({
        text: link.textContent,
        href: link.getAttribute("href"),
      })),
    ).toContainEqual({
      text: "First Course",
      href: "courses/First%20Course-101/index.html",
    });
    expect(strFromU8(entries["status.html"]!)).toContain(
      "Combined archive status",
    );
    const savedPage = new DOMParser().parseFromString(
      strFromU8(entries["courses/First Course-101/pages/welcome.html"]!),
      "text/html",
    );
    expect(
      [...savedPage.querySelectorAll("a")]
        .filter((link) => link.textContent === "Courses")
        .map((link) => link.getAttribute("href")),
    ).toContain("../../../index.html");
    expect(Object.keys(entries)).toEqual([
      "assets/archive.css",
      "courses/First Course-101/assets/archive.css",
      "courses/First Course-101/files.html",
      "courses/First Course-101/files/slides.pdf",
      "courses/First Course-101/index.html",
      "courses/First Course-101/manifest.json",
      "courses/First Course-101/modules.html",
      "courses/First Course-101/pages.html",
      "courses/First Course-101/pages/welcome.html",
      "courses/First Course-101/status.html",
      "courses/Second Course-202/assets/archive.css",
      "courses/Second Course-202/files.html",
      "courses/Second Course-202/files/slides.pdf",
      "courses/Second Course-202/index.html",
      "courses/Second Course-202/manifest.json",
      "courses/Second Course-202/modules.html",
      "courses/Second Course-202/pages.html",
      "courses/Second Course-202/pages/welcome.html",
      "courses/Second Course-202/status.html",
      "index.html",
      "manifest.json",
      "status.html",
    ]);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]!)) as {
      kind: string;
      courses: Array<{ courseId: number }>;
    };
    expect(manifest.kind).toBe("combined");
    expect(manifest.courses.map(({ courseId }) => courseId)).toEqual([
      101, 202,
    ]);
    expect(entries["courses/First Course-101/files/slides.pdf"]).toBeDefined();
  });

  it("rejects malformed nested course ZIPs", () => {
    const archive: CourseArchiveOutput = {
      ...courseArchive(303, "Broken Course"),
      zipBytes: strToU8("not a zip"),
    };
    expect(() =>
      buildCombinedZip({
        archives: [archive],
        archiveCss: "body{}",
        now: () => "2026-08-17T12:00:00.000Z",
        fileName: () => "gradpack-combined.zip",
      }),
    ).toThrow();
  });

  it("rejects an unsafe nested course shell", () => {
    const archive = courseArchive(404, "Unsafe Course");
    const entries = unzipSync(archive.zipBytes);
    entries["index.html"] = strToU8(
      strFromU8(entries["index.html"]!).replace(
        "</body>",
        "<script>alert(1)</script></body>",
      ),
    );
    archive.zipBytes = zipSync(entries);
    expect(() =>
      buildCombinedZip({
        archives: [archive],
        archiveCss: ARCHIVE_CSS,
        now: () => "2026-08-17T12:00:00.000Z",
        fileName: () => "gradpack-combined.zip",
      }),
    ).toThrow(TypeError);
  });
});
