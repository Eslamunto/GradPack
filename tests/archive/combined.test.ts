import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildCourseZip } from "../../src/archive/build-zip";
import { ARCHIVE_CSS } from "../../src/archive/style";
import {
  buildCombinedZip,
  type CourseArchiveOutput,
} from "../../src/archive/combined";
import { buildManifest } from "../../src/archive/manifest";
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
  const manifest = buildManifest(
    plan,
    structuredClone(syntheticArchiveOutcomes),
    "2026-08-17T12:00:00.000Z",
  );
  const zipBytes = buildCourseZip({
    indexHtml: syntheticArchiveInput.indexHtml,
    archiveCss: ARCHIVE_CSS,
    manifest,
    entries: new Map(
      [...syntheticArchiveInput.entries].map(([path, bytes]) => [
        path,
        bytes.slice(),
      ]),
    ),
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
    expect(Object.keys(entries)).toEqual([
      "assets/archive.css",
      "courses/First Course-101/assets/archive.css",
      "courses/First Course-101/files/slides.pdf",
      "courses/First Course-101/index.html",
      "courses/First Course-101/manifest.json",
      "courses/First Course-101/pages/welcome.html",
      "courses/Second Course-202/assets/archive.css",
      "courses/Second Course-202/files/slides.pdf",
      "courses/Second Course-202/index.html",
      "courses/Second Course-202/manifest.json",
      "courses/Second Course-202/pages/welcome.html",
      "index.html",
      "manifest.json",
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
});
