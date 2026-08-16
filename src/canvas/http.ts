import { CANVAS_ORIGIN, MAX_RETRIES } from "../shared/constants";
import { fetchAllPages } from "./pagination";

export class CanvasSessionError extends Error {}
export class CanvasResponseError extends Error {}
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
          throw new CanvasResponseError(
            "Canvas request failed after bounded retries",
          );
        }
        await this.waitBeforeRetry(250 * 2 ** attempt);
        continue;
      }

      let finalUrl: URL;
      try {
        finalUrl = new URL(response.url || url);
      } catch {
        throw new CanvasResponseError("Rejected final Canvas URL");
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (
        finalUrl.origin !== CANVAS_ORIGIN ||
        finalUrl.username !== "" ||
        finalUrl.password !== "" ||
        /\/login(?:\/|$)/.test(finalUrl.pathname)
      ) {
        throw new CanvasSessionError("Canvas session is unavailable");
      }
      if (!isCanvasApiUrl(finalUrl)) {
        throw new CanvasResponseError("Rejected final Canvas URL");
      }
      if (finalUrl.pathname !== url.pathname) {
        throw new CanvasResponseError("Rejected Canvas response path");
      }
      if (!sameSearch(finalUrl, url)) {
        throw new CanvasResponseError("Rejected Canvas response query");
      }
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        if (attempt === MAX_RETRIES) {
          throw new CanvasResponseError(
            "Canvas request failed after bounded retries",
          );
        }
        await this.waitBeforeRetry(250 * 2 ** attempt);
        continue;
      }
      if (contentType.toLowerCase().includes("text/html")) {
        throw new CanvasSessionError("Canvas session is unavailable");
      }
      if (response.status === 401) {
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
        if (context.continuation) {
          throw new CanvasResponseError(
            "Unexpected Canvas continuation response",
          );
        }
        throw new CanvasSessionError("Canvas session is unavailable");
      }
      if (!response.ok) {
        throw new CanvasResponseError(
          `Unexpected Canvas response: ${response.status}`,
        );
      }
      if (!isJsonContentType(contentType)) {
        throw new CanvasResponseError("Canvas returned a non-JSON response");
      }

      try {
        return { value: (await response.json()) as T, response };
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw new CanvasResponseError("Canvas returned invalid JSON");
      }
    }

    throw new CanvasResponseError(
      "Canvas request failed after bounded retries",
    );
  }

  json<T>(url: URL): Promise<{ value: T; response: Response }> {
    return this.requestJson<T>(url, {
      optionalCourseIndexInitial: false,
      continuation: false,
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
