import { relativeArchiveHref, type CourseHtmlPath } from "./archive-links";
import type {
  ArchiveNavigationModel,
  ArchiveResourceView,
} from "./navigation-model";
import { escapeHtml, renderArchiveShell, type ArchivePageKind } from "./shell";

const status = (resource: ArchiveResourceView): string =>
  `<span class="resource-status status-${resource.status}">${escapeHtml(resource.status)}</span>`;
const row = (
  pagePath: string,
  resource: ArchiveResourceView,
  title = resource.title,
  indent = 0,
): string => {
  let label = `<span>${escapeHtml(title)}</span>`;
  if (resource.status === "success" && resource.archivePath !== null)
    label = `<a href="${relativeArchiveHref(pagePath, resource.archivePath)}">${escapeHtml(title)}</a>`;
  else if (resource.status === "external" && resource.externalHref !== null)
    label = `<a href="${escapeHtml(resource.externalHref)}" rel="noopener noreferrer">${escapeHtml(title)} (external)</a>`;
  return `<li class="module-indent-${indent}">${label} ${status(resource)}</li>`;
};
const shell = (
  model: ArchiveNavigationModel,
  path: CourseHtmlPath,
  kind: ArchivePageKind,
  title: string,
  contentHtml: string,
  combinedHomeHref: string | null,
) =>
  renderArchiveShell({
    pagePath: path,
    pageKind: kind,
    title,
    course: model.manifest.course,
    combinedHomeHref,
    contentHtml,
  });

export const renderCoursePages = (
  model: ArchiveNavigationModel,
  options: Readonly<{ combinedHomeHref?: string }> = {},
): ReadonlyMap<CourseHtmlPath, string> => {
  const combined = options.combinedHomeHref ?? null;
  const modules = model.modules
    .map(
      (module) =>
        `<section class="module"><h2>${escapeHtml(module.name)}</h2><ol>${module.items.map((item) => (item.resource === null ? `<li class="module-indent-${item.indent}"><span>${escapeHtml(item.title)}</span> <span class="resource-status">unsupported</span></li>` : row("modules.html", item.resource, item.title, item.indent))).join("")}</ol></section>`,
    )
    .join("");
  const pages = model.resources
    .filter((resource) => resource.kind === "page")
    .map((resource) => row("pages.html", resource))
    .join("");
  const files = model.resources
    .filter((resource) => resource.kind === "file")
    .map((resource) => row("files.html", resource))
    .join("");
  const totals = model.manifest.totals;
  const home = `<header class="archive-header"><p class="eyebrow">GradPack offline archive</p><h1>${escapeHtml(model.manifest.course.name)}</h1><p>Browse this saved course without Canvas.</p></header><section class="panel"><h2>Course content</h2><p><a href="modules.html">View modules</a>, <a href="pages.html">pages</a>, <a href="files.html">files</a>, or <a href="status.html">archive status</a>.</p></section>`;
  const statusPage = `<h1>Archive status</h1><section class="status-grid"><div class="panel"><strong>${totals.success}</strong><br>Saved</div><div class="panel"><strong>${totals.unavailable}</strong><br>Unavailable</div><div class="panel"><strong>${totals.external}</strong><br>External</div></section><p><a href="manifest.json">View technical manifest</a></p><aside class="responsibility-notice"><h2>Course-material responsibility</h2><p>You are responsible for applicable copyright, licensing, confidentiality, and course-material restrictions.</p></aside>`;
  return new Map([
    [
      "files.html",
      shell(
        model,
        "files.html",
        "files",
        "Files",
        `<h1>Files</h1><ul class="resource-list">${files || "<li>No files were listed.</li>"}</ul>`,
        combined,
      ),
    ],
    [
      "index.html",
      shell(
        model,
        "index.html",
        "home",
        model.manifest.course.name,
        home,
        combined,
      ),
    ],
    [
      "modules.html",
      shell(
        model,
        "modules.html",
        "modules",
        "Modules",
        `<h1>Modules</h1>${modules || "<p>No modules were listed.</p>"}`,
        combined,
      ),
    ],
    [
      "pages.html",
      shell(
        model,
        "pages.html",
        "pages",
        "Pages",
        `<h1>Pages</h1><ul class="resource-list">${pages || "<li>No pages were listed.</li>"}</ul>`,
        combined,
      ),
    ],
    [
      "status.html",
      shell(
        model,
        "status.html",
        "status",
        "Archive status",
        statusPage,
        combined,
      ),
    ],
  ] as const);
};
