import { CANVAS_ORIGIN, MAX_RETRIES } from "../shared/constants";
import { fetchAllPages } from "./pagination";

export class CanvasSessionError extends Error {}
export class CanvasResponseError extends Error {}
export class CanvasBodySizeError extends CanvasResponseError {
  override readonly name = "CanvasBodySizeError";
}
export class CanvasTransientError extends CanvasResponseError {
  override readonly name = "CanvasTransientError";
}
export class CanvasResourceUnavailableError extends CanvasResponseError {
  override readonly name = "CanvasResourceUnavailableError";

  constructor(readonly status: 403 | 404) {
    super("Canvas resource is unavailable");
  }
}
export class CanvasCourseIndexUnavailableError extends CanvasResponseError {
  readonly name = "CanvasCourseIndexUnavailableError";

  constructor(readonly status: 403 | 404) {
    super("Canvas course index is unavailable");
  }
}
export class CanvasCourseModulesDisabledError extends CanvasResponseError {
  override readonly name = "CanvasCourseModulesDisabledError";
}

type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const abortError = (signal: AbortSignal): DOMException =>
  isAbortError(signal.reason)
    ? (signal.reason as DOMException)
    : new DOMException("Canvas request aborted", "AbortError");

const abortableDelay: Sleep = (milliseconds, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(finish, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(
        signal ? abortError(signal) : new DOMException("Aborted", "AbortError"),
      );
    };
    function finish(): void {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const isCanvasApiUrl = (url: URL): boolean =>
  url.origin === CANVAS_ORIGIN &&
  url.pathname.startsWith("/api/v1/") &&
  url.username === "" &&
  url.password === "" &&
  url.hash === "";

const isJsonContentType = (value: string): boolean => {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
};

const isCourseCollectionIndex = (url: URL): boolean =>
  /^\/api\/v1\/courses\/[1-9]\d*\/(?:files|folders|modules|pages)$/.test(
    url.pathname,
  );

const isCourseModulesIndex = (url: URL): boolean =>
  /^\/api\/v1\/courses\/[1-9]\d*\/modules$/.test(url.pathname);

const isCoursePagesIndex = (url: URL): boolean =>
  /^\/api\/v1\/courses\/[1-9]\d*\/pages$/.test(url.pathname);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const missingDataValue = Symbol("missingDataValue");

const ownDataValue = (value: object, key: PropertyKey): unknown => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor
      ? descriptor.value
      : missingDataValue;
  } catch {
    return missingDataValue;
  }
};

const ownKeys = (value: object): PropertyKey[] | null => {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return null;
  }
};

const hasConservativeCanvasErrorEntry = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const keys = ownKeys(value);
  if (!keys || keys.some((key) => key !== "message" && key !== "error_code")) {
    return false;
  }
  const message = ownDataValue(value, "message");
  const errorCode = ownDataValue(value, "error_code");
  if (keys.includes("error_code") && errorCode === missingDataValue) {
    return false;
  }
  return (
    typeof message === "string" &&
    message.trim().length > 0 &&
    message.length <= 1_000 &&
    (errorCode === missingDataValue ||
      (typeof errorCode === "string" && errorCode.length <= 200))
  );
};

const hasConservativeCanvasErrorShape = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const keys = ownKeys(value);
  if (
    !keys ||
    keys.length < 1 ||
    keys.length > 2 ||
    keys.some((key) => key !== "errors" && key !== "status")
  ) {
    return false;
  }
  const errors = ownDataValue(value, "errors");
  if (!Array.isArray(errors) || errors.length === 0 || errors.length > 20) {
    return false;
  }
  const errorKeys = ownKeys(errors);
  if (!errorKeys || errorKeys.length !== errors.length + 1) return false;
  if (
    !Array.from({ length: errors.length }, (_, index) =>
      hasConservativeCanvasErrorEntry(ownDataValue(errors, String(index))),
    ).every(Boolean)
  ) {
    return false;
  }
  if (!keys.includes("status")) return true;
  const status = ownDataValue(value, "status");
  return typeof status === "string" && /^[a-z][a-z0-9_-]{0,99}$/u.test(status);
};

const hasConservativeDisabledCourseShape = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    return false;
  }
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = ownKeys(value);
  if (!keys || keys.length !== 1 || keys[0] !== "message") return false;
  return (
    ownDataValue(value, "message") ===
    "That page has been disabled for this course"
  );
};

