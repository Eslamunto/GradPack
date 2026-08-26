/* eslint-disable @typescript-eslint/require-await -- async callbacks model browser fetches in focused tests */
import { strFromU8, strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { CanvasSessionError } from "../../src/canvas/http";
import { CANVAS_PAGE_JSON_MAX_BYTES } from "../../src/shared/constants";
import {
  RunSafetyError,
  fetchFileResource,
  fetchPageResource,
  resolveLocalHref,
} from "../../src/page/run-course";
import { syntheticArchivePlan } from "../fixtures/course-plan";

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
        fetchFileResource(resource, new AbortController().signal, {
          fetcher: vi.fn(async () => response),
          sleep: vi.fn(),
        }),
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
      fetchFileResource(resource, new AbortController().signal, {
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
      }),
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
        fetchFileResource(resource, new AbortController().signal, {
          fetcher,
          sleep: vi.fn(),
        }),
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
        fetchFileResource(resource, new AbortController().signal, {
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
        }),
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
      fetchFileResource(resource, new AbortController().signal, {
        fetcher: vi.fn(async () =>
          streamResponse([...chunks], {
            status: 200,
            headers: { "content-type": "application/pdf" },
          }),
        ),
        sleep: vi.fn(),
      }),
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
        fetchFileResource(resource, new AbortController().signal, {
          fetcher: vi.fn(async () => response),
          sleep: vi.fn(),
        }),
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
    const action = fetchFileResource(resource, controller.signal, {
      fetcher: vi.fn(async () => response),
      sleep: vi.fn(),
    });
    streamController.enqueue(strToU8("data"));
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(action).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalled();
  });

  it("cancels the retry timer when aborted during file backoff", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const request = fetchFileResource(resource, controller.signal, {
        fetcher: vi.fn(async () => {
          throw new TypeError("network");
        }),
      });
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
      controller.abort(new DOMException("cancelled", "AbortError"));
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
