import { canvasEndpoint } from "../canvas/endpoints";
import { CanvasHttp } from "../canvas/http";
import { parseNextLink } from "../canvas/pagination";
import { assertCurrentUser, listAccessibleCourses } from "../canvas/session";
import { CANVAS_ORIGIN } from "../shared/constants";
import { DEV_CHANNEL, parseDevResult, type DevResult } from "./protocol";

const MAX_COURSES = 8;
const MAX_MODULES_PER_COURSE = 8;
const MAX_ITEMS_PER_COURSE = 100;
const MAX_FILE_BYTES = 5_242_880;
const MAX_CONCURRENCY = 2;

type CanvasModuleItem = {
  type?: unknown;
  page_url?: unknown;
  content_id?: unknown;
};

type FileMetadata = {
  url?: unknown;
  size?: unknown;
};

type Representative = {
  courseId: number;
  pageUrl: string;
  fileId: number;
};

type Failure = Exclude<DevResult["failure"], "none" | "busy" | "timeout">;
type PartialResult = Partial<
  Pick<
    DevResult,
    | "session"
    | "courses"
    | "modules"
    | "page"
    | "file"
    | "contentType"
    | "redirect"
  >
>;

export type LiveSmokeDependencies = {
  http?: CanvasHttp;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

const failureResult = (
  runId: string,
  failure: Failure,
  partial: PartialResult = {},
): DevResult =>
  parseDevResult({
    channel: DEV_CHANNEL,
    type: "LIVE_SMOKE_RESULT",
    runId,
    outcome: "fail",
    failure,
    session: "unavailable",
    courses: "unavailable",
    modules: "not-run",
    page: "not-run",
    file: "not-run",
    contentType: "none",
    redirect: "none",
    ...partial,
  });

const passResult = (
  runId: string,
  contentType: DevResult["contentType"],
  redirect: DevResult["redirect"],
): DevResult =>
  parseDevResult({
    channel: DEV_CHANNEL,
    type: "LIVE_SMOKE_RESULT",
    runId,
    outcome: "pass",
    failure: "none",
    session: "available",
    courses: "available",
    modules: "page-and-file",
    page: "available",
    file: "available",
    contentType,
    redirect,
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const pageToken = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,255}$/.test(value);

const moduleAvailability = (
  pageUrl: string | undefined,
  fileId: number | undefined,
): DevResult["modules"] => {
  if (pageUrl !== undefined && fileId !== undefined) return "page-and-file";
  if (pageUrl !== undefined) return "page-only";
  if (fileId !== undefined) return "file-only";
  return "empty";
};

async function mapWithBoundedConcurrency<T, R>(
  values: readonly T[],
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;
  let firstFailure: { error: unknown } | undefined;

  const worker = async (): Promise<void> => {
    while (firstFailure === undefined && nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        output[index] = await operation(values[index]!);
      } catch (error) {
        firstFailure ??= { error };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENCY, values.length) }, async () =>
      worker(),
    ),
  );
  if (firstFailure) throw firstFailure.error;
  return output;
}

