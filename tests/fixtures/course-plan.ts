import { strToU8 } from "fflate";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi, type Mock } from "vitest";
import { ARCHIVE_CSS } from "../../src/archive/style";
import { discoverCoursePlan } from "../../src/canvas/discovery";
import type { ArchiveInput } from "../../src/archive/build-zip";
import {
  CanvasCourseIndexUnavailableError,
  CanvasCourseModulesDisabledError,
  CanvasHttp,
  CanvasResourceUnavailableError,
} from "../../src/canvas/http";
import {
  fetchFileResource,
  fetchPageResource,
  runCourse,
} from "../../src/page/run-course";
import {
  CANVAS_ORIGIN,
  CANVAS_PAGE_JSON_MAX_BYTES,
} from "../../src/shared/constants";
import type {
  CoursePlan,
  CourseSummary,
  PlannedResource,
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
  modulesDisabled?: boolean;
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
  pageDetails?: Record<string, unknown>;
  fileDetailStatuses?: Partial<Record<number, 403 | 404>>;
  pageResourceStatuses?: Partial<Record<string, 403 | 404>>;
};

export type SyntheticHttp = CanvasHttp & {
  fetchAll: Mock<(url: URL) => Promise<unknown[]>>;
  json: Mock<(url: URL) => Promise<{ value: unknown }>>;
  jsonBoundedResource: Mock<
    (url: URL, maximumBytes: number) => Promise<{ value: unknown }>
  >;
};

export function syntheticCanvasHttp(
  options: SyntheticOptions = {},
): SyntheticHttp {
  const itemType = options.unsupportedItemType ?? "File";
  const item = {
    id: 301,
    title: itemType === "File" ? "slides.pdf" : "Unsupported item",
    position: 1,
    indent: 0,
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
      if (options.modulesDisabled) {
        throw new CanvasCourseModulesDisabledError(
          "Canvas course Modules are disabled",
        );
      }
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
  const jsonBoundedResource = vi.fn(
    async (url: URL, maximumBytes: number): Promise<{ value: unknown }> => {
      await Promise.resolve();
      if (maximumBytes !== CANVAS_PAGE_JSON_MAX_BYTES) {
        throw new TypeError("Unexpected fixture bounded JSON limit");
      }
      const fileMatch = /\/files\/(\d+)$/.exec(url.pathname);
      if (fileMatch) {
        const id = Number(fileMatch[1]);
        const status = options.fileDetailStatuses?.[id];
        if (status) throw new CanvasResourceUnavailableError(status);
        return json(url);
      }
      const pageMatch = /\/pages\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
      if (pageMatch) {
        const token = pageMatch[1]!;
        const status = options.pageResourceStatuses?.[token];
        if (status) throw new CanvasResourceUnavailableError(status);
        const detail = options.pageDetails?.[token];
        if (detail !== undefined) return { value: detail };
        const indexed = (options.pages ?? []).find(
          (candidate) =>
            typeof candidate === "object" &&
            candidate !== null &&
            Object.hasOwn(candidate, "url") &&
            (candidate as { url?: unknown }).url === token,
        );
        const title =
          indexed &&
          Object.hasOwn(indexed, "title") &&
          typeof (indexed as { title?: unknown }).title === "string"
            ? (indexed as { title: string }).title
            : token;
        return { value: { title, body: "" } };
      }
      throw new TypeError(
        `Unexpected fixture bounded detail path: ${url.pathname}`,
      );
    },
  );
  return { fetchAll, json, jsonBoundedResource } as unknown as SyntheticHttp;
}

export function planWithOneFile(size: number | null): CoursePlan {
  return {
    course: syntheticCourse,
    moduleDiscovery: "available",
    modules: [],
    folderPathFallbackKeys: [],
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

export function unknownFileResource(
  fileId = 777,
  course: CourseSummary = syntheticCourse,
): PlannedResource {
  return {
    key: `file:${fileId}`,
    kind: "file",
    title: `file-${fileId}`,
    sourceId: String(fileId),
    archivePath: `files/file-${fileId}`,
    advertisedBytes: null,
    sourceUrl: `${CANVAS_ORIGIN}/courses/${course.id}/files/${fileId}/download`,
  };
}

export const syntheticArchivePlan: CoursePlan = {
  course: syntheticCourse,
  moduleDiscovery: "available",
  folderPathFallbackKeys: [],
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
          indent: 0,
          resourceKey: "file:301",
          type: "File",
        },
        {
          id: 302,
          title: "Public reference",
          position: 2,
          indent: 0,
          resourceKey: "external:401",
          type: "ExternalUrl",
        },
      ],
    },
  ],
};

