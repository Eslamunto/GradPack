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

const partialPlan: RunPlanSummary = {
  ...plan,
  requestedCourseCount: 3,
  skipped: [{ courseId: concludedCourse.id, category: "canvas-unavailable" }],
};

const allSkippedPlan: RunPlanSummary = {
  requestedCourseCount: 2,
  selected: [],
  skipped: [
    { courseId: syntheticCourse.id, category: "unexpected-local" },
    { courseId: secondCourse.id, category: "safety-validation" },
  ],
  requestedPackaging: "combined",
  effectivePackaging: "combined",
  advertisedBytes: 0,
  unknownSizeCount: 0,
  resourceCount: 0,
  fallbackReason: null,
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
    expect(discovering).toMatchObject({
      name: "configure",
      busy: true,
      discoveryProgress: null,
    });
    const checking = reduceState(discovering, {
      type: "DISCOVERY_PROGRESS",
      progress: {
        completed: 1,
        total: 2,
        currentCourseId: syntheticCourse.id,
      },
    });
    expect(checking).toMatchObject({
      name: "configure",
      discoveryProgress: { completed: 1, total: 2 },
    });
    const review = reduceState(checking, { type: "PLAN_READY", plan });
    expect(review).toMatchObject({ name: "review", plan });

    const packing = reduceState(review, { type: "CONFIRM" });
    expect(packing).toMatchObject({
      name: "packing",
      packaging: "per-course",
      requestedPackaging: "combined",
      courses: [syntheticCourse, secondCourse],
      selectedIds: [syntheticCourse.id, secondCourse.id],
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
      retryCourseIds: [secondCourse.id],
      requestedPackaging: "combined",
      plan,
    });
  });

  it("keeps an all-skipped plan in review and prepares a fresh retry", () => {
    const configure = {
      name: "configure" as const,
      courses: [syntheticCourse, secondCourse],
      selectedIds: [syntheticCourse.id, secondCourse.id],
      packaging: "combined" as const,
      busy: true,
      discoveryProgress: null,
    };
    const review = reduceState(configure, {
      type: "PLAN_READY",
      plan: allSkippedPlan,
    });

    expect(review).toMatchObject({ name: "review", plan: allSkippedPlan });
    expect(reduceState(review, { type: "CONFIRM" })).toBe(review);
    expect(reduceState(review, { type: "RETRY" })).toMatchObject({
      name: "connect",
      retry: {
        courseIds: [syntheticCourse.id, secondCourse.id],
        packaging: "combined",
      },
    });
  });

  it("derives planning and packing failures in original order for retry", () => {
    const review = {
      name: "review" as const,
      courses: [syntheticCourse, secondCourse, concludedCourse],
      selectedIds: [syntheticCourse.id, secondCourse.id, concludedCourse.id],
      plan: partialPlan,
    };
    const packing = reduceState(review, { type: "CONFIRM" });
    const complete = reduceState(packing, {
      type: "COMPLETE",
      packaging: "per-course",
      completedCourses: 1,
      completedCourseIds: [syntheticCourse.id],
      failedCourses: 1,
      outputCount: 1,
      counts: {
        success: 1,
        failed: 0,
        unavailable: 0,
        unsupported: 0,
        external: 0,
      },
    });

    expect(complete).toMatchObject({
      name: "complete",
      retryCourseIds: [secondCourse.id, concludedCourse.id],
    });
    const retry = reduceState(complete, { type: "RETRY" });
    expect(retry).toMatchObject({
      name: "connect",
      retry: {
        courseIds: [secondCourse.id, concludedCourse.id],
        packaging: "combined",
      },
    });
    expect(
      reduceState(retry, {
        type: "COURSES",
        courses: [syntheticCourse, concludedCourse],
      }),
    ).toMatchObject({
      name: "configure",
      selectedIds: [concludedCourse.id],
      packaging: "combined",
      busy: false,
      discoveryProgress: null,
    });
    expect(
      reduceState(retry, { type: "COURSES", courses: [syntheticCourse] }),
    ).toMatchObject({ name: "blocked" });
  });

  it("keeps every selected course retryable after a zero-output completion", () => {
    const review = {
      name: "review" as const,
      courses: [syntheticCourse, secondCourse],
      selectedIds: [syntheticCourse.id, secondCourse.id],
      plan,
    };
    const complete = reduceState(reduceState(review, { type: "CONFIRM" }), {
      type: "COMPLETE",
      packaging: "per-course",
      completedCourses: 0,
      completedCourseIds: [],
      failedCourses: 2,
      outputCount: 0,
      counts: {
        success: 0,
        failed: 0,
        unavailable: 0,
        unsupported: 0,
        external: 0,
      },
    });

    expect(complete).toMatchObject({
      name: "complete",
      retryCourseIds: [syntheticCourse.id, secondCourse.id],
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
