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

type Sleep = (milliseconds: number) => Promise<void>;

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const abortError = (signal: AbortSignal): DOMException =>
  isAbortError(signal.reason)
    ? (signal.reason as DOMException)
    : new DOMException("Canvas request aborted", "AbortError");

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
  /^\/api\/v1\/courses\/[1-9]\d*\/(?:files|folders|pages)$/.test(url.pathname);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasConservativeCanvasErrorShape = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== "errors") return false;
  const errors = value.errors;
  if (!Array.isArray(errors) || errors.length === 0 || errors.length > 20) {
    return false;
  }
  return errors.every((entry) => {
    if (!isRecord(entry)) return false;
    const entryKeys = Reflect.ownKeys(entry);
    if (entryKeys.some((key) => key !== "message" && key !== "error_code")) {
      return false;
    }
    return (
      Object.hasOwn(entry, "message") &&
      typeof entry.message === "string" &&
      entry.message.trim().length > 0 &&
      entry.message.length <= 1_000 &&
      (!Object.hasOwn(entry, "error_code") ||
        (typeof entry.error_code === "string" &&
          entry.error_code.length <= 200))
    );
  });
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
    private readonly sleep: Sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  private throwIfAborted(): void {
    if (this.signal?.aborted) throw abortError(this.signal);
  }

  private async waitBeforeRetry(milliseconds: number): Promise<void> {
    const signal = this.signal;
    if (!signal) {
      await this.sleep(milliseconds);
      return;
    }

    this.throwIfAborted();
    let rejectAbort: (reason: DOMException) => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = (): void => rejectAbort(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await Promise.race([this.sleep(milliseconds), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
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
        if (!hasConservativeCanvasErrorShape(errorValue)) {
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
        this.throwIfAborted();
        if (result.done) break;
        total += result.value.byteLength;
        if (!Number.isSafeInteger(total) || total > maximumBytes) {
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
        chunks.length = 0;
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // The original bounded-read failure remains authoritative.
      }
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
    return fetchAllPages<T>((next) => {
      const isInitial = initial;
      initial = false;
      return this.requestJson<T[]>(next, {
        optionalCourseIndexInitial: isInitial && isCourseCollectionIndex(url),
        continuation: !isInitial,
      });
    }, url);
  }
}
