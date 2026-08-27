import { describe, expect, it, vi } from "vitest";
import {
  createRunPlan,
  runCourses,
  type MultiCourseDependencies,
} from "../../src/page/run-courses";
import {
  parseRunnerEvent,
  RUNNER_TERMINAL_MESSAGES,
} from "../../src/shared/messages";
import { RUNNER_CHANNEL } from "../../src/shared/constants";
import type { CoursePlan, CourseSummary } from "../../src/shared/model";
import { reduceState } from "../../src/sidepanel/state";

const courses: CourseSummary[] = [
  {
    id: 101,
    name: "Synthetic First Course",
    courseCode: "SYN-101",
    workflowState: "available",
    concluded: false,
  },
  {
    id: 202,
    name: "Synthetic Second Course",
    courseCode: "SYN-202",
    workflowState: "available",
    concluded: false,
  },
];

const coursePlan = (course: CourseSummary): CoursePlan => ({
  course: { ...course },
  modules: [],
  advertisedBytes: 1,
  resources: [
    {
      key: `file:${course.id}`,
      kind: "file",
      title: "synthetic-file.bin",
      sourceId: String(course.id),
      archivePath: "files/synthetic-file.bin",
      advertisedBytes: 1,
      sourceUrl: null,
    },
  ],
});

describe("all packing failures", () => {
  it("keeps every selected course in order for zero-output retry", async () => {
    const downloads: string[] = [];
    const dependencies: MultiCourseDependencies = {
      discover: vi.fn((course: CourseSummary) =>
        Promise.resolve(coursePlan(course)),
      ),
      retrieve: vi.fn(),
      buildCourseArchive: vi.fn(
        ({
          course,
        }: Parameters<MultiCourseDependencies["buildCourseArchive"]>[0]) =>
          Promise.reject(
            new Error(`Synthetic archive failure for course ${course.id}`),
          ),
      ),
      buildCombinedZip: vi.fn(() => {
        throw new Error("Synthetic combined archive should not be built");
      }),
      archiveCss: "",
      now: () => "2026-08-27T00:00:00.000Z",
      fileName: (course) => `synthetic-${course.id}.zip`,
      combinedFileName: () => "synthetic-combined.zip",
      download: (fileName) => downloads.push(fileName),
    };
    const plan = await createRunPlan({
      courses,
      requestedPackaging: "combined",
      signal: new AbortController().signal,
      dependencies,
    });

    expect(Object.isFrozen(plan.courses)).toBe(true);
    expect(Object.isFrozen(plan.courses[0])).toBe(true);
    const result = await runCourses({
      plan,
      signal: new AbortController().signal,
      progress: () => {},
      dependencies,
    });

    expect(downloads).toEqual([]);
    const event = parseRunnerEvent({
      channel: RUNNER_CHANNEL,
      type: "COMPLETE",
      runId: "run-synthetic-0001",
      message: RUNNER_TERMINAL_MESSAGES.noArchives,
      packaging: result.effectivePackaging,
      completedCourses: result.completed.length,
      completedCourseIds: result.completed.map(({ course }) => course.id),
      failedCourses: result.failedCourseIds.length,
      outputCount: result.combined ? 1 : result.completed.length,
      ...result.counts,
    });

    expect(event.type).toBe("COMPLETE");
    if (event.type !== "COMPLETE") throw new Error("Expected completion event");
    const packing = {
      name: "packing" as const,
      courses,
      selectedIds: courses.map(({ id }) => id),
      progress: {
        stage: "download" as const,
        currentCourseId: courses[0]!.id,
        currentCourseIndex: 0,
        totalCourses: courses.length,
        completedCourses: 0,
        completed: 0,
        total: 1,
        failed: 0,
      },
      packaging: plan.summary.effectivePackaging,
      requestedPackaging: plan.summary.requestedPackaging,
      plan: plan.summary,
    };
    const complete = reduceState(packing, {
      type: "COMPLETE",
      packaging: event.packaging,
      completedCourses: event.completedCourses,
      completedCourseIds: event.completedCourseIds,
      failedCourses: event.failedCourses,
      outputCount: event.outputCount,
      counts: {
        success: event.success,
        failed: event.failed,
        unavailable: event.unavailable,
        unsupported: event.unsupported,
        external: event.external,
      },
    });

    expect(complete).toMatchObject({
      name: "complete",
      retryCourseIds: [101, 202],
    });
  });
});
