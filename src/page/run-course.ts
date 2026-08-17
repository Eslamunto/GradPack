import { strToU8 } from "fflate";
import { buildCourseZip } from "../archive/build-zip";
import { renderIndexPage } from "../archive/index-page";
import {
  MAX_ARCHIVE_RESOURCES,
  buildManifest,
  type ArchiveManifest,
} from "../archive/manifest";
import { isCanonicalArchivePath } from "../archive/paths";
import { sanitizePageHtml } from "../archive/sanitize";
import { assertPilotSize } from "../canvas/discovery";
import { canvasEndpoint } from "../canvas/endpoints";
import {
  CanvasBodySizeError,
  CanvasResourceUnavailableError,
  CanvasResponseError,
  CanvasSessionError,
  CanvasTransientError,
  type CanvasHttp,
} from "../canvas/http";
import {
  CANVAS_ORIGIN,
  MAX_ARCHIVE_BYTES,
  MAX_CONCURRENCY,
  MAX_RETRIES,
} from "../shared/constants";
import type {
  CoursePlan,
  CourseSummary,
  PlannedResource,
  Progress,
  ResourceOutcome,
} from "../shared/model";

// Pilot-only in-memory limit for one raw Canvas page-detail JSON response.
export const PAGE_JSON_MAX_BYTES = 5 * 1024 * 1024;
const PAGE_TITLE_MAX_CHARACTERS = 500;

export class RunSafetyError extends TypeError {
  override readonly name = "RunSafetyError";
}

export type Retrieval =
  | { status: "success"; bytes: Uint8Array }
  | {
      status: "failed" | "unavailable";
      failureCategory:
        | "access-denied"
        | "network-exhausted"
        | "not-found"
        | "page-too-large"
        | "transient-exhausted";
    };

export type RunDependencies = {
  discover: (course: CourseSummary, signal: AbortSignal) => Promise<CoursePlan>;
  retrieve: (
    resource: PlannedResource,
    plan: CoursePlan,
    signal: AbortSignal,
  ) => Promise<Retrieval>;
  archiveCss: string;
  now: () => string;
  fileName: (course: CourseSummary) => string;
  download: (fileName: string, bytes: Uint8Array) => void;
  beforePackage?: () => void;
  maxArchiveBytes?: number;
};

export type CourseArchiveDependencies = Omit<RunDependencies, "discover" | "download">;

export type RunResult = { manifest: ArchiveManifest; zipBytes: Uint8Array };

const abortError = (signal: AbortSignal): DOMException =>
  signal.reason instanceof DOMException && signal.reason.name === "AbortError"
    ? signal.reason
    : new DOMException("Packing was cancelled", "AbortError");

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw abortError(signal);
};

export const freezeCoursePlan = (plan: CoursePlan): CoursePlan => {
  const clone: CoursePlan = {
    course: { ...plan.course },
    modules: plan.modules.map((module) => ({
      ...module,
      items: module.items.map((item) => ({ ...item })),
    })),
    resources: plan.resources.map((resource) => ({ ...resource })),
    advertisedBytes: plan.advertisedBytes,
  };
  assertPilotSize(clone);
  if (clone.resources.length > MAX_ARCHIVE_RESOURCES) {
    throw new RunSafetyError("Archive resource limit exceeded");
  }
  Object.freeze(clone.course);
  clone.modules.forEach((module) => {
    module.items.forEach(Object.freeze);
    Object.freeze(module.items);
    Object.freeze(module);
  });
  clone.resources.forEach(Object.freeze);
  Object.freeze(clone.modules);
  Object.freeze(clone.resources);
  return Object.freeze(clone);
};

const terminalOutcome = (
  resource: PlannedResource,
  status: "external" | "unsupported",
): ResourceOutcome => ({
  ...resource,
  status,
  actualBytes: 0,
  failureCategory: null,
});

