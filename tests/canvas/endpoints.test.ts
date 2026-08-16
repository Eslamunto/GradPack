import { describe, expect, it } from "vitest";
import { canvasEndpoint } from "../../src/canvas/endpoints";

describe("canvasEndpoint", () => {
  it("constructs fixed read-only endpoints", () => {
    expect(canvasEndpoint({ type: "currentUser" }).pathname).toBe(
      "/api/v1/users/self/profile",
    );
    expect(canvasEndpoint({ type: "courseFiles", courseId: 42 }).pathname).toBe(
      "/api/v1/courses/42/files",
    );
  });

  it("rejects invalid identifiers", () => {
    expect(() =>
      canvasEndpoint({ type: "courseFiles", courseId: -1 }),
    ).toThrow();
  });

  it("allows only fixed Canvas paths and query parameters", () => {
    const courses = canvasEndpoint({
      type: "courses",
      enrollmentState: "active",
    });
    expect(courses.origin).toBe("https://frankfurtschool.instructure.com");
    expect(courses.pathname).toBe("/api/v1/courses");
    expect(courses.searchParams.get("enrollment_state")).toBe("active");
    expect(courses.searchParams.getAll("state[]")).toEqual([
      "available",
      "completed",
    ]);
    expect(courses.searchParams.getAll("include[]")).toEqual(["concluded"]);
    expect(courses.searchParams.get("per_page")).toBe("100");
  });

  it("rejects unrecognized endpoint variants and unsafe page tokens", () => {
    expect(() =>
      canvasEndpoint({
        type: "coursePage",
        courseId: 42,
        pageUrl: "../secrets",
      }),
    ).toThrow();
    expect(() => canvasEndpoint({ type: "FETCH_URL" } as never)).toThrow();
  });

  it("rejects arbitrary enrollment states at runtime", () => {
    expect(() =>
      canvasEndpoint({
        type: "courses",
        enrollmentState: { toString: (): string => "active" },
      } as never),
    ).toThrow();
    expect(() =>
      canvasEndpoint({ type: "courses", enrollmentState: "all" } as never),
    ).toThrow();
  });

  it("rejects coercible page URL values at runtime", () => {
    expect(() =>
      canvasEndpoint({
        type: "coursePage",
        courseId: 42,
        pageUrl: { toString: (): string => "intro" },
      } as never),
    ).toThrow();
  });
});