export const syntheticSavedPageHtml =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome — GradPack</title><link rel="stylesheet" href="../assets/archive.css"></head><body><a class="skip-link" href="#archive-main">Skip to content</a><div class="archive-layout"><main id="archive-main" tabindex="-1"><article class="saved-page-content"><h1>Welcome</h1><p>Welcome</p></article></main></div></body></html>';

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
    actualBytes: strToU8(syntheticSavedPageHtml).byteLength,
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
  archiveRoot: null,
  pages: new Map(
    [
      "files.html",
      "index.html",
      "modules.html",
      "pages.html",
      "status.html",
    ].map((path) => [
      path,
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Course</title><link rel="stylesheet" href="assets/archive.css"></head><body><main>Synthetic Course</main></body></html>',
    ]),
  ) as ArchiveInput["pages"],
  archiveCss: "body{font-family:system-ui}",
  manifest: {
    schemaVersion: 1,
    gradPackVersion: "0.1.0-alpha.6",
    createdAt: "2026-08-16T12:00:00.000Z",
    canvasHost: "frankfurtschool.instructure.com",
    course: { id: 101, name: "Synthetic Course", courseCode: "SYN-101" },
    moduleDiscovery: "available",
    part: { index: 1, total: 1 },
    courseTotals: {
      advertisedBytes: 19,
      resourceCount: syntheticArchivePlan.resources.length,
      unknownSizeCount: 0,
      folderPathFallbackCount: 0,
    },
    totals: {
      success: 2,
      failed: 0,
      unavailable: 0,
      unsupported: 1,
      external: 1,
      advertisedBytes: 19,
      archivedBytes: 19 + strToU8(syntheticSavedPageHtml).byteLength,
    },
    resourceCatalog: syntheticArchivePlan.resources.map((resource) => ({
      key: resource.key,
      kind: resource.kind,
      title: resource.title,
      partIndex: 1,
      folderPathFallback: false,
    })),
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
    ["pages/welcome.html", strToU8(syntheticSavedPageHtml)],
  ]),
};

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve("tests/fixtures/canvas", name), "utf8")) as T;

type SyntheticPilotOptions = {
  unavailableFile?: boolean;
  pageOnlyFile?: boolean;
};

export const SYNTHETIC_PAGE_ONLY_FILE_ID = 777;
export const SYNTHETIC_PAGE_ONLY_FILE_CONTENT = "synthetic page-only bytes";

type SyntheticPilotResult = {
  zipBytes: Uint8Array;
  requestedUrls: URL[];
  requestHeaders: Array<Array<[string, string]>>;
  maximumConcurrency: number;
};

const exactRequest = (
  url: URL,
  init: RequestInit | undefined,
): Array<[string, string]> => {
  if (
    url.origin !== CANVAS_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    init?.method !== "GET" ||
    init.credentials !== "include" ||
    init.redirect !== "follow" ||
    init.body !== undefined
  ) {
    throw new TypeError("Unexpected synthetic request boundary");
  }
  const api = url.pathname.startsWith("/api/v1/");
  const headers = [...new Headers(init.headers).entries()];
  const expected: Array<[string, string]> = api
    ? [["accept", "application/json"]]
    : [];
  if (
    headers.length !== expected.length ||
    headers.some(
      ([name, value], index) =>
        name !== expected[index]?.[0] || value !== expected[index]?.[1],
    )
  ) {
    throw new TypeError("Unexpected synthetic request headers");
  }
  return headers;
};

const responseAt = (
  url: URL,
  body: BodyInit | null,
  init: ResponseInit,
): Response => {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url.href });
  return response;
};