const sameSearch = (left: URL, right: URL): boolean => {
  const leftEntries = [...left.searchParams.entries()].sort();
  const rightEntries = [...right.searchParams.entries()].sort();
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value], index) =>
        key === rightEntries[index]?.[0] && value === rightEntries[index]?.[1],
    )
  );
};

type RequestContext = {
  optionalCourseIndexInitial: boolean;
  continuation: boolean;
  boundedResourceBytes?: number;
};

export class CanvasHttp {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly signal?: AbortSignal,
    private readonly sleep: Sleep = abortableDelay,
  ) {}

  private throwIfAborted(): void {
    if (this.signal?.aborted) throw abortError(this.signal);
  }

  private async waitBeforeRetry(milliseconds: number): Promise<void> {
    const signal = this.signal;
    await this.sleep(milliseconds, signal);
    this.throwIfAborted();
  }

  private async requestJson<T>(
    url: URL,
    context: RequestContext,
  ): Promise<{ value: T; response: Response }> {
    if (!isCanvasApiUrl(url)) {
      throw new CanvasResponseError("Rejected Canvas URL");
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      this.throwIfAborted();
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: "GET",
          credentials: "include",
          redirect: "follow",
          headers: { Accept: "application/json" },
          ...(this.signal ? { signal: this.signal } : {}),
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (!(error instanceof TypeError)) {
          throw new CanvasResponseError("Canvas request failed");
        }
        if (attempt === MAX_RETRIES) {
          throw context.boundedResourceBytes === undefined
            ? new CanvasResponseError(
                "Canvas request failed after bounded retries",
              )
            : new CanvasTransientError(
                "Canvas request failed after bounded retries",
              );
        }
        await this.waitBeforeRetry(250 * 2 ** attempt);
        continue;
      }

      let finalUrl: URL;
      const discardBoundedBody = async (): Promise<void> => {
        if (context.boundedResourceBytes === undefined) return;
        await response.body?.cancel().catch(() => {});
      };
      try {
        finalUrl = new URL(response.url || url);
      } catch {
        await discardBoundedBody();
        throw new CanvasResponseError("Rejected final Canvas URL");
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (
        finalUrl.origin !== CANVAS_ORIGIN ||
        finalUrl.username !== "" ||
        finalUrl.password !== "" ||
        /\/login(?:\/|$)/.test(finalUrl.pathname)
      ) {
        await discardBoundedBody();
        throw new CanvasSessionError("Canvas session is unavailable");
      }
      if (!isCanvasApiUrl(finalUrl)) {
        await discardBoundedBody();
        throw new CanvasResponseError("Rejected final Canvas URL");
      }
      if (finalUrl.pathname !== url.pathname) {
        await discardBoundedBody();
        throw new CanvasResponseError("Rejected Canvas response path");
      }
      if (!sameSearch(finalUrl, url)) {
        await discardBoundedBody();
        throw new CanvasResponseError("Rejected Canvas response query");
      }
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        await response.body?.cancel().catch(() => {});
        if (attempt === MAX_RETRIES) {
          throw context.boundedResourceBytes === undefined
            ? new CanvasResponseError(
                "Canvas request failed after bounded retries",
              )
            : new CanvasTransientError(
                "Canvas request failed after bounded retries",
              );
        }
        await this.waitBeforeRetry(250 * 2 ** attempt);
        continue;
      }
      if (contentType.toLowerCase().includes("text/html")) {
        await discardBoundedBody();
        throw new CanvasSessionError("Canvas session is unavailable");
      }
      if (response.status === 401) {
        await discardBoundedBody();
        throw new CanvasSessionError("Canvas session is unavailable");
      }
      if (
        (response.status === 403 || response.status === 404) &&
        isJsonContentType(contentType) &&
        context.optionalCourseIndexInitial &&
        isCourseCollectionIndex(url) &&
        isCourseCollectionIndex(finalUrl) &&
        url.pathname === finalUrl.pathname
      ) {
        let errorValue: unknown;
        try {
          errorValue = await response.json();
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw new CanvasResponseError("Canvas returned invalid JSON");
        }
        if (
          isCourseModulesIndex(url) &&
          hasConservativeDisabledCourseShape(errorValue)
        ) {
          throw new CanvasCourseModulesDisabledError(
            "Canvas course Modules are disabled",
          );
        }
        if (
          !hasConservativeCanvasErrorShape(errorValue) &&
          !(
            isCoursePagesIndex(url) &&
            hasConservativeDisabledCourseShape(errorValue)
          )
        ) {
          throw new CanvasResponseError(
            "Canvas returned an invalid error response",
          );
        }
        throw new CanvasCourseIndexUnavailableError(response.status);
      }
      if (response.status === 403) {
        if (context.boundedResourceBytes !== undefined) {
          await response.body?.cancel().catch(() => {});
          throw new CanvasResourceUnavailableError(403);
        }
        if (context.continuation) {
          throw new CanvasResponseError(
            "Unexpected Canvas continuation response",
          );
        }
        throw new CanvasSessionError("Canvas session is unavailable");
      }
      if (
        response.status === 404 &&
        context.boundedResourceBytes !== undefined
      ) {
        await response.body?.cancel().catch(() => {});
        throw new CanvasResourceUnavailableError(404);
      }
      if (!response.ok) {
        await discardBoundedBody();
        throw new CanvasResponseError(
          `Unexpected Canvas response: ${response.status}`,
        );
      }
      if (!isJsonContentType(contentType)) {
        await discardBoundedBody();
        throw new CanvasResponseError("Canvas returned a non-JSON response");
      }

      try {
        if (context.boundedResourceBytes !== undefined) {
          return {
            value: (await this.readBoundedJson(
              response,
              context.boundedResourceBytes,
            )) as T,
            response,
          };
        }
        return { value: (await response.json()) as T, response };
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof CanvasResponseError) throw error;
        throw new CanvasResponseError("Canvas returned invalid JSON");
      }
    }

    throw new CanvasResponseError(
      "Canvas request failed after bounded retries",
    );
  }

  private async readBoundedJson(
    response: Response,
    maximumBytes: number,
  ): Promise<unknown> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new CanvasResponseError("Invalid JSON body limit");
    }
    const rawLength = response.headers.get("content-length");
    if (rawLength !== null) {
      if (!/^(?:0|[1-9]\d*)$/u.test(rawLength)) {
        await response.body?.cancel().catch(() => {});
        throw new CanvasResponseError("Invalid Canvas JSON content length");
      }
      if (Number(rawLength) > maximumBytes) {
        await response.body?.cancel().catch(() => {});
        throw new CanvasBodySizeError("Canvas JSON body is too large");
      }
    }
    if (!response.body)
      throw new CanvasResponseError("Canvas returned an empty JSON body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        this.throwIfAborted();
        const result = await reader.read();
        if (this.signal?.aborted) {
          if (!result.done) result.value.fill(0);
          this.throwIfAborted();
        }
        if (result.done) break;
        total += result.value.byteLength;
        if (!Number.isSafeInteger(total) || total > maximumBytes) {
          result.value.fill(0);
          throw new CanvasBodySizeError("Canvas JSON body is too large");
        }
        chunks.push(result.value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      reader.releaseLock();
      try {
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ) as unknown;
      } finally {
        bytes.fill(0);
        chunks.forEach((chunk) => chunk.fill(0));
        chunks.length = 0;
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // The original bounded-read failure remains authoritative.
      }
      chunks.forEach((chunk) => chunk.fill(0));
      chunks.length = 0;
      throw error;
    }
  }

  json<T>(url: URL): Promise<{ value: T; response: Response }> {
    return this.requestJson<T>(url, {
      optionalCourseIndexInitial: false,
      continuation: false,
    });
  }

  jsonBoundedResource<T>(
    url: URL,
    maximumBytes: number,
  ): Promise<{ value: T; response: Response }> {
    return this.requestJson<T>(url, {
      optionalCourseIndexInitial: false,
      continuation: false,
      boundedResourceBytes: maximumBytes,
    });
  }

  fetchAll<T>(url: URL): Promise<T[]> {
    let initial = true;
    return fetchAllPages<T>(async (next) => {
      const isInitial = initial;
      initial = false;
      const page = await this.requestJson<unknown>(next, {
        optionalCourseIndexInitial: isInitial && isCourseCollectionIndex(url),
        continuation: !isInitial,
      });
      if (
        isInitial &&
        isCourseModulesIndex(url) &&
        hasConservativeDisabledCourseShape(page.value)
      ) {
        throw new CanvasCourseModulesDisabledError(
          "Canvas course Modules are disabled",
        );
      }
      return page as { value: T[]; response: Response };
    }, url);
  }
}
