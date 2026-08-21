import { isCanonicalArchivePath } from "./paths";

export const COURSE_HTML_PATHS = Object.freeze([
  "files.html",
  "index.html",
  "modules.html",
  "pages.html",
  "status.html",
] as const);

export type CourseHtmlPath = (typeof COURSE_HTML_PATHS)[number];

const encodePath = (segments: readonly string[]): string =>
  segments.map(encodeURIComponent).join("/");

export const relativeArchiveHref = (
  fromPath: string,
  toPath: string,
): string => {
  if (!isCanonicalArchivePath(fromPath) || !isCanonicalArchivePath(toPath)) {
    throw new TypeError("Invalid archive link path");
  }
  const from = fromPath.split("/").slice(0, -1);
  const to = toPath.split("/");
  let shared = 0;
  while (shared < from.length && from[shared] === to[shared]) shared += 1;
  return [
    ...from.slice(shared).map(() => ".."),
    ...to.slice(shared).map((segment) => encodeURIComponent(segment)),
  ].join("/");
};