export async function buildCourseArchive(options: {
  course: CourseSummary;
  plan: CoursePlan;
  signal: AbortSignal;
  progress: (progress: Progress) => void;
  dependencies: CourseArchiveDependencies;
}): Promise<RunResult> {
  const { course, plan, signal, progress, dependencies } = options;
  const controller = new AbortController();
  const onCallerAbort = (): void => controller.abort(abortError(signal));
  signal.addEventListener("abort", onCallerAbort, { once: true });
  if (signal.aborted) onCallerAbort();
  const entries = new Map<string, Uint8Array>();
  const retained = new Set<Uint8Array>();
  let terminalCause: unknown;
  let zipBytes: Uint8Array | undefined;
  let succeeded = false;

  try {
    throwIfAborted(controller.signal);
  const immutablePlan = freezeCoursePlan(plan);
    if (immutablePlan.course.id !== course.id) {
      throw new RunSafetyError("Discovered course does not match selection");
    }
    throwIfAborted(controller.signal);

    const outcomes = new Array<ResourceOutcome>(immutablePlan.resources.length);
    let cursor = 0;
    let completed = 0;
    let failed = 0;
    let successfulBytes = 0;
    const byteLimit = dependencies.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
    if (
      !Number.isSafeInteger(byteLimit) ||
      byteLimit < 0 ||
      byteLimit > MAX_ARCHIVE_BYTES
    ) {
      throw new RunSafetyError("Invalid archive byte limit");
    }

    const work = async (): Promise<void> => {
      for (;;) {
        if (terminalCause !== undefined || controller.signal.aborted) return;
        const index = cursor;
        if (index >= immutablePlan.resources.length) return;
        cursor += 1;
        const resource = immutablePlan.resources[index]!;
        try {
          let outcome: ResourceOutcome;
          if (resource.kind === "external" || resource.kind === "unsupported") {
            outcome = terminalOutcome(resource, resource.kind);
          } else {
            progress({
              stage: resource.kind === "page" ? "sanitize" : "download",
              completed,
              total: immutablePlan.resources.length,
              failed,
            });
            const result = await dependencies.retrieve(
              resource,
              immutablePlan,
              controller.signal,
            );
            throwIfAborted(controller.signal);
            if (result.status === "success") {
              if (
                !resource.archivePath ||
                !isCanonicalArchivePath(resource.archivePath)
              ) {
                throw new RunSafetyError("Invalid planned archive path");
              }
              successfulBytes += result.bytes.byteLength;
              if (
                !Number.isSafeInteger(successfulBytes) ||
                successfulBytes > byteLimit
              ) {
                result.bytes.fill(0);
                throw new RunSafetyError("Archive byte limit exceeded");
              }
              retained.add(result.bytes);
              entries.set(resource.archivePath, result.bytes);
              outcome = {
                ...resource,
                status: "success",
                actualBytes: result.bytes.byteLength,
                failureCategory: null,
              };
            } else {
              failed += 1;
              outcome = {
                ...resource,
                status: result.status,
                actualBytes: null,
                failureCategory: result.failureCategory,
              };
            }
          }
          outcomes[index] = outcome;
          completed += 1;
          progress({
            stage: resource.kind === "page" ? "sanitize" : "download",
            completed,
            total: immutablePlan.resources.length,
            failed,
          });
        } catch (error) {
          const cause =
            error instanceof Error || error instanceof DOMException
              ? error
              : new RunSafetyError("Retrieval failed");
          terminalCause ??= cause;
          controller.abort(terminalCause);
          return;
        }
      }
    };

    await Promise.allSettled(
      Array.from(
        { length: Math.min(MAX_CONCURRENCY, immutablePlan.resources.length) },
        work,
      ),
    );
    if (terminalCause !== undefined) {
      if (
        terminalCause instanceof Error ||
        terminalCause instanceof DOMException
      ) {
        throw terminalCause;
      }
      throw new RunSafetyError("Retrieval failed");
    }
    throwIfAborted(controller.signal);
    if (outcomes.some((outcome) => outcome === undefined)) {
      throw new RunSafetyError("Incomplete resource outcomes");
    }

    progress({
      stage: "package",
      completed,
      total: immutablePlan.resources.length,
      failed,
    });
    dependencies.beforePackage?.();
    throwIfAborted(controller.signal);
    const createdAt = dependencies.now();
    const manifest = buildManifest(immutablePlan, outcomes, createdAt);
    const indexHtml = renderIndexPage(immutablePlan, outcomes, createdAt);
    zipBytes = buildCourseZip({
      indexHtml,
      archiveCss: dependencies.archiveCss,
      manifest,
      entries,
    });
    throwIfAborted(controller.signal);
    succeeded = true;
    return { manifest, zipBytes };
  } finally {
    signal.removeEventListener("abort", onCallerAbort);
    entries.clear();
    retained.forEach((bytes) => bytes.fill(0));
    if (!succeeded) zipBytes?.fill(0);
    retained.clear();
  }
}

