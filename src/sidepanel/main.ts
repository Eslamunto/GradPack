import { EXTENSION_CHANNEL } from "../shared/constants";
import { parseRunnerEvent } from "../shared/messages";
import type { CourseSummary } from "../shared/model";

const appElement = document.querySelector<HTMLElement>("#app");
if (!appElement) throw new Error("GradPack root is missing");
const app: HTMLElement = appElement;

let activeRunId = "";
let activeTabId: number | null = null;

function renderCourseChoices(courses: CourseSummary[]): void {
  app.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = "Choose one course";
  app.append(heading);
  for (const course of courses) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "course";
    radio.value = String(course.id);
    label.append(radio, document.createTextNode(course.name));
    app.append(label);
  }
}

function renderBlocked(message: string): void {
  app.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = "GradPack stopped";
  const detail = document.createElement("p");
  detail.textContent = message;
  app.append(heading, detail);
}

async function connect(): Promise<void> {
  activeRunId = `run-${crypto.randomUUID()}`;
  try {
    const result = await chrome.runtime.sendMessage<
      string,
      { tabId: number } | { error: string }
    >("GRADPACK_ENSURE_RUNNER");
    if ("error" in result) {
      renderBlocked(result.error);
      return;
    }
    activeTabId = result.tabId;
    await chrome.tabs.sendMessage(activeTabId, {
      channel: EXTENSION_CHANNEL,
      type: "LIST_COURSES",
      runId: activeRunId,
    });
  } catch {
    renderBlocked("Open a signed-in Frankfurt School Canvas tab.");
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (sender.id !== chrome.runtime.id || sender.tab?.id !== activeTabId) {
    return;
  }
  try {
    const event = parseRunnerEvent(raw);
    if (event.runId !== activeRunId) return;
    if (event.type === "COURSES") renderCourseChoices(event.courses);
    if (event.type === "FAILED") renderBlocked(event.message);
  } catch {
    // Invalid runtime messages are ignored without retaining their payloads.
  }
});

app.innerHTML =
  "<h1>GradPack</h1><p>Connecting to the active Frankfurt School Canvas tab…</p>";
void connect();
