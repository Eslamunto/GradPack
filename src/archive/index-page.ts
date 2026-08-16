import { isCanonicalArchivePath } from "./paths";
import { buildManifest, type ArchiveManifestResource } from "./manifest";
import type { CoursePlan, ResourceOutcome } from "../shared/model";

const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu;

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const comparePosition = (
  left: { position: number; id: number },
  right: { position: number; id: number },
): number => left.position - right.position || left.id - right.id;

const encodeArchiveHref = (path: string): string =>
  path.split("/").map(encodeURIComponent).join("/");

const safeExternalHref = (value: string | null): string | null => {
  if (
    value === null ||
    value !== value.trim() ||
    CONTROL.test(value) ||
    ENCODED_CONTROL.test(value)
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  return url.href;
};

const localHref = (resource: ArchiveManifestResource): string | null => {
  if (
    resource.status !== "success" ||
    resource.archivePath === null ||
    !isCanonicalArchivePath(resource.archivePath) ||
    (resource.kind === "file" && !resource.archivePath.startsWith("files/")) ||
    (resource.kind === "page" && !resource.archivePath.startsWith("pages/"))
  ) {
    return null;
  }
  return encodeArchiveHref(resource.archivePath);
};

const statusText = (resource: ArchiveManifestResource): string =>
  resource.failureCategory === null
    ? resource.status
    : `${resource.status} (${resource.failureCategory})`;

const resourceRow = (
  title: string,
  resource: ArchiveManifestResource | undefined,
  externalHref: string | null,
): string => {
  if (!resource) {
    return `<li><span>${escapeHtml(title)}</span> <span class="resource-status">unsupported</span></li>`;
  }
  const local = localHref(resource);
  if (local !== null) {
    return `<li><a href="${escapeHtml(local)}">${escapeHtml(title)}</a> <span class="resource-status">${escapeHtml(statusText(resource))}</span></li>`;
  }
  if (resource.status === "external" && externalHref !== null) {
    return `<li><a href="${escapeHtml(externalHref)}" rel="noopener noreferrer">${escapeHtml(title)} (external)</a> <span class="resource-status">external</span></li>`;
  }
  return `<li><span>${escapeHtml(title)}</span> <span class="resource-status">${escapeHtml(statusText(resource))}</span></li>`;
};

export function renderIndexPage(
  plan: CoursePlan,
  outcomes: ResourceOutcome[],
  createdAt: string,
): string;
export function renderIndexPage(
  plan: unknown,
  outcomes: unknown,
  createdAt: unknown,
): string {
  const manifest = buildManifest(
    plan as CoursePlan,
    outcomes as ResourceOutcome[],
    createdAt as string,
  );
  const validatedPlan = plan as CoursePlan;
  const byKey = new Map(
    manifest.resources.map((resource) => [resource.key, resource]),
  );
  const sourceByKey = new Map(
    validatedPlan.resources.map((resource) => [
      resource.key,
      resource.sourceUrl,
    ]),
  );
  const modules = [...validatedPlan.modules]
    .sort(comparePosition)
    .map((module) => {
      const items = [...module.items]
        .sort(comparePosition)
        .map((item) => {
          const resource =
            item.resourceKey === null ? undefined : byKey.get(item.resourceKey);
          const external =
            item.resourceKey === null
              ? null
              : safeExternalHref(sourceByKey.get(item.resourceKey) ?? null);
          return resourceRow(item.title, resource, external);
        })
        .join("");
      return `<section class="module"><h2>${escapeHtml(module.name)}</h2><ol>${items}</ol></section>`;
    })
    .join("");
  const allResources = manifest.resources
    .map((resource) =>
      resourceRow(
        resource.title,
        resource,
        safeExternalHref(sourceByKey.get(resource.key) ?? null),
      ),
    )
    .join("");
  const totals = manifest.totals;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(manifest.course.name)} — GradPack</title><link rel="stylesheet" href="assets/archive.css"></head><body><main><header class="archive-header"><p class="eyebrow">GradPack offline archive</p><h1>${escapeHtml(manifest.course.name)}</h1><dl class="metadata"><div><dt>Course code</dt><dd>${escapeHtml(manifest.course.courseCode)}</dd></div><div><dt>Exported</dt><dd>${escapeHtml(manifest.createdAt)}</dd></div><div><dt>Canvas host</dt><dd>${escapeHtml(manifest.canvasHost)}</dd></div></dl></header><section class="summary" aria-labelledby="summary-title"><h2 id="summary-title">Archive summary</h2><ul><li>${totals.success} successful</li><li>${totals.failed} failed</li><li>${totals.unavailable} unavailable</li><li>${totals.unsupported} unsupported</li><li>${totals.external} external</li><li>${totals.advertisedBytes} bytes advertised</li><li>${totals.archivedBytes} bytes archived</li></ul></section><section aria-labelledby="modules-title"><h2 id="modules-title">Modules</h2>${modules || "<p>No modules were listed.</p>"}</section><section aria-labelledby="resources-title"><h2 id="resources-title">All resources</h2><ul class="all-resources">${allResources || "<li>No resources were listed.</li>"}</ul></section><aside class="responsibility-notice"><h2>Course-material responsibility</h2><p>You are responsible for applicable copyright, licensing, confidentiality, and course-material restrictions.</p></aside></main></body></html>`;
}
