import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasSessionError } from "../../src/canvas/http";
import { EXTENSION_CHANNEL, RUNNER_CHANNEL } from "../../src/shared/constants";
import { syntheticCourse } from "../fixtures/course-plan";

const mocks = vi.hoisted(() => ({
  assertCurrentUser: vi.fn(),
  listAccessibleCourses: vi.fn(),
  runCourse: vi.fn(),
  http: {},
}));

vi.mock("../../src/canvas/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/canvas/http")>()),
  CanvasHttp: vi.fn(function CanvasHttp() {
    return mocks.http;
  }),
}));
vi.mock("../../src/canvas/session", () => ({
  assertCurrentUser: mocks.assertCurrentUser,
  listAccessibleCourses: mocks.listAccessibleCourses,
}));
vi.mock("../../src/page/run-course", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/page/run-course")>()),
  runCourse: mocks.runCourse,
}));

function dispatch(payload: unknown, origin = location.origin): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      origin,
      data: { source: "gradpack-relay", payload },
    }),
  );
}
const list = (runId: string): void =>
  dispatch({ channel: EXTENSION_CHANNEL, type: "LIST_COURSES", runId });
const start = (runId: string, courseId = syntheticCourse.id): void =>
  dispatch({
    channel: EXTENSION_CHANNEL,
    type: "START_COURSE",
    runId,
    courseId,
  });
const cancel = (runId: string): void =>
  dispatch({ channel: EXTENSION_CHANNEL, type: "CANCEL", runId });
const eventType = (value: unknown): unknown =>
  (value as { payload?: { type?: unknown } }).payload?.type;

beforeAll(async () => {
  delete (window as unknown as Window & Record<string, unknown>)
    .__gradPackRunnerV1;
  await import("../../src/page/runner");
});

beforeEach(() => {
  mocks.assertCurrentUser.mockReset().mockResolvedValue(undefined);
  mocks.listAccessibleCourses.mockReset().mockResolvedValue([syntheticCourse]);
  mocks.runCourse.mockReset().mockResolvedValue({
    manifest: {
      totals: {
        success: 2,
        failed: 1,
        unavailable: 1,
        unsupported: 0,
        external: 1,
      },
    },
    zipBytes: new Uint8Array(),
  });
});

describe("production page runner", () => {
  it("binds a listed course to its run and emits one scalar-only completion", async () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-list0001");
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "gradpack-runner",
          payload: {
            channel: RUNNER_CHANNEL,
            type: "COURSES",
            runId: "run-list0001",
            courses: [syntheticCourse],
          },
        },
        location.origin,
      ),
    );
    start("run-list0001");
    await vi.waitFor(() => expect(mocks.runCourse).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "gradpack-runner",
          payload: {
            channel: RUNNER_CHANNEL,
            type: "COMPLETE",
            runId: "run-list0001",
            message: "Your course ZIP was downloaded.",
            success: 2,
            failed: 1,
            unavailable: 1,
            unsupported: 0,
            external: 1,
          },
        },
        location.origin,
      ),
    );
    expect(
      postMessage.mock.calls.filter(
        ([value]) => eventType(value) === "COMPLETE",
      ),
    ).toHaveLength(1);
    postMessage.mockRestore();
  });

  it("rejects stale and unlisted starts without running", async () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-list0002");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-stale002");
    start("run-list0002", 999);
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.filter(
          ([value]) => eventType(value) === "FAILED",
        ),
      ).toHaveLength(2),
    );
    expect(mocks.runCourse).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });

  it("makes duplicate cancel idempotent and emits one cancellation", async () => {
    mocks.runCourse.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-list0003");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-list0003");
    await vi.waitFor(() => expect(mocks.runCourse).toHaveBeenCalledOnce());
    cancel("run-list0003");
    cancel("run-list0003");
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.filter(
          ([value]) => eventType(value) === "CANCELLED",
        ),
      ).toHaveLength(1),
    );
    postMessage.mockRestore();
  });

  it("maps session failure to fixed text and ignores foreign or inexact commands", async () => {
    mocks.assertCurrentUser.mockRejectedValueOnce(
      new CanvasSessionError("private"),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-list0004");
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "gradpack-runner",
          payload: {
            channel: RUNNER_CHANNEL,
            type: "FAILED",
            runId: "run-list0004",
            message: "Your Canvas session ended. Sign in and try again.",
          },
        },
        location.origin,
      ),
    );
    const calls = postMessage.mock.calls.length;
    dispatch(
      {
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId: "run-foreign1",
      },
      "https://evil.test",
    );
    dispatch({
      channel: EXTENSION_CHANNEL,
      type: "LIST_COURSES",
      runId: "run-inexact1",
      url: "https://evil.test",
    });
    expect(postMessage).toHaveBeenCalledTimes(calls);
    postMessage.mockRestore();
  });

  it("does not install duplicate listeners when reinjected", async () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    await import("../../src/page/runner");
    list("run-list0005");
    await vi.waitFor(() =>
      expect(mocks.assertCurrentUser).toHaveBeenCalledOnce(),
    );
    expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce();
    postMessage.mockRestore();
  });

  it("rejects overlapping commands while a course list is in flight", async () => {
    let finishList!: (courses: (typeof syntheticCourse)[]) => void;
    mocks.listAccessibleCourses.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishList = resolve;
        }),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-list0006");
    await vi.waitFor(() =>
      expect(mocks.assertCurrentUser).toHaveBeenCalledOnce(),
    );
    start("run-list0006");
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.some(([value]) => eventType(value) === "FAILED"),
      ).toBe(true),
    );
    expect(mocks.runCourse).not.toHaveBeenCalled();
    finishList([syntheticCourse]);
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.some(
          ([value]) => eventType(value) === "COURSES",
        ),
      ).toBe(true),
    );
    postMessage.mockRestore();
  });

  it("aborts an active run on navigation and emits one fixed terminal event", async () => {
    mocks.runCourse.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("navigation", "AbortError")),
            { once: true },
          );
        }),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-list0007");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-list0007");
    await vi.waitFor(() => expect(mocks.runCourse).toHaveBeenCalledOnce());
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "gradpack-runner",
          payload: {
            channel: RUNNER_CHANNEL,
            type: "CANCELLED",
            runId: "run-list0007",
            message:
              "The Canvas tab navigated or closed. Reopen it and try again.",
          },
        },
        location.origin,
      ),
    );
    expect(
      postMessage.mock.calls.filter(
        ([value]) => eventType(value) === "CANCELLED",
      ),
    ).toHaveLength(1);
    postMessage.mockRestore();
  });
});
