// @vitest-environment-options { "url": "https://frankfurtschool.instructure.com/courses" }
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEV_CHANNEL,
  DEV_CONTROLLER_SOURCE,
  DEV_RELAY_SOURCE,
  DEV_RESULT_ATTRIBUTE,
  DEV_RUNNER_SOURCE,
  serializeDevResult,
  type DevResult,
} from "../../src/dev/protocol";

const sendMessage = vi.fn();

const runCommand = {
  channel: DEV_CHANNEL,
  type: "RUN_LIVE_SMOKE_TEST",
  runId: "run-live-12345678",
} as const;

const passingResult: DevResult = {
  channel: DEV_CHANNEL,
  type: "LIVE_SMOKE_RESULT",
  runId: runCommand.runId,
  outcome: "pass",
  failure: "none",
  session: "available",
  courses: "available",
  modules: "page-and-file",
  page: "available",
  file: "available",
  contentType: "pdf",
  redirect: "same-origin-https",
};

const failureResult = (
  runId: string,
  failure: "safety" | "busy" | "timeout",
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

function dispatchController(
  payload: unknown,
  options: {
    origin?: string;
    source?: MessageEventSource | null;
    envelopeSource?: string;
  } = {},
): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: options.origin ?? location.origin,
      source: options.source === undefined ? window : options.source,
      data: {
        source: options.envelopeSource ?? DEV_CONTROLLER_SOURCE,
        payload,
      },
    }),
  );
}

function dispatchRunner(
  payload: unknown,
  envelopeSource: string = DEV_RUNNER_SOURCE,
) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: location.origin,
      source: window,
      data: { source: envelopeSource, payload },
    }),
  );
}

function marker(): string | null {
  return document.documentElement.getAttribute(DEV_RESULT_ATTRIBUTE);
}

beforeAll(async () => {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "gradpack-extension",
      onMessage: { addListener: vi.fn() },
      sendMessage,
    },
  });
  await import("../../src/dev/relay");
});

beforeEach(() => {
  vi.useRealTimers();
  sendMessage.mockReset().mockResolvedValue({ ok: true });
  document.documentElement.removeAttribute(DEV_RESULT_ATTRIBUTE);
  document.documentElement.removeAttribute("data-preserve-me");
});

