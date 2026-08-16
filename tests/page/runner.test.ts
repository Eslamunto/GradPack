import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_CHANNEL, RUNNER_CHANNEL } from "../../src/shared/constants";

const runnerMocks = vi.hoisted(() => ({
  assertCurrentUser: vi.fn(),
  listAccessibleCourses: vi.fn(),
  http: {},
}));

vi.mock("../../src/canvas/http", () => ({
  CanvasHttp: vi.fn(function CanvasHttp() {
    return runnerMocks.http;
  }),
}));

vi.mock("../../src/canvas/session", () => ({
  assertCurrentUser: runnerMocks.assertCurrentUser,
  listAccessibleCourses: runnerMocks.listAccessibleCourses,
}));

beforeAll(async () => {
  delete (window as unknown as Window & Record<string, unknown>)
    .__gradPackRunnerV1;
  await import("../../src/page/runner");
});

beforeEach(() => {
  runnerMocks.assertCurrentUser.mockReset().mockResolvedValue(undefined);
  runnerMocks.listAccessibleCourses.mockReset().mockResolvedValue([]);
});

function dispatchCommand(
  payload: unknown,
  origin = location.origin,
  source: MessageEventSource | null = window,
): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      source,
      origin,
      data: { source: "gradpack-relay", payload },
    }),
  );
}

describe("page-world course-list runner", () => {
  it("probes the current session and posts discovered courses", async () => {
    const courses = [
      {
        id: 7,
        name: "Economics",
        courseCode: "ECON",
        workflowState: "available",
        concluded: false,
      },
    ];
    runnerMocks.listAccessibleCourses.mockResolvedValue(courses);
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});

    dispatchCommand({
      channel: EXTENSION_CHANNEL,
      type: "LIST_COURSES",
      runId: "run-12345678",
    });

    await vi.waitFor(() => {
      expect(runnerMocks.assertCurrentUser).toHaveBeenCalledWith(
        runnerMocks.http,
      );
      expect(runnerMocks.listAccessibleCourses).toHaveBeenCalledWith(
        runnerMocks.http,
      );
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "gradpack-runner",
          payload: {
            channel: RUNNER_CHANNEL,
            type: "COURSES",
            runId: "run-12345678",
            courses,
          },
        },
        location.origin,
      );
    });
    postMessage.mockRestore();
  });

  it("ignores foreign-origin, unsupported, and inexact commands", () => {
    dispatchCommand(
      {
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId: "run-12345678",
      },
      "https://evil.test",
    );
    dispatchCommand({
      channel: EXTENSION_CHANNEL,
      type: "START_COURSE",
      runId: "run-12345678",
      courseId: 7,
    });
    dispatchCommand({
      channel: EXTENSION_CHANNEL,
      type: "LIST_COURSES",
      runId: "run-12345678",
      url: "https://evil.test",
    });

    expect(runnerMocks.assertCurrentUser).not.toHaveBeenCalled();
    expect(runnerMocks.listAccessibleCourses).not.toHaveBeenCalled();
  });

  it("ignores a command from a foreign window source", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);

    dispatchCommand(
      {
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId: "run-12345678",
      },
      location.origin,
      iframe.contentWindow,
    );

    expect(runnerMocks.assertCurrentUser).not.toHaveBeenCalled();
    expect(runnerMocks.listAccessibleCourses).not.toHaveBeenCalled();
    iframe.remove();
  });

  it("posts only a fixed failure message when the session probe fails", async () => {
    runnerMocks.assertCurrentUser.mockRejectedValue(
      new Error("sensitive detail"),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});

    dispatchCommand({
      channel: EXTENSION_CHANNEL,
      type: "LIST_COURSES",
      runId: "run-abcdefgh",
    });

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "gradpack-runner",
          payload: {
            channel: RUNNER_CHANNEL,
            type: "FAILED",
            runId: "run-abcdefgh",
            message:
              "GradPack could not use the active Canvas session. Sign in and try again.",
          },
        },
        location.origin,
      );
    });
    postMessage.mockRestore();
  });
});
