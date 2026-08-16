import { describe, expect, it } from "vitest";
import { initialState, reduceState } from "../../src/sidepanel/state";
import { syntheticCourse } from "../fixtures/course-plan";

describe("Side Panel state reducer", () => {
  it("implements the six approved states without impossible transitions", () => {
    const choose = reduceState(initialState, {
      type: "COURSES",
      courses: [syntheticCourse],
    });
    expect(choose).toMatchObject({ name: "choose", selectedId: null });
    expect(
      reduceState(choose, {
        type: "FAILED",
        message: "GradPack stopped because a safety check failed.",
      }),
    ).toBe(choose);
    const ready = reduceState(choose, {
      type: "SELECT",
      courseId: syntheticCourse.id,
    });
    expect(ready).toEqual({ name: "ready", course: syntheticCourse });
    expect(reduceState(ready, { type: "COURSES", courses: [] })).toBe(ready);
    const packing = reduceState(ready, {
      type: "PROGRESS",
      progress: { stage: "download", completed: 1, total: 2, failed: 0 },
    });
    expect(packing).toMatchObject({ name: "packing" });
    const complete = reduceState(packing, {
      type: "COMPLETE",
      counts: {
        success: 1,
        failed: 0,
        unavailable: 1,
        unsupported: 0,
        external: 0,
      },
    });
    expect(complete).toMatchObject({ name: "complete" });
    expect(
      reduceState(complete, {
        type: "PROGRESS",
        progress: { stage: "package", completed: 2, total: 2, failed: 0 },
      }),
    ).toBe(complete);
    expect(
      reduceState(initialState, {
        type: "FAILED",
        message: "GradPack stopped because a safety check failed.",
      }),
    ).toMatchObject({ name: "blocked" });
  });

  it("blocks an unlisted course and handles an empty course list", () => {
    const empty = reduceState(initialState, { type: "COURSES", courses: [] });
    expect(empty).toMatchObject({ name: "blocked" });
    const choose = reduceState(initialState, {
      type: "COURSES",
      courses: [syntheticCourse],
    });
    expect(
      reduceState(choose, { type: "SELECT", courseId: 999 }),
    ).toMatchObject({ name: "blocked" });
  });
});
