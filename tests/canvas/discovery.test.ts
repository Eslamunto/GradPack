import { describe, expect, it, vi } from "vitest";
import {
  assertPilotSize,
  discoverCoursePlan,
  PilotSizeError,
} from "../../src/canvas/discovery";
import {
  CanvasBodySizeError,
  CanvasHttp,
  CanvasResponseError,
  CanvasSessionError,
  CanvasTransientError,
} from "../../src/canvas/http";
import {
  CANVAS_ORIGIN,
  CANVAS_PAGE_JSON_MAX_BYTES,
} from "../../src/shared/constants";
import {
  planWithOneFile,
  syntheticCanvasHttp,
  syntheticCourse,
  type SyntheticHttp,
} from "../fixtures/course-plan";

const file = (id: number, name = `file-${id}.bin`, size = id) => ({
  id,
  folder_id: 401,
  display_name: name,
  filename: name,
  size,
  url: `https://frankfurtschool.instructure.com/files/${id}/download`,
});

const moduleItem = (
  id: number,
  type: string,
  extra: Record<string, unknown> = {},
) => ({ id, title: `Item ${id}`, position: id, type, ...extra });

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve?.() };
}

describe("discoverCoursePlan", () => {
  it("falls back to module-linked files when the broad index has an accepted optional error", async () => {
    const response = (body: unknown, url: URL, status = 200): Response => {
      const value = new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
      Object.defineProperty(value, "url", { value: url.href });
      return value;
    };
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url =
        input instanceof URL
          ? input
          : new URL(input instanceof Request ? input.url : input);
      if (url.pathname.endsWith("/modules")) {
        return Promise.resolve(
          response(
            [
              {
                id: 201,
                name: "Module One",
                position: 1,
                items: [moduleItem(1, "File", { content_id: 301 })],
              },
            ],
            url,
          ),
        );
      }
      if (url.pathname.endsWith("/files")) {
        return Promise.resolve(
          response(
            { errors: [{ message: "Unavailable" }], status: "forbidden" },
            url,
            403,
          ),
        );
      }
      if (url.pathname.endsWith("/folders")) {
        return Promise.resolve(
          response([{ id: 401, full_name: "course files" }], url),
        );
      }
      if (url.pathname.endsWith("/pages")) {
        return Promise.resolve(response([], url));
      }
      if (url.pathname.endsWith("/files/301")) {
        return Promise.resolve(response(file(301, "fallback.pdf", 7), url));
      }
      return Promise.reject(
        new TypeError(`Unexpected synthetic request: ${url.pathname}`),
      );
    });

    const plan = await discoverCoursePlan(
      new CanvasHttp(fetcher),
      syntheticCourse,
    );

    expect(plan.resources.map(({ key }) => key)).toEqual(["file:301"]);
    expect(plan.resources[0]?.archivePath).toBe("files/fallback.pdf");
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        href: `${CANVAS_ORIGIN}/api/v1/courses/101/files/301`,
      }),
      expect.anything(),
    );
  });

  it("unions broad indexes with module-linked resources and deduplicates canonically", async () => {
    const http = syntheticCanvasHttp({
      modules: [
        {
          id: 201,
          name: "Module One",
          position: 1,
          items: [
            moduleItem(1, "File", { content_id: 301 }),
            moduleItem(2, "Page", { page_url: "welcome" }),
          ],
        },
      ],
      files: [file(301, "slides.pdf", 19), file(302)],
      pages: [
        { page_id: 501, url: "welcome", title: "Welcome" },
        { page_id: 502, url: "extra", title: "Extra" },
      ],
    });

    const plan = await discoverCoursePlan(http, syntheticCourse);

    expect(plan.resources.map(({ key }) => key)).toEqual([
      "file:301",
      "file:302",
      "page:extra",
      "page:welcome",
    ]);
    expect(
      plan.modules[0]?.items.map(({ resourceKey }) => resourceKey),
    ).toEqual(["file:301", "page:welcome"]);
    expect(new Set(plan.resources.map(({ key }) => key)).size).toBe(
      plan.resources.length,
    );
  });

  it("discovers one canonical metadata-backed file from both accepted anchors on a planned page", async () => {
    const http = syntheticCanvasHttp({
      modules: [],
      files: [],
      pages: [{ page_id: 501, url: "welcome", title: "Welcome" }],
      pageDetails: {
        welcome: {
          title: "Welcome",
          body: [
            '<a href="/courses/101/files/777?wrap=1">Preview</a>',
            `<a href="${CANVAS_ORIGIN}/courses/101/files/777/download">Download</a>`,
          ].join(""),
        },
      },
      fileDetails: { 777: file(777, "official.pdf", 23) },
    });

    const plan = await discoverCoursePlan(http, syntheticCourse);

    expect(plan.resources.map(({ key }) => key)).toEqual([
      "file:777",
      "page:welcome",
    ]);
    expect(plan.resources.filter(({ key }) => key === "file:777")).toEqual([
      {
        key: "file:777",
        kind: "file",
        title: "official.pdf",
        sourceId: "777",
        archivePath: "files/Week One/official.pdf",
        advertisedBytes: 23,
        sourceUrl: `${CANVAS_ORIGIN}/files/777/download`,
      },
    ]);
    expect(plan.resources.filter(({ kind }) => kind === "page")).toHaveLength(
      1,
    );
    expect(http.jsonBoundedResource.mock.calls).toContainEqual([
      expect.objectContaining({
        href: `${CANVAS_ORIGIN}/api/v1/courses/101/pages/welcome`,
      }),
      CANVAS_PAGE_JSON_MAX_BYTES,
    ]);
  });

  it.each([403, 404] as const)(
    "creates one deterministic unknown-size file when exact metadata returns %s",
    async (status) => {
      const http = syntheticCanvasHttp({
        modules: [],
        files: [],
        pages: [{ page_id: 501, url: "welcome", title: "Welcome" }],
        pageDetails: {
          welcome: {
            title: "Welcome",
            body: '<a href="/courses/101/files/777?wrap=1">Preview</a>',
          },
        },
        fileDetailStatuses: { 777: status },
      });

      const plan = await discoverCoursePlan(http, syntheticCourse);

      expect(plan.resources.find(({ key }) => key === "file:777")).toEqual({
        key: "file:777",
        kind: "file",
        title: "file-777",
        sourceId: "777",
        archivePath: "files/file-777",
        advertisedBytes: null,
        sourceUrl: `${CANVAS_ORIGIN}/courses/101/files/777/download`,
      });
      expect(plan.advertisedBytes).toBe(0);
    },
  );

  it.each([
    ["session", new CanvasSessionError("session")],
    ["transient exhaustion", new CanvasTransientError("transient")],
  ])("rejects page-linked file metadata on %s", async (_name, error) => {
    const http = syntheticCanvasHttp({
      modules: [],
      files: [],
      pages: [{ page_id: 501, url: "welcome", title: "Welcome" }],
      pageDetails: {
        welcome: {
          title: "Welcome",
          body: '<a href="/courses/101/files/777?wrap=1">Preview</a>',
        },
      },
    });
    const bounded = http.jsonBoundedResource.getMockImplementation()!;
    http.jsonBoundedResource.mockImplementation((url, maximumBytes) =>
      url.pathname.endsWith("/files/777")
        ? Promise.reject(error)
        : bounded(url, maximumBytes),
    );

    await expect(discoverCoursePlan(http, syntheticCourse)).rejects.toBe(error);
  });

  it.each([
    ["malformed", null, "Mismatched file metadata"],
    ["mismatched-ID", file(778), "Mismatched file metadata"],
    [
      "unsafe",
      { ...file(777), url: "https://untrusted.test/files/777/download" },
      "Rejected file URL",
    ],
    ["malformed-size", file(777, "invalid.bin", -1), "Invalid file size"],
  ])(
    "rejects %s page-linked file metadata",
    async (_name, detail, expectedMessage) => {
      const http = syntheticCanvasHttp({
        modules: [],
        files: [],
        pages: [{ page_id: 501, url: "welcome", title: "Welcome" }],
        pageDetails: {
          welcome: {
            title: "Welcome",
            body: '<a href="/courses/101/files/777?wrap=1">Preview</a>',
          },
        },
        fileDetails: { 777: detail },
      });

      await expect(discoverCoursePlan(http, syntheticCourse)).rejects.toThrow(
        expectedMessage,
      );
    },
  );

  it.each([403, 404] as const)(
    "keeps a planned page but contributes no embedded files when its preflight returns %s",
    async (status) => {
      const http = syntheticCanvasHttp({
        modules: [],
        files: [],
        pages: [{ page_id: 501, url: "welcome", title: "Welcome" }],
        pageResourceStatuses: { welcome: status },
      });

      const plan = await discoverCoursePlan(http, syntheticCourse);

      expect(plan.resources.map(({ key }) => key)).toEqual(["page:welcome"]);
      expect(
        http.jsonBoundedResource.mock.calls.some(([url]) =>
          url.pathname.includes("/files/"),
        ),
      ).toBe(false);
    },
  );

  it("keeps a planned page but contributes no embedded files when its preflight exceeds the body cap", async () => {
    const http = syntheticCanvasHttp({
      modules: [],
      files: [],
      pages: [{ page_id: 501, url: "welcome", title: "Welcome" }],
    });
    const error = new CanvasBodySizeError("page too large");
    http.jsonBoundedResource.mockRejectedValue(error);

    const plan = await discoverCoursePlan(http, syntheticCourse);

    expect(plan.resources.map(({ key }) => key)).toEqual(["page:welcome"]);
  });

  it.each([
    ["session", new CanvasSessionError("session")],
    ["transient exhaustion", new CanvasTransientError("transient")],
    ["unsafe final URL", new CanvasResponseError("Rejected final Canvas URL")],
    ["cancellation", new DOMException("aborted", "AbortError")],
  ])(
    "fails planning when page preflight has a terminal %s",
    async (_name, error) => {
      const http = syntheticCanvasHttp({
        modules: [],
        files: [],
        pages: [{ page_id: 501, url: "welcome", title: "Welcome" }],
      });
      http.jsonBoundedResource.mockRejectedValue(error);

      await expect(discoverCoursePlan(http, syntheticCourse)).rejects.toBe(
        error,
      );
    },
  );

  it("rejects a malformed page preflight response", async () => {
    const http = syntheticCanvasHttp({
      modules: [],
      files: [],
      pages: [{ page_id: 501, url: "welcome", title: "Welcome" }],
      pageDetails: { welcome: null },
    });

    await expect(discoverCoursePlan(http, syntheticCourse)).rejects.toThrow(
      "Canvas returned an invalid page",
    );
  });

  it("keeps authoritative indexed file metadata when a page links to the same ID", async () => {
    const http = syntheticCanvasHttp({
      modules: [],
      files: [file(777, "indexed.pdf", 31)],
      pages: [{ page_id: 501, url: "welcome", title: "Welcome" }],
      pageDetails: {
        welcome: {
          title: "Welcome",
          body: '<a href="/courses/101/files/777?wrap=1">Preview</a>',
        },
      },
      fileDetailStatuses: { 777: 404 },
    });

    const plan = await discoverCoursePlan(http, syntheticCourse);

    expect(plan.resources.find(({ key }) => key === "file:777")).toEqual(
      expect.objectContaining({
        title: "indexed.pdf",
        advertisedBytes: 31,
        sourceUrl: `${CANVAS_ORIGIN}/files/777/download`,
      }),
    );
    expect(
      http.jsonBoundedResource.mock.calls.some(([url]) =>
        url.pathname.endsWith("/files/777"),
      ),
    ).toBe(false);
  });

  it("settles active page preflights and rejects queued pages after the first terminal failure", async () => {
    const activeGate = deferred();
    const failureSeen = deferred();
    const marker = new CanvasResponseError("page preflight failure");
    const calls: string[] = [];
    let active = 0;
    const http = syntheticCanvasHttp({
      modules: [],
      files: [],
      pages: ["alpha", "beta", "gamma", "delta"].map((url, index) => ({
        page_id: 501 + index,
        url,
        title: url,
      })),
    });
    http.jsonBoundedResource.mockImplementation(async (url) => {
      const token = url.pathname.split("/").at(-1)!;
      calls.push(token);
      active += 1;
      if (token === "alpha") {
        await activeGate.promise;
        active -= 1;
        return { value: { title: "alpha", body: "" } };
      }
      if (token === "beta") {
        active -= 1;
        failureSeen.resolve();
        throw marker;
      }
      active -= 1;
      return { value: { title: token, body: "" } };
    });
    const request = discoverCoursePlan(http, syntheticCourse);
    let terminal = false;
    const observed = request.then(
      () => {
        terminal = true;
      },
      () => {
        terminal = true;
      },
    );

    await failureSeen.promise;
    await Promise.resolve();
    const terminalBeforeJoin = terminal;
    activeGate.resolve();
    await expect(request).rejects.toBe(marker);
    await observed;

    expect(terminalBeforeJoin).toBe(false);
    expect(calls).toEqual(["alpha", "beta"]);
    expect(active).toBe(0);
  });

  it("aborts active discovery siblings, rejects queued work, and awaits cleanup on first failure", async () => {
    const controller = new AbortController();
    const first = new TypeError("first discovery failure");
    const started: string[] = [];
    const siblingCleaned = vi.fn();
    const fetchAll = vi.fn((url: URL) => {
      started.push(url.pathname);
      if (url.pathname.endsWith("/modules")) return Promise.resolve([]);
      if (url.pathname.endsWith("/files")) return Promise.reject(first);
      if (url.pathname.endsWith("/folders")) {
        return new Promise<unknown[]>((_resolve, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => {
              siblingCleaned();
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        });
      }
      return Promise.resolve([]);
    });

    await expect(
      discoverCoursePlan({ fetchAll } as never, syntheticCourse, {
        abort: (reason) => controller.abort(reason),
      }),
    ).rejects.toBe(first);
    expect(siblingCleaned).toHaveBeenCalledOnce();
    expect(started.some((path) => path.endsWith("/pages"))).toBe(false);
  });

  it("uses closed module-only fallbacks for exact unavailable indexes", async () => {
    const http = syntheticCanvasHttp({
      unavailableIndexes: { files: 403, folders: 404, pages: 404 },
      modules: [
        {
          id: 201,
          name: "Module One",
          position: 1,
          items: [
            {
              ...moduleItem(1, "File", { content_id: 777 }),
              url: "https://evil.test/arbitrary",
            },
            {
              ...moduleItem(2, "Page", { page_url: "module-page" }),
              url: "https://evil.test/arbitrary-page",
            },
          ],
        },
      ],
      fileDetails: { 777: file(777, "fallback.pdf", 7) },
    });

    const plan = await discoverCoursePlan(http, syntheticCourse);

    expect(plan.resources.map(({ key }) => key)).toEqual([
      "file:777",
      "page:module-page",
    ]);
    expect(http.jsonBoundedResource.mock.calls).toContainEqual([
      expect.objectContaining({
        pathname: "/api/v1/courses/101/files/777",
      }),
      CANVAS_PAGE_JSON_MAX_BYTES,
    ]);
    expect(
      [...http.fetchAll.mock.calls, ...http.jsonBoundedResource.mock.calls].map(
        ([url]) => url.origin,
      ),
    ).toEqual(
      expect.arrayContaining(["https://frankfurtschool.instructure.com"]),
    );
    expect(
      [
        ...http.fetchAll.mock.calls,
        ...http.jsonBoundedResource.mock.calls,
      ].some(([url]) => url.href.includes("evil.test")),
    ).toBe(false);
    expect(
      plan.resources.find(({ key }) => key === "file:777")?.archivePath,
    ).toMatch(/^files\//);
    expect(
      plan.resources.find(({ key }) => key === "file:777")?.archivePath,
    ).not.toContain("Week One");
  });

  it.each([
    new CanvasSessionError("session"),
    new CanvasResponseError("not optional"),
    new TypeError("malformed index"),
    new DOMException("aborted", "AbortError"),
  ])(
    "fails closed when an index error is not precisely optional",
    async (error) => {
      const http = syntheticCanvasHttp();
      http.fetchAll.mockImplementation((url: URL) => {
        if (url.pathname.endsWith("/modules")) return Promise.resolve([]);
        if (url.pathname.endsWith("/files")) return Promise.reject(error);
        return Promise.resolve([]);
      });

      await expect(discoverCoursePlan(http, syntheticCourse)).rejects.toBe(
        error,
      );
    },
  );

  it("loads missing inline module items without silently dropping them", async () => {
    const http = syntheticCanvasHttp({ moduleItemsInline: false });

    const plan = await discoverCoursePlan(http, syntheticCourse);

    expect(http.fetchAll.mock.calls).toContainEqual([
      expect.objectContaining({
        pathname: "/api/v1/courses/101/modules/201/items",
      }),
    ]);
    expect(plan.modules[0]?.items).toHaveLength(1);
  });

  it("rejects malformed inline module items instead of replacing or dropping them", async () => {
    const http = syntheticCanvasHttp({
      modules: [{ id: 201, name: "Module", position: 1, items: {} }],
    });

    await expect(discoverCoursePlan(http, syntheticCourse)).rejects.toThrow(
      "Invalid inline module items",
    );
    expect(
      http.fetchAll.mock.calls.some(([url]) =>
        url.pathname.endsWith("/modules/201/items"),
      ),
    ).toBe(false);
  });

  it("keeps HTTPS external links as unfetched references and unsupported items visible", async () => {
    const http = syntheticCanvasHttp({
      modules: [
        {
          id: 201,
          name: "Module",
          position: 1,
          items: [
            moduleItem(1, "ExternalUrl", {
              external_url: "https://reference.test/resource",
            }),
            moduleItem(2, "Assignment", {
              url: "https://evil.test/assignment",
            }),
          ],
        },
      ],
      files: [],
      pages: [],
    });

    const plan = await discoverCoursePlan(http, syntheticCourse);

    expect(plan.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "external:1",
          archivePath: null,
          sourceUrl: "https://reference.test/resource",
        }),
        expect.objectContaining({
          key: "unsupported:2",
          archivePath: null,
          sourceUrl: null,
        }),
      ]),
    );
    expect(http.json.mock.calls).toHaveLength(0);
  });

  it("rejects unsafe external URLs and malformed page tokens", async () => {
    const unsafeExternal = syntheticCanvasHttp({
      modules: [
        {
          id: 201,
          items: [
            moduleItem(1, "ExternalUrl", {
              external_url: "http://reference.test/resource",
            }),
          ],
        },
      ],
      files: [],
      pages: [],
    });
    const badPage = syntheticCanvasHttp({ pageToken: "../private" });

    await expect(
      discoverCoursePlan(unsafeExternal, syntheticCourse),
    ).rejects.toThrow("Rejected external URL");
    await expect(discoverCoursePlan(badPage, syntheticCourse)).rejects.toThrow(
      "Invalid page token",
    );
  });

  it("assigns unique case-insensitive paths across filename and page collisions", async () => {
    const long = "x".repeat(130);
    const http = syntheticCanvasHttp({
      modules: [],
      folders: [
        { id: 401, full_name: "course files/CON" },
        { id: 402, full_name: "course files/con" },
      ],
      files: [
        { ...file(1, "Résumé.pdf"), folder_id: 401 },
        { ...file(2, "Re\u0301sume\u0301.PDF"), folder_id: 401 },
        { ...file(3, `${long}A.txt`), folder_id: 402 },
        { ...file(4, `${long}B.txt`), folder_id: 402 },
        { ...file(5, "Same.txt"), folder_id: 401 },
        { ...file(6, "same.TXT"), folder_id: 401 },
      ],
      pages: [
        { page_id: 1, url: "Intro", title: "Intro" },
        { page_id: 2, url: "intro", title: "Intro duplicate" },
      ],
    });

    const plan = await discoverCoursePlan(http, syntheticCourse);
    const paths = plan.resources
      .map(({ archivePath }) => archivePath)
      .filter((path): path is string => path !== null);

    expect(
      new Set(paths.map((path) => path.toLocaleLowerCase("en-US"))).size,
    ).toBe(paths.length);
    expect(paths.every((path) => path.length <= 240)).toBe(true);
    expect(paths.some((path) => path.includes("_CON"))).toBe(true);
    expect(paths.some((path) => /--file-[1-6]/.test(path))).toBe(true);
    expect(paths.some((path) => /--page-(1|2)/.test(path))).toBe(true);
  });

  it("preserves safe accessible folder hierarchy", async () => {
    const plan = await discoverCoursePlan(
      syntheticCanvasHttp(),
      syntheticCourse,
    );

    expect(
      plan.resources.find(({ key }) => key === "file:301")?.archivePath,
    ).toBe("files/Week One/slides.pdf");
  });

  it("prevents file-versus-directory archive path collisions", async () => {
    const http = syntheticCanvasHttp({
      modules: [],
      folders: [{ id: 401, full_name: "course files/Week One" }],
      files: [
        { ...file(1, "Week One"), folder_id: null },
        { ...file(2, "notes.txt"), folder_id: 401 },
      ],
      pages: [],
    });

    const plan = await discoverCoursePlan(http, syntheticCourse);
    const paths = plan.resources
      .map(({ archivePath }) => archivePath)
      .filter((path): path is string => path !== null)
      .map((path) => path.toLocaleLowerCase("en-US"));

    expect(
      paths.some((path, index) =>
        paths.some(
          (other, otherIndex) =>
            index !== otherIndex && other.startsWith(`${path}/`),
        ),
      ),
    ).toBe(false);
    expect(paths.some((path) => path.includes("--file-1"))).toBe(true);
  });

  it("rechecks generated disambiguators against future folder ancestors", async () => {
    const long = "x".repeat(100);
    const longGenerated = `${"x".repeat(92)}--file-4`;
    const http = syntheticCanvasHttp({
      modules: [],
      folders: [
        { id: 401, full_name: "course files/Folder" },
        { id: 402, full_name: "course files/Folder--file-1" },
        { id: 403, full_name: `course files/${long}` },
        { id: 404, full_name: `course files/${longGenerated}` },
      ],
      files: [
        { ...file(1, "Folder"), folder_id: null },
        { ...file(2, "inside.txt"), folder_id: 401 },
        { ...file(3, "future.txt"), folder_id: 402 },
        { ...file(4, `${long}tail.txt`), folder_id: null },
        { ...file(5, "long-inside.txt"), folder_id: 403 },
        { ...file(6, "long-future.txt"), folder_id: 404 },
      ],
      pages: [],
    });

    const plan = await discoverCoursePlan(http, syntheticCourse);
    const paths = plan.resources
      .map(({ archivePath }) => archivePath)
      .filter((path): path is string => path !== null);
    const canonical = paths.map((path) => path.normalize("NFKC").toLowerCase());

    expect(
      canonical.some((path, index) =>
        canonical.some(
          (other, otherIndex) =>
            index !== otherIndex &&
            (other === path || other.startsWith(`${path}/`)),
        ),
      ),
    ).toBe(false);
    expect(paths.every((path) => path.length <= 240)).toBe(true);
    expect(paths).not.toContain("files/Folder--file-1");
    expect(paths).not.toContain(`files/${longGenerated}`);
  });

  it("case-folds Greek sigma and sharp-S collisions deterministically", async () => {
    const http = syntheticCanvasHttp({
      modules: [],
      files: [
        file(10, "ΟΣ.txt"),
        file(11, "οσ.TXT"),
        file(12, "Straße.txt"),
        file(13, "STRASSE.TXT"),
      ],
      pages: [],
    });

    const plan = await discoverCoursePlan(http, syntheticCourse);
    const paths = plan.resources
      .map(({ archivePath }) => archivePath)
      .filter((path): path is string => path !== null);

    expect(paths.some((path) => /--file-(10|11)/.test(path))).toBe(true);
    expect(paths.some((path) => /--file-(12|13)/.test(path))).toBe(true);
  });

  it("hard-fails a referenced folder missing from an available folder index", async () => {
    await expect(
      discoverCoursePlan(
        syntheticCanvasHttp({
          modules: [],
          files: [{ ...file(1), folder_id: 999 }],
          folders: [{ id: 401, full_name: "course files/Present" }],
          pages: [],
        }),
        syntheticCourse,
      ),
    ).rejects.toThrow("Missing folder metadata");
  });

  it("requires full_name instead of trusting a name-only folder record", async () => {
    await expect(
      discoverCoursePlan(
        syntheticCanvasHttp({
          modules: [],
          files: [file(1)],
          folders: [{ id: 401, name: "Untrusted" }],
          pages: [],
        }),
        syntheticCourse,
      ),
    ).rejects.toThrow("Invalid folder path");
  });

  it("uses a safe root path when the entire folder index is unavailable", async () => {
    const plan = await discoverCoursePlan(
      syntheticCanvasHttp({
        modules: [],
        unavailableIndexes: { folders: 404 },
        files: [file(1, "root.txt")],
        pages: [],
      }),
      syntheticCourse,
    );

    expect(plan.resources[0]?.archivePath).toBe("files/root.txt");
  });

  it("rejects file metadata whose ID does not match the closed requested endpoint", async () => {
    const http = syntheticCanvasHttp({
      unavailableIndexes: { files: 403 },
      modules: [
        {
          id: 201,
          items: [moduleItem(1, "File", { content_id: 777 })],
        },
      ],
      fileDetails: { 777: file(778) },
    });

    await expect(discoverCoursePlan(http, syntheticCourse)).rejects.toThrow(
      "Mismatched file metadata",
    );
  });

  it("enforces one global two-request bound for module items and file metadata", async () => {
    let active = 0;
    let maxActive = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const modules = Array.from({ length: 6 }, (_, index) => ({
      id: 201 + index,
      name: `Module ${index}`,
      position: index,
    }));
    const fetchAll = vi.fn(async (url: URL): Promise<unknown[]> => {
      if (url.pathname.endsWith("/modules")) return modules;
      if (/\/modules\/\d+\/items$/.test(url.pathname)) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (active === 2) release?.();
        await gate;
        active -= 1;
        const moduleId = Number(url.pathname.split("/").at(-2));
        return [moduleItem(moduleId, "File", { content_id: moduleId })];
      }
      if (/\/(files|folders|pages)$/.test(url.pathname)) {
        const { CanvasCourseIndexUnavailableError } =
          await import("../../src/canvas/http");
        throw new CanvasCourseIndexUnavailableError(404);
      }
      throw new TypeError("Unexpected synthetic request");
    });
    const jsonBoundedResource = vi.fn(async (url: URL) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      const id = Number(url.pathname.split("/").at(-1));
      return { value: file(id) };
    });
    const http = {
      fetchAll,
      json: vi.fn(),
      jsonBoundedResource,
    } as unknown as SyntheticHttp;

    const plan = await discoverCoursePlan(http, syntheticCourse);

    expect(plan.modules).toHaveLength(6);
    expect(plan.resources.filter(({ kind }) => kind === "file")).toHaveLength(
      6,
    );
    expect(maxActive).toBe(2);
  });

  it("latches a module-item failure, cancels queued calls, and joins active work", async () => {
    const activeGate = deferred();
    const failureSeen = deferred();
    const marker = new CanvasResponseError("module item failure");
    const calls: number[] = [];
    let active = 0;
    const fetchAll = vi.fn(async (url: URL): Promise<unknown[]> => {
      if (url.pathname.endsWith("/modules")) {
        return [201, 202, 203, 204].map((id) => ({ id }));
      }
      const match = /\/modules\/(\d+)\/items$/.exec(url.pathname);
      if (!match) return [];
      const id = Number(match[1]);
      calls.push(id);
      active += 1;
      if (id === 201) {
        await activeGate.promise;
        active -= 1;
        return [];
      }
      if (id === 202) {
        active -= 1;
        failureSeen.resolve();
        throw marker;
      }
      active -= 1;
      return [];
    });
    const request = discoverCoursePlan(
      { fetchAll, json: vi.fn() } as unknown as SyntheticHttp,
      syntheticCourse,
    );
    let terminal = false;
    const observed = request.then(
      () => {
        terminal = true;
      },
      () => {
        terminal = true;
      },
    );

    await failureSeen.promise;
    await Promise.resolve();
    const terminalBeforeJoin = terminal;
    activeGate.resolve();
    await expect(request).rejects.toBe(marker);
    await observed;

    expect(terminalBeforeJoin).toBe(false);
    expect(calls).toEqual([201, 202]);
    expect(active).toBe(0);
  });

  it("latches an optional-index hard failure without dispatching queued indexes", async () => {
    const activeGate = deferred();
    const failureSeen = deferred();
    const marker = new CanvasResponseError("index failure");
    const collections: string[] = [];
    let active = 0;
    const fetchAll = vi.fn(async (url: URL): Promise<unknown[]> => {
      if (url.pathname.endsWith("/modules")) return [];
      const collection = url.pathname.split("/").at(-1)!;
      collections.push(collection);
      active += 1;
      if (collection === "files") {
        await activeGate.promise;
        active -= 1;
        return [];
      }
      if (collection === "folders") {
        active -= 1;
        failureSeen.resolve();
        throw marker;
      }
      active -= 1;
      return [];
    });
    const request = discoverCoursePlan(
      { fetchAll, json: vi.fn() } as unknown as SyntheticHttp,
      syntheticCourse,
    );
    let terminal = false;
    const observed = request.then(
      () => {
        terminal = true;
      },
      () => {
        terminal = true;
      },
    );

    await failureSeen.promise;
    await Promise.resolve();
    const terminalBeforeJoin = terminal;
    activeGate.resolve();
    await expect(request).rejects.toBe(marker);
    await observed;

    expect(terminalBeforeJoin).toBe(false);
    expect(collections).toEqual(["files", "folders"]);
    expect(active).toBe(0);
  });

  it("latches a file-metadata failure without dispatching queued metadata", async () => {
    const activeGate = deferred();
    const failureSeen = deferred();
    const marker = new CanvasResponseError("metadata failure");
    const calls: number[] = [];
    let active = 0;
    const http = syntheticCanvasHttp({
      modules: [
        {
          id: 201,
          items: [701, 702, 703, 704].map((id) =>
            moduleItem(id, "File", { content_id: id }),
          ),
        },
      ],
      unavailableIndexes: { files: 404 },
      pages: [],
    });
    http.jsonBoundedResource.mockImplementation(async (url: URL) => {
      const id = Number(url.pathname.split("/").at(-1));
      calls.push(id);
      active += 1;
      if (id === 701) {
        await activeGate.promise;
        active -= 1;
        return { value: file(id) };
      }
      if (id === 702) {
        active -= 1;
        failureSeen.resolve();
        throw marker;
      }
      active -= 1;
      return { value: file(id) };
    });
    const request = discoverCoursePlan(http, syntheticCourse);
    let terminal = false;
    const observed = request.then(
      () => {
        terminal = true;
      },
      () => {
        terminal = true;
      },
    );

    await failureSeen.promise;
    await Promise.resolve();
    const terminalBeforeJoin = terminal;
    activeGate.resolve();
    await expect(request).rejects.toBe(marker);
    await observed;

    expect(terminalBeforeJoin).toBe(false);
    expect(calls).toEqual([701, 702]);
    expect(active).toBe(0);
  });

  it("keeps the two-request cap across overlapping discoveries around a failure", async () => {
    const firstActiveGate = deferred();
    const failureSeen = deferred();
    const secondIndexGate = deferred();
    const secondIndexStarted = deferred();
    const marker = new CanvasResponseError("first discovery failed");
    let active = 0;
    let maxActive = 0;
    const enter = (): void => {
      active += 1;
      maxActive = Math.max(maxActive, active);
    };
    const leave = (): void => {
      active -= 1;
    };
    const firstFetchAll = vi.fn(async (url: URL): Promise<unknown[]> => {
      if (url.pathname.endsWith("/modules")) return [{ id: 201 }, { id: 202 }];
      const id = Number(url.pathname.split("/").at(-2));
      enter();
      if (id === 201) {
        await firstActiveGate.promise;
        leave();
        return [];
      }
      leave();
      failureSeen.resolve();
      throw marker;
    });
    const secondFetchAll = vi.fn(async (url: URL): Promise<unknown[]> => {
      enter();
      if (url.pathname.endsWith("/modules")) {
        await Promise.resolve();
        leave();
        return [];
      }
      secondIndexStarted.resolve();
      await secondIndexGate.promise;
      leave();
      return [];
    });
    const first = discoverCoursePlan(
      { fetchAll: firstFetchAll, json: vi.fn() } as unknown as SyntheticHttp,
      syntheticCourse,
    );
    await failureSeen.promise;
    const second = discoverCoursePlan(
      { fetchAll: secondFetchAll, json: vi.fn() } as unknown as SyntheticHttp,
      syntheticCourse,
    );

    await secondIndexStarted.promise;
    await Promise.resolve();
    const observedMax = maxActive;
    secondIndexGate.resolve();
    await second;
    firstActiveGate.resolve();
    await expect(first).rejects.toBe(marker);

    expect(observedMax).toBe(2);
    expect(maxActive).toBe(2);
    expect(active).toBe(0);
  });

  it("has no production resource-count cap", async () => {
    const files = Array.from({ length: 12 }, (_, index) => file(index + 1));
    const plan = await discoverCoursePlan(
      syntheticCanvasHttp({ modules: [], files, pages: [] }),
      syntheticCourse,
    );

    expect(plan.resources).toHaveLength(12);
  });

  it("returns a deeply immutable plan", async () => {
    const plan = await discoverCoursePlan(
      syntheticCanvasHttp(),
      syntheticCourse,
    );

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.resources)).toBe(true);
    expect(Object.isFrozen(plan.resources[0])).toBe(true);
    expect(Object.isFrozen(plan.modules)).toBe(true);
    expect(Object.isFrozen(plan.modules[0]?.items)).toBe(true);
  });

  it("rejects inherited identifiers and malformed index records", async () => {
    const inherited = Object.create({ id: 301 }) as Record<string, unknown>;
    Object.assign(inherited, {
      display_name: "bad.bin",
      size: 1,
      url: "https://frankfurtschool.instructure.com/files/301/download",
    });

    await expect(
      discoverCoursePlan(
        syntheticCanvasHttp({ modules: [], files: [inherited], pages: [] }),
        syntheticCourse,
      ),
    ).rejects.toThrow("Invalid file");
  });
});

