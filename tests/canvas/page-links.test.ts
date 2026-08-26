import { describe, expect, it } from "vitest";
import {
  exactCanvasPage,
  pageLinkedFileIds,
} from "../../src/canvas/page-links";
import { CANVAS_ORIGIN } from "../../src/shared/constants";

describe("page-linked Canvas files", () => {
  it("collects sorted unique IDs from relative wrap links", () => {
    const body = [
      '<a href="/courses/101/files/42?wrap=1">First</a>',
      '<a href="/courses/101/files/7?wrap=1">Second</a>',
      '<a href="/courses/101/files/42?wrap=1">Repeated</a>',
    ].join("");

    expect(pageLinkedFileIds(body, 101)).toEqual([7, 42]);
  });

  it("collects sorted unique IDs from exact-origin download links", () => {
    const body = [
      `<a href="${CANVAS_ORIGIN}/courses/101/files/42/download">First</a>`,
      `<a href="${CANVAS_ORIGIN}/courses/101/files/7/download">Second</a>`,
      `<a href="${CANVAS_ORIGIN}/courses/101/files/42/download">Repeated</a>`,
    ].join("");

    expect(pageLinkedFileIds(body, 101)).toEqual([7, 42]);
  });

  it("ignores every link outside the exact page-file boundary", () => {
    const pageContent = "synthetic page content must not leak";
    const httpUrl = new URL("/courses/101/files/7?wrap=1", CANVAS_ORIGIN);
    httpUrl.protocol = "http:";
    const credentialUrl = new URL("/courses/101/files/7?wrap=1", CANVAS_ORIGIN);
    credentialUrl.username = "synthetic";
    credentialUrl.password = "synthetic";
    const networkPathHref = `//${new URL(CANVAS_ORIGIN).host}/courses/101/files/7?wrap=1`;
    const body = [
      `<a href="${CANVAS_ORIGIN}/courses/102/files/7?wrap=1">other course</a>`,
      '<a href="https://synthetic.invalid/courses/101/files/7?wrap=1">other origin</a>',
      `<a href="${httpUrl.href}">http</a>`,
      `<a href="${credentialUrl.href}">credentials</a>`,
      '<a href="courses/101/files/7?wrap=1">path-relative</a>',
      '<a href="./courses/101/files/7?wrap=1">dot-relative</a>',
      `<a href="${networkPathHref}">network-path</a>`,
      '<a href="/courses/101/files/7?wrap=1#section">fragment</a>',
      '<a href=" /courses/101/files/7?wrap=1">leading whitespace</a>',
      '<a href="/courses/101/files/7?wrap=1 ">trailing whitespace</a>',
      '<a href="\\courses\\101\\files\\7?wrap=1">backslashes</a>',
      '<a href="/courses%2F101/files/7?wrap=1">encoded separator</a>',
      '<a href="/courses/101/files%2F7?wrap=1">encoded separator</a>',
      '<a href="/courses/101/files/0?wrap=1">zero ID</a>',
      '<a href="/courses/101/files/07?wrap=1">leading zero ID</a>',
      '<a href="/courses/101/files/not-a-number?wrap=1">invalid ID</a>',
      '<a href="/courses/101/files/7">unsupported suffix</a>',
      '<a href="/courses/101/files/7/download?wrap=1">download query</a>',
      '<a href="/courses/101/files/7?wrap=1&extra=1">extra query</a>',
      '<a href="/courses/101/files/7?wrap=1&wrap=1">duplicate query</a>',
      '<a href="/courses/101/files/7?%77rap=1">encoded query name</a>',
      '<a href="/courses/101/files/7?wrap=%31">encoded query value</a>',
      '<a data-href="/courses/101/files/7?wrap=1">data attribute</a>',
      '<span href="/courses/101/files/7?wrap=1">non-anchor</span>',
      pageContent,
    ].join("");

    expect(() => pageLinkedFileIds(body, 101)).not.toThrow();
    expect(pageLinkedFileIds(body, 101)).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid selected course ID %s",
    (courseId) => {
      expect(() =>
        pageLinkedFileIds(
          '<a href="/courses/101/files/7?wrap=1">x</a>',
          courseId,
        ),
      ).toThrow("Invalid Canvas course ID");
    },
  );
});

describe("exact Canvas page record", () => {
  it("returns own string title and body fields", () => {
    expect(
      exactCanvasPage({ title: "Synthetic title", body: "<p>Body</p>" }),
    ).toEqual({
      title: "Synthetic title",
      body: "<p>Body</p>",
    });
  });

  it("accepts a 500-character title", () => {
    expect(
      exactCanvasPage({ title: "x".repeat(500), body: "synthetic" }),
    ).toEqual({
      title: "x".repeat(500),
      body: "synthetic",
    });
  });

  it.each([
    [],
    { title: "x".repeat(501), body: "synthetic" },
    { title: "Synthetic" },
    { body: "synthetic" },
    { title: 7, body: "synthetic" },
    { title: "Synthetic", body: 7 },
    Object.create({ title: "Synthetic", body: "synthetic" }),
    Object.defineProperties(
      {},
      {
        title: { get: () => "Synthetic", enumerable: true },
        body: { value: "synthetic", enumerable: true },
      },
    ),
    Object.defineProperties(
      {},
      {
        title: { value: "Synthetic", enumerable: true },
        body: { get: () => "synthetic", enumerable: true },
      },
    ),
  ])("rejects an invalid page record", (value) => {
    expect(() => exactCanvasPage(value)).toThrow(
      "Canvas returned an invalid page",
    );
  });

  it("does not include an invalid page body in its error", () => {
    const body = "synthetic page content must not leak";

    expect(() => exactCanvasPage({ title: 7, body })).toThrowError(
      expect.not.stringContaining(body),
    );
  });
});
