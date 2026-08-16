import { describe, expect, it, vi } from "vitest";
import {
  CanvasCourseIndexUnavailableError,
  CanvasHttp,
  CanvasResponseError,
  CanvasSessionError,
} from "../../src/canvas/http";
import { CANVAS_ORIGIN } from "../../src/shared/constants";

const requestUrl = `${CANVAS_ORIGIN}/api/v1/test`;

function jsonResponse(
  status = 200,
  body: unknown = {},
  options: { contentType?: string; url?: string } = {},
): Response {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": options.contentType ?? "application/json" },
  });
  Object.defineProperty(response, "url", {
    value: options.url ?? requestUrl,
  });
  return response;
}

describe("CanvasHttp", () => {
  it("uses an authenticated GET only for the exact Canvas API origin", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    const http = new CanvasHttp(fetcher);

    await expect(http.json(new URL(requestUrl))).resolves.toMatchObject({
      value: {},
    });
    expect(fetcher).toHaveBeenCalledWith(new URL(requestUrl), {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      headers: { Accept: "application/json" },
    });
  });

  it.each([
    "https://evil.test/api/v1/test",
    `${CANVAS_ORIGIN}/api/v2/test`,
    `${CANVAS_ORIGIN}/api/v1evil/test`,
  ])(
    "rejects a request outside the fixed Canvas API boundary: %s",
    async (url) => {
      const fetcher = vi.fn<typeof fetch>();

      await expect(new CanvasHttp(fetcher).json(new URL(url))).rejects.toThrow(
        "Rejected Canvas URL",
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([408, 429, 500, 503])(
    "retries transient status %i twice",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(status))
        .mockResolvedValueOnce(jsonResponse(status))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      const sleep = vi.fn().mockResolvedValue(undefined);
      const http = new CanvasHttp(fetcher, undefined, sleep);

      await expect(http.json(new URL(requestUrl))).resolves.toMatchObject({
        value: { ok: true },
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenNthCalledWith(1, 250);
      expect(sleep).toHaveBeenNthCalledWith(2, 500);
    },
  );

  it.each([429, 503])(
    "retries exact-API HTML transient status %i twice",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse(status, {}, { contentType: "text/html" }),
        )
        .mockResolvedValueOnce(
          jsonResponse(status, {}, { contentType: "text/html" }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      const sleep = vi.fn().mockResolvedValue(undefined);

      await expect(
        new CanvasHttp(fetcher, undefined, sleep).json(new URL(requestUrl)),
      ).resolves.toMatchObject({ value: { ok: true } });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenNthCalledWith(1, 250);
      expect(sleep).toHaveBeenNthCalledWith(2, 500);
    },
  );

  it.each([
    "https://evil.test/api/v1/test",
    `${CANVAS_ORIGIN}/login/canvas`,
    `https://user@frankfurtschool.instructure.com/api/v1/test`,
  ])(
    "does not retry a transient status after an unsafe redirect: %s",
    async (url) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse(503, {}, { contentType: "text/html", url }),
        );
      const sleep = vi.fn();

      await expect(
        new CanvasHttp(fetcher, undefined, sleep).json(new URL(requestUrl)),
      ).rejects.toBeInstanceOf(CanvasSessionError);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("retries a network TypeError exactly twice", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network unavailable"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      new CanvasHttp(fetcher, undefined, sleep).json(new URL(requestUrl)),
    ).rejects.toThrow("Canvas request failed after bounded retries");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it.each([400, 404, 422])(
    "does not retry permanent status %i",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(status));
      const http = new CanvasHttp(fetcher, undefined, vi.fn());

      await expect(http.json(new URL(requestUrl))).rejects.toThrow(
        "Unexpected Canvas response",
      );
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([401, 403])("does not retry session status %i", async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(status));
    const http = new CanvasHttp(fetcher, undefined, vi.fn());

    await expect(http.json(new URL(requestUrl))).rejects.toBeInstanceOf(
      CanvasSessionError,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([403, 404])(
    "classifies only exact same-origin JSON course index status %i as unavailable",
    async (status) => {
      const courseIndexUrl = `${CANVAS_ORIGIN}/api/v1/courses/101/files`;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(status, {}, { url: courseIndexUrl }));

      await expect(
        new CanvasHttp(fetcher).json(new URL(courseIndexUrl)),
      ).rejects.toMatchObject({
        name: "CanvasCourseIndexUnavailableError",
        status,
      });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([
    {
      status: 403,
      url: `${CANVAS_ORIGIN}/api/v1/courses/101/files`,
      contentType: "text/html",
      error: CanvasSessionError,
    },
    {
      status: 403,
      url: `${CANVAS_ORIGIN}/login/canvas`,
      contentType: "application/json",
      error: CanvasSessionError,
    },
    {
      status: 404,
      url: `${CANVAS_ORIGIN}/api/v1/courses/101/files/301`,
      contentType: "application/json",
      error: CanvasResponseError,
    },
    {
      status: 404,
      url: "https://evil.test/api/v1/courses/101/files",
      contentType: "application/json",
      error: CanvasSessionError,
    },
  ])(
    "does not classify HTML, login, per-resource, or foreign failures as optional",
    async ({ status, url, contentType, error }) => {
      const requested = `${CANVAS_ORIGIN}/api/v1/courses/101/files`;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(status, {}, { url, contentType }));

      const request = new CanvasHttp(fetcher).json(new URL(requested));
      await expect(request).rejects.toBeInstanceOf(error);
      await expect(request).rejects.not.toBeInstanceOf(
        CanvasCourseIndexUnavailableError,
      );
    },
  );

  it("does not retry an aborted request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    const sleep = vi.fn();

    await expect(
      new CanvasHttp(fetcher, undefined, sleep).json(new URL(requestUrl)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("aborts during retry sleep without issuing another fetch", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network unavailable"));
    let sleepStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      sleepStarted = resolve;
    });
    const sleep = vi.fn(
      () =>
        new Promise<void>(() => {
          sleepStarted?.();
        }),
    );
    const request = new CanvasHttp(fetcher, controller.signal, sleep).json(
      new URL(requestUrl),
    );

    await started;
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledOnce();
  });

  it.each([
    { url: `${CANVAS_ORIGIN}/login/canvas`, contentType: "text/html" },
    { url: "https://evil.test/api/v1/test", contentType: "application/json" },
  ])("detects a lost session after redirects", async ({ url, contentType }) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, {}, { url, contentType }));

    await expect(
      new CanvasHttp(fetcher, undefined, vi.fn()).json(new URL(requestUrl)),
    ).rejects.toBeInstanceOf(CanvasSessionError);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects a same-origin redirect outside the Canvas API", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(200, {}, { url: `${CANVAS_ORIGIN}/dashboard` }),
      );

    await expect(
      new CanvasHttp(fetcher).json(new URL(requestUrl)),
    ).rejects.toThrow("Rejected final Canvas URL");
  });

  it("rejects non-JSON content without reading the body", async () => {
    const response = jsonResponse(200, {}, { contentType: "text/plain" });
    const json = vi.spyOn(response, "json");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      new CanvasHttp(fetcher).json(new URL(requestUrl)),
    ).rejects.toThrow("Canvas returned a non-JSON response");
    expect(json).not.toHaveBeenCalled();
  });

  it("does not retry a response-body decoding TypeError", async () => {
    const response = jsonResponse();
    vi.spyOn(response, "json").mockRejectedValue(new TypeError("invalid body"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      new CanvasHttp(fetcher).json(new URL(requestUrl)),
    ).rejects.toBeInstanceOf(CanvasResponseError);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
