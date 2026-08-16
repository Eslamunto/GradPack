import { describe, expect, it, vi } from "vitest";
import {
  assertPilotSize,
  discoverCoursePlan,
  PilotSizeError,
} from "../../src/canvas/discovery";
import { CanvasResponseError, CanvasSessionError } from "../../src/canvas/http";
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

describe("discoverCoursePlan", () => {
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
    expect(http.json.mock.calls).toContainEqual([
      expect.objectContaining({
        pathname: "/api/v1/courses/101/files/777",
      }),
    ]);
    expect(
      [...http.fetchAll.mock.calls, ...http.json.mock.calls].map(
        ([url]) => url.origin,
      ),
    ).toEqual(
      expect.arrayContaining(["https://frankfurtschool.instructure.com"]),
    );
    expect(
      [...http.fetchAll.mock.calls, ...http.json.mock.calls].some(([url]) =>
        url.href.includes("evil.test"),
      ),
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
    const json = vi.fn(async (url: URL) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      const id = Number(url.pathname.split("/").at(-1));
      return { value: file(id) };
    });
    const http = { fetchAll, json } as unknown as SyntheticHttp;

    const plan = await discoverCoursePlan(http, syntheticCourse);

    expect(plan.modules).toHaveLength(6);
    expect(plan.resources.filter(({ kind }) => kind === "file")).toHaveLength(
      6,
    );
    expect(maxActive).toBe(2);
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
    [null, true],
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
