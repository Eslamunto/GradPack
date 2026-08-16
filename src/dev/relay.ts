import "../content/relay";
import {
  DEV_CHANNEL,
  DEV_CONTROLLER_SOURCE,
  DEV_RELAY_SOURCE,
  DEV_RESULT_ATTRIBUTE,
  DEV_RUNNER_SOURCE,
  parseDevCommand,
  parseDevResult,
  serializeDevResult,
  type DevCommand,
  type DevResult,
  type DevRuntimeCommand,
} from "./protocol";

const CANVAS_ORIGIN = "https://frankfurtschool.instructure.com";
const RUNNER_SETUP_TIMEOUT_MS = 2_000;

type RunState =
  | { phase: "idle" }
  | { phase: "ensuring"; runId: string }
  | { phase: "running"; runId: string };

let runState: RunState = { phase: "idle" };

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

const setResult = (result: DevResult): void => {
  document.documentElement.setAttribute(
    DEV_RESULT_ATTRIBUTE,
    serializeDevResult(result),
  );
};

const isSuccessfulResponse = (value: unknown): value is { ok: true } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === 1 && keys[0] === "ok" && Reflect.get(value, "ok") === true
  );
};

const ensureRunner = (command: DevCommand): void => {
  const { runId } = command;
  const runtimeCommand: DevRuntimeCommand = {
    channel: DEV_CHANNEL,
    type: "ENSURE_DEV_RUNNER",
    runId,
  };
  let timeout: ReturnType<typeof setTimeout>;
  const setup = chrome.runtime.sendMessage(runtimeCommand).then(
    (response: unknown) =>
      isSuccessfulResponse(response) ? "ready" : "safety",
    () => "safety" as const,
  );
  const deadline = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), RUNNER_SETUP_TIMEOUT_MS);
  });

  void Promise.race([setup, deadline]).then((result) => {
    clearTimeout(timeout);
    if (runState.phase !== "ensuring" || runState.runId !== runId) return;
    if (result === "ready") {
      runState = { phase: "running", runId };
      window.postMessage(
        { source: DEV_RELAY_SOURCE, payload: command },
        location.origin,
      );
      return;
    }
    runState = { phase: "idle" };
    setResult(failureResult(runId, result));
  });
};

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== CANVAS_ORIGIN) return;
  if (typeof event.data !== "object" || event.data === null) return;
  const envelope = event.data as { source?: unknown; payload?: unknown };
  if (envelope.source !== DEV_CONTROLLER_SOURCE) return;

  try {
    const command = parseDevCommand(envelope.payload);
    if (command.type === "CLEAR_LIVE_TEST_RESULT") {
      document.documentElement.removeAttribute(DEV_RESULT_ATTRIBUTE);
      return;
    }
    if (command.type === "RELOAD_DEV_EXTENSION") {
      const runtimeCommand: DevRuntimeCommand = {
        channel: DEV_CHANNEL,
        type: "RELOAD_DEV_EXTENSION",
        runId: command.runId,
      };
      void chrome.runtime.sendMessage(runtimeCommand).catch(() => {});
      return;
    }
    if (runState.phase !== "idle") {
      setResult(failureResult(command.runId, "busy"));
      return;
    }
    runState = { phase: "ensuring", runId: command.runId };
    ensureRunner(command);
  } catch {
    // Invalid controller messages are ignored without retaining their payloads.
  }
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== CANVAS_ORIGIN) return;
  if (typeof event.data !== "object" || event.data === null) return;
  const envelope = event.data as { source?: unknown; payload?: unknown };
  if (envelope.source !== DEV_RUNNER_SOURCE) return;

  try {
    const result = parseDevResult(envelope.payload);
    if (runState.phase !== "running" || runState.runId !== result.runId) {
      return;
    }
    setResult(result);
    runState = { phase: "idle" };
  } catch {
    // Invalid runner messages are ignored without retaining their payloads.
  }
});