export async function runSyntheticPilot(
  options: SyntheticPilotOptions = {},
): Promise<SyntheticPilotResult> {
  const pageOnlyFile = options.pageOnlyFile === true;
  const modules = pageOnlyFile
    ? [
        {
          id: 201,
          name: "Module One",
          position: 1,
          items: [
            {
              id: 301,
              title: "Welcome Page",
              position: 1,
              type: "Page",
              page_url: "welcome",
            },
          ],
        },
      ]
    : fixture<unknown[]>("modules.json");
  const files = pageOnlyFile ? [] : fixture<unknown[]>("files.json");
  const pages = fixture<unknown[]>("pages.json");
  const pageBody = pageOnlyFile
    ? `<p>Welcome to the synthetic course. <a href="/courses/101/files/${SYNTHETIC_PAGE_ONLY_FILE_ID}?wrap=1">Open the page-only file</a>.</p>`
    : readFileSync(resolve("tests/fixtures/canvas/page.html"), "utf8");
  const requestedUrls: URL[] = [];
  const requestHeaders: Array<Array<[string, string]>> = [];
  let activeRequests = 0;
  let maximumConcurrency = 0;

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    requestHeaders.push(exactRequest(url, init));
    requestedUrls.push(new URL(url));
    activeRequests += 1;
    maximumConcurrency = Math.max(maximumConcurrency, activeRequests);
    await Promise.resolve();
    activeRequests -= 1;

    const json = (value: unknown): Response =>
      responseAt(url, JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const route = `${url.pathname}${url.search}`;
    if (
      route ===
      "/api/v1/courses/101/modules?include%5B%5D=items&include%5B%5D=content_details&per_page=100"
    ) {
      return json(modules);
    }
    if (route === "/api/v1/courses/101/files?per_page=100") {
      return json(files);
    }
    if (route === "/api/v1/courses/101/folders?per_page=100") {
      return json([{ id: 401, full_name: "course files" }]);
    }
    if (route === "/api/v1/courses/101/pages?per_page=100") {
      return json(pages);
    }
    if (route === "/api/v1/courses/101/pages/welcome") {
      return json({ title: "Welcome Page", body: pageBody });
    }
    if (
      pageOnlyFile &&
      route === `/api/v1/courses/101/files/${SYNTHETIC_PAGE_ONLY_FILE_ID}`
    ) {
      return responseAt(url, null, { status: 404 });
    }
    if (
      pageOnlyFile &&
      route === `/courses/101/files/${SYNTHETIC_PAGE_ONLY_FILE_ID}/download`
    ) {
      if (options.unavailableFile) {
        return responseAt(url, null, { status: 404 });
      }
      return responseAt(url, strToU8(SYNTHETIC_PAGE_ONLY_FILE_CONTENT), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(
            strToU8(SYNTHETIC_PAGE_ONLY_FILE_CONTENT).byteLength,
          ),
        },
      });
    }
    if (route === "/files/301/download?verifier=synthetic-boundary-marker") {
      if (options.unavailableFile) {
        return responseAt(url, null, { status: 404 });
      }
      return responseAt(url, strToU8("synthetic PDF bytes"), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-length": "19",
        },
      });
    }
    throw new TypeError("Unexpected synthetic route");
  };

  const controller = new AbortController();
  let downloaded: Uint8Array | undefined;
  const result = await runCourse({
    course: syntheticCourse,
    signal: controller.signal,
    progress: () => {},
    dependencies: {
      discover: async (course, signal) =>
        discoverCoursePlan(new CanvasHttp(fakeFetch, signal), course),
      retrieve: async (resource, plan, signal, remainingBytes) => {
        if (resource.kind === "file") {
          return fetchFileResource(
            resource,
            signal,
            { fetcher: fakeFetch },
            remainingBytes,
          );
        }
        if (resource.kind === "page") {
          return fetchPageResource(
            resource,
            plan,
            signal,
            new CanvasHttp(fakeFetch, signal),
          );
        }
        throw new TypeError("Unexpected synthetic retrieval kind");
      },
      archiveCss: ARCHIVE_CSS,
      now: () => "2026-08-16T12:00:00.000Z",
      fileName: () => "gradpack-synthetic-course.zip",
      download: (_name, bytes) => {
        downloaded = bytes;
      },
    },
  });
  if (downloaded !== result.zipBytes) {
    throw new TypeError("Synthetic download did not use the produced ZIP");
  }
  return {
    zipBytes: result.zipBytes,
    requestedUrls,
    requestHeaders,
    maximumConcurrency,
  };
}
