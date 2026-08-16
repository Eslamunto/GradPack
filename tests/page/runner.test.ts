import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasSessionError } from "../../src/canvas/http";
import { RunSafetyError } from "../../src/page/run-course";
import { EXTENSION_CHANNEL, RUNNER_CHANNEL } from "../../src/shared/constants";
import { syntheticCourse } from "../fixtures/course-plan";

const mocks = vi.hoisted(() => ({
  assertCurrentUser: vi.fn(),
  listAccessibleCourses: vi.fn(),
  runCourse: vi.fn(),
  http: {},
  signals: [] as AbortSignal[],
}));

vi.mock("../../src/canvas/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/canvas/http")>()),
  CanvasHttp: vi.fn(function CanvasHttp(
    _fetcher: typeof fetch,
    signal?: AbortSignal,
  ) {
    if (signal) mocks.signals.push(signal);
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
  mocks.signals.length = 0;
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
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await Promise.resolve();
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
    start("run-overlap06");
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
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    postMessage.mockRestore();
  });

  it("lets a fresh list replace an unused prior list and terminalizes the stale owner", async () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-unused001");
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.some(
          ([value]) =>
            eventType(value) === "COURSES" &&
            (value as { payload?: { runId?: unknown } }).payload?.runId ===
              "run-unused001",
        ),
      ).toBe(true),
    );
    list("run-fresh0001");
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.some(
          ([value]) =>
            eventType(value) === "COURSES" &&
            (value as { payload?: { runId?: unknown } }).payload?.runId ===
              "run-fresh0001",
        ),
      ).toBe(true),
    );
    const calls = postMessage.mock.calls.length;
    start("run-unused001");
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledTimes(calls);
    expect(mocks.runCourse).not.toHaveBeenCalled();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
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

  it("consumes list ownership once and ignores duplicate or late commands for the same run", async () => {
    let finish!: (value: unknown) => void;
    mocks.runCourse.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-single001");
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.some(
          ([value]) =>
            eventType(value) === "COURSES" &&
            (value as { payload?: { runId?: unknown } }).payload?.runId ===
              "run-single001",
        ),
      ).toBe(true),
    );
    list("run-single001");
    start("run-single001");
    start("run-single001");
    await vi.waitFor(() => expect(mocks.runCourse).toHaveBeenCalledOnce());
    expect(
      postMessage.mock.calls.filter(
        ([value]) =>
          (value as { payload?: { runId?: unknown; type?: unknown } }).payload
            ?.runId === "run-single001" && eventType(value) === "FAILED",
      ),
    ).toHaveLength(0);
    finish({
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
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.filter(
          ([value]) => eventType(value) === "COMPLETE",
        ),
      ).toHaveLength(1),
    );
    const calls = postMessage.mock.calls.length;
    start("run-single001");
    cancel("run-single001");
    list("run-single001");
    await Promise.resolve();
    expect(mocks.runCourse).toHaveBeenCalledOnce();
    expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledTimes(calls);
    postMessage.mockRestore();
  });

  it("preserves cancellation as the first terminal cause when navigation follows", async () => {
    mocks.runCourse.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-cause0001");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-cause0001");
    await vi.waitFor(() => expect(mocks.runCourse).toHaveBeenCalledOnce());
    cancel("run-cause0001");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "gradpack-runner",
          payload: {
            channel: RUNNER_CHANNEL,
            type: "CANCELLED",
            runId: "run-cause0001",
            message: "Packing was cancelled.",
          },
        },
        location.origin,
      ),
    );
    postMessage.mockRestore();
  });

  it("preserves an internal run failure when cancellation arrives during sibling cleanup", async () => {
    let internalStarted!: () => void;
    const started = new Promise<void>((resolve) => (internalStarted = resolve));
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => (finishCleanup = resolve));
    mocks.runCourse.mockImplementationOnce(async () => {
      const cause = new RunSafetyError("private safety cause");
      internalStarted();
      await cleanup;
      throw cause;
    });
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-cause0002");
    await vi.waitFor(() =>
      expect(mocks.listAccessibleCourses).toHaveBeenCalledOnce(),
    );
    start("run-cause0002");
    await started;
    cancel("run-cause0002");
    finishCleanup();
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "gradpack-runner",
          payload: {
            channel: RUNNER_CHANNEL,
            type: "FAILED",
            runId: "run-cause0002",
            message: "GradPack stopped because a safety check failed.",
          },
        },
        location.origin,
      ),
    );
    postMessage.mockRestore();
  });

  it("aborts and awaits a course listing on navigation before releasing ownership", async () => {
    mocks.listAccessibleCourses.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          const signal = mocks.signals[0]!;
          if (signal.aborted)
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new DOMException("aborted", "AbortError"),
            );
          else
            signal.addEventListener(
              "abort",
              () =>
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new DOMException("aborted", "AbortError"),
                ),
              { once: true },
            );
        }),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    list("run-listnav01");
    await vi.waitFor(() => expect(mocks.signals).toHaveLength(1));
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "gradpack-runner",
          payload: {
            channel: RUNNER_CHANNEL,
            type: "CANCELLED",
            runId: "run-listnav01",
            message:
              "The Canvas tab navigated or closed. Reopen it and try again.",
          },
        },
        location.origin,
      ),
    );
    postMessage.mockRestore();
  });
});
