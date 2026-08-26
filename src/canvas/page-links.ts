import { CanvasResponseError } from "./http";
import { CANVAS_ORIGIN } from "../shared/constants";

const PAGE_TITLE_MAX_CHARACTERS = 500;
const ENCODED_SEPARATOR = /%(?:2f|5c)/iu;

const invalidPage = (): never => {
  throw new CanvasResponseError("Canvas returned an invalid page");
};

export const exactCanvasPage = (
  value: unknown,
): { title: string; body: string } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidPage();
  }
  let title: PropertyDescriptor | undefined;
  let body: PropertyDescriptor | undefined;
  try {
    title = Object.getOwnPropertyDescriptor(value, "title");
    body = Object.getOwnPropertyDescriptor(value, "body");
  } catch {
    return invalidPage();
  }
  if (
    !title ||
    !("value" in title) ||
    typeof title.value !== "string" ||
    title.value.length > PAGE_TITLE_MAX_CHARACTERS ||
    !body ||
    !("value" in body) ||
    typeof body.value !== "string"
  ) {
    return invalidPage();
  }
  return { title: title.value, body: body.value };
};

const exactPositiveId = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Invalid Canvas course ID");
  }
  return value;
};

export const pageLinkedFileIds = (body: string, courseId: number): number[] => {
  const selectedCourseId = exactPositiveId(courseId);
  const ids = new Set<number>();
  const expectedPath = new RegExp(
    `^/courses/${selectedCourseId}/files/([1-9]\\d*)(?:/download)?$`,
    "u",
  );
  const document = new DOMParser().parseFromString(body, "text/html");

  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (
      href === null ||
      href !== href.trim() ||
      href.includes("\\") ||
      ENCODED_SEPARATOR.test(href)
    ) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(href, CANVAS_ORIGIN);
    } catch {
      continue;
    }
    if (
      url.origin !== CANVAS_ORIGIN ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      continue;
    }
    const match = expectedPath.exec(url.pathname);
    if (
      !match ||
      (match[0].endsWith("/download")
        ? url.search !== ""
        : url.search !== "?wrap=1")
    ) {
      continue;
    }
    const fileId = Number(match[1]);
    if (Number.isSafeInteger(fileId) && fileId > 0) ids.add(fileId);
  }

  return [...ids].sort((left, right) => left - right);
};