async function discoverRepresentative(
  http: CanvasHttp,
  courseId: number,
): Promise<{
  representative?: Representative;
  modules: DevResult["modules"];
}> {
  const modulesPage = await http.json<unknown>(
    canvasEndpoint({ type: "courseModules", courseId }),
  );
  parseNextLink(modulesPage.response.headers.get("link"));
  if (!Array.isArray(modulesPage.value)) {
    throw new TypeError("Invalid module response");
  }

  const moduleItems = new Map<number, unknown[]>();
  const missing: Array<{ index: number; moduleId: number }> = [];
  const modules = modulesPage.value.slice(0, MAX_MODULES_PER_COURSE);

  for (const [index, value] of modules.entries()) {
    if (!isRecord(value) || !positiveId(value.id)) continue;
    if (Object.hasOwn(value, "items")) {
      if (!Array.isArray(value.items)) {
        throw new TypeError("Invalid inline module items");
      }
      moduleItems.set(index, value.items);
      continue;
    }
    missing.push({ index, moduleId: value.id });
  }

  const loaded = await mapWithBoundedConcurrency(missing, async (entry) => {
    const itemsPage = await http.json<unknown>(
      canvasEndpoint({
        type: "moduleItems",
        courseId,
        moduleId: entry.moduleId,
      }),
    );
    parseNextLink(itemsPage.response.headers.get("link"));
    if (!Array.isArray(itemsPage.value)) {
      throw new TypeError("Invalid module-item response");
    }
    return { index: entry.index, items: itemsPage.value };
  });
  for (const entry of loaded) moduleItems.set(entry.index, entry.items);

  let pageUrl: string | undefined;
  let fileId: number | undefined;
  let consumed = 0;
  for (let index = 0; index < modules.length; index += 1) {
    const items = moduleItems.get(index) ?? [];
    for (const value of items) {
      if (consumed >= MAX_ITEMS_PER_COURSE) break;
      consumed += 1;
      if (!isRecord(value)) continue;
      const item = value as CanvasModuleItem;
      if (
        pageUrl === undefined &&
        item.type === "Page" &&
        pageToken(item.page_url)
      ) {
        pageUrl = item.page_url;
      }
      if (
        fileId === undefined &&
        item.type === "File" &&
        positiveId(item.content_id)
      ) {
        fileId = item.content_id;
      }
    }
    if (consumed >= MAX_ITEMS_PER_COURSE) break;
  }

  const availability = moduleAvailability(pageUrl, fileId);
  return {
    modules: availability,
    ...(availability === "page-and-file"
      ? { representative: { courseId, pageUrl: pageUrl!, fileId: fileId! } }
      : {}),
  };
}

function strictFileUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== CANVAS_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !url.pathname.startsWith("/files/")
  ) {
    return null;
  }
  return url;
}

function finalUrl(response: Response): {
  redirect: "same-origin-https" | "cross-origin-https" | "unsafe";
  url: URL | null;
} {
  let url: URL;
  try {
    url = new URL(response.url);
  } catch {
    return { redirect: "unsafe", url: null };
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    /\/login(?:\/|$)/i.test(url.pathname)
  ) {
    return { redirect: "unsafe", url: null };
  }
  return {
    redirect:
      url.origin === CANVAS_ORIGIN ? "same-origin-https" : "cross-origin-https",
    url,
  };
}

const mediaType = (value: string): string =>
  value.split(";", 1)[0]?.trim().toLowerCase() ?? "";

function contentCategory(value: string): DevResult["contentType"] {
  const type = mediaType(value);
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("text/")) return "text";
  if (
    type === "application/zip" ||
    type === "application/gzip" ||
    type === "application/x-7z-compressed" ||
    type === "application/x-rar-compressed" ||
    type === "application/x-tar"
  ) {
    return "archive";
  }
  if (
    type.includes("officedocument") ||
    type.includes("msword") ||
    type.includes("ms-excel") ||
    type.includes("ms-powerpoint") ||
    type.includes("opendocument")
  ) {
    return "office";
  }
  return "other";
}

async function cleanupDownload(
  controller: AbortController,
  body: ReadableStream<Uint8Array> | null,
  reader?: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  controller.abort();
  try {
    if (reader) {
      await reader.cancel();
    } else if (body) {
      await body.cancel();
    }
  } catch {
    // Cleanup failures are reduced to the caller's fixed terminal result.
  }
}