export async function runCourse(options: {
  course: CourseSummary;
  signal: AbortSignal;
  progress: (progress: Progress) => void;
  dependencies: RunDependencies;
}): Promise<RunResult> {
  const { course, signal, progress, dependencies } = options;
  progress({ stage: "discovery", completed: 0, total: 0, failed: 0 });
  const plan = await dependencies.discover({ ...course }, signal);
  const result = await buildCourseArchive({
    course,
    plan,
    signal,
    progress,
    dependencies,
  });
  throwIfAborted(signal);
  dependencies.download(dependencies.fileName(course), result.zipBytes);
  throwIfAborted(signal);
  return result;
}

type FileTransport = {
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

const abortableDelay = (
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(finish, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(
        signal
          ? abortError(signal)
          : new DOMException("Packing was cancelled", "AbortError"),
      );
    };
    function finish(): void {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const waitForRetry = async (
  milliseconds: number,
  signal: AbortSignal,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
): Promise<void> => {
  throwIfAborted(signal);
  await sleep(milliseconds, signal);
  throwIfAborted(signal);
};

const cancelBody = async (response: Response): Promise<void> => {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Cleanup failures never replace the already classified request outcome.
  }
};

const validatedFileUrl = (resource: PlannedResource): URL => {
  if (
    resource.kind !== "file" ||
    resource.sourceUrl === null ||
    resource.advertisedBytes === null ||
    !Number.isSafeInteger(resource.advertisedBytes) ||
    resource.advertisedBytes <= 0
  ) {
    throw new RunSafetyError("Invalid planned file");
  }
  const url = new URL(resource.sourceUrl);
  if (
    url.origin !== CANVAS_ORIGIN ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.pathname !== `/files/${resource.sourceId}/download`
  ) {
    throw new RunSafetyError("Rejected planned file URL");
  }
  return url;
};

export async function fetchFileResource(
  resource: PlannedResource,
  callerSignal: AbortSignal,
  transport: FileTransport = {},
): Promise<Retrieval> {
  const initial = validatedFileUrl(resource);
  const advertisedBytes = resource.advertisedBytes!;
  const fetcher = transport.fetcher ?? fetch;
  const sleep = transport.sleep ?? abortableDelay;
  const local = new AbortController();
  const onCallerAbort = (): void => local.abort(abortError(callerSignal));
  callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  if (callerSignal.aborted) onCallerAbort();

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      throwIfAborted(local.signal);
      let response: Response;
      try {
        response = await fetcher(initial, {
          method: "GET",
          credentials: "include",
          redirect: "follow",
          signal: local.signal,
        });
      } catch (error) {
        if (local.signal.aborted) throw abortError(local.signal);
        if (!(error instanceof TypeError)) {
          throw new CanvasResponseError("File request failed");
        }
        if (attempt === MAX_RETRIES) {
          return { status: "failed", failureCategory: "network-exhausted" };
        }
        await waitForRetry(250 * 2 ** attempt, local.signal, sleep);
        continue;
      }

      let finalUrl: URL;
      try {
        if (typeof response.url !== "string" || response.url.length === 0) {
          throw new TypeError("Missing final response URL");
        }
        finalUrl = new URL(response.url);
      } catch {
        await cancelBody(response);
        throw new RunSafetyError("Rejected file response URL");
      }
      if (
        finalUrl.protocol !== "https:" ||
        finalUrl.username !== "" ||
        finalUrl.password !== "" ||
        finalUrl.hash !== ""
      ) {
        await cancelBody(response);
        throw new RunSafetyError("Rejected file response URL");
      }
      const contentType = (
        response.headers.get("content-type") ?? ""
      ).toLowerCase();
      if (
        response.status === 401 ||
        /\/login(?:\/|$)/u.test(finalUrl.pathname) ||
        contentType.includes("text/html")
      ) {
        await cancelBody(response);
        throw new CanvasSessionError("Canvas session is unavailable");
      }
      if (response.status === 403 || response.status === 404) {
        await cancelBody(response);
        return {
          status: "unavailable",
          failureCategory:
            response.status === 403 ? "access-denied" : "not-found",
        };
      }
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        await cancelBody(response);
        if (attempt === MAX_RETRIES) {
          return { status: "failed", failureCategory: "transient-exhausted" };
        }
        await waitForRetry(250 * 2 ** attempt, local.signal, sleep);
        continue;
      }
      if (!response.ok) {
        await cancelBody(response);
        throw new RunSafetyError("Rejected file response");
      }
      const rawLength = response.headers.get("content-length");
      if (rawLength !== null) {
        if (!/^(?:0|[1-9]\d*)$/u.test(rawLength)) {
          await cancelBody(response);
          throw new RunSafetyError("Invalid file content length");
        }
        const declared = Number(rawLength);
        if (!Number.isSafeInteger(declared) || declared !== advertisedBytes) {
          await cancelBody(response);
          throw new RunSafetyError("File content length changed");
        }
      }
      if (!response.body) {
        throw new RunSafetyError("File response body is unavailable");
      }

      const reader = response.body.getReader();
      const output = new Uint8Array(advertisedBytes);
      let offset = 0;
      let rejectReadAbort: (error: DOMException) => void = () => {};
      const readAbort = new Promise<never>((_resolve, reject) => {
        rejectReadAbort = reject;
      });
      const onReadAbort = (): void => rejectReadAbort(abortError(local.signal));
      local.signal.addEventListener("abort", onReadAbort, { once: true });
      try {
        for (;;) {
          throwIfAborted(local.signal);
          const value = await Promise.race([reader.read(), readAbort]);
          throwIfAborted(local.signal);
          if (value.done) break;
          if (value.value.byteLength === 0) {
            throw new RunSafetyError("Invalid file stream chunk");
          }
          if (value.value.byteLength > advertisedBytes - offset) {
            throw new RunSafetyError("File stream exceeded advertised size");
          }
          output.set(value.value, offset);
          offset += value.value.byteLength;
        }
        if (offset === 0 || offset !== advertisedBytes) {
          throw new RunSafetyError("File stream size changed");
        }
        reader.releaseLock();
        return { status: "success", bytes: output };
      } catch (error) {
        local.abort(error);
        try {
          await reader.cancel();
        } catch {
          // The original terminal cause remains authoritative.
        }
        output.fill(0);
        if (
          local.signal.reason instanceof DOMException &&
          local.signal.reason.name === "AbortError"
        ) {
          throw local.signal.reason;
        }
        throw error;
      } finally {
        local.signal.removeEventListener("abort", onReadAbort);
      }
    }
    return { status: "failed", failureCategory: "transient-exhausted" };
  } finally {
    callerSignal.removeEventListener("abort", onCallerAbort);
    local.abort();
  }
}

