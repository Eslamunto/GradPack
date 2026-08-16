import { describe, expect, it, vi } from "vitest";
import { fetchAllPages, parseNextLink } from "../../src/canvas/pagination";
import { CANVAS_ORIGIN } from "../../src/shared/constants";

function pageResponse(link: string | null): Response {
  return new Response(null, link ? { headers: { link } } : {});
}

describe("parseNextLink", () => {
  it("accepts one exact-origin next link", () => {
    expect(
      parseNextLink(
        `<${CANVAS_ORIGIN}/api/v1/courses?page=2>; rel="next"`,
      )?.searchParams.get("page"),
    ).toBe("2");
  });

  it("selects next from a multi-relation Link header", () => {
    expect(
      parseNextLink(
        `<${CANVAS_ORIGIN}/api/v1/courses?page=1>; rel="current", <${CANVAS_ORIGIN}/api/v1/courses?page=2>; rel="next"`,
      )?.searchParams.get("page"),
    ).toBe("2");
  });

  it("returns null when no next relation exists", () => {
    expect(
      parseNextLink(`<${CANVAS_ORIGIN}/api/v1/courses?page=1>; rel="current"`),
    ).toBeNull();
  });

  it.each([
    '<https://evil.test/api/v1/courses?page=2>; rel="next"',
    `<${CANVAS_ORIGIN}/api/v2/courses?page=2>; rel="next"`,
    '<javascript:alert(1)>; rel="next"',
    '<not a url>; rel="next"',
  ])("rejects an unsafe next link: %s", (header) => {
    expect(() => parseNextLink(header)).toThrow();
  });

  it("rejects more than one next relation", () => {
    expect(() =>
      parseNextLink(
        `<${CANVAS_ORIGIN}/api/v1/courses?page=2>; rel="next", <${CANVAS_ORIGIN}/api/v1/courses?page=3>; rel="next"`,
      ),
    ).toThrow("multiple next links");
  });
});

describe("fetchAllPages", () => {
  it("collects each validated page in order", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        value: [1, 2],
        response: pageResponse(
          `<${CANVAS_ORIGIN}/api/v1/courses?page=2>; rel="next"`,
        ),
      })
      .mockResolvedValueOnce({ value: [3], response: pageResponse(null) });

    await expect(
      fetchAllPages<number>(
        request,
        new URL(`${CANVAS_ORIGIN}/api/v1/courses?page=1`),
      ),
    ).resolves.toEqual([1, 2, 3]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stops a pagination loop before issuing a repeated request", async () => {
    const first = `${CANVAS_ORIGIN}/api/v1/courses?page=1`;
    const request = vi.fn().mockResolvedValue({
      value: [],
      response: pageResponse(`<${first}>; rel="next"`),
    });

    await expect(fetchAllPages(request, new URL(first))).rejects.toThrow(
      "Pagination loop detected",
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("rejects a foreign next page before requesting it", async () => {
    const request = vi.fn().mockResolvedValue({
      value: [],
      response: pageResponse(
        '<https://evil.test/api/v1/courses?page=2>; rel="next"',
      ),
    });

    await expect(
      fetchAllPages(request, new URL(`${CANVAS_ORIGIN}/api/v1/courses`)),
    ).rejects.toThrow("Rejected pagination URL");
    expect(request).toHaveBeenCalledOnce();
  });
});
