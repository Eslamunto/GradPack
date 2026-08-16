import { CANVAS_ORIGIN, MAX_RETRIES } from "../shared/constants";
import { fetchAllPages } from "./pagination";

export class CanvasSessionError extends Error {}
export class CanvasResponseError extends Error {}

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
  url.password === "";

const isJsonContentType = (value: string): boolean => {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
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

  async json<T>(url: URL): Promise<{ value: T; response: Response }> {
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
        response.status === 401 ||
        response.status === 403 ||
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

  fetchAll<T>(url: URL): Promise<T[]> {
    return fetchAllPages<T>((next) => this.json<T[]>(next), url);
  }
}
