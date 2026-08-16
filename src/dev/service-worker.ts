import "../service-worker";
import { parseDevRuntimeCommand } from "./protocol";

const CANVAS_ORIGIN = "https://frankfurtschool.instructure.com";

const senderCanvasTabId = (
  sender: chrome.runtime.MessageSender,
): number | null => {
  if (sender.id !== chrome.runtime.id) return null;
  const tabId = sender.tab?.id;
  const tabUrl = sender.tab?.url;
  if (
    typeof tabId !== "number" ||
    !Number.isInteger(tabId) ||
    tabId < 0 ||
    typeof tabUrl !== "string"
  ) {
    return null;
  }
  try {
    return new URL(tabUrl).origin === CANVAS_ORIGIN ? tabId : null;
  } catch {
    return null;
  }
};

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  try {
    const command = parseDevRuntimeCommand(raw);
    const tabId = senderCanvasTabId(sender);
    if (tabId === null) return;

    if (command.type === "RELOAD_DEV_EXTENSION") {
      sendResponse({ ok: true });
      setTimeout(() => chrome.runtime.reload(), 0);
      return true;
    }

    void chrome.scripting
      .executeScript({
        target: { tabId },
        files: ["runner.js"],
        world: "MAIN",
      })
      .then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false }),
      );
    return true;
  } catch {
    // Invalid runtime messages are ignored without retaining their payloads.
  }
});
