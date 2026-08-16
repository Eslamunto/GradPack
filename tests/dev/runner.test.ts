import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEV_CHANNEL,
  DEV_RELAY_SOURCE,
  DEV_RUNNER_SOURCE,
  type DevResult,
} from "../../src/dev/protocol";

const runnerMocks = vi.hoisted(() => ({
  runLiveSmokeTest: vi.fn(),
}));

vi.mock("../../src/dev/live-smoke", () => ({
  runLiveSmokeTest: runnerMocks.runLiveSmokeTest,
}));

const passingResult = (runId: string): DevResult => ({
  channel: DEV_CHANNEL,
  type: "LIVE_SMOKE_RESULT",
  runId,
  outcome: "pass",
  failure: "none",
  session: "available",
  courses: "available",
  modules: "page-and-file",
  page: "available",
  file: "available",
  contentType: "pdf",
  redirect: "same-origin-https",
});

const fixedFailure = (
  runId: string,
  failure: "busy" | "timeout" | "safety",
): DevResult => ({
  channel: DEV_CHANNEL,
  type: "LIVE_SMOKE_RESULT",
  runId,
  outcome: "fail",
  failure,
  session: "unavailable",
  courses: "unavailable",
  modules: "not-run",
  page: "not-run",
  file: "not-run",
  contentType: "none",
  redirect: "none",
});

function command(runId: string, type = "RUN_LIVE_SMOKE_TEST") {
  return { channel: DEV_CHANNEL, type, runId };
}

function dispatch(
  payload: unknown,
  origin = location.origin,
  source: MessageEventSource | null = window,
  envelopeSource: string = DEV_RELAY_SOURCE,
): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      source,
      origin,
      data: { source: envelopeSource, payload },
    }),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeAll(async () => {
  delete (window as unknown as Window & Record<string, unknown>)
    .__gradPackDevRunnerV1;
  await import("../../src/dev/runner");
});

beforeEach(() => {
  vi.useRealTimers();
  runnerMocks.runLiveSmokeTest.mockReset();
});

describe("development live-smoke runner", () => {
  it("accepts only exact-origin, same-window run envelopes", async () => {
    runnerMocks.runLiveSmokeTest.mockResolvedValue(
      passingResult("run-valid-12345678"),
    );
    const iframe = document.createElement("iframe");
    document.body.append(iframe);

    dispatch(command("run-origin-12345678"), "https://synthetic.invalid");
    dispatch(
      command("run-window-12345678"),
      location.origin,
      iframe.contentWindow,
    );
    dispatch(command("run-source-12345678"), location.origin, window, "wrong");
    dispatch(command("run-reload-12345678", "RELOAD_DEV_EXTENSION"));
    dispatch(command("run-invalid-12345678", "UNKNOWN"));
    dispatch(command("run-valid-12345678"));

    await vi.waitFor(() => {
      expect(runnerMocks.runLiveSmokeTest).toHaveBeenCalledOnce();
      expect(runnerMocks.runLiveSmokeTest).toHaveBeenCalledWith(
        "run-valid-12345678",
        { signal: expect.any(AbortSignal) },
      );
    });
    iframe.remove();
  });

  it("allows only one active run and posts a correlated fixed busy result", async () => {
    const first = deferred<DevResult>();
    runnerMocks.runLiveSmokeTest.mockReturnValue(first.promise);
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});

    dispatch(command("run-first-12345678"));
    dispatch(command("run-second-12345678"));

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: DEV_RUNNER_SOURCE,
          payload: fixedFailure("run-second-12345678", "busy"),
        },
        location.origin,
      );
    });
    expect(runnerMocks.runLiveSmokeTest).toHaveBeenCalledOnce();

    first.resolve(passingResult("run-first-12345678"));
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: DEV_RUNNER_SOURCE,
          payload: passingResult("run-first-12345678"),
        },
        location.origin,
      );
    });
    postMessage.mockRestore();
  });

  it("aborts at 30 seconds, releases the run, and rejects its stale result", async () => {
    vi.useFakeTimers();
    const first = deferred<DevResult>();
    const second = deferred<DevResult>();
    runnerMocks.runLiveSmokeTest
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});

    dispatch(command("run-timeout-12345678"));
    const firstSignal = runnerMocks.runLiveSmokeTest.mock.calls[0]?.[1]?.signal;
    expect(firstSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(firstSignal?.aborted).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      {
        source: DEV_RUNNER_SOURCE,
        payload: fixedFailure("run-timeout-12345678", "timeout"),
      },
      location.origin,
    );

    dispatch(command("run-next-12345678"));
    expect(runnerMocks.runLiveSmokeTest).toHaveBeenCalledTimes(2);
    second.resolve(passingResult("run-next-12345678"));
    await flush();
    first.resolve(passingResult("run-timeout-12345678"));
    await flush();

    expect(postMessage).toHaveBeenCalledWith(
      {
        source: DEV_RUNNER_SOURCE,
        payload: passingResult("run-next-12345678"),
      },
      location.origin,
    );
    expect(postMessage).not.toHaveBeenCalledWith(
      {
        source: DEV_RUNNER_SOURCE,
        payload: passingResult("run-timeout-12345678"),
      },
      location.origin,
    );
    postMessage.mockRestore();
  });

  it("terminalizes an uncorrelated result for the active run and permits the next run", async () => {
    runnerMocks.runLiveSmokeTest
      .mockResolvedValueOnce(passingResult("run-stale-12345678"))
      .mockResolvedValueOnce(passingResult("run-next2-12345678"));
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});

    dispatch(command("run-active-12345678"));
    await flush();
    expect(postMessage).toHaveBeenCalledWith(
      {
        source: DEV_RUNNER_SOURCE,
        payload: fixedFailure("run-active-12345678", "safety"),
      },
      location.origin,
    );

    dispatch(command("run-next2-12345678"));
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: DEV_RUNNER_SOURCE,
          payload: passingResult("run-next2-12345678"),
        },
        location.origin,
      );
    });
    postMessage.mockRestore();
  });

  it("converts only runner exceptions into a parsed fixed safety result", async () => {
    runnerMocks.runLiveSmokeTest.mockRejectedValue(
      new Error("synthetic private exception"),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});

    dispatch(command("run-error-12345678"));

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: DEV_RUNNER_SOURCE,
          payload: fixedFailure("run-error-12345678", "safety"),
        },
        location.origin,
      );
    });
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain(
      "synthetic private exception",
    );
    postMessage.mockRestore();
  });

  it("clears the timeout after a terminal result", async () => {
    vi.useFakeTimers();
    runnerMocks.runLiveSmokeTest.mockResolvedValue(
      passingResult("run-timer-12345678"),
    );

    dispatch(command("run-timer-12345678"));
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("is idempotent when the packaged runner is injected again", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const before = addEventListener.mock.calls.filter(
      ([type]) => type === "message",
    ).length;

    vi.resetModules();
    await import("../../src/dev/runner");

    const after = addEventListener.mock.calls.filter(
      ([type]) => type === "message",
    ).length;
    expect(after).toBe(before);
    addEventListener.mockRestore();
  });
});