describe("development Canvas relay", () => {
  it("ignores wrong-origin, foreign-window, wrong-source, and malformed commands", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);

    dispatchController(runCommand, { origin: "https://evil.test" });
    dispatchController(runCommand, { source: iframe.contentWindow });
    dispatchController(runCommand, { envelopeSource: "gradpack-dev-foreign" });
    dispatchController({ ...runCommand, body: "sensitive" });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(marker()).toBeNull();
    iframe.remove();
  });

  it("clears only the fixed result attribute", () => {
    document.documentElement.setAttribute(DEV_RESULT_ATTRIBUTE, "old-result");
    document.documentElement.setAttribute("data-preserve-me", "keep");

    dispatchController({
      channel: DEV_CHANNEL,
      type: "CLEAR_LIVE_TEST_RESULT",
      runId: "run-clear-12345678",
    });

    expect(marker()).toBeNull();
    expect(document.documentElement.getAttribute("data-preserve-me")).toBe(
      "keep",
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("forwards reload as the matching closed runtime command", async () => {
    const command = {
      channel: DEV_CHANNEL,
      type: "RELOAD_DEV_EXTENSION",
      runId: "run-reload-12345678",
    } as const;

    dispatchController(command);

    expect(sendMessage).toHaveBeenCalledWith(command);
    await Promise.resolve();
  });

  it("ensures the runner before forwarding a validated run command", async () => {
    let resolveEnsure!: (value: { ok: true }) => void;
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveEnsure = resolve;
      }),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});

    dispatchController(runCommand);

    expect(sendMessage).toHaveBeenCalledWith({
      channel: DEV_CHANNEL,
      type: "ENSURE_DEV_RUNNER",
      runId: runCommand.runId,
    });
    expect(postMessage).not.toHaveBeenCalled();

    resolveEnsure({ ok: true });
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { source: DEV_RELAY_SOURCE, payload: runCommand },
        location.origin,
      );
    });

    dispatchRunner(passingResult);
    postMessage.mockRestore();
  });

  it.each([
    {
      name: "malformed",
      arrange: () =>
        sendMessage.mockResolvedValue({ ok: true, detail: "secret" }),
    },
    {
      name: "rejected",
      arrange: () =>
        sendMessage.mockRejectedValue(new Error("sensitive setup detail")),
    },
  ])(
    "writes a fixed safety result for a $name ensure response",
    async ({ arrange }) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      arrange();

      dispatchController(runCommand);

      await vi.waitFor(() => {
        expect(marker()).toBe(
          serializeDevResult(failureResult(runCommand.runId, "safety")),
        );
      });
      expect(marker()).not.toContain("secret");
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();
      consoleError.mockRestore();
      consoleLog.mockRestore();
    },
  );

  it("times out runner setup after 2,000 milliseconds and releases the run", async () => {
    vi.useFakeTimers();
    sendMessage.mockReturnValueOnce(new Promise(() => {}));

    dispatchController(runCommand);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(marker()).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(marker()).toBe(
      serializeDevResult(failureResult(runCommand.runId, "timeout")),
    );

    const nextRun = { ...runCommand, runId: "run-live-87654321" };
    sendMessage.mockResolvedValueOnce({ ok: true });
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    dispatchController(nextRun);
    await vi.runAllTimersAsync();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenCalledWith(
      { source: DEV_RELAY_SOURCE, payload: nextRun },
      location.origin,
    );
    dispatchRunner({ ...passingResult, runId: nextRun.runId });
    postMessage.mockRestore();
  });

  it("keeps the original run pending when a second run is rejected as busy", async () => {
    let resolveEnsure!: (value: { ok: true }) => void;
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveEnsure = resolve;
      }),
    );
    const secondRun = { ...runCommand, runId: "run-live-87654321" };
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});

    dispatchController(runCommand);
    dispatchController(secondRun);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(marker()).toBe(
      serializeDevResult(failureResult(secondRun.runId, "busy")),
    );

    resolveEnsure({ ok: true });
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { source: DEV_RELAY_SOURCE, payload: runCommand },
        location.origin,
      );
    });
    dispatchRunner(passingResult);
    postMessage.mockRestore();
  });

  it("ignores parsed runner results when no run is pending", () => {
    document.documentElement.setAttribute(DEV_RESULT_ATTRIBUTE, "preserved");

    dispatchRunner({ ...passingResult, detail: "sensitive" });
    dispatchRunner(passingResult, "gradpack-dev-foreign");
    dispatchRunner(passingResult);

    expect(marker()).toBe("preserved");
  });

  it("terminalizes a mismatched result for the active run and accepts the next run", async () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    dispatchController(runCommand);
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { source: DEV_RELAY_SOURCE, payload: runCommand },
        location.origin,
      );
    });

    dispatchRunner({ ...passingResult, runId: "run-stale-12345678" });
    const mismatchedMarker = marker();

    const secondRun = { ...runCommand, runId: "run-live-87654321" };
    dispatchController(secondRun);
    await Promise.resolve();
    const acceptedNextRun = sendMessage.mock.calls.length === 2;
    if (acceptedNextRun) {
      await vi.waitFor(() => {
        expect(postMessage).toHaveBeenCalledWith(
          { source: DEV_RELAY_SOURCE, payload: secondRun },
          location.origin,
        );
      });
      dispatchRunner({ ...passingResult, runId: secondRun.runId });
    } else {
      dispatchRunner(passingResult);
    }
    postMessage.mockRestore();

    expect(mismatchedMarker).toBe(
      serializeDevResult(failureResult(runCommand.runId, "safety")),
    );
    expect(acceptedNextRun).toBe(true);
  });

  it("ignores even a matching result while runner setup is pending", async () => {
    let resolveEnsure!: (value: { ok: true }) => void;
    sendMessage.mockReturnValue(
      new Promise((resolve) => {
        resolveEnsure = resolve;
      }),
    );
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});

    dispatchController(runCommand);
    dispatchRunner(passingResult);
    expect(marker()).toBeNull();

    const secondRun = { ...runCommand, runId: "run-live-87654321" };
    dispatchController(secondRun);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(marker()).toBe(
      serializeDevResult(failureResult(secondRun.runId, "busy")),
    );

    resolveEnsure({ ok: true });
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { source: DEV_RELAY_SOURCE, payload: runCommand },
        location.origin,
      );
    });
    dispatchRunner(passingResult);
    postMessage.mockRestore();
  });

  it("accepts a matching result only after setup and clears the active run", async () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    dispatchController(runCommand);
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { source: DEV_RELAY_SOURCE, payload: runCommand },
        location.origin,
      );
    });

    dispatchRunner(passingResult);
    expect(marker()).toBe(serializeDevResult(passingResult));

    const nextRun = { ...runCommand, runId: "run-live-87654321" };
    dispatchController(nextRun);
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(postMessage).toHaveBeenCalledWith(
        { source: DEV_RELAY_SOURCE, payload: nextRun },
        location.origin,
      );
    });
    dispatchRunner({ ...passingResult, runId: nextRun.runId });
    postMessage.mockRestore();
  });

  it("terminalizes a synchronous ensure throw and accepts the next run", async () => {
    sendMessage
      .mockImplementationOnce(() => {
        throw new Error("sensitive invalidated extension detail");
      })
      .mockResolvedValueOnce({ ok: true });
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});

    dispatchController(runCommand);
    const thrownMarker = marker();

    const nextRun = { ...runCommand, runId: "run-live-87654321" };
    dispatchController(nextRun);
    await Promise.resolve();
    const acceptedNextRun = sendMessage.mock.calls.length === 2;
    if (acceptedNextRun) {
      await vi.waitFor(() => {
        expect(postMessage).toHaveBeenCalledWith(
          { source: DEV_RELAY_SOURCE, payload: nextRun },
          location.origin,
        );
      });
      dispatchRunner({ ...passingResult, runId: nextRun.runId });
    }
    postMessage.mockRestore();

    expect(thrownMarker).toBe(
      serializeDevResult(failureResult(runCommand.runId, "safety")),
    );
    expect(thrownMarker).not.toContain("invalidated extension detail");
    expect(acceptedNextRun).toBe(true);
  });
});
