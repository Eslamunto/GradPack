import { describe, expect, it, vi } from "vitest";
import type { CanvasHttp } from "../../src/canvas/http";
import { CANVAS_ORIGIN } from "../../src/shared/constants";
import {
  parseDevResult,
  serializeDevResult,
  type DevResult,
} from "../../src/dev/protocol";
import { runLiveSmokeTest } from "../../src/dev/live-smoke";

const RUN_ID = "run-live-12345678";
const FILE_URL = `${CANVAS_ORIGIN}/files/123/download`;

type JsonResult = { value: unknown; response: Response };

type SyntheticHttp = {
  json: ReturnType<typeof vi.fn<(url: URL) => Promise<JsonResult>>>;
  fetchAll: ReturnType<typeof vi.fn<(url: URL) => Promise<unknown[]>>>;
};

function apiResponse(value: unknown, link: string | null = null): JsonResult {
  return {
    value,
    response: new Response(null, link ? { headers: { link } } : {}),
  };
}

function downloadResponse(
  options: {
    body?: BodyInit | null;
    contentType?: string;
    status?: number;
    url?: string;
  } = {},
): Response {
  const response = new Response(
    options.body === undefined ? "x" : options.body,
    {
      status: options.status ?? 200,
      headers: { "content-type": options.contentType ?? "application/pdf" },
    },
  );
  Object.defineProperty(response, "url", {
    value: options.url ?? FILE_URL,
  });
  return response;
}

function course(id: number) {
  return {
    id,
    name: `Synthetic Course ${id}`,
    course_code: `SYN-${id}`,
    workflow_state: "available",
    concluded: false,
  };
}

function syntheticHttp(
  json: (url: URL) => Promise<JsonResult>,
  courses: unknown[] = [course(11)],
): SyntheticHttp {
  return {
    json: vi.fn(json),
    fetchAll: vi.fn((url: URL) =>
      Promise.resolve(
        url.searchParams.get("enrollment_state") === "active" ? courses : [],
      ),
    ),
  };
}

function standardJson(url: URL): Promise<JsonResult> {
  if (url.pathname === "/api/v1/users/self/profile") {
    return Promise.resolve(apiResponse({ id: 1 }));
  }
  if (url.pathname === "/api/v1/courses/11/modules") {
    return Promise.resolve(
      apiResponse([
        {
          id: 21,
          items: [
            { type: "Page", page_url: "synthetic-page" },
            { type: "File", content_id: 31 },
          ],
        },
      ]),
    );
  }
  if (url.pathname === "/api/v1/courses/11/pages/synthetic-page") {
    return Promise.resolve(apiResponse({ page_id: 41 }));
  }
  if (url.pathname === "/api/v1/courses/11/files/31") {
    return Promise.resolve(apiResponse({ url: FILE_URL, size: 1 }));
  }
  return Promise.reject(new Error("unexpected synthetic endpoint"));
}

function expectClosed(result: DevResult): void {
  expect(parseDevResult(result)).toEqual(result);
  expect(serializeDevResult(result).length).toBeLessThanOrEqual(512);
}

