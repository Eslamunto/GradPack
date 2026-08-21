import { relativeArchiveHref } from "./archive-links";

export type ArchivePageKind =
  "home" | "modules" | "pages" | "files" | "status" | "saved-page";

export type ArchiveShellInput = Readonly<{
  pagePath: string;
  pageKind: ArchivePageKind;
  title: string;
  course: Readonly<{ name: string; courseCode: string }>;
  combinedHomeHref: string | null;
  contentHtml: string;
}>;

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });

const navigation = [
  ["home", "Home", "index.html"],
  ["modules", "Modules", "modules.html"],
  ["pages", "Pages", "pages.html"],
  ["files", "Files", "files.html"],
  ["status", "Archive Status", "status.html"],
] as const;

const archiveLink = (
  from: string,
  to: string,
  label: string,
  current = false,
) =>
  `<a href="${relativeArchiveHref(from, to)}"${current ? ' aria-current="page"' : ""}>${label}</a>`;

export const renderArchiveShell = (input: ArchiveShellInput): string => {
  const active = input.pageKind === "saved-page" ? "pages" : input.pageKind;
  const courseNav = navigation
    .map(([kind, label, path]) =>
      archiveLink(input.pagePath, path, label, kind === active),
    )
    .join("");
  const coursesHref =
    input.combinedHomeHref ?? relativeArchiveHref(input.pagePath, "index.html");
  const title = escapeHtml(input.title);
  const courseName = escapeHtml(input.course.name);
  const code = escapeHtml(input.course.courseCode);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — GradPack</title><link rel="stylesheet" href="${relativeArchiveHref(input.pagePath, "assets/archive.css")}"></head><body><a class="skip-link" href="#archive-main">Skip to content</a><div class="archive-layout"><nav class="global-rail" aria-label="Archive"><span class="gradpack-mark" aria-label="GradPack">GP</span>${archiveLink(input.pagePath, "index.html", "Archive", active === "home")}<a href="${escapeHtml(coursesHref)}">Courses</a>${archiveLink(input.pagePath, "status.html", "Status", active === "status")}</nav><nav class="course-navigation" aria-label="Course"><strong>${courseName}</strong><span class="course-code">${code}</span>${courseNav}</nav><div class="archive-workspace"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${escapeHtml(coursesHref)}">Courses</a><span aria-hidden="true">›</span><a href="${relativeArchiveHref(input.pagePath, "index.html")}">${courseName}</a><span aria-hidden="true">›</span><span>${title}</span></nav><main id="archive-main" tabindex="-1">${input.contentHtml}</main><footer class="archive-identity">Local GradPack archive</footer></div></div></body></html>`;
};
