import { vi, type Mock } from "vitest";
import { strToU8 } from "fflate";
import type { ArchiveInput } from "../../src/archive/build-zip";
import {
  CanvasCourseIndexUnavailableError,
  type CanvasHttp,
} from "../../src/canvas/http";
import type {
  CoursePlan,
  CourseSummary,
  ResourceOutcome,
} from "../../src/shared/model";

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

export const syntheticArchivePlan: CoursePlan = {
  course: syntheticCourse,
  advertisedBytes: 19,
  resources: [
    {
      key: "file:301",
      kind: "file",
      title: "slides.pdf",
      sourceId: "301",
      archivePath: "files/slides.pdf",
      advertisedBytes: 19,
      sourceUrl:
        "https://frankfurtschool.instructure.com/files/301/download?verifier=synthetic-secret",
    },
    {
      key: "page:welcome",
      kind: "page",
      title: "Welcome",
      sourceId: "welcome",
      archivePath: "pages/welcome.html",
      advertisedBytes: 0,
      sourceUrl: null,
    },
    {
      key: "external:401",
      kind: "external",
      title: "Public reference",
      sourceId: "401",
      archivePath: null,
      advertisedBytes: 0,
      sourceUrl: "https://reference.example/reading",
    },
    {
      key: "unsupported:501",
      kind: "unsupported",
      title: "Synthetic unsupported item",
      sourceId: "501",
      archivePath: null,
      advertisedBytes: 0,
      sourceUrl: null,
    },
  ],
  modules: [
    {
      id: 201,
      name: "Module One",
      position: 1,
      items: [
        {
          id: 301,
          title: "Slides",
          position: 1,
          resourceKey: "file:301",
          type: "File",
        },
        {
          id: 302,
          title: "Public reference",
          position: 2,
          resourceKey: "external:401",
          type: "ExternalUrl",
        },
      ],
    },
  ],
};

export const syntheticArchiveOutcomes: ResourceOutcome[] = [
  {
    ...syntheticArchivePlan.resources[0]!,
    status: "success",
    actualBytes: 19,
    failureCategory: null,
  },
  {
    ...syntheticArchivePlan.resources[1]!,
    status: "success",
    actualBytes: 29,
    failureCategory: null,
  },
  {
    ...syntheticArchivePlan.resources[2]!,
    status: "external",
    actualBytes: 0,
    failureCategory: null,
  },
  {
    ...syntheticArchivePlan.resources[3]!,
    status: "unsupported",
    actualBytes: 0,
    failureCategory: null,
  },
];

export const syntheticArchiveInput: ArchiveInput = {
  indexHtml:
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic Course</title><link rel="stylesheet" href="assets/archive.css"></head><body><main>Synthetic Course</main></body></html>',
  archiveCss: "body{font-family:system-ui}",
  manifest: {
    schemaVersion: 1,
    gradPackVersion: "0.1.0-alpha.1",
    createdAt: "2026-08-16T12:00:00.000Z",
    canvasHost: "frankfurtschool.instructure.com",
    course: { id: 101, name: "Synthetic Course", courseCode: "SYN-101" },
    totals: {
      success: 2,
      failed: 0,
      unavailable: 0,
      unsupported: 1,
      external: 1,
      advertisedBytes: 19,
      archivedBytes: 48,
    },
    resources: syntheticArchiveOutcomes.map((outcome) => ({
      key: outcome.key,
      kind: outcome.kind,
      title: outcome.title,
      sourceId: outcome.sourceId,
      archivePath: outcome.archivePath,
      advertisedBytes: outcome.advertisedBytes,
      status: outcome.status,
      actualBytes: outcome.actualBytes,
      failureCategory: outcome.failureCategory,
    })),
  },
  entries: new Map([
    ["files/slides.pdf", strToU8("synthetic PDF bytes")],
    ["pages/welcome.html", strToU8("<!doctype html><p>Welcome</p>")],
  ]),
};