const exactPage = (value: unknown): { title: string; body: string } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CanvasResponseError("Canvas returned an invalid page");
  }
  const title = Object.getOwnPropertyDescriptor(value, "title");
  const body = Object.getOwnPropertyDescriptor(value, "body");
  if (
    !title ||
    !("value" in title) ||
    typeof title.value !== "string" ||
    title.value.length > PAGE_TITLE_MAX_CHARACTERS ||
    !body ||
    !("value" in body) ||
    typeof body.value !== "string"
  ) {
    throw new CanvasResponseError("Canvas returned an invalid page");
  }
  return { title: title.value, body: body.value };
};

const encodeArchiveHref = (path: string): string =>
  `../${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

export function resolveLocalHref(raw: string, plan: CoursePlan): string | null {
  if (typeof raw !== "string" || raw !== raw.trim() || raw.includes("\\"))
    return null;
  let url: URL;
  try {
    url = new URL(raw, CANVAS_ORIGIN);
  } catch {
    return null;
  }
  if (
    url.origin !== CANVAS_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  )
    return null;
  const courseId = String(plan.course.id);
  const fileMatch = new RegExp(
    `^/courses/${courseId}/files/([1-9]\\d*)(/download)?$`,
    "u",
  ).exec(url.pathname);
  if (fileMatch) {
    const wrap = url.search === "?wrap=1";
    if ((url.search !== "" && !wrap) || (fileMatch[2] === undefined && !wrap)) {
      return null;
    }
    const resource = plan.resources.find(
      (candidate) =>
        candidate.kind === "file" && candidate.sourceId === fileMatch[1],
    );
    return resource?.archivePath
      ? encodeArchiveHref(resource.archivePath)
      : null;
  }
  const pageMatch = new RegExp(
    `^/courses/${courseId}/pages/([a-zA-Z0-9_-]{1,255})$`,
    "u",
  ).exec(url.pathname);
  if (pageMatch && url.search === "") {
    const resource = plan.resources.find(
      (candidate) =>
        candidate.kind === "page" && candidate.sourceId === pageMatch[1],
    );
    return resource?.archivePath
      ? encodeArchiveHref(resource.archivePath)
      : null;
  }
  return null;
}

type BoundedPageHttp = Pick<CanvasHttp, "jsonBoundedResource">;

export async function fetchPageResource(
  resource: PlannedResource,
  plan: CoursePlan,
  signal: AbortSignal,
  http: BoundedPageHttp,
): Promise<Retrieval> {
  throwIfAborted(signal);
  if (resource.kind !== "page" || resource.archivePath === null) {
    throw new RunSafetyError("Invalid planned page");
  }
  try {
    const response = await http.jsonBoundedResource<unknown>(
      canvasEndpoint({
        type: "coursePage",
        courseId: plan.course.id,
        pageUrl: resource.sourceId,
      }),
      PAGE_JSON_MAX_BYTES,
    );
    throwIfAborted(signal);
    const page = exactPage(response.value);
    const html = sanitizePageHtml({
      title: page.title,
      body: page.body,
      resolveLocalHref: (href) => resolveLocalHref(href, plan),
    });
    return { status: "success", bytes: strToU8(html) };
  } catch (error) {
    if (
      error instanceof CanvasBodySizeError ||
      (error instanceof Error && error.name === "CanvasBodySizeError")
    ) {
      return { status: "unavailable", failureCategory: "page-too-large" };
    }
    if (error instanceof CanvasResourceUnavailableError) {
      return {
        status: "unavailable",
        failureCategory: error.status === 403 ? "access-denied" : "not-found",
      };
    }
    if (error instanceof CanvasTransientError) {
      return { status: "failed", failureCategory: "transient-exhausted" };
    }
    throw error;
  }
}
