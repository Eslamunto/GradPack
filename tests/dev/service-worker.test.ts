// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEV_CHANNEL } from "../../src/dev/protocol";

type RuntimeListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0];

const runtimeListeners: RuntimeListener[] = [];
const executeScript = vi.fn();
const reload = vi.fn();
let workerListener: RuntimeListener;

const ensureCommand = {
  channel: DEV_CHANNEL,
  type: "ENSURE_DEV_RUNNER",
  runId: "run-live-12345678",
} as const;

const validSender = {
  id: "gradpack-extension",
  tab: {
    id: 42,
    url: "https://frankfurtschool.instructure.com/courses/7",
  },
} as chrome.runtime.MessageSender;

beforeAll(async () => {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "gradpack-extension",
      onInstalled: { addListener: vi.fn() },
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListeners.push(listener);
        }),
      },
      reload,
    },
    sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(undefined) },
    tabs: { query: vi.fn() },
    scripting: { executeScript },
  });
  await import("../../src/dev/service-worker");
  expect(runtimeListeners).toHaveLength(2);
  workerListener = runtimeListeners[1]!;
});

beforeEach(() => {
  vi.useRealTimers();
  executeScript.mockReset().mockResolvedValue([]);
  reload.mockReset();
});

describe("development service worker", () => {
  it("injects only the packaged main-world runner into the sender tab", async () => {
    const sendResponse = vi.fn();

    const keepAlive = workerListener(ensureCommand, validSender, sendResponse);

    expect(keepAlive).toBe(true);
    await vi.waitFor(() => {
      expect(executeScript).toHaveBeenCalledWith({
        target: { tabId: 42 },
        files: ["runner.js"],
        world: "MAIN",
      });
      expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });
  });

  it("returns only a fixed failure when runner injection rejects", async () => {
    executeScript.mockRejectedValue(new Error("sensitive injection detail"));
    const sendResponse = vi.fn();

    expect(workerListener(ensureCommand, validSender, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false });
    });
  });

  it("acknowledges reload before scheduling extension self-reload", () => {
    vi.useFakeTimers();
    const sendResponse = vi.fn();
    const command = {
      channel: DEV_CHANNEL,
      type: "RELOAD_DEV_EXTENSION",
      runId: "run-reload-12345678",
    } as const;

    const keepAlive = workerListener(command, validSender, sendResponse);

    expect(keepAlive).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(reload).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "malformed command",
      command: { ...ensureCommand, body: "sensitive" },
      sender: validSender,
    },
    {
      name: "wrong-origin sender",
      command: ensureCommand,
      sender: {
        ...validSender,
        tab: { id: 42, url: "https://evil.test/courses/7" },
      },
    },
    {
      name: "extension-page sender",
      command: ensureCommand,
      sender: {
        id: "gradpack-extension",
        url: "chrome-extension://gradpack-extension/sidepanel.html",
      },
    },
    {
      name: "sender without a tab id",
      command: ensureCommand,
      sender: {
        id: "gradpack-extension",
        tab: { url: "https://frankfurtschool.instructure.com/courses/7" },
      },
    },
    {
      name: "wrong-extension sender",
      command: ensureCommand,
      sender: { ...validSender, id: "another-extension" },
    },
  ])("ignores a $name", ({ command, sender }) => {
    const sendResponse = vi.fn();

    const keepAlive = workerListener(
      command,
      sender as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepAlive).toBeUndefined();
    expect(executeScript).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
