import { parseExtensionCommand, parseRunnerEvent } from "../shared/messages";

chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  try {
    const command = parseExtensionCommand(raw);
    window.postMessage(
      { source: "gradpack-relay", payload: command },
      location.origin,
    );
  } catch {
    // Invalid extension messages are ignored without retaining their payloads.
  }
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (typeof event.data !== "object" || event.data === null) return;
  const envelope = event.data as { source?: unknown; payload?: unknown };
  if (envelope.source !== "gradpack-runner") return;
  try {
    void chrome.runtime
      .sendMessage(parseRunnerEvent(envelope.payload))
      .catch(() => {});
  } catch {
    // Invalid page messages are ignored without retaining their payloads.
  }
});
