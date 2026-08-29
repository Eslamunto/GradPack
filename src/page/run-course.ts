import { strFromU8, strToU8 } from "fflate";
import { buildCourseZip } from "../archive/build-zip";
import { renderCoursePages } from "../archive/course-pages";
import { relativeArchiveHref } from "../archive/archive-links";
import { buildArchiveNavigationModel } from "../archive/navigation-model";
import {
  MAX_ARCHIVE_RESOURCES,
  type ArchiveManifest,
} from "../archive/manifest";
import { isCanonicalArchivePath } from "../archive/paths";
import { renderSavedPageHtml, sanitizePageFragment } from "../archive/sanitize";
import { assertCoursePlanSizes } from "../canvas/discovery";
import { canvasEndpoint } from "../canvas/endpoints";
import { partitionCoursePlan } from "./course-parts";
import {
  CanvasBodySizeError,
  CanvasResourceUnavailableError,
  CanvasResponseError,
  CanvasSessionError,
  CanvasTransientError,
  type CanvasHttp,
} from "../canvas/http";
import { exactCanvasPage } from "../canvas/page-links";
import {
  CANVAS_PAGE_JSON_MAX_BYTES,
  CANVAS_ORIGIN,
  MAX_ARCHIVED_PAGE_BYTES,
  MAX_ARCHIVE_BYTES,
  MAX_CONCURRENCY,
  MAX_RETRIES,
} from "../shared/constants";
import type {
  CourseArchivePartPlan,
  CoursePlan,
  CourseSummary,
  PlannedResource,
  Progress,
  ResourceOutcome,
} from "../shared/model";

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
        | "individual-size-limit"
        | "page-too-large"
        | "transient-exhausted";
    };

export type RunDependencies = {
  discover: (course: CourseSummary, signal: AbortSignal) => Promise<CoursePlan>;
  retrieve: (
    resource: PlannedResource,
    plan: CoursePlan,
    signal: AbortSignal,
    remainingBytes: number,
  ) => Promise<Retrieval>;
  archiveCss: string;
  now: () => string;
  fileName: (course: CourseSummary) => string;
  download: (fileName: string, bytes: Uint8Array) => void;
  beforePackage?: () => void;
  maxArchiveBytes?: number;
  maxArchivedPageBytes?: number;
};

export type CourseArchiveDependencies = Omit<
  RunDependencies,
  "discover" | "download"