describe("assertPilotSize", () => {
  it.each([
    [0, false],
    [262_144_000, false],
    [262_144_001, true],
    [-1, true],
    [null, false],
    [1.5, true],
    [Number.NaN, true],
  ])("enforces advertised size %s", (size, rejected) => {
    const assertion = () => assertPilotSize(planWithOneFile(size));
    if (rejected) expect(assertion).toThrow(PilotSizeError);
    else expect(assertion).not.toThrow();
  });

  it("rejects integer-total overflow before trusting the declared total", () => {
    const plan = planWithOneFile(Number.MAX_SAFE_INTEGER);
    plan.resources.push({
      ...plan.resources[0]!,
      key: "file:302",
      sourceId: "302",
      advertisedBytes: 1,
    });
    plan.advertisedBytes = Number.MAX_SAFE_INTEGER;

    expect(() => assertPilotSize(plan)).toThrow("overflow");
  });

  it("rejects a declared total that does not match the immutable file plan", () => {
    const plan = planWithOneFile(19);
    plan.advertisedBytes = 18;

    expect(() => assertPilotSize(plan)).toThrow("total");
  });

  it("does not trust inherited file-size fields at the size boundary", () => {
    const plan = planWithOneFile(0);
    const inherited = Object.create({
      kind: "file",
      advertisedBytes: 0,
    }) as (typeof plan.resources)[number];
    plan.resources = [inherited];

    expect(() => assertPilotSize(plan)).toThrow("invalid resource");
  });
});