describe("runLiveSmokeTest", () => {
  it("stops at a session failure before discovering courses", async () => {
    const http = syntheticHttp((url) => {
      if (url.pathname === "/api/v1/users/self/profile") {
        return Promise.reject(new Error("synthetic private response"));
      }
      return Promise.resolve(apiResponse({}));
    });

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
    });

    expect(result).toEqual({
      channel: "gradpack/dev/v1",
      type: "LIVE_SMOKE_RESULT",
      runId: RUN_ID,
      outcome: "fail",
      failure: "session",
      session: "unavailable",
      courses: "unavailable",
      modules: "not-run",
      page: "not-run",
      file: "not-run",
      contentType: "none",
      redirect: "none",
    });
    expect(http.fetchAll).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("synthetic private response");
    expectClosed(result);
  });

  it("returns a fixed empty-course result", async () => {
    const http = syntheticHttp(
      () => Promise.resolve(apiResponse({ id: 1 })),
      [],
    );

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
    });

    expect(result).toMatchObject({
      outcome: "fail",
      failure: "courses",
      session: "available",
      courses: "empty",
      modules: "not-run",
    });
    expect(http.fetchAll).toHaveBeenCalledTimes(2);
    expectClosed(result);
  });

  it("uses first-page inline module items and closed detail endpoints", async () => {
    const next = `${CANVAS_ORIGIN}/api/v1/courses/11/modules?page=2`;
    const json = vi.fn(async (url: URL) => {
      if (url.pathname === "/api/v1/courses/11/modules") {
        return apiResponse(
          [
            {
              id: 21,
              items: [
                {
                  type: "Page",
                  page_url: "synthetic-page",
                  url: "https://synthetic.invalid/arbitrary-page",
                },
                {
                  type: "File",
                  content_id: 31,
                  url: "https://synthetic.invalid/arbitrary-file",
                },
              ],
            },
          ],
          `<${next}>; rel="next"`,
        );
      }
      return standardJson(url);
    });
    const http = syntheticHttp(json);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(downloadResponse({ body: "pdf" }));

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
    });

    expect(result).toMatchObject({
      outcome: "pass",
      failure: "none",
      session: "available",
      courses: "available",
      modules: "page-and-file",
      page: "available",
      file: "available",
      contentType: "pdf",
      redirect: "same-origin-https",
    });
    const paths = http.json.mock.calls.map(([url]) => url.pathname);
    expect(paths).toContain("/api/v1/courses/11/pages/synthetic-page");
    expect(paths).toContain("/api/v1/courses/11/files/31");
    expect(http.json.mock.calls.some(([url]) => url.href === next)).toBe(false);
    expect(fetcher).toHaveBeenCalledWith(
      new URL(FILE_URL),
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        redirect: "follow",
        signal: expect.any(AbortSignal),
      }),
    );
    expectClosed(result);
  });

  it("inspects no more than eight discovered courses sequentially", async () => {
    let activeModules = 0;
    let peakModules = 0;
    const http = syntheticHttp(
      async (url) => {
        if (url.pathname === "/api/v1/users/self/profile") {
          return apiResponse({ id: 1 });
        }
        if (url.pathname.endsWith("/modules")) {
          activeModules += 1;
          peakModules = Math.max(peakModules, activeModules);
          await Promise.resolve();
          activeModules -= 1;
          return apiResponse([]);
        }
        throw new Error("unexpected synthetic endpoint");
      },
      Array.from({ length: 9 }, (_, index) => course(index + 1)),
    );

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
    });

    const modulePaths = http.json.mock.calls
      .map(([url]) => url.pathname)
      .filter((path) => path.endsWith("/modules"));
    expect(modulePaths).toHaveLength(8);
    expect(modulePaths).not.toContain("/api/v1/courses/9/modules");
    expect(peakModules).toBe(1);
    expect(result).toMatchObject({ failure: "modules", modules: "empty" });
    expectClosed(result);
  });

  it("inspects no more than eight modules per course", async () => {
    const http = syntheticHttp((url) => {
      if (url.pathname === "/api/v1/users/self/profile") {
        return Promise.resolve(apiResponse({ id: 1 }));
      }
      if (url.pathname === "/api/v1/courses/11/modules") {
        return Promise.resolve(
          apiResponse(
            Array.from({ length: 9 }, (_, index) => ({ id: index + 1 })),
          ),
        );
      }
      if (
        url.pathname.includes("/modules/") &&
        url.pathname.endsWith("/items")
      ) {
        return Promise.resolve(apiResponse([]));
      }
      return Promise.reject(new Error("unexpected synthetic endpoint"));
    });

    await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
    });

    const itemPaths = http.json.mock.calls
      .map(([url]) => url.pathname)
      .filter((path) => path.endsWith("/items"));
    expect(itemPaths).toHaveLength(8);
    expect(itemPaths).not.toContain("/api/v1/courses/11/modules/9/items");
  });

  it("consumes no more than 100 module items per course", async () => {
    const items = [
      { type: "Page", page_url: "synthetic-page" },
      ...Array.from({ length: 99 }, () => ({ type: "ExternalUrl" })),
      { type: "File", content_id: 31 },
    ];
    const http = syntheticHttp((url) => {
      if (url.pathname === "/api/v1/users/self/profile") {
        return Promise.resolve(apiResponse({ id: 1 }));
      }
      if (url.pathname === "/api/v1/courses/11/modules") {
        return Promise.resolve(apiResponse([{ id: 21, items }]));
      }
      return Promise.reject(
        new Error("detail requests must stay outside the item bound"),
      );
    });

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
    });

    expect(result).toMatchObject({ failure: "modules", modules: "page-only" });
    expect(
      http.json.mock.calls.some(([url]) => url.pathname.includes("/files/31")),
    ).toBe(false);
    expectClosed(result);
  });

  it("loads missing module items with at most two concurrent requests", async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    let itemCalls = 0;
    const http = syntheticHttp(async (url) => {
      if (url.pathname === "/api/v1/users/self/profile") {
        return apiResponse({ id: 1 });
      }
      if (url.pathname === "/api/v1/courses/11/modules") {
        return apiResponse([1, 2, 3, 4].map((id) => ({ id })));
      }
      if (url.pathname.endsWith("/items")) {
        itemCalls += 1;
        const call = itemCalls;
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        if (call === 1) {
          return apiResponse([{ type: "Page", page_url: "synthetic-page" }]);
        }
        if (call === 2) {
          return apiResponse([{ type: "File", content_id: 31 }]);
        }
        return apiResponse([]);
      }
      return standardJson(url);
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(downloadResponse());

    const run = runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
    });
    await vi.waitFor(() => expect(itemCalls).toBe(2));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(itemCalls).toBe(4));
    releases.splice(0).forEach((release) => release());
    const result = await run;

    expect(peak).toBe(2);
    expect(result).toMatchObject({ outcome: "pass", modules: "page-and-file" });
    expectClosed(result);
  });

  it("waits for active module-item workers and stops dequeuing after the first failure", async () => {
    let active = 0;
    let peak = 0;
    let itemCalls = 0;
    let rejectFirst!: () => void;
    let releaseSibling!: () => void;
    const firstFailure = new Promise<void>((_resolve, reject) => {
      rejectFirst = () => reject(new Error("synthetic first-worker failure"));
    });
    const sibling = new Promise<void>((resolve) => {
      releaseSibling = resolve;
    });
    const http = syntheticHttp(async (url) => {
      if (url.pathname === "/api/v1/users/self/profile") {
        return apiResponse({ id: 1 });
      }
      if (url.pathname === "/api/v1/courses/11/modules") {
        return apiResponse([1, 2, 3].map((id) => ({ id })));
      }
      if (url.pathname.endsWith("/items")) {
        itemCalls += 1;
        const call = itemCalls;
        active += 1;
        peak = Math.max(peak, active);
        try {
          if (call === 1) await firstFailure;
          if (call === 2) await sibling;
          return apiResponse([]);
        } finally {
          active -= 1;
        }
      }
      return standardJson(url);
    });
    let settled = false;

    const run = runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
    }).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(active).toBe(2));

    rejectFirst();
    await vi.waitFor(() => expect(active).toBe(1));
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(itemCalls).toBe(2);

    releaseSibling();
    const result = await run;

    expect(active).toBe(0);
    expect(peak).toBe(2);
    expect(itemCalls).toBe(2);
    expect(result).toMatchObject({
      outcome: "fail",
      failure: "modules",
      modules: "unavailable",
    });
    expectClosed(result);
  });

  it("uses only strict page_url and positive file content_id references", async () => {
    const http = syntheticHttp(async (url) => {
      if (url.pathname === "/api/v1/users/self/profile") {
        return apiResponse({ id: 1 });
      }
      if (url.pathname === "/api/v1/courses/11/modules") {
        return apiResponse([
          {
            id: 21,
            items: [
              {
                type: "Page",
                page_url: "../unsafe",
                url: `${CANVAS_ORIGIN}/api/v1/courses/11/pages/unsafe`,
              },
              { type: "Page", page_url: 42 },
              { type: "File", content_id: 0 },
              { type: "File", content_id: 1.5 },
              { type: "Page", page_url: "synthetic-page" },
              { type: "File", content_id: 31 },
            ],
          },
        ]);
      }
      return standardJson(url);
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(downloadResponse());

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
    });

    const detailPaths = http.json.mock.calls
      .map(([url]) => url.pathname)
      .filter(
        (path) => path.includes("/pages/") || path.match(/\/files\/\d+$/),
      );
    expect(detailPaths).toEqual(
      expect.arrayContaining([
        "/api/v1/courses/11/pages/synthetic-page",
        "/api/v1/courses/11/files/31",
      ]),
    );
    expect(detailPaths).toHaveLength(2);
    expect(result.outcome).toBe("pass");
  });

  it("never combines representatives discovered in different courses", async () => {
    const http = syntheticHttp(
      (url) => {
        if (url.pathname === "/api/v1/users/self/profile") {
          return Promise.resolve(apiResponse({ id: 1 }));
        }
        if (url.pathname === "/api/v1/courses/11/modules") {
          return Promise.resolve(
            apiResponse([
              {
                id: 21,
                items: [{ type: "Page", page_url: "synthetic-page" }],
              },
            ]),
          );
        }
        if (url.pathname === "/api/v1/courses/12/modules") {
          return Promise.resolve(
            apiResponse([
              { id: 22, items: [{ type: "File", content_id: 31 }] },
            ]),
          );
        }
        return Promise.reject(new Error("cross-course detail request"));
      },
      [course(11), course(12)],
    );

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
    });

    expect(result).toMatchObject({ outcome: "fail", failure: "modules" });
    expect(
      http.json.mock.calls.some(
        ([url]) =>
          url.pathname.includes("/pages/") ||
          url.pathname.match(/\/files\/\d+$/),
      ),
    ).toBe(false);
    expectClosed(result);
  });

  it("does not depend on course-wide Pages or Files metadata", async () => {
    const http = syntheticHttp(async (url) => {
      if (
        url.pathname === "/api/v1/courses/11/pages" ||
        url.pathname === "/api/v1/courses/11/files"
      ) {
        throw new Error("synthetic 404/403");
      }
      return standardJson(url);
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(downloadResponse());

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
    });

    expect(result.outcome).toBe("pass");
    expect(
      http.json.mock.calls.some(
        ([url]) =>
          url.pathname === "/api/v1/courses/11/pages" ||
          url.pathname === "/api/v1/courses/11/files",
      ),
    ).toBe(false);
  });

  it("starts closed page detail and file metadata requests together", async () => {
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const http = syntheticHttp(async (url) => {
      if (
        url.pathname === "/api/v1/courses/11/pages/synthetic-page" ||
        url.pathname === "/api/v1/courses/11/files/31"
      ) {
        started.push(url.pathname);
        await new Promise<void>((resolve) => releases.push(resolve));
      }
      return standardJson(url);
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(downloadResponse());

    const run = runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
    });
    await vi.waitFor(() => expect(started).toHaveLength(2));
    releases.splice(0).forEach((release) => release());

    await expect(run).resolves.toMatchObject({ outcome: "pass" });
  });

  it.each([
    { url: `http://frankfurtschool.instructure.com/files/123/download` },
    { url: `https://user@frankfurtschool.instructure.com/files/123/download` },
    { url: `${CANVAS_ORIGIN}/files/123/download#fragment` },
    { url: `${CANVAS_ORIGIN}/api/v1/files/123` },
    { url: "https://synthetic.invalid/files/123/download" },
  ])("rejects unsafe file metadata URL $url", async ({ url }) => {
    const http = syntheticHttp(async (request) => {
      if (request.pathname === "/api/v1/courses/11/files/31") {
        return apiResponse({ url, size: 1 });
      }
      return standardJson(request);
    });
    const fetcher = vi.fn<typeof fetch>();

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
    });

    expect(result).toMatchObject({
      outcome: "fail",
      failure: "safety",
      page: "available",
      file: "unavailable",
      redirect: "unsafe",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expectClosed(result);
  });

  it("rejects an advertised file above five MiB before downloading", async () => {
    const http = syntheticHttp(async (url) => {
      if (url.pathname === "/api/v1/courses/11/files/31") {
        return apiResponse({ url: FILE_URL, size: 5_242_881 });
      }
      return standardJson(url);
    });
    const fetcher = vi.fn<typeof fetch>();

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
    });

    expect(result).toMatchObject({
      failure: "safety",
      file: "too-large",
      contentType: "none",
      redirect: "none",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expectClosed(result);
  });

  it.each([
    {
      name: "same-origin PDF",
      response: downloadResponse(),
      contentType: "pdf",
      redirect: "same-origin-https",
    },
    {
      name: "cross-origin image",
      response: downloadResponse({
        contentType: "image/png",
        url: "https://downloads.synthetic.invalid/object",
      }),
      contentType: "image",
      redirect: "cross-origin-https",
    },
  ])(
    "classifies a safe $name response",
    async ({ response, contentType, redirect }) => {
      const http = syntheticHttp(standardJson);
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

      const result = await runLiveSmokeTest(RUN_ID, {
        http: http as unknown as CanvasHttp,
        fetcher,
      });

      expect(result).toMatchObject({ outcome: "pass", contentType, redirect });
      expectClosed(result);
    },
  );

  it.each([
    {
      name: "login redirect",
      response: downloadResponse({ url: `${CANVAS_ORIGIN}/login/canvas` }),
      expected: { failure: "safety", file: "unavailable", redirect: "unsafe" },
    },
    {
      name: "401",
      response: downloadResponse({ status: 401 }),
      expected: {
        failure: "file",
        file: "unavailable",
        redirect: "same-origin-https",
      },
    },
    {
      name: "403",
      response: downloadResponse({ status: 403 }),
      expected: {
        failure: "file",
        file: "unavailable",
        redirect: "same-origin-https",
      },
    },
    {
      name: "HTML",
      response: downloadResponse({ contentType: "text/html" }),
      expected: {
        failure: "file",
        file: "html",
        redirect: "same-origin-https",
      },
    },
    {
      name: "empty body",
      response: downloadResponse({ body: null }),
      expected: {
        failure: "file",
        file: "unavailable",
        redirect: "same-origin-https",
      },
    },
    {
      name: "downgraded final URL",
      response: downloadResponse({
        url: "http://downloads.synthetic.invalid/object",
      }),
      expected: { failure: "safety", file: "unavailable", redirect: "unsafe" },
    },
  ])("fails closed for a $name response", async ({ response, expected }) => {
    const http = syntheticHttp(standardJson);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
    });

    expect(result).toMatchObject({ outcome: "fail", ...expected });
    expectClosed(result);
  });

  it.each([
    {
      name: "unsafe redirect",
      contentType: "application/pdf",
      ok: true,
      status: 200,
      url: "http://downloads.synthetic.invalid/object",
    },
    {
      name: "HTTP session status",
      contentType: "application/pdf",
      ok: false,
      status: 401,
      url: FILE_URL,
    },
    {
      name: "HTML response",
      contentType: "text/html",
      ok: true,
      status: 200,
      url: FILE_URL,
    },
  ])(
    "cancels the response body and aborts before returning for $name",
    async ({ contentType, ok, status, url }) => {
      let releaseCancellation!: () => void;
      const cancellation = new Promise<void>((resolve) => {
        releaseCancellation = resolve;
      });
      const cancel = vi.fn().mockReturnValue(cancellation);
      const getReader = vi.fn();
      const response = {
        body: { cancel, getReader },
        headers: new Headers({ "content-type": contentType }),
        ok,
        status,
        url,
      } as unknown as Response;
      let requestSignal: AbortSignal | undefined;
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
        requestSignal = init?.signal ?? undefined;
        return Promise.resolve(response);
      });
      const http = syntheticHttp(standardJson);
      let settled = false;

      const run = runLiveSmokeTest(RUN_ID, {
        http: http as unknown as CanvasHttp,
        fetcher,
      }).then((result) => {
        settled = true;
        return result;
      });

      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      expect(getReader).not.toHaveBeenCalled();
      expect(requestSignal?.aborted).toBe(true);
      expect(settled).toBe(false);

      releaseCancellation();
      const result = await run;

      expect(result.outcome).toBe("fail");
      expectClosed(result);
    },
  );

  it("cancels the reader and aborts before returning after a stream read exception", async () => {
    let releaseCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const cancelReader = vi.fn().mockReturnValue(cancellation);
    const read = vi
      .fn()
      .mockRejectedValue(new Error("synthetic private read failure"));
    const cancelBody = vi.fn().mockResolvedValue(undefined);
    const response = {
      body: {
        cancel: cancelBody,
        getReader: () => ({ cancel: cancelReader, read }),
      },
      headers: new Headers({ "content-type": "application/pdf" }),
      ok: true,
      status: 200,
      url: FILE_URL,
    } as unknown as Response;
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      requestSignal = init?.signal ?? undefined;
      return Promise.resolve(response);
    });
    const http = syntheticHttp(standardJson);
    let settled = false;

    const run = runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
    }).then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(cancelReader).toHaveBeenCalledOnce());
    expect(read).toHaveBeenCalledOnce();
    expect(cancelBody).not.toHaveBeenCalled();
    expect(requestSignal?.aborted).toBe(true);
    expect(settled).toBe(false);

    releaseCancellation();
    const result = await run;

    expect(result).toMatchObject({ outcome: "fail", failure: "file" });
    expect(JSON.stringify(result)).not.toContain(
      "synthetic private read failure",
    );
    expectClosed(result);
  });

  it("cancels and aborts immediately above 5,242,880 streamed bytes", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValueOnce({
      done: false,
      value: new Uint8Array(5_242_881),
    });
    const response = {
      body: { getReader: () => ({ read, cancel }) },
      headers: new Headers({ "content-type": "application/pdf" }),
      ok: true,
      status: 200,
      url: FILE_URL,
    } as unknown as Response;
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      requestSignal = init?.signal ?? undefined;
      return Promise.resolve(response);
    });
    const http = syntheticHttp(async (url) => {
      if (url.pathname === "/api/v1/courses/11/files/31") {
        return apiResponse({ url: FILE_URL, size: 5_242_880 });
      }
      return standardJson(url);
    });

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      outcome: "fail",
      failure: "safety",
      file: "too-large",
      contentType: "pdf",
      redirect: "same-origin-https",
    });
    expectClosed(result);
  });

  it("aborts the file request above the limit when a caller signal is injected", async () => {
    const caller = new AbortController();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValueOnce({
      done: false,
      value: new Uint8Array(5_242_881),
    });
    const response = {
      body: { getReader: () => ({ read, cancel }) },
      headers: new Headers({ "content-type": "application/pdf" }),
      ok: true,
      status: 200,
      url: FILE_URL,
    } as unknown as Response;
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      requestSignal = init?.signal ?? undefined;
      return Promise.resolve(response);
    });
    const http = syntheticHttp(async (url) => {
      if (url.pathname === "/api/v1/courses/11/files/31") {
        return apiResponse({ url: FILE_URL, size: 5_242_880 });
      }
      return standardJson(url);
    });

    const result = await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
      signal: caller.signal,
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expect(result).toMatchObject({ failure: "safety", file: "too-large" });
    expectClosed(result);
  });

  it("propagates an injected abort signal to the representative file request", async () => {
    const controller = new AbortController();
    const http = syntheticHttp(standardJson);
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      requestSignal = init?.signal ?? undefined;
      return Promise.resolve(downloadResponse());
    });

    await runLiveSmokeTest(RUN_ID, {
      http: http as unknown as CanvasHttp,
      fetcher,
      signal: controller.signal,
    });

    expect(fetcher).toHaveBeenCalledWith(new URL(FILE_URL), {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      signal: requestSignal,
    });
    expect(requestSignal?.aborted).toBe(false);
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
  });

  it.each([
    {
      name: "modules",
      matcher: (url: URL) => url.pathname.endsWith("/modules"),
      failure: "modules",
    },
    {
      name: "page",
      matcher: (url: URL) => url.pathname.includes("/pages/"),
      failure: "page",
    },
    {
      name: "file metadata",
      matcher: (url: URL) => url.pathname.match(/\/files\/\d+$/) !== null,
      failure: "file",
    },
  ] as const)(
    "maps a $name exception to a fixed stage result",
    async ({ matcher, failure }) => {
      const http = syntheticHttp(async (url) => {
        if (matcher(url)) throw new Error("synthetic private server text");
        return standardJson(url);
      });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(downloadResponse());

      const result = await runLiveSmokeTest(RUN_ID, {
        http: http as unknown as CanvasHttp,
        fetcher,
      });

      expect(result).toMatchObject({ outcome: "fail", failure });
      expect(JSON.stringify(result)).not.toContain(
        "synthetic private server text",
      );
      expectClosed(result);
    },
  );
});