>;

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
    moduleDiscovery: plan.moduleDiscovery,
    modules: plan.modules.map((module) => ({
      ...module,
      items: module.items.map((item) => ({ ...item })),
    })),
    resources: plan.resources.map((resource) => ({ ...resource })),
    folderPathFallbackKeys: [...plan.folderPathFallbackKeys],
    advertisedBytes: plan.advertisedBytes,
  };
  assertCoursePlanSizes(clone);
  if (clone.resources.length > MAX_ARCHIVE_RESOURCES) {
    throw new RunSafetyError("Archive resource limit exceeded");
  }
  const fallbackKeys = new Set(clone.folderPathFallbackKeys);
  if (fallbackKeys.size !== clone.folderPathFallbackKeys.length) {
    throw new RunSafetyError("Invalid folder fallback keys");
  }
  for (const key of fallbackKeys) {
    const resource = clone.resources.find((candidate) => candidate.key === key);
    if (
      resource?.kind !== "file" ||
      resource.archivePath === null ||
      !isCanonicalArchivePath(resource.archivePath) ||
      !resource.archivePath.startsWith("files/unfiled/")
    ) {
      throw new RunSafetyError("Invalid folder fallback keys");
    }
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
  Object.freeze(clone.folderPathFallbackKeys);
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

const removeUnavailableLocalLinks = (
  fragment: string,
  pagePath: string,
  entries: ReadonlyMap<string, Uint8Array>,
): string => {
  const document = new DOMParser().parseFromString(
    `<body>${fragment}</body>`,
    "text/html",
  );
  const base = `https://archive.invalid/${pagePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  for (const anchor of document.body.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (
      href === null ||
      href.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(href)
    )
      continue;
    let target: string;
    try {
      target = decodeURIComponent(new URL(href, base).pathname.slice(1));
    } catch {
      anchor.removeAttribute("href");
      anchor.removeAttribute("rel");
      continue;
    }
    if (!entries.has(target)) {
      anchor.removeAttribute("href");
      anchor.removeAttribute("rel");
    }
  }
  return document.body.innerHTML;
};

export async function buildCourseArchive(options: {
  course: CourseSummary;
  plan: CoursePlan;
  partPlan?: CourseArchivePartPlan;
  combinedRoot: string | null;
  signal: AbortSignal;
  progress: (progress: Progress) => void;
  dependencies: CourseArchiveDependencies;
}): Promise<RunResult> {
  const {
    course,
    plan,
    partPlan,
    combinedRoot,
    signal,
    progress,
    dependencies,
  } = options;
  if (combinedRoot !== null && !isCanonicalArchivePath(combinedRoot)) {
    throw new RunSafetyError("Invalid combined course root");
  }
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
    const activePart = partPlan;
    if (activePart) {
      const canonicalParts = partitionCoursePlan(immutablePlan);
      const canonicalPart = canonicalParts[activePart.index - 1];
      if (
        !canonicalPart ||
        activePart.total !== canonicalPart.total ||
        activePart.resourceKeys.length !== canonicalPart.resourceKeys.length ||
        activePart.resourceKeys.some(
          (key, index) => key !== canonicalPart.resourceKeys[index],
        ) ||
        activePart.resourceParts.length !==
          canonicalPart.resourceParts.length ||
        activePart.resourceParts.some((assignment, index) => {
          const canonical = canonicalPart.resourceParts[index];
          return (
            assignment.resourceKey !== canonical?.resourceKey ||
            assignment.partIndex !== canonical.partIndex
          );
        })
      ) {
        throw new RunSafetyError("Invalid course archive part");
      }
    }
    const resourcesByKey = new Map(
      immutablePlan.resources.map((resource) => [resource.key, resource]),
    );
    const localResources = (
      activePart?.resourceKeys ??
      immutablePlan.resources.map((resource) => resource.key)
    ).map((key) => {
      const resource = resourcesByKey.get(key);
      if (!resource) throw new RunSafetyError("Invalid course archive part");
      return resource;
    });
    throwIfAborted(controller.signal);

    const outcomes = new Array<ResourceOutcome>(localResources.length);
    let cursor = 0;
    let completed = 0;
    let failed = 0;
    let successfulBytes = 0;
    const byteLimit = dependencies.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
    const pageByteLimit =
      dependencies.maxArchivedPageBytes ?? MAX_ARCHIVED_PAGE_BYTES;
    if (
      !Number.isSafeInteger(byteLimit) ||
      byteLimit < 0 ||
      byteLimit > MAX_ARCHIVE_BYTES
    ) {
      throw new RunSafetyError("Invalid archive byte limit");
    }
    if (
      !Number.isSafeInteger(pageByteLimit) ||
      pageByteLimit < 1 ||
      pageByteLimit > MAX_ARCHIVED_PAGE_BYTES
    ) {
      throw new RunSafetyError("Invalid archived page byte limit");
    }

    const latchTerminalCause = (error: unknown): Error | DOMException => {
      const cause =
        error instanceof Error || error instanceof DOMException
          ? error
          : new RunSafetyError("Retrieval failed");
      terminalCause ??= cause;
      controller.abort(terminalCause);
      return cause;
    };
    type RetrievalRelease = () => void;
    type RetrievalWaiter = {
      exclusive: boolean;
      settled: boolean;
      resolve: (release: RetrievalRelease) => void;
      reject: (reason: unknown) => void;
      onAbort: () => void;
    };
    let activeSharedRetrievals = 0;
    let exclusiveRetrievalActive = false;
    const retrievalWaiters: RetrievalWaiter[] = [];

    function drainRetrievalWaiters(): void {
      if (controller.signal.aborted || exclusiveRetrievalActive) return;
      const first = retrievalWaiters[0];
      if (!first) return;
      if (first.exclusive) {
        if (activeSharedRetrievals > 0) return;
        retrievalWaiters.shift();
        admitRetrievalWaiter(first);
        return;
      }
      while (retrievalWaiters[0] && !retrievalWaiters[0].exclusive) {
        admitRetrievalWaiter(retrievalWaiters.shift()!);
      }
    }

    function createRetrievalRelease(exclusive: boolean): RetrievalRelease {
      let released = false;
      return (): void => {
        if (released) return;
        released = true;
        if (exclusive) exclusiveRetrievalActive = false;
        else activeSharedRetrievals -= 1;
        drainRetrievalWaiters();
      };
    }

    function admitRetrieval(exclusive: boolean): RetrievalRelease {
      if (exclusive) exclusiveRetrievalActive = true;
      else activeSharedRetrievals += 1;
      return createRetrievalRelease(exclusive);
    }

    function admitRetrievalWaiter(waiter: RetrievalWaiter): void {
      if (waiter.settled) return;
      waiter.settled = true;
      controller.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(admitRetrieval(waiter.exclusive));
    }

    const acquireRetrieval = (
      exclusive: boolean,
    ): RetrievalRelease | Promise<RetrievalRelease> => {
      throwIfAborted(controller.signal);
      if (
        retrievalWaiters.length === 0 &&
        !exclusiveRetrievalActive &&
        (!exclusive || activeSharedRetrievals === 0)
      ) {
        return admitRetrieval(exclusive);
      }
      return new Promise<RetrievalRelease>((resolve, reject) => {
        const waiter: RetrievalWaiter = {
          exclusive,
          settled: false,
          resolve,
          reject,
          onAbort: (): void => undefined,
        };
        waiter.onAbort = (): void => {
          if (waiter.settled) return;
          waiter.settled = true;
          const index = retrievalWaiters.indexOf(waiter);
          if (index >= 0) retrievalWaiters.splice(index, 1);
          controller.signal.removeEventListener("abort", waiter.onAbort);
          waiter.reject(abortError(controller.signal));
          drainRetrievalWaiters();
        };
        retrievalWaiters.push(waiter);
        controller.signal.addEventListener("abort", waiter.onAbort, {
          once: true,
        });
        if (controller.signal.aborted) waiter.onAbort();
      });
    };

    const work = async (): Promise<void> => {
      for (;;) {
        if (terminalCause !== undefined || controller.signal.aborted) return;
        const index = cursor;
        if (index >= localResources.length) return;
        cursor += 1;
        const resource = localResources[index]!;
        try {
          let outcome: ResourceOutcome;
          if (resource.kind === "external" || resource.kind === "unsupported") {
            outcome = terminalOutcome(resource, resource.kind);
          } else {
            progress({
              stage: resource.kind === "page" ? "sanitize" : "download",
              completed,
              total: localResources.length,
              failed,
            });
            if (
              resource.kind === "file" &&
              resource.advertisedBytes !== null &&
              resource.advertisedBytes > MAX_ARCHIVE_BYTES
            ) {
              failed += 1;
              outcome = {
                ...resource,
                status: "unavailable",
                actualBytes: null,
                failureCategory: "individual-size-limit",
              };
            } else {
              if (resource.kind === "file") {
                validatedFileUrl(resource, immutablePlan.course.id);
              }
              let releaseRetrieval: RetrievalRelease | undefined;
              try {
                const exclusive =
                  resource.kind === "file" && resource.advertisedBytes === null;
                const admission = acquireRetrieval(exclusive);
                releaseRetrieval =
                  typeof admission === "function" ? admission : await admission;
                const remainingBytes = byteLimit - successfulBytes;
                if (
                  !Number.isSafeInteger(remainingBytes) ||
                  remainingBytes < 0 ||
                  remainingBytes > MAX_ARCHIVE_BYTES
                ) {
                  throw new RunSafetyError(
                    "Invalid remaining archive byte limit",
                  );
                }
                const result = await dependencies.retrieve(
                  resource,
                  immutablePlan,
                  controller.signal,
                  remainingBytes,
                );
                if (controller.signal.aborted && result.status === "success") {
                  result.bytes.fill(0);
                }
                throwIfAborted(controller.signal);
                if (result.status === "success") {
                  if (
                    !resource.archivePath ||
                    !isCanonicalArchivePath(resource.archivePath)
                  ) {
                    result.bytes.fill(0);
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
              } catch (error) {
                if (releaseRetrieval !== undefined) {
                  latchTerminalCause(error);
                }
                throw error;
              } finally {
                releaseRetrieval?.();
              }
            }
          }
          outcomes[index] = outcome;
          completed += 1;
          progress({
            stage: resource.kind === "page" ? "sanitize" : "download",
            completed,
            total: localResources.length,
            failed,
          });
        } catch (error) {
          latchTerminalCause(error);
          return;
        }
      }
    };

    await Promise.allSettled(
      Array.from(
        { length: Math.min(MAX_CONCURRENCY, localResources.length) },
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
      total: localResources.length,
      failed,
    });
    dependencies.beforePackage?.();
    throwIfAborted(controller.signal);
    const createdAt = dependencies.now();
    const pageFragments = new Map<string, Uint8Array>();
    for (const [index, resource] of localResources.entries()) {
      if (
        resource.kind !== "page" ||
        outcomes[index]?.status !== "success" ||
        resource.archivePath === null
      )
        continue;
      const fragmentBytes = entries.get(resource.archivePath);
      if (!fragmentBytes)
        throw new RunSafetyError("Missing sanitized page fragment");
      pageFragments.set(resource.archivePath, fragmentBytes);
    }
    let model = buildArchiveNavigationModel(
      immutablePlan,
      outcomes,
      createdAt,
      activePart,
    );
    let removedOversizedPage: boolean;
    do {
      removedOversizedPage = false;
      for (const [index, resource] of localResources.entries()) {
        if (
          resource.kind !== "page" ||
          outcomes[index]?.status !== "success" ||
          resource.archivePath === null
        )
          continue;
        const fragmentBytes = pageFragments.get(resource.archivePath);
        const currentBytes = entries.get(resource.archivePath);
        if (!fragmentBytes || !currentBytes) {
          throw new RunSafetyError("Missing sanitized page fragment");
        }
        const wrapped = strToU8(
          renderSavedPageHtml({
            model,
            pagePath: resource.archivePath,
            title: resource.title,
            sanitizedFragment: removeUnavailableLocalLinks(
              strFromU8(fragmentBytes),
              resource.archivePath,
              entries,
            ),
            combinedHomeHref:
              combinedRoot === null
                ? null
                : relativeArchiveHref(
                    `${combinedRoot}/${resource.archivePath}`,
                    "index.html",
                  ),
          }),
        );
        if (wrapped.byteLength > pageByteLimit) {
          wrapped.fill(0);
          successfulBytes -= currentBytes.byteLength;
          if (currentBytes !== fragmentBytes) currentBytes.fill(0);
          entries.delete(resource.archivePath);
          outcomes[index] = {
            ...resource,
            status: "unavailable",
            actualBytes: null,
            failureCategory: "page-too-large",
          };
          failed += 1;
          removedOversizedPage = true;
          continue;
        }
        successfulBytes =
          successfulBytes - currentBytes.byteLength + wrapped.byteLength;
        if (
          !Number.isSafeInteger(successfulBytes) ||
          successfulBytes > byteLimit
        ) {
          wrapped.fill(0);
          throw new RunSafetyError("Archive byte limit exceeded");
        }
        if (currentBytes !== fragmentBytes) currentBytes.fill(0);
        retained.add(wrapped);
        entries.set(resource.archivePath, wrapped);
        outcomes[index] = {
          ...outcomes[index],
          actualBytes: wrapped.byteLength,
        };
      }
      model = buildArchiveNavigationModel(
        immutablePlan,
        outcomes,
        createdAt,
        activePart,
      );
    } while (removedOversizedPage);
    const manifest = model.manifest;
    const pages = renderCoursePages(
      model,
      combinedRoot === null
        ? {}
        : {
            combinedHomeHref: relativeArchiveHref(
              `${combinedRoot}/index.html`,
              "index.html",
            ),
          },
    );
    zipBytes = buildCourseZip({
      archiveRoot: combinedRoot,
      pages,
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
    combinedRoot: null,
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

const validatedFileUrl = (
  resource: PlannedResource,
  expectedCourseId?: number,
): URL => {
  if (
    resource.kind !== "file" ||
    resource.sourceUrl === null ||
    (resource.advertisedBytes !== null &&
      (!Number.isSafeInteger(resource.advertisedBytes) ||
        resource.advertisedBytes <= 0))
  ) {
    throw new RunSafetyError("Invalid planned file");
  }
  let url: URL;
  try {
    url = new URL(resource.sourceUrl);
  } catch {
    throw new RunSafetyError("Rejected planned file URL");
  }
  if (
    url.origin !== CANVAS_ORIGIN ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new RunSafetyError("Rejected planned file URL");
  }
  if (resource.advertisedBytes !== null) {
    if (url.pathname !== `/files/${resource.sourceId}/download`) {
      throw new RunSafetyError("Rejected planned file URL");
    }
    return url;
  }
  const match = /^\/courses\/([1-9]\d*)\/files\/([1-9]\d*)\/download$/u.exec(
    url.pathname,
  );
  if (
    url.search !== "" ||
    match === null ||
    match[2] !== resource.sourceId ||
    (expectedCourseId !== undefined && match[1] !== String(expectedCourseId))
  ) {
    throw new RunSafetyError("Rejected planned file URL");
  }
  const courseId =
    expectedCourseId === undefined ? match[1] : String(expectedCourseId);
  if (
    resource.sourceUrl !==
    `${CANVAS_ORIGIN}/courses/${courseId}/files/${resource.sourceId}/download`
  ) {
    throw new RunSafetyError("Rejected planned file URL");
  }
  return url;
};

export async function fetchFileResource(
  resource: PlannedResource,
  callerSignal: AbortSignal,
  transport: FileTransport = {},
  remainingBytes: number,
): Promise<Retrieval> {
  const initial = validatedFileUrl(resource);
  const advertisedBytes = resource.advertisedBytes;
  if (
    advertisedBytes === null &&
    (!Number.isSafeInteger(remainingBytes) ||
      remainingBytes < 0 ||
      remainingBytes > MAX_ARCHIVE_BYTES)
  ) {
    throw new RunSafetyError("Invalid remaining archive byte limit");
  }
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
      let declaredBytes: number | null = null;
      if (rawLength !== null) {
        const validLength =
          advertisedBytes === null
            ? /^[1-9]\d*$/u.test(rawLength)
            : /^(?:0|[1-9]\d*)$/u.test(rawLength);
        if (!validLength) {
          await cancelBody(response);
          throw new RunSafetyError("Invalid file content length");
        }
        const declared = Number(rawLength);
        if (!Number.isSafeInteger(declared)) {
          await cancelBody(response);
          throw new RunSafetyError("Invalid file content length");
        }
        if (advertisedBytes !== null && declared !== advertisedBytes) {
          await cancelBody(response);
          throw new RunSafetyError("File content length changed");
        }
        if (advertisedBytes === null && declared > remainingBytes) {
          await cancelBody(response);
          return {
            status: "unavailable",
            failureCategory: "individual-size-limit",
          };
        }
        declaredBytes = declared;
      }
      if (!response.body) {
        throw new RunSafetyError("File response body is unavailable");
      }

      const reader = response.body.getReader();
      let output: Uint8Array | undefined;
      const chunks: Uint8Array[] = [];
      let rejectReadAbort: (error: DOMException) => void = () => {};
      const readAbort = new Promise<never>((_resolve, reject) => {
        rejectReadAbort = reject;
      });
      const onReadAbort = (): void => rejectReadAbort(abortError(local.signal));
      local.signal.addEventListener("abort", onReadAbort, { once: true });
      try {
        if (advertisedBytes === null) {
          let total = 0;
          for (;;) {
            throwIfAborted(local.signal);
            const value = await Promise.race([reader.read(), readAbort]);
            throwIfAborted(local.signal);
            if (value.done) break;
            chunks.push(value.value);
            if (value.value.byteLength === 0) {
              throw new RunSafetyError("Invalid file stream chunk");
            }
            if (value.value.byteLength > remainingBytes - total) {
              await reader.cancel();
              chunks.forEach((chunk) => chunk.fill(0));
              chunks.length = 0;
              reader.releaseLock();
              return {
                status: "unavailable",
                failureCategory: "individual-size-limit",
              };
            }
            if (
              declaredBytes !== null &&
              value.value.byteLength > declaredBytes - total
            ) {
              throw new RunSafetyError("File content length changed");
            }
            total += value.value.byteLength;
          }
          if (total === 0) {
            throw new RunSafetyError("File stream size changed");
          }
          if (declaredBytes !== null && total !== declaredBytes) {
            throw new RunSafetyError("File content length changed");
          }
          output = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            output.set(chunk, offset);
            offset += chunk.byteLength;
          }
          chunks.forEach((chunk) => chunk.fill(0));
          chunks.length = 0;
        } else {
          output = new Uint8Array(advertisedBytes);
          let offset = 0;
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
        output?.fill(0);
        chunks.forEach((chunk) => chunk.fill(0));
        chunks.length = 0;
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
  maximumArchivedBytes = MAX_ARCHIVED_PAGE_BYTES,
): Promise<Retrieval> {
  throwIfAborted(signal);
  if (
    !Number.isSafeInteger(maximumArchivedBytes) ||
    maximumArchivedBytes < 1 ||
    maximumArchivedBytes > MAX_ARCHIVED_PAGE_BYTES
  ) {
    throw new RunSafetyError("Invalid archived page byte limit");
  }
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
      CANVAS_PAGE_JSON_MAX_BYTES,
    );
    throwIfAborted(signal);
    const page = exactCanvasPage(response.value);
    const html = sanitizePageFragment({
      title: page.title,
      body: page.body,
      resolveLocalHref: (href) => resolveLocalHref(href, plan),
    });
    const bytes = strToU8(html);
    if (bytes.byteLength > maximumArchivedBytes) {
      bytes.fill(0);
      return { status: "unavailable", failureCategory: "page-too-large" };
    }
    return { status: "success", bytes };
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
