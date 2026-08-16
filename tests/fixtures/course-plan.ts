import { vi, type Mock } from "vitest";
import {
  CanvasCourseIndexUnavailableError,
  type CanvasHttp,
} from "../../src/canvas/http";
import type { CoursePlan, CourseSummary } from "../../src/shared/model";

export const syntheticCourse: CourseSummary = {
  id: 101,
  name: "Synthetic Course",
  courseCode: "SYN-101",
  workflowState: "available",
  concluded: false,
};

export type SyntheticOptions = {
  moduleItemsInline?: boolean;
  duplicateFileId?: boolean;
  pageToken?: string;
  unsupportedItemType?: string;
  unavailableIndexes?: Partial<
    Record<"files" | "folders" | "pages", 403 | 404>
  >;
  modules?: unknown[];
  files?: unknown[];
  folders?: unknown[];
  pages?: unknown[];
  fileDetails?: Record<number, unknown>;
};

export type SyntheticHttp = CanvasHttp & {
  fetchAll: Mock<(url: URL) => Promise<unknown[]>>;
  json: Mock<(url: URL) => Promise<{ value: unknown }>>;
};

export function syntheticCanvasHttp(
  options: SyntheticOptions = {},
): SyntheticHttp {
  const itemType = options.unsupportedItemType ?? "File";
  const item = {
    id: 301,
    title: itemType === "File" ? "slides.pdf" : "Unsupported item",
    position: 1,
    type: itemType,
    ...(itemType === "File" ? { content_id: 301 } : {}),
  };
  const module = {
    id: 201,
    name: "Module One",
    position: 1,
    ...(options.moduleItemsInline === false ? {} : { items: [item] }),
  };
  const file = {
    id: 301,
    folder_id: 401,
    display_name: "slides.pdf",
    filename: "slides.pdf",
    size: 19,
    url: "https://frankfurtschool.instructure.com/files/301/download",
  };
  const files =
    options.files ?? (options.duplicateFileId ? [file, { ...file }] : [file]);
  const fetchAll = vi.fn(async (url: URL): Promise<unknown[]> => {
    await Promise.resolve();
    if (url.pathname.endsWith("/modules")) {
      return options.modules ?? [module];
    }
    if (url.pathname.endsWith("/modules/201/items")) return [item];
    if (url.pathname.endsWith("/files")) {
      const status = options.unavailableIndexes?.files;
      if (status) throw new CanvasCourseIndexUnavailableError(status);
      return files;
    }
    if (url.pathname.endsWith("/folders")) {
      const status = options.unavailableIndexes?.folders;
      if (status) throw new CanvasCourseIndexUnavailableError(status);
      return (
        options.folders ?? [{ id: 401, full_name: "course files/Week One" }]
      );
    }
    if (url.pathname.endsWith("/pages")) {
      const status = options.unavailableIndexes?.pages;
      if (status) throw new CanvasCourseIndexUnavailableError(status);
      return (
        options.pages ?? [
          {
            page_id: 501,
            url: options.pageToken ?? "welcome",
            title: "Welcome",
          },
        ]
      );
    }
    throw new TypeError(`Unexpected fixture path: ${url.pathname}`);
  });
  const json = vi.fn(async (url: URL): Promise<{ value: unknown }> => {
    await Promise.resolve();
    const match = /\/files\/(\d+)$/.exec(url.pathname);
    if (!match)
      throw new TypeError(`Unexpected fixture detail path: ${url.pathname}`);
    const id = Number(match[1]);
    const detail = options.fileDetails?.[id];
    if (detail !== undefined) return { value: detail };
    const indexed = files.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        Object.hasOwn(candidate, "id") &&
        (candidate as { id?: unknown }).id === id,
    );
    return {
      value:
        indexed ??
        (id === 301
          ? file
          : {
              id,
              display_name: `file-${id}.bin`,
              filename: `file-${id}.bin`,
              size: id,
              url: `https://frankfurtschool.instructure.com/files/${id}/download`,
            }),
    };
  });
  return { fetchAll, json } as unknown as SyntheticHttp;
}

export function planWithOneFile(size: number | null): CoursePlan {
  return {
    course: syntheticCourse,
    modules: [],
    advertisedBytes: size ?? 0,
    resources: [
      {
        key: "file:301",
        kind: "file",
        title: "slides.pdf",
        sourceId: "301",
        archivePath: "files/slides.pdf",
        advertisedBytes: size,
        sourceUrl: "https://frankfurtschool.instructure.com/files/301/download",
      },
    ],
  };
}
