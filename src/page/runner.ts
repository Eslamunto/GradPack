import { CanvasHttp } from "../canvas/http";
import { assertCurrentUser, listAccessibleCourses } from "../canvas/session";
import { RUNNER_CHANNEL } from "../shared/constants";
import { parseExtensionCommand, type RunnerEvent } from "../shared/messages";

const marker = "__gradPackRunnerV1";
const scope = window as unknown as Window & Record<string, unknown>;

function post(event: RunnerEvent): void {
  window.postMessage(
    { source: "gradpack-runner", payload: event },
    location.origin,
  );
}

if (scope[marker] !== true) {
  scope[marker] = true;
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (typeof event.data !== "object" || event.data === null) return;
    const envelope = event.data as { source?: unknown; payload?: unknown };
    if (envelope.source !== "gradpack-relay") return;

    let command;
    try {
      command = parseExtensionCommand(envelope.payload);
    } catch {
      return;
    }
    if (command.type !== "LIST_COURSES") return;

    void (async () => {
      try {
        const http = new CanvasHttp();
        await assertCurrentUser(http);
        const courses = await listAccessibleCourses(http);
        post({
          channel: RUNNER_CHANNEL,
          type: "COURSES",
          runId: command.runId,
          courses,
        });
      } catch {
        post({
          channel: RUNNER_CHANNEL,
          type: "FAILED",
          runId: command.runId,
          message:
            "GradPack could not use the active Canvas session. Sign in and try again.",
        });
      }
    })();
  });
}