export async function runLiveSmokeTest(
  runId: string,
  dependencies: LiveSmokeDependencies = {},
): Promise<DevResult> {
  const http = dependencies.http ?? new CanvasHttp(fetch, dependencies.signal);
  const fetcher = dependencies.fetcher ?? fetch;

  try {
    await assertCurrentUser(http);
  } catch {
    return failureResult(runId, "session");
  }

  let courseIds: number[];
  try {
    const courses = await listAccessibleCourses(http);
    courseIds = courses
      .slice(0, MAX_COURSES)
      .map(({ id }) => id)
      .filter(positiveId);
  } catch {
    return failureResult(runId, "courses", { session: "available" });
  }
  if (courseIds.length === 0) {
    return failureResult(runId, "courses", {
      session: "available",
      courses: "empty",
    });
  }

  let representative: Representative | undefined;
  let availability: DevResult["modules"] = "empty";
  try {
    for (const courseId of courseIds) {
      const discovered = await discoverRepresentative(http, courseId);
      if (availability === "empty" && discovered.modules !== "empty") {
        availability = discovered.modules;
      }
      if (discovered.representative) {
        representative = discovered.representative;
        availability = "page-and-file";
        break;
      }
    }
  } catch {
    return failureResult(runId, "modules", {
      session: "available",
      courses: "available",
      modules: "unavailable",
    });
  }
  if (!representative) {
    return failureResult(runId, "modules", {
      session: "available",
      courses: "available",
      modules: availability,
    });
  }

  const [pageDetail, fileDetail] = await Promise.allSettled([
    http.json<unknown>(
      canvasEndpoint({
        type: "coursePage",
        courseId: representative.courseId,
        pageUrl: representative.pageUrl,
      }),
    ),
    http.json<unknown>(
      canvasEndpoint({
        type: "courseFile",
        courseId: representative.courseId,
        fileId: representative.fileId,
      }),
    ),
  ]);

  if (pageDetail.status === "rejected") {
    return failureResult(runId, "page", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "unavailable",
      ...(fileDetail.status === "rejected" ? { file: "unavailable" } : {}),
    });
  }
  if (fileDetail.status === "rejected") {
    return failureResult(runId, "file", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "unavailable",
    });
  }

  const metadata = fileDetail.value.value;
  if (!isRecord(metadata)) {
    return failureResult(runId, "file", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "unavailable",
    });
  }
  const file = metadata as FileMetadata;
  const fileUrl = strictFileUrl(file.url);
  if (!fileUrl) {
    return failureResult(runId, "safety", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "unavailable",
      redirect: "unsafe",
    });
  }
  if (!positiveId(file.size)) {
    return failureResult(runId, "file", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "unavailable",
    });
  }
  if (file.size > MAX_FILE_BYTES) {
    return failureResult(runId, "safety", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "too-large",
    });
  }

  const downloadController = new AbortController();
  const signal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, downloadController.signal])
    : downloadController.signal;
  let response: Response;
  try {
    response = await fetcher(fileUrl, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      signal,
    });
  } catch {
    return failureResult(runId, "file", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "unavailable",
    });
  }

  const destination = finalUrl(response);
  if (!destination.url) {
    await cleanupDownload(downloadController, response.body);
    return failureResult(runId, "safety", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "unavailable",
      redirect: destination.redirect,
    });
  }
  if (!response.ok || response.status === 401 || response.status === 403) {
    await cleanupDownload(downloadController, response.body);
    return failureResult(runId, "file", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "unavailable",
      redirect: destination.redirect,
    });
  }

  const responseType = response.headers.get("content-type") ?? "";
  const type = mediaType(responseType);
  if (type === "text/html" || type === "application/xhtml+xml") {
    await cleanupDownload(downloadController, response.body);
    return failureResult(runId, "file", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "html",
      redirect: destination.redirect,
    });
  }
  if (!response.body) {
    await cleanupDownload(downloadController, null);
    return failureResult(runId, "file", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "unavailable",
      redirect: destination.redirect,
    });
  }

  const category = contentCategory(responseType);
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_FILE_BYTES) {
        await cleanupDownload(downloadController, response.body, reader);
        return failureResult(runId, "safety", {
          session: "available",
          courses: "available",
          modules: "page-and-file",
          page: "available",
          file: "too-large",
          contentType: category,
          redirect: destination.redirect,
        });
      }
    }
  } catch {
    await cleanupDownload(downloadController, response.body, reader);
    return failureResult(runId, "file", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "unavailable",
      contentType: category,
      redirect: destination.redirect,
    });
  }
  if (bytes === 0) {
    await cleanupDownload(downloadController, response.body, reader);
    return failureResult(runId, "file", {
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "unavailable",
      contentType: category,
      redirect: destination.redirect,
    });
  }

  return passResult(runId, category, destination.redirect);
}
