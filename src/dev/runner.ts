import "../page/runner";
import {
  DEV_CHANNEL,
  DEV_RELAY_SOURCE,
  DEV_RUNNER_SOURCE,
  parseDevCommand,
  parseDevResult,
  type DevResult,
} from "./protocol";
import { runLiveSmokeTest } from "./live-smoke";

const marker = "__gradPackDevRunnerV1";
const RUN_TIMEOUT_MS = 30_000;
const scope = window as unknown as Window & Record<string, unknown>;

type ActiveRun = {
  controller: AbortController;
  runId: string;
  timeout: ReturnType<typeof setTimeout>;
};

let activeRun: ActiveRun | null = null;

const failureResult = (
  runId: string,
  failure: "busy" | "timeout" | "safety",
): DevResult =>
  parseDevResult({
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

const post = (result: DevResult): void => {
  window.postMessage(
    { source: DEV_RUNNER_SOURCE, payload: parseDevResult(result) },
    location.origin,
  );
};

const start = (runId: string): void => {
  if (activeRun) {
    post(failureResult(runId, "busy"));
    return;
  }

  const controller = new AbortController();
  const run = {
    controller,
    runId,
    timeout: setTimeout(() => {
      if (activeRun !== run) return;
      activeRun = null;
      controller.abort();
      post(failureResult(runId, "timeout"));
    }, RUN_TIMEOUT_MS),
  };
  activeRun = run;

  void runLiveSmokeTest(runId, { signal: controller.signal })
    .then(
      (result) => {
        if (activeRun !== run) return;
        let parsed: DevResult;
        try {
          parsed = parseDevResult(result);
        } catch {
          activeRun = null;
          post(failureResult(runId, "safety"));
          return;
        }
        activeRun = null;
        if (parsed.runId !== runId) {
          post(failureResult(runId, "safety"));
          return;
        }
        post(parsed);
      },
      () => {
        if (activeRun !== run) return;
        activeRun = null;
        post(failureResult(runId, "safety"));
      },
    )
    .finally(() => clearTimeout(run.timeout));
};

if (scope[marker] !== true) {
  scope[marker] = true;
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (typeof event.data !== "object" || event.data === null) return;
    const envelope = event.data as { source?: unknown; payload?: unknown };
    if (envelope.source !== DEV_RELAY_SOURCE) return;

    try {
      const command = parseDevCommand(envelope.payload);
      if (command.type !== "RUN_LIVE_SMOKE_TEST") return;
      start(command.runId);
    } catch {
      // Invalid relay messages are ignored without retaining their payloads.
    }
  });
}
