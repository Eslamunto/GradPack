import { strToU8, unzipSync, type Unzipped } from "fflate";
import { normalizeArchiveManifest } from "./manifest";
import { isCanonicalArchivePath, safeArchivePath } from "./paths";
import type { ArchiveManifest } from "./manifest";
import type { CourseSummary } from "../shared/model";
import { COURSE_HTML_PATHS, relativeArchiveHref } from "./archive-links";
import {
  buildDeterministicZip,
  MAX_CLASSIC_ZIP_ENTRIES,
  validateArchiveHtml,
  validateArchiveLinkTargets,
} from "./build-zip";
import { ARCHIVE_CSS } from "./style";
import { COURSES_HOME_LINK_CLASS } from "./shell";

const COURSE_CORE_PATHS = new Set([
  "assets/archive.css",
  "files.html",
  "index.html",
  "manifest.json",
  "modules.html",
  "pages.html",
  "status.html",
]);

export type CourseArchiveOutput = {
  course: CourseSummary;
  fileName: string;
  manifest: ArchiveManifest;
  moduleCount: number;
  itemCount: number;
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

const rewriteCoursesHomeLinks = (
  pagePath: string,
  root: string,
  validatedHtml: string,
): Uint8Array => {
  const document = new DOMParser().parseFromString(validatedHtml, "text/html");
  const selector = `a.${COURSES_HOME_LINK_CLASS}`;
  const marked = [...document.querySelectorAll(selector)];
  const globalLink = document.querySelector(`nav.global-rail > ${selector}`);
  const breadcrumbLink = document.querySelector(
    `nav.breadcrumbs > ${selector}`,
  );
  const standaloneHref = relativeArchiveHref(pagePath, "index.html");
  if (
    marked.length !== 2 ||
    globalLink === null ||
    breadcrumbLink === null ||
    globalLink === breadcrumbLink ||
    marked.some(
      (link) =>
        (link !== globalLink && link !== breadcrumbLink) ||
        link.textContent !== "Courses" ||
        link.getAttribute("href") !== standaloneHref,
    )
  ) {
    throw new TypeError("Invalid nested Courses links");
  }
  const standaloneAnchor = `<a class="${COURSES_HOME_LINK_CLASS}" href="${standaloneHref}">Courses</a>`;
  const fragments = validatedHtml.split(standaloneAnchor);
  if (fragments.length !== 3) {
    throw new TypeError("Invalid nested Courses links");
  }
  const combinedHref = relativeArchiveHref(`${root}/${pagePath}`, "index.html");
  const combinedAnchor = `<a class="${COURSES_HOME_LINK_CLASS}" href="${combinedHref}">Courses</a>`;
  return strToU8(fragments.join(combinedAnchor));
};

export const combinedCourseRoot = (course: CourseSummary): string =>
  safeArchivePath("courses", `${course.name}-${course.id}`);

const document = (
  title: string,
  active: "courses" | "status",
  content: string,
): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — GradPack</title><link rel="stylesheet" href="assets/archive.css"></head><body><a class="skip-link" href="#archive-main">Skip to content</a><div class="archive-layout"><nav class="global-rail" aria-label="Archive"><span class="gradpack-mark" aria-label="GradPack">GP</span><a href="index.html">Archive</a><a href="index.html"${active === "courses" ? ' aria-current="page"' : ""}>Courses</a><a href="status.html"${active === "status" ? ' aria-current="page"' : ""}>Status</a></nav><div class="archive-workspace combined-workspace"><main id="archive-main" tabindex="-1">${content}</main><footer class="archive-identity">Local GradPack archive</footer></div></div></body></html>`;

const rootIndex = (
  archives: readonly CourseArchiveOutput[],
  roots: readonly string[],
  manifest: CombinedArchiveManifest,
): string => {
  const cards = archives
    .map((archive, index) => {
      const root = roots[index]!;
      const inventory =
        archive.manifest.moduleDiscovery === "disabled"
          ? `Module navigation unavailable · ${archive.manifest.totals.success} saved resources`
          : `${archive.moduleCount} modules · ${archive.itemCount} module items · ${archive.manifest.totals.success} saved resources`;
      return `<article class="course-card panel"><p class="eyebrow">${escapeHtml(archive.course.courseCode)}</p><h2><a href="${encodedPath(`${root}/index.html`)}">${escapeHtml(archive.course.name)}</a></h2><p>${escapeHtml(inventory)}</p><p><a href="${encodedPath(`${root}/status.html`)}">View archive status</a></p></article>`;
    })
    .join("");
  return document(
    "GradPack archives",
    "courses",
    `<header class="archive-header"><p class="eyebrow">GradPack offline archive</p><h1>Your courses</h1><p>Browse ${manifest.courses.length} saved courses without Canvas.</p></header><section class="course-grid" aria-label="Saved courses">${cards}</section>`,
  );
};

const rootStatus = (
  archives: readonly CourseArchiveOutput[],
  roots: readonly string[],
  manifest: CombinedArchiveManifest,
): string =>
  document(
    "Combined archive status",
    "status",
    `<h1>Combined archive status</h1><section class="status-grid"><div class="panel"><strong>${manifest.courses.length}</strong><br>Courses</div><div class="panel"><strong>${manifest.totals.success}</strong><br>Saved</div><div class="panel"><strong>${manifest.totals.failed}</strong><br>Failed</div><div class="panel"><strong>${manifest.totals.unavailable}</strong><br>Unavailable</div><div class="panel"><strong>${manifest.totals.unsupported}</strong><br>Unsupported</div><div class="panel"><strong>${manifest.totals.external}</strong><br>External</div></section><h2>Course status</h2><ul class="resource-list">${archives.map((archive, index) => `<li><a href="${encodedPath(`${roots[index]!}/status.html`)}">${escapeHtml(archive.course.name)} status</a></li>`).join("")}</ul><p><a href="manifest.json">View technical manifest</a></p><aside class="responsibility-notice"><h2>Course-material responsibility</h2><p>You are responsible for applicable copyright, licensing, confidentiality, and course-material restrictions.</p></aside>`,
  );

export function buildCombinedZip(input: CombinedArchiveInput): {
  zipBytes: Uint8Array;
  manifest: CombinedArchiveManifest;
} {
  if (
    input.archives.length === 0 ||
    input.archiveCss !== ARCHIVE_CSS ||
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
  sources.set(
    "index.html",
    strToU8(rootIndex(input.archives, roots, manifest)),
  );
  sources.set(
    "manifest.json",
    strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  );
  sources.set(
    "status.html",
    strToU8(rootStatus(input.archives, roots, manifest)),
  );

  input.archives.forEach((archive, index) => {
    const root = roots[index]!;
    const entries: Unzipped = unzipSync(archive.zipBytes);
    const rewrittenHtml = new Map<string, Uint8Array>();
    const nestedManifest = normalizeArchiveManifest(archive.manifest);
    const expectedManifest = `${JSON.stringify(nestedManifest, null, 2)}\n`;
    if (
      !entries["manifest.json"] ||
      new TextDecoder().decode(entries["manifest.json"]) !== expectedManifest ||
      !entries["assets/archive.css"] ||
      new TextDecoder().decode(entries["assets/archive.css"]) !== ARCHIVE_CSS
    ) {
      throw new TypeError("Invalid nested course core");
    }
    const expectedPaths = new Set(COURSE_CORE_PATHS);
    for (const resource of nestedManifest.resources) {
      if (resource.status === "success" && resource.archivePath !== null) {
        expectedPaths.add(resource.archivePath);
      }
    }
    if (
      Object.keys(entries).length !== expectedPaths.size ||
      Object.keys(entries).some((path) => !expectedPaths.has(path))
    ) {
      throw new TypeError("Invalid nested course entry set");
    }
    for (const pagePath of COURSE_HTML_PATHS) {
      const bytes = entries[pagePath];
      if (!bytes) throw new TypeError("Missing nested course page");
      const validated = validateArchiveHtml(
        pagePath,
        new TextDecoder().decode(bytes),
      );
      rewrittenHtml.set(
        pagePath,
        rewriteCoursesHomeLinks(pagePath, root, validated),
      );
    }
    for (const resource of nestedManifest.resources) {
      if (
        resource.kind === "page" &&
        resource.status === "success" &&
        resource.archivePath !== null
      ) {
        const bytes = entries[resource.archivePath];
        if (!bytes) throw new TypeError("Missing nested saved page");
        const validated = validateArchiveHtml(
          resource.archivePath,
          new TextDecoder().decode(bytes),
        );
        rewrittenHtml.set(
          resource.archivePath,
          rewriteCoursesHomeLinks(resource.archivePath, root, validated),
        );
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
      sources.set(combinedPath, rewrittenHtml.get(path) ?? bytes);
    }
  });
  if (sources.size > MAX_CLASSIC_ZIP_ENTRIES) {
    throw new TypeError("Combined archive resource limit exceeded");
  }
  validateArchiveHtml(
    "index.html",
    new TextDecoder().decode(sources.get("index.html")),
  );
  validateArchiveHtml(
    "status.html",
    new TextDecoder().decode(sources.get("status.html")),
  );
  const combinedPaths = new Set(sources.keys());
  for (const [path, bytes] of sources) {
    if (path.endsWith(".html")) {
      validateArchiveLinkTargets(
        path,
        new TextDecoder().decode(bytes),
        combinedPaths,
      );
    }
  }
  return { zipBytes: buildDeterministicZip(sources), manifest };
}
