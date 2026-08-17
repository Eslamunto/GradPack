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

const courseRoot = (course: CourseSummary): string =>
  safeArchivePath("courses", `${course.name}-${course.id}`);

const rootIndex = (
  archives: readonly CourseArchiveOutput[],
  roots: readonly string[],
): string => {
  const links = archives
    .map((archive, index) => {
      const root = roots[index]!;
      return `<li><a href="${encodedPath(`${root}/index.html`)}">${escapeHtml(archive.course.name)}</a> <span>${escapeHtml(archive.course.courseCode)}</span></li>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GradPack archives</title><link rel="stylesheet" href="assets/archive.css"></head><body><main><h1>GradPack archives</h1><p>Combined local course archive.</p><ul>${links}</ul></main></body></html>`;
};

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
  const roots = input.archives.map(({ course }) => courseRoot(course));
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
  sources.set("index.html", strToU8(rootIndex(input.archives, roots)));
  sources.set(
    "manifest.json",
    strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  );

  input.archives.forEach((archive, index) => {
    const root = roots[index]!;
    const entries: Unzipped = unzipSync(archive.zipBytes);
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
  if (sources.size > MAX_ARCHIVE_RESOURCES + 3) {
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
