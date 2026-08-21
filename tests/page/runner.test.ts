/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-call */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasSessionError } from "../../src/canvas/http";
import { EXTENSION_CHANNEL } from "../../src/shared/constants";
import { syntheticCourse } from "../fixtures/course-plan";

const mocks = vi.hoisted(() => ({
  assertCurrentUser: vi.fn(),
  listAccessibleCourses: vi.fn(),
  createRunPlan: vi.fn(),
  runCourses: vi.fn(),
  signals: [] as AbortSignal[],
}));

vi.mock("../../src/canvas/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/canvas/http")>()),
  CanvasHttp: vi.fn(function CanvasHttp(
    _fetcher: typeof fetch,
    signal?: AbortSignal,
  ) {
    if (signal) mocks.signals.push(signal);
    return {};
  }),
}));
vi.mock("../../src/canvas/session", () => ({
  assertCurrentUser: mocks.assertCurrentUser,
  listAccessibleCourses: mocks.listAccessibleCourses,
}));
vi.mock("../../src/page/run-courses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/page/run-courses")>()),
  createRunPlan: mocks.createRunPlan,
  runCourses: mocks.runCourses,
}));

type RuntimeEvent = {
  source?: unknown;
  payload?: { type?: unknown; runId?: unknown; [key: string]: unknown };
};

const dispatch = (payload: unknown, origin = location.origin): void => {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      origin,
      data: { source: "gradpack-relay", payload },
    }),
  );
};

const list = (runId: string): void =>
  dispatch({ channel: EXTENSION_CHANNEL, type: "LIST_COURSES", runId });
const start = (
  runId: string,
  courseIds = [syntheticCourse.id],
  packaging: "combined" | "per-course" = "per-course",
): void =>
  dispatch({
    channel: EXTENSION_CHANNEL,
    type: "START_RUN",
    runId,
    courseIds,
    packaging,
  });
const confirm = (runId: string): void =>
  dispatch({ channel: EXTENSION_CHANNEL, type: "CONFIRM_PLAN", runId });
const cancel = (runId: string): void =>
  dispatch({ channel: EXTENSION_CHANNEL, type: "CANCEL", runId });

const plan = (
  effectivePackaging: "combined" | "per-course" = "per-course",
) => ({
  courses: [
    {
      course: syntheticCourse,
      modules: [],
      resources: [],
      advertisedBytes: 0,
    },
  ],
  summary: {
    selected: [
      { courseId: syntheticCourse.id, advertisedBytes: 0, resourceCount: 0 },
    ],
    requestedPackaging: "combined" as const,
    effectivePackaging,
    advertisedBytes: 0,
    resourceCount: 0,
    fallbackReason:
      effectivePackaging === "per-course"
        ? ("combined-size-exceeded" as const)
        : null,
  },
});

const successfulResult = {
  effectivePackaging: "per-course" as const,
  combined: null,
  completed: [
    {
      course: syntheticCourse,
      fileName: "course.zip",
      manifest: {
        totals: {
          success: 1,
          failed: 0,
          unavailable: 0,
          unsupported: 0,
          external: 0,
        },
      },
      zipBytes: new Uint8Array(),
    },
  ],
  failedCourseIds: [],
  counts: {
    success: 1,
    failed: 0,
    unavailable: 0,
    unsupported: 0,
    external: 0,
  },
};

let runnerImported = false;
beforeAll(async () => {
  delete (window as unknown as Window & Record<string, unknown>)
    .__gradPackRunnerV1;
  await import("../../src/page/runner");
  runnerImported = true;
});

beforeEach(() => {
  expect(runnerImported).toBe(true);
  mocks.signals.length = 0;
  mocks.assertCurrentUser.mockReset().mockResolvedValue(undefined);
  mocks.listAccessibleCourses.mockReset().mockResolvedValue([syntheticCourse]);
  mocks.createRunPlan.mockReset().mockResolvedValue(plan());
  mocks.runCourses.mockReset().mockImplementation(async ({ progress }) => {
    progress({
      currentCourseId: syntheticCourse.id,
      currentCourseIndex: 0,
      totalCourses: 1,
      completedCourses: 0,
      stage: "package",
      completed: 0,
      total: 0,
      failed: 0,
    });
    return successfulResult;
  });
});

describe("production page runner", () => {
  it("emits PLAN_READY before retrieval and completes only after confirmation", async () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-plan0001");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-plan0001");
    await vi.waitFor(() => expect(mocks.createRunPlan).toHaveBeenCalledOnce());
    expect(mocks.runCourses).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "gradpack-runner",
        payload: expect.objectContaining({
          type: "PLAN_READY",
          runId: "run-plan0001",
        }),
      }),
      location.origin,
    );
    confirm("run-plan0001");
    await vi.waitFor(() => expect(mocks.runCourses).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            type: "COMPLETE",
            outputCount: 1,
          }),
        }),
        location.origin,
      ),
    );
    postMessage.mockRestore();
  });

  it("emits the combined fallback explanation in PLAN_READY", async () => {
    mocks.createRunPlan.mockResolvedValueOnce(plan("per-course"));
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-plan0002");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-plan0002", [syntheticCourse.id], "combined");
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            type: "PLAN_READY",
            effectivePackaging: "per-course",
            fallbackReason: "combined-size-exceeded",
          }),
        }),
        location.origin,
      ),
    );
    expect(mocks.runCourses).not.toHaveBeenCalled();
    cancel("run-plan0002");
    await new Promise((resolve) => setTimeout(resolve, 0));
    postMessage.mockRestore();
  });

  it("rejects stale confirmations and unlisted starts without running", async () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-plan0003");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-stale0003");
    start("run-plan0003", [999]);
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.filter(
          ([value]) => (value as RuntimeEvent).payload?.type === "FAILED",
        ),
      ).toHaveLength(2),
    );
    expect(mocks.runCourses).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });

  it("maps session loss to fixed failure text", async () => {
    mocks.createRunPlan.mockRejectedValueOnce(
      new CanvasSessionError("private"),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-plan0004");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-plan0004");
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            type: "FAILED",
            message: "Your Canvas session ended. Sign in and try again.",
          }),
        }),
        location.origin,
      ),
    );
    postMessage.mockRestore();
  });

  it("cancels an active confirmed run once", async () => {
    mocks.runCourses.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          ),
        ),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-plan0005");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-plan0005");
    await vi.waitFor(() => expect(mocks.createRunPlan).toHaveBeenCalledOnce());
    confirm("run-plan0005");
    await vi.waitFor(() => expect(mocks.runCourses).toHaveBeenCalledOnce());
    cancel("run-plan0005");
    cancel("run-plan0005");
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.filter(
          ([value]) => (value as RuntimeEvent).payload?.type === "CANCELLED",
        ),
      ).toHaveLength(1),
    );
    postMessage.mockRestore();
  });

  it("cancels a pending plan without starting retrieval", async () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-plan0006");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-plan0006");
    await vi.waitFor(() => expect(mocks.createRunPlan).toHaveBeenCalledOnce());
    cancel("run-plan0006");
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.some(
          ([value]) => (value as RuntimeEvent).payload?.type === "CANCELLED",
        ),
      ).toBe(true),
    );
    expect(mocks.runCourses).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });
});
