import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_CHANNEL, RUNNER_CHANNEL } from "../../src/shared/constants";

type RuntimeListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0];

let runtimeListener: RuntimeListener;
const sendMessage = vi.fn().mockResolvedValue(undefined);

beforeAll(async () => {
  const addListener = vi.fn((listener: RuntimeListener) => {
    runtimeListener = listener;
  });
  vi.stubGlobal("chrome", {
    runtime: {
      id: "gradpack-extension",
      onMessage: { addListener },
      sendMessage,
    },
  });
  await import("../../src/content/relay");
});

beforeEach(() => {
  sendMessage.mockClear();
});

describe("isolated relay", () => {
  it("forwards only parsed extension-origin commands to the page", () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => {});
    const command = {
      channel: EXTENSION_CHANNEL,
      type: "LIST_COURSES",
      runId: "run-12345678",
    } as const;

    runtimeListener(command, { id: "gradpack-extension" }, vi.fn());
    expect(postMessage).toHaveBeenCalledWith(
      { source: "gradpack-relay", payload: command },
      location.origin,
    );

    postMessage.mockClear();
    runtimeListener(command, { id: "another-extension" }, vi.fn());
    expect(postMessage).not.toHaveBeenCalled();

    expect(() =>
      runtimeListener(
        { ...command, url: "https://evil.test" },
        { id: "gradpack-extension" },
        vi.fn(),
      ),
    ).not.toThrow();
    expect(postMessage).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });

  it("forwards only exact same-window and same-origin runner events", () => {
    const payload = {
      channel: RUNNER_CHANNEL,
      type: "COURSES",
      runId: "run-12345678",
      courses: [],
    } as const;

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: location.origin,
        data: { source: "gradpack-runner", payload },
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(payload);

    sendMessage.mockClear();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: "https://evil.test",
        data: { source: "gradpack-runner", payload },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: location.origin,
        data: {
          source: "gradpack-runner",
          payload: { ...payload, body: "secret" },
        },
      }),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ignores a runner event from a foreign window source", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const payload = {
      channel: RUNNER_CHANNEL,
      type: "COURSES",
      runId: "run-12345678",
      courses: [],
    } as const;

    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        origin: location.origin,
        data: { source: "gradpack-runner", payload },
      }),
    );

    expect(sendMessage).not.toHaveBeenCalled();
    iframe.remove();
  });

  it("handles runtime delivery rejection without throwing or logging payloads", async () => {
    const delivery = Promise.reject(new Error("message port closed"));
    void delivery.catch(() => undefined);
    const rejectionHandler = vi.spyOn(delivery, "catch");
    sendMessage.mockReturnValueOnce(delivery);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const payload = {
      channel: RUNNER_CHANNEL,
      type: "COURSES",
      runId: "run-12345678",
      courses: [],
    } as const;

    expect(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          origin: location.origin,
          data: { source: "gradpack-runner", payload },
        }),
      ),
    ).not.toThrow();
    await Promise.resolve();

    expect(rejectionHandler).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });
});
