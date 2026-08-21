import {
  strToU8,
  unzipSync,
  zipSync,
  type Unzipped,
  type Zippable,
} from "fflate";
import { MAX_ARCHIVE_RESOURCES } from "./manifest";
import { isCanonicalArchivePath, safeArchivePath } from "./paths";
import type { ArchiveManifest } from "./manifest";
import type { CourseSummary } from "../shared/model";
import { COURSE_HTML_PATHS } from "./archive-links";
import { validateArchiveHtml } from "./build-zip";

export type CourseArchiveOutput = {
  course: CourseSummary;
  fileName: string;
  manifest: ArchiveManifest;
  zipBytes: Uint8Array;
};

export type CombinedArchiveManifest = {
  schemaVersion: 1;
  kind: "combined";
  createdAt: string;
  courses: readonly {
    courseId: number;
    fileName: string;
    manifest: ArchiveManifest;
  }[];
  totals: {
    success: number;
    failed: number;
    unavailable: number;
    unsupported: number;
    external: number;
  };
};

export type CombinedArchiveOutput = {
  fileName: string;
  manifest: CombinedArchiveManifest;
  zipBytes: Uint8Array;
};

export type CombinedArchiveInput = {
  archives: readonly CourseArchiveOutput[];
  archiveCss: string;
  now: () => string;
  fileName: (courses: readonly CourseSummary[]) => string;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>'"]/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });

const encodedPath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export const combinedCourseRoot = (course: CourseSummary): string =>
  safeArchivePath("courses", `${course.name}-${course.id}`);

const document = (title: string, active: "courses" | "status", content: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — GradPack</title><link rel="stylesheet" href="assets/archive.css"></head><body><a class="skip-link" href="#archive-main">Skip to content</a><div class="archive-layout"><nav class="global-rail" aria-label="Archive"><span class="gradpack-mark" aria-label="GradPack">GP</span><a href="index.html">Archive</a><a href="index.html"${active === "courses" ? ' aria-current="page"' : ""}>Courses</a><a href="status.html"${active === "status" ? ' aria-current="page"' : ""}>Status</a></nav><div class="archive-workspace combined-workspace"><main id="archive-main" tabindex="-1">${content}</main><footer class="archive-identity">Local GradPack archive</footer></div></div></body></html>`;

const rootIndex = (
  archives: readonly CourseArchiveOutput[],
  roots: readonly string[],
  manifest: CombinedArchiveManifest,
): string => {
  const cards = archives
    .map((archive, index) => {
      const root = roots[index]!;
      return `<article class="course-card panel"><p class="eyebrow">${escapeHtml(archive.course.courseCode)}</p><h2><a href="${encodedPath(`${root}/index.html`)}">${escapeHtml(archive.course.name)}</a></h2><p>${archive.manifest.totals.success} saved resources</p></article>`;
    })
    .join("");
  return document("GradPack archives", "courses", `<header class="archive-header"><p class="eyebrow">GradPack offline archive</p><h1>Your courses</h1><p>Browse ${manifest.courses.length} saved courses without Canvas.</p></header><section class="course-grid" aria-label="Saved courses">${cards}</section>`);
};

const rootStatus = (manifest: CombinedArchiveManifest): string =>
  document("Combined archive status", "status", `<h1>Combined archive status</h1><section class="status-grid"><div class="panel"><strong>${manifest.courses.length}</strong><br>Courses</div><div class="panel"><strong>${manifest.totals.success}</strong><br>Saved</div><div class="panel"><strong>${manifest.totals.unavailable}</strong><br>Unavailable</div></section><p><a href="manifest.json">View technical manifest</a></p><aside class="responsibility-notice"><h2>Course-material responsibility</h2><p>You are responsible for applicable copyright, licensing, confidentiality, and course-material restrictions.</p></aside>`);

export function buildCombinedZip(input: CombinedArchiveInput): {
  zipBytes: Uint8Array;
  manifest: CombinedArchiveManifest;
} {
  if (
    input.archives.length === 0 ||
    typeof input.archiveCss !== "string" ||
    typeof input.now !== "function" ||
    typeof input.fileName !== "function"
  ) {
    throw new TypeError("Invalid combined archive input");
  }
  const roots = input.archives.map(({ course }) => combinedCourseRoot(course));
  if (new Set(roots).size !== roots.length) {
    throw new TypeError("Conflicting combined course paths");
  }
  const manifest: CombinedArchiveManifest = {
    schemaVersion: 1,
    kind: "combined",
    createdAt: input.now(),
    courses: input.archives.map(
      ({ course, fileName, manifest: courseManifest }) => ({
        courseId: course.id,
        fileName,
        manifest: courseManifest,
      }),
    ),
    totals: input.archives.reduce(
      (totals, archive) => ({
        success: totals.success + archive.manifest.totals.success,
        failed: totals.failed + archive.manifest.totals.failed,
        unavailable: totals.unavailable + archive.manifest.totals.unavailable,
        unsupported: totals.unsupported + archive.manifest.totals.unsupported,
        external: totals.external + archive.manifest.totals.external,
      }),
      { success: 0, failed: 0, unavailable: 0, unsupported: 0, external: 0 },
    ),
  };
  const sources = new Map<string, Uint8Array>();
  sources.set("assets/archive.css", strToU8(input.archiveCss));
  sources.set("index.html", strToU8(rootIndex(input.archives, roots, manifest)));
  sources.set(
    "manifest.json",
    strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  );
  sources.set("status.html", strToU8(rootStatus(manifest)));

  input.archives.forEach((archive, index) => {
    const root = roots[index]!;
    const entries: Unzipped = unzipSync(archive.zipBytes);
    for (const pagePath of COURSE_HTML_PATHS) {
      const bytes = entries[pagePath];
      if (!bytes) throw new TypeError("Missing nested course page");
      validateArchiveHtml(pagePath, new TextDecoder().decode(bytes));
    }
    for (const resource of archive.manifest.resources) {
      if (
        resource.kind === "page" &&
        resource.status === "success" &&
        resource.archivePath !== null
      ) {
        const bytes = entries[resource.archivePath];
        if (!bytes) throw new TypeError("Missing nested saved page");
        validateArchiveHtml(resource.archivePath, new TextDecoder().decode(bytes));
      }
    }
    for (const [path, bytes] of Object.entries(entries)) {
      if (!isCanonicalArchivePath(path)) {
        throw new TypeError("Invalid nested archive path");
      }
      const combinedPath = `${root}/${path}`;
      if (!isCanonicalArchivePath(combinedPath) || sources.has(combinedPath)) {
        throw new TypeError("Conflicting combined archive path");
      }
      sources.set(combinedPath, bytes);
    }
  });
  if (sources.size > MAX_ARCHIVE_RESOURCES + 7) {
    throw new TypeError("Combined archive resource limit exceeded");
  }
  const zipEntries: Zippable = Object.create(null) as Zippable;
  for (const [path, bytes] of [...sources].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    zipEntries[path] = [bytes, { level: 6, os: 3, attrs: 0o100644 * 65_536 }];
  }
  return { zipBytes: zipSync(zipEntries, { level: 6 }), manifest };
}
