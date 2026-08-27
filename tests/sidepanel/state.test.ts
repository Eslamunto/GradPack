import { describe, expect, it } from "vitest";
import { initialState, reduceState } from "../../src/sidepanel/state";
import type { AggregateProgress, RunPlanSummary } from "../../src/shared/model";
import { syntheticCourse } from "../fixtures/course-plan";

const secondCourse = {
  ...syntheticCourse,
  id: 102,
  name: "Second Course",
  courseCode: "SYN-102",
};

const concludedCourse = {
  ...syntheticCourse,
  id: 103,
  name: "Concluded Course",
  courseCode: "SYN-103",
  workflowState: "completed",
  concluded: true,
};

const plan: RunPlanSummary = {
  requestedCourseCount: 2,
  selected: [
    {
      courseId: syntheticCourse.id,
      advertisedBytes: 19,
      unknownSizeCount: 0,
      resourceCount: 2,
    },
    {
      courseId: secondCourse.id,
      advertisedBytes: 21,
      unknownSizeCount: 0,
      resourceCount: 1,
    },
  ],
  skipped: [],
  requestedPackaging: "combined",
  effectivePackaging: "per-course",
  advertisedBytes: 40,
  unknownSizeCount: 0,
  resourceCount: 3,
  fallbackReason: "combined-size-exceeded",
};

const progress: AggregateProgress = {
  stage: "download",
  currentCourseId: secondCourse.id,
  currentCourseIndex: 1,
  totalCourses: 2,
  completedCourses: 1,
  completed: 1,
  total: 1,
  failed: 0,
};

describe("Side Panel state reducer", () => {
  it("selects and clears every displayed course from none, partial, and all", () => {
    const choose = reduceState(initialState, {
      type: "COURSES",
      courses: [syntheticCourse, secondCourse, concludedCourse],
    });

    const allFromNone = reduceState(choose, { type: "SELECT_ALL" });
    expect(allFromNone).toMatchObject({
      name: "choose",
      selectedIds: [101, 102, 103],
    });

    const partial = reduceState(allFromNone, {
      type: "SELECT",
      courseId: secondCourse.id,
    });
    expect(partial).toMatchObject({
      name: "choose",
      selectedIds: [101, 103],
    });
    expect(reduceState(partial, { type: "SELECT_ALL" })).toMatchObject({
      name: "choose",
      selectedIds: [101, 102, 103],
    });

    expect(reduceState(allFromNone, { type: "SELECT_ALL" })).toMatchObject({
      name: "choose",
      selectedIds: [],
    });

    expect(reduceState(initialState, { type: "SELECT_ALL" })).toBe(
      initialState,
    );
  });

  it("models selection, review, aggregate packing, and completion", () => {
    const choose = reduceState(initialState, {
      type: "COURSES",
      courses: [syntheticCourse, secondCourse],
    });
    expect(choose).toMatchObject({ name: "choose", selectedIds: [] });

    const selected = reduceState(
      reduceState(choose, { type: "SELECT", courseId: syntheticCourse.id }),
      { type: "SELECT", courseId: secondCourse.id },
    );
    expect(selected).toMatchObject({
      name: "choose",
      selectedIds: [syntheticCourse.id, secondCourse.id],
    });

    const configure = reduceState(selected, { type: "CONFIGURE" });
    expect(configure).toMatchObject({
      name: "configure",
      packaging: "per-course",
      busy: false,
    });
    const discovering = reduceState(configure, { type: "DISCOVERING" });
    expect(discovering).toMatchObject({ name: "configure", busy: true });
    const review = reduceState(discovering, { type: "PLAN_READY", plan });
    expect(review).toMatchObject({ name: "review", plan });

    const packing = reduceState(review, { type: "CONFIRM" });
    expect(packing).toMatchObject({
      name: "packing",
      packaging: "per-course",
      plan,
      progress: {
        stage: "discovery",
        currentCourseId: syntheticCourse.id,
        currentCourseIndex: 0,
        totalCourses: 2,
        completedCourses: 0,
        completed: 0,
        total: 2,
        failed: 0,
      },
    });
    expect(reduceState(packing, { type: "PROGRESS", progress })).toMatchObject({
      name: "packing",
      progress,
    });
    expect(
      reduceState(packing, {
        type: "COMPLETE",
        packaging: "per-course",
        completedCourses: 1,
        completedCourseIds: [syntheticCourse.id],
        failedCourses: 1,
        outputCount: 1,
        counts: {
          success: 1,
          failed: 1,
          unavailable: 0,
          unsupported: 0,
          external: 0,
        },
      }),
    ).toMatchObject({
      name: "complete",
      completedCourseIds: [syntheticCourse.id],
      outputCount: 1,
    });
  });

  it("ignores impossible transitions and blocks empty or invalid runs", () => {
    const empty = reduceState(initialState, { type: "COURSES", courses: [] });
    expect(empty).toMatchObject({ name: "blocked" });
    const choose = reduceState(initialState, {
      type: "COURSES",
      courses: [syntheticCourse],
    });
    expect(reduceState(choose, { type: "CONFIGURE" })).toBe(choose);
    expect(
      reduceState(choose, { type: "SELECT", courseId: 999 }),
    ).toMatchObject({
      name: "blocked",
    });
    expect(
      reduceState(choose, {
        type: "FAILED",
        message: "GradPack stopped because a safety check failed.",
      }),
    ).toMatchObject({ name: "blocked" });
  });
});
