import { describe, expect, it, vi } from "vitest";
import {
  CanvasBodySizeError,
  CanvasCourseIndexUnavailableError,
  CanvasHttp,
  CanvasResourceUnavailableError,
  CanvasResponseError,
  CanvasSessionError,
  CanvasTransientError,
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

function rawResponse(
  status: number,
  body: BodyInit | null,
  options: { contentType?: string; url?: string } = {},
): Response {
  const response = new Response(body, {
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
      expect(sleep).toHaveBeenNthCalledWith(1, 250, undefined);
      expect(sleep).toHaveBeenNthCalledWith(2, 500, undefined);
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
      expect(sleep).toHaveBeenNthCalledWith(1, 250, undefined);
      expect(sleep).toHaveBeenNthCalledWith(2, 500, undefined);
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

  it.each([
    { status: 403, body: { errors: [{ message: "Unavailable" }] } },
    { status: 404, body: { errors: [{ message: "Unavailable" }] } },
    {
      status: 404,
      body: { errors: [{ message: "Unavailable" }], status: "not_found" },
    },
  ])(
    "classifies only exact same-origin JSON course index status $status as unavailable",
    async ({ status, body }) => {
      const courseIndexUrl = `${CANVAS_ORIGIN}/api/v1/courses/101/files`;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(status, body, { url: courseIndexUrl }));

      await expect(
        new CanvasHttp(fetcher).fetchAll(new URL(courseIndexUrl)),
      ).rejects.toMatchObject({
        name: "CanvasCourseIndexUnavailableError",
        status,
      });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("classifies a course-disabled pages index as optional", async () => {
    const pagesIndexUrl = `${CANVAS_ORIGIN}/api/v1/courses/101/pages`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          404,
          { message: "That page has been disabled for this course" },
          { url: pagesIndexUrl },
        ),
      );

    await expect(
      new CanvasHttp(fetcher).fetchAll(new URL(pagesIndexUrl)),
    ).rejects.toMatchObject({
      name: "CanvasCourseIndexUnavailableError",
      status: 404,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 403, body: "{" },
    { status: 403, body: JSON.stringify([]) },
    { status: 404, body: "" },
    { status: 404, body: JSON.stringify({ error: "Unavailable" }) },
  ])(
    "hard-fails malformed or wrong-shape optional index JSON for status $status",
    async ({ status, body }) => {
      const courseIndexUrl = `${CANVAS_ORIGIN}/api/v1/courses/101/files`;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(rawResponse(status, body, { url: courseIndexUrl }));

      const request = new CanvasHttp(fetcher).fetchAll(new URL(courseIndexUrl));
      await expect(request).rejects.toBeInstanceOf(CanvasResponseError);
      await expect(request).rejects.not.toBeInstanceOf(
        CanvasCourseIndexUnavailableError,
      );
    },
  );

  it("hard-fails optional index errors with invalid status or property shapes", async () => {
    const courseIndexUrl = `${CANVAS_ORIGIN}/api/v1/courses/101/files`;
    const invalidBodies: unknown[] = [
      { errors: [{ message: "Unavailable" }], status: "Not-Found" },
      { errors: [{ message: "Unavailable" }], status: "" },
      { errors: [{ message: "Unavailable" }], status: "a".repeat(101) },
      { errors: [{ message: "Unavailable" }], status: 404 },
      {
        errors: [{ message: "Unavailable" }],
        status: "not_found",
        extra: true,
      },
      { errors: [], status: "not_found" },
    ];
    const accessor = { errors: [{ message: "Unavailable" }] } as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessor, "status", {
      enumerable: true,
      get: () => "not_found",
    });
    invalidBodies.push(accessor);
    const errorCodeGetter = vi.fn(() => "unavailable");
    const errorCodeAccessor = { message: "Unavailable" } as Record<
      string,
      unknown
    >;
    Object.defineProperty(errorCodeAccessor, "error_code", {
      enumerable: true,
      get: errorCodeGetter,
    });
    invalidBodies.push({ errors: [errorCodeAccessor], status: "not_found" });
    const symbolKeyedErrors = [{ message: "Unavailable" }] as Array<{
      message: string;
    }> &
      Record<PropertyKey, unknown>;
    symbolKeyedErrors[Symbol("extra")] = true;
    invalidBodies.push({ errors: symbolKeyedErrors, status: "not_found" });

    for (const body of invalidBodies) {
      const response = jsonResponse(403, {}, { url: courseIndexUrl });
      vi.spyOn(response, "json").mockResolvedValue(body);
      const request = new CanvasHttp(
        vi.fn<typeof fetch>().mockResolvedValue(response),
      ).fetchAll(new URL(courseIndexUrl));

      await expect(request).rejects.toBeInstanceOf(CanvasResponseError);
      await expect(request).rejects.not.toBeInstanceOf(
        CanvasCourseIndexUnavailableError,
      );
    }
    expect(errorCodeGetter).not.toHaveBeenCalled();
  });

  it.each([403, 404])(
    "hard-fails a continuation status %i instead of discarding the first page",
    async (status) => {
      const first = `${CANVAS_ORIGIN}/api/v1/courses/101/files?per_page=100`;
      const second = `${CANVAS_ORIGIN}/api/v1/courses/101/files?per_page=100&page=2`;
      const firstResponse = jsonResponse(200, [{ id: 1 }], { url: first });
      firstResponse.headers.set("link", `<${second}>; rel="next"`);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(
          jsonResponse(
            status,
            { errors: [{ message: "Unavailable" }], status: "not_found" },
            { url: second },
          ),
        );

      const request = new CanvasHttp(fetcher).fetchAll(new URL(first));
      await expect(request).rejects.toBeInstanceOf(CanvasResponseError);
      await expect(request).rejects.not.toBeInstanceOf(
        CanvasCourseIndexUnavailableError,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    `${CANVAS_ORIGIN}/api/v1/courses/102/files`,
    `${CANVAS_ORIGIN}/api/v1/courses/101/pages`,
  ])(
    "rejects a successful same-origin response pathname pivot: %s",
    async (url) => {
      const requested = `${CANVAS_ORIGIN}/api/v1/courses/101/files`;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(200, [], { url }));

      await expect(
        new CanvasHttp(fetcher).json(new URL(requested)),
      ).rejects.toThrow("response path");
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
        .mockResolvedValue(
          jsonResponse(
            status,
            { errors: [{ message: "Unavailable" }], status: "not_found" },
            { url, contentType },
          ),
        );

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
      (_milliseconds: number, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          sleepStarted?.();
          signal?.addEventListener(
            "abort",
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new DOMException("aborted", "AbortError"),
              ),
            { once: true },
          );
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

  it("clears the default retry timer when an HTTP request is aborted", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError("network unavailable"));
      const request = new CanvasHttp(fetcher, controller.signal).json(
        new URL(requestUrl),
      );
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
      controller.abort(new DOMException("cancelled", "AbortError"));
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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

  it("reads a resource JSON body through the bounded stream path", async () => {
    const response = rawResponse(
      200,
      JSON.stringify({ title: "Synthetic", body: "<p>Safe</p>" }),
    );
    const json = vi.spyOn(response, "json");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      new CanvasHttp(fetcher).jsonBoundedResource(new URL(requestUrl), 1024),
    ).resolves.toMatchObject({
      value: { title: "Synthetic", body: "<p>Safe</p>" },
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("scrubs every raw bounded JSON chunk after successful parsing", async () => {
    const raw = new TextEncoder().encode(
      JSON.stringify({ title: "Synthetic", body: "<p>Safe</p>" }),
    );
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(raw);
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    Object.defineProperty(response, "url", { value: requestUrl });
    await new CanvasHttp(
      vi.fn<typeof fetch>().mockResolvedValue(response),
    ).jsonBoundedResource(new URL(requestUrl), 1024);
    expect(raw.every((value) => value === 0)).toBe(true);
  });

  it("scrubs the chunk that crosses the bounded JSON cap", async () => {
    const raw = new Uint8Array(11).fill(65);
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(raw);
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    Object.defineProperty(response, "url", { value: requestUrl });
    await expect(
      new CanvasHttp(
        vi.fn<typeof fetch>().mockResolvedValue(response),
      ).jsonBoundedResource(new URL(requestUrl), 10),
    ).rejects.toBeInstanceOf(CanvasBodySizeError);
    expect(raw.every((value) => value === 0)).toBe(true);
  });

  it("rejects declared and streamed JSON bodies above the fixed cap with awaited cancellation", async () => {
    const declared = rawResponse(200, "{}", {
      contentType: "application/json",
    });
    declared.headers.set("content-length", "100");
    const declaredCancel = vi.spyOn(declared.body!, "cancel");
    await expect(
      new CanvasHttp(
        vi.fn<typeof fetch>().mockResolvedValue(declared),
      ).jsonBoundedResource(new URL(requestUrl), 10),
    ).rejects.toBeInstanceOf(CanvasBodySizeError);
    expect(declaredCancel).toHaveBeenCalledOnce();

    const streamed = rawResponse(200, "01234567890", {
      contentType: "application/json",
    });
    const cancelled = vi.fn();
    const original = streamed.body!;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          const reader = original.getReader();
          const value = await reader.read();
          if (value.done) controller.close();
          else controller.enqueue(value.value);
        },
        cancel: cancelled,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    Object.defineProperty(response, "url", { value: requestUrl });
    await expect(
      new CanvasHttp(
        vi.fn<typeof fetch>().mockResolvedValue(response),
      ).jsonBoundedResource(new URL(requestUrl), 10),
    ).rejects.toBeInstanceOf(CanvasBodySizeError);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("treats malformed bounded Content-Length as a run-level response violation", async () => {
    const response = rawResponse(200, "{}");
    response.headers.set("content-length", "not-a-number");
    const cancel = vi.spyOn(response.body!, "cancel");
    const request = new CanvasHttp(
      vi.fn<typeof fetch>().mockResolvedValue(response),
    ).jsonBoundedResource(new URL(requestUrl), 1024);
    await expect(request).rejects.toBeInstanceOf(CanvasResponseError);
    await expect(request).rejects.not.toBeInstanceOf(CanvasBodySizeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([403, 404] as const)(
    "classifies bounded resource status %i without treating scoped 403 as logout",
    async (status) => {
      const response = jsonResponse(status, {
        errors: [{ message: "Unavailable" }],
      });
      const cancel = vi.spyOn(response.body!, "cancel");
      await expect(
        new CanvasHttp(
          vi.fn<typeof fetch>().mockResolvedValue(response),
        ).jsonBoundedResource(new URL(requestUrl), 1024),
      ).rejects.toMatchObject({
        name: "CanvasResourceUnavailableError",
        status,
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(new CanvasResourceUnavailableError(status)).not.toBeInstanceOf(
        CanvasSessionError,
      );
    },
  );

  it("cancels every transient bounded response and throws a typed exhausted outcome", async () => {
    const responses = [408, 429, 503].map((status) => jsonResponse(status));
    const cancels = responses.map((response) =>
      vi.spyOn(response.body!, "cancel"),
    );
    const fetcher = vi.fn<typeof fetch>();
    responses.forEach((response) => fetcher.mockResolvedValueOnce(response));
    await expect(
      new CanvasHttp(
        fetcher,
        undefined,
        vi.fn().mockResolvedValue(undefined),
      ).jsonBoundedResource(new URL(requestUrl), 1024),
    ).rejects.toBeInstanceOf(CanvasTransientError);
    cancels.forEach((cancel) => expect(cancel).toHaveBeenCalledOnce());
  });

  it("classifies an exhausted bounded network failure as an individual transient outcome", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("private network detail"));
    await expect(
      new CanvasHttp(
        fetcher,
        undefined,
        vi.fn().mockResolvedValue(undefined),
      ).jsonBoundedResource(new URL(requestUrl), 1024),
    ).rejects.toBeInstanceOf(CanvasTransientError);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    { status: 401, url: requestUrl, contentType: "application/json" },
    {
      status: 200,
      url: `${CANVAS_ORIGIN}/login/canvas`,
      contentType: "text/html",
    },
    {
      status: 200,
      url: "https://evil.test/api/v1/test",
      contentType: "application/json",
    },
    { status: 200, url: requestUrl, contentType: "text/plain" },
  ])(
    "cancels a bounded body before every terminal response rejection %#",
    async ({ status, url, contentType }) => {
      const response = rawResponse(status, "private", { url, contentType });
      const cancel = vi.spyOn(response.body!, "cancel");
      await expect(
        new CanvasHttp(
          vi.fn<typeof fetch>().mockResolvedValue(response),
        ).jsonBoundedResource(new URL(requestUrl), 1024),
      ).rejects.toThrow();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
});
