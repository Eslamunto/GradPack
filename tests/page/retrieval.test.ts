/* eslint-disable @typescript-eslint/require-await -- async callbacks model browser fetches in focused tests */
import { strFromU8, strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { CanvasSessionError } from "../../src/canvas/http";
import {
  CANVAS_ORIGIN,
  CANVAS_PAGE_JSON_MAX_BYTES,
  MAX_ARCHIVED_PAGE_BYTES,
  MAX_ARCHIVE_BYTES,
} from "../../src/shared/constants";
import {
  RunSafetyError,
  fetchFileResource,
  fetchPageResource,
  resolveLocalHref,
} from "../../src/page/run-course";
import {
  syntheticArchivePlan,
  unknownFileResource,
} from "../fixtures/course-plan";

const streamResponse = (
  chunks: Uint8Array[],
  init: ResponseInit & { url?: string } = {},
): Response => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    }),
    init,
  );
  Object.defineProperty(response, "url", {
    value: init.url ?? "https://cdn.example/file",
  });
  return response;
};

describe("production file retrieval", () => {
  const resource = syntheticArchivePlan.resources[0]!;

  it("streams the exact advertised bytes from a safe HTTPS redirect", async () => {
    const fetcher = vi.fn(async () =>
      streamResponse([strToU8("synthetic-file-data")], {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": "19" },
        url: "https://cdn.example/file",
      }),
    );
    const result = await fetchFileResource(
      resource,
      new AbortController().signal,
      { fetcher, sleep: vi.fn() },
      MAX_ARCHIVE_BYTES,
    );
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(Array.from(result.bytes)).toEqual(
        Array.from(strToU8("synthetic-file-data")),
      );
    }
    expect(fetcher).toHaveBeenCalledWith(
      new URL(resource.sourceUrl!),
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        redirect: "follow",
      }),
    );
  });

  it.each([
    [403, "access-denied"],
    [404, "not-found"],
  ] as const)(
    "returns a fixed individual outcome for status %i",
    async (status, failureCategory) => {
      const response = streamResponse([strToU8("ignored")], {
        status,
        headers: { "content-type": "application/json" },
      });
      const cancel = vi.spyOn(response.body!, "cancel");
      await expect(
        fetchFileResource(
          resource,
          new AbortController().signal,
          { fetcher: vi.fn(async () => response), sleep: vi.fn() },
          MAX_ARCHIVE_BYTES,
        ),
      ).resolves.toEqual({ status: "unavailable", failureCategory });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("retries fixed transient responses twice with abort-aware cleanup", async () => {
    const responses = [408, 429, 503].map((status) =>
      streamResponse([], {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
    const cancels = responses.map((response) =>
      vi.spyOn(response.body!, "cancel"),
    );
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>(
      async () => undefined,
    );
    const result = await fetchFileResource(
      resource,
      new AbortController().signal,
      { fetcher: vi.fn(async () => responses.shift()!), sleep },
      MAX_ARCHIVE_BYTES,
    );
    expect(result).toEqual({
      status: "failed",
      failureCategory: "transient-exhausted",
    });
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      250, 500,
    ]);
    cancels.forEach((cancel) => expect(cancel).toHaveBeenCalledOnce());
  });

  it.each([
    ["http://cdn.example/file", "unsafe redirect"],
    ["https://user:pass@cdn.example/file", "credentialed redirect"],
    ["https://cdn.example/login", "login redirect"],
  ])("rejects %s", async (url) => {
    await expect(
      fetchFileResource(
        resource,
        new AbortController().signal,
        {
          fetcher: vi.fn(async () =>
            streamResponse([], {
              status: 200,
              headers: {
                "content-type": "application/pdf",
                "content-length": "19",
              },
              url,
            }),
          ),
          sleep: vi.fn(),
        },
        MAX_ARCHIVE_BYTES,
      ),
    ).rejects.toThrow();
  });

  it.each([
    [403, "http://cdn.example/file"],
    [404, "https://user@cdn.example/file"],
    [503, "https://cdn.example/file#unsafe"],
    [404, ""],
  ] as const)(
    "rejects unsafe final URL %s before classifying status %i",
    async (status, url) => {
      const fetcher = vi.fn(async () =>
        streamResponse([], {
          status,
          headers: { "content-type": "application/json" },
          url,
        }),
      );
      await expect(
        fetchFileResource(
          resource,
          new AbortController().signal,
          { fetcher, sleep: vi.fn() },
          MAX_ARCHIVE_BYTES,
        ),
      ).rejects.toBeInstanceOf(RunSafetyError);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["text/html", "19"],
    ["application/pdf", "20"],
    ["application/pdf", "not-a-number"],
  ])(
    "rejects content type %s and length %s",
    async (contentType, contentLength) => {
      await expect(
        fetchFileResource(
          resource,
          new AbortController().signal,
          {
            fetcher: vi.fn(async () =>
              streamResponse([strToU8("synthetic-file-data")], {
                status: 200,
                headers: {
                  "content-type": contentType,
                  "content-length": contentLength,
                },
              }),
            ),
            sleep: vi.fn(),
          },
          MAX_ARCHIVE_BYTES,
        ),
      ).rejects.toThrow();
    },
  );

  it.each([
    [[], "zero"],
    [[strToU8("too-short")], "mismatch"],
    [[new Uint8Array(20)], "overflow"],
  ] as const)("rejects a %s stream", async (chunks, label) => {
    void label;
    await expect(
      fetchFileResource(
        resource,
        new AbortController().signal,
        {
          fetcher: vi.fn(async () =>
            streamResponse([...chunks], {
              status: 200,
              headers: { "content-type": "application/pdf" },
            }),
          ),
          sleep: vi.fn(),
        },
        MAX_ARCHIVE_BYTES,
      ),
    ).rejects.toBeInstanceOf(RunSafetyError);
  });

  it("classifies 401 and login HTML as session loss", async () => {
    for (const response of [
      streamResponse([], {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
      streamResponse([], {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ]) {
      await expect(
        fetchFileResource(
          resource,
          new AbortController().signal,
          { fetcher: vi.fn(async () => response), sleep: vi.fn() },
          MAX_ARCHIVE_BYTES,
        ),
      ).rejects.toBeInstanceOf(CanvasSessionError);
    }
  });

  it("aborts and cancels a stream on caller cancellation", async () => {
    const controller = new AbortController();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(value) {
          streamController = value;
        },
        cancel: cancelled,
      }),
      { status: 200, headers: { "content-type": "application/pdf" } },
    );
    Object.defineProperty(response, "url", {
      value: "https://cdn.example/file",
    });
    const action = fetchFileResource(
      resource,
      controller.signal,
      { fetcher: vi.fn(async () => response), sleep: vi.fn() },
      MAX_ARCHIVE_BYTES,
    );
    streamController.enqueue(strToU8("data"));
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(action).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalled();
  });

  it("cancels the retry timer when aborted during file backoff", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const request = fetchFileResource(
        resource,
        controller.signal,
        {
          fetcher: vi.fn(async () => {
            throw new TypeError("network");
          }),
        },
        MAX_ARCHIVE_BYTES,
      );
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
      controller.abort(new DOMException("cancelled", "AbortError"));
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [`${CANVAS_ORIGIN}/courses/101/files/301/download`, "course-scoped path"],
    [`${CANVAS_ORIGIN}/files/999/download`, "mismatched source ID"],
    [`${CANVAS_ORIGIN}/files/301/download/extra`, "extra path segment"],
    ["https://canvas.example/files/301/download", "alternate origin"],
  ])("rejects a known-size file with a %s", async (sourceUrl) => {
    const fetcher = vi.fn();
    await expect(
      fetchFileResource(
        { ...resource, sourceUrl },
        new AbortController().signal,
        { fetcher, sleep: vi.fn() },
        MAX_ARCHIVE_BYTES,
      ),
    ).rejects.toBeInstanceOf(RunSafetyError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("unknown-size production file retrieval", () => {
  const resource = unknownFileResource();
  const bytes = strToU8("synthetic unknown bytes");

  it.each([
    ["with Content-Length", String(bytes.byteLength)],
    ["without Content-Length", null],
  ])("streams a non-empty file %s", async (_label, contentLength) => {
    const headers = new Headers({ "content-type": "application/pdf" });
    if (contentLength !== null) headers.set("content-length", contentLength);
    const result = await fetchFileResource(
      resource,
      new AbortController().signal,
      {
        fetcher: vi.fn(async () =>
          streamResponse([bytes.slice(0, 4), bytes.slice(4)], {
            status: 200,
            headers,
          }),
        ),
        sleep: vi.fn(),
      },
      bytes.byteLength,
    );

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
    }
  });

  it("accepts a stream exactly equal to the remaining course budget", async () => {
    const result = await fetchFileResource(
      resource,
      new AbortController().signal,
      {
        fetcher: vi.fn(async () =>
          streamResponse([new Uint8Array([1]), new Uint8Array([2, 3])], {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
        ),
        sleep: vi.fn(),
      },
      3,
    );

    expect(result).toEqual({
      status: "success",
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it("assembles shared-buffer chunk views before zeroing temporaries", async () => {
    const shared = new Uint8Array([1, 2, 3]);
    const result = await fetchFileResource(
      resource,
      new AbortController().signal,
      {
        fetcher: vi.fn(async () =>
          streamResponse([shared.subarray(0, 2), shared.subarray(1, 3)], {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
        ),
        sleep: vi.fn(),
      },
      4,
    );

    expect(result).toEqual({
      status: "success",
      bytes: new Uint8Array([1, 2, 2, 3]),
    });
    expect(shared).toEqual(new Uint8Array(3));
  });

  it("classifies an over-budget declared length before reading the body", async () => {
    const response = streamResponse([new Uint8Array([9, 8, 7, 6])], {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": "4",
      },
    });
    const cancel = vi.spyOn(response.body!, "cancel");

    await expect(
      fetchFileResource(
        resource,
        new AbortController().signal,
        { fetcher: vi.fn(async () => response), sleep: vi.fn() },
        3,
      ),
    ).resolves.toEqual({
      status: "unavailable",
      failureCategory: "individual-size-limit",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("classifies streamed overflow and zeroes every retained chunk", async () => {
    const first = new Uint8Array([1, 2]);
    const overflow = new Uint8Array([3, 4]);
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(first);
          controller.enqueue(overflow);
        },
        cancel: cancelled,
      }),
      {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      },
    );
    Object.defineProperty(response, "url", {
      value: "https://cdn.example/file",
    });

    await expect(
      fetchFileResource(
        resource,
        new AbortController().signal,
        { fetcher: vi.fn(async () => response), sleep: vi.fn() },
        3,
      ),
    ).resolves.toEqual({
      status: "unavailable",
      failureCategory: "individual-size-limit",
    });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(first).toEqual(new Uint8Array(2));
    expect(overflow).toEqual(new Uint8Array(2));
  });

  it("rejects an empty stream", async () => {
    await expect(
      fetchFileResource(
        resource,
        new AbortController().signal,
        {
          fetcher: vi.fn(async () =>
            streamResponse([], {
              status: 200,
              headers: { "content-type": "application/octet-stream" },
            }),
          ),
          sleep: vi.fn(),
        },
        3,
      ),
    ).rejects.toBeInstanceOf(RunSafetyError);
  });

  it.each(["0", "-1", "+1", "1.5", "not-a-number"])(
    "rejects Content-Length %s",
    async (contentLength) => {
      const response = streamResponse([new Uint8Array([1])], {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": contentLength,
        },
      });
      const cancel = vi.spyOn(response.body!, "cancel");
      await expect(
        fetchFileResource(
          resource,
          new AbortController().signal,
          { fetcher: vi.fn(async () => response), sleep: vi.fn() },
          3,
        ),
      ).rejects.toBeInstanceOf(RunSafetyError);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [3, new Uint8Array([1, 2])],
    [2, new Uint8Array([1, 2, 3])],
  ])(
    "rejects a stream that differs from declared length %i",
    async (contentLength, chunk) => {
      await expect(
        fetchFileResource(
          resource,
          new AbortController().signal,
          {
            fetcher: vi.fn(async () =>
              streamResponse([chunk], {
                status: 200,
                headers: {
                  "content-type": "application/octet-stream",
                  "content-length": String(contentLength),
                },
              }),
            ),
            sleep: vi.fn(),
          },
          3,
        ),
      ).rejects.toThrow("File content length changed");
    },
  );

  it.each([-1, 1.5, Number.NaN, MAX_ARCHIVE_BYTES + 1])(
    "rejects invalid remaining budget %s before fetch",
    async (remainingBytes) => {
      const fetcher = vi.fn();
      await expect(
        fetchFileResource(
          resource,
          new AbortController().signal,
          { fetcher, sleep: vi.fn() },
          remainingBytes,
        ),
      ).rejects.toBeInstanceOf(RunSafetyError);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("cancels and zeroes retained chunks on mid-stream abort", async () => {
    const controller = new AbortController();
    const first = new Uint8Array([1, 2]);
    const cancelled = vi.fn();
    let resolveSecondPull!: () => void;
    const secondPull = new Promise<void>((resolve) => {
      resolveSecondPull = resolve;
    });
    let pulls = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(streamController) {
          pulls += 1;
          if (pulls === 1) streamController.enqueue(first);
          else resolveSecondPull();
        },
        cancel: cancelled,
      }),
      {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      },
    );
    Object.defineProperty(response, "url", {
      value: "https://cdn.example/file",
    });
    const action = fetchFileResource(
      resource,
      controller.signal,
      { fetcher: vi.fn(async () => response), sleep: vi.fn() },
      3,
    );
    await Promise.race([secondPull, action.catch(() => undefined)]);
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(action).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(first).toEqual(new Uint8Array(2));
  });

  it.each([
    [403, "access-denied"],
    [404, "not-found"],
  ] as const)(
    "keeps the fixed unavailable outcome for status %i",
    async (status, failureCategory) => {
      const response = streamResponse([new Uint8Array([1])], {
        status,
        headers: { "content-type": "application/json" },
      });
      const cancel = vi.spyOn(response.body!, "cancel");
      await expect(
        fetchFileResource(
          resource,
          new AbortController().signal,
          { fetcher: vi.fn(async () => response), sleep: vi.fn() },
          3,
        ),
      ).resolves.toEqual({ status: "unavailable", failureCategory });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["login HTML", "https://cdn.example/file", "text/html"],
    ["HTTP redirect", "http://cdn.example/file", "application/octet-stream"],
    [
      "credentialed redirect",
      "https://user:pass@cdn.example/file",
      "application/octet-stream",
    ],
  ])("rejects %s", async (_label, url, contentType) => {
    const response = streamResponse([new Uint8Array([1])], {
      status: 200,
      headers: { "content-type": contentType },
      url,
    });
    const cancel = vi.spyOn(response.body!, "cancel");
    await expect(
      fetchFileResource(
        resource,
        new AbortController().signal,
        { fetcher: vi.fn(async () => response), sleep: vi.fn() },
        3,
      ),
    ).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ["network", "network-exhausted"],
    ["transient", "transient-exhausted"],
  ] as const)(
    "preserves %s retry exhaustion",
    async (kind, failureCategory) => {
      const responses: Response[] = [];
      const fetcher = vi.fn(async () => {
        if (kind === "network") throw new TypeError("network");
        const response = streamResponse([], {
          status: 503,
          headers: { "content-type": "application/json" },
        });
        responses.push(response);
        return response;
      });
      const sleep = vi.fn<(milliseconds: number) => Promise<void>>(
        async () => undefined,
      );

      await expect(
        fetchFileResource(
          resource,
          new AbortController().signal,
          { fetcher, sleep },
          3,
        ),
      ).resolves.toEqual({ status: "failed", failureCategory });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
        250, 500,
      ]);
      responses.forEach((response) =>
        expect(response.body?.locked).toBe(false),
      );
    },
  );

  it.each([
    [`${CANVAS_ORIGIN}/files/777/download`, "known-size path"],
    [`${CANVAS_ORIGIN}/courses/101/files/778/download`, "wrong file"],
    [`${CANVAS_ORIGIN}/courses/101/files/777/download?wrap=1`, "query"],
    [`${CANVAS_ORIGIN}/courses/101/files/777/download?`, "empty query"],
    [`${CANVAS_ORIGIN}/courses/101/files/777/download#part`, "fragment"],
    [`${CANVAS_ORIGIN}/courses/101/files/777/download#`, "empty fragment"],
    [
      "https://frankfurtschool.instructure.com:443/courses/101/files/777/download",
      "explicit default port",
    ],
    [` ${CANVAS_ORIGIN}/courses/101/files/777/download`, "leading whitespace"],
    ["https://canvas.example/courses/101/files/777/download", "origin"],
    [
      "https://user@frankfurtschool.instructure.com/courses/101/files/777/download",
      "credentials",
    ],
  ])("rejects a source URL with the wrong %s", async (sourceUrl) => {
    const fetcher = vi.fn();
    await expect(
      fetchFileResource(
        { ...resource, sourceUrl },
        new AbortController().signal,
        { fetcher, sleep: vi.fn() },
        3,
      ),
    ).rejects.toBeInstanceOf(RunSafetyError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("production page retrieval and local links", () => {
  const page = syntheticArchivePlan.resources[1]!;

  it("sanitizes a bounded own-property page record", async () => {
    const http = {
      jsonBoundedResource: vi.fn(async () => ({
        value: { title: "Welcome", body: "<p>Safe</p><script>bad()</script>" },
      })),
    };
    const result = await fetchPageResource(
      page,
      syntheticArchivePlan,
      new AbortController().signal,
      http as never,
    );
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(strFromU8(result.bytes)).toContain("<p>Safe</p>");
      expect(strFromU8(result.bytes)).not.toContain("script");
    }
    expect(http.jsonBoundedResource).toHaveBeenCalledWith(
      expect.any(URL),
      CANVAS_PAGE_JSON_MAX_BYTES,
    );
  });

  it("maps a bounded individual page failure", async () => {
    const tooLarge = {
      jsonBoundedResource: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error(), { name: "CanvasBodySizeError" }),
        ),
    };
    await expect(
      fetchPageResource(
        page,
        syntheticArchivePlan,
        new AbortController().signal,
        tooLarge as never,
      ),
    ).resolves.toEqual({
      status: "unavailable",
      failureCategory: "page-too-large",
    });
  });

  it("maps sanitized page output beyond the archived page limit", async () => {
    const http = {
      jsonBoundedResource: vi.fn(async () => ({
        value: { title: "Welcome", body: "<p>Too large</p>" },
      })),
    };
    await expect(
      fetchPageResource(
        page,
        syntheticArchivePlan,
        new AbortController().signal,
        http as never,
        8,
      ),
    ).resolves.toEqual({
      status: "unavailable",
      failureCategory: "page-too-large",
    });
    expect(MAX_ARCHIVED_PAGE_BYTES).toBeGreaterThan(8);
  });

  it("rewrites only exact same-course known file and page paths", () => {
    const cases: Array<[string, string | null]> = [
      ["/courses/101/files/301/download", "../files/slides.pdf"],
      ["/courses/101/files/301/download?wrap=1", "../files/slides.pdf"],
      ["/courses/101/files/301?wrap=1", "../files/slides.pdf"],
      ["/courses/101/files/301/wrap", null],
      ["/courses/101/pages/welcome", "../pages/welcome.html"],
      ["/courses/999/pages/welcome", null],
      ["/courses/101/assignments/1", null],
      ["/courses/101/files/301/download?download=1", null],
      ["/courses/101/files/301?%77rap=1", null],
      ["/courses/101/files/301?wrap=%31", null],
      ["/courses/101/files/301?wrap=1&", null],
      ["/courses/101/files/301/download?wrap=1&", null],
      [
        "https://user@frankfurtschool.instructure.com/courses/101/pages/welcome",
        null,
      ],
    ];
    for (const [href, expected] of cases)
      expect(resolveLocalHref(href, syntheticArchivePlan)).toBe(expected);
  });

  it("encodes archive path segments once for spaces, Unicode, and literal percent", () => {
    const plan = structuredClone(syntheticArchivePlan);
    plan.resources[0]!.archivePath = "files/Week 1/Über 100%.pdf";
    expect(resolveLocalHref("/courses/101/files/301/download", plan)).toBe(
      "../files/Week%201/%C3%9Cber%20100%25.pdf",
    );
  });
});
