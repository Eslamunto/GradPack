import { EXTENSION_CHANNEL } from "../shared/constants";
import {
  parseExtensionCommand,
  parseRunnerEvent,
  RUNNER_TERMINAL_MESSAGES,
} from "../shared/messages";
import type { CourseSummary } from "../shared/model";
import {
  initialState,
  reduceState,
  type OutcomeCounts,
  type UiEvent,
  type ViewState,
} from "./state";

const appElement = document.querySelector<HTMLElement>("#app");
if (!appElement) throw new Error("GradPack root is missing");
const app = appElement;
let state: ViewState = initialState;
let activeRunId = "";
let activeTabId: number | null = null;
let terminalReceived = false;
let cancelRequested = false;

const button = (
  label: string,
  action: () => void,
  options: { disabled?: boolean; busy?: boolean } = {},
): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.disabled = options.disabled === true;
  if (options.busy) element.setAttribute("aria-busy", "true");
  element.addEventListener("click", action);
  return element;
};

const paragraph = (text: string, className?: string): HTMLParagraphElement => {
  const element = document.createElement("p");
  element.textContent = text;
  if (className) element.className = className;
  return element;
};

const courseLabel = (course: CourseSummary): string => {
  const details = [
    course.courseCode,
    course.concluded ? "concluded" : course.workflowState,
  ]
    .filter((value) => value.trim().length > 0)
    .join(" · ");
  return details ? `${course.name} — ${details}` : course.name;
};

const notices = (): HTMLElement => {
  const section = document.createElement("section");
  section.className = "notices";
  const heading = document.createElement("h2");
  heading.textContent = "Before you pack";
  const list = document.createElement("ul");
  for (const text of [
    "Pack one course at a time. Files must have known sizes and the course must fit the 250 MB pilot limit.",
    "Everything is processed locally. GradPack has no storage, analytics, or backend.",
    "Keep this Canvas tab open and signed in until the ZIP download finishes.",
    "Only currently accessible material is retrieved. Some resources may be unavailable, fail, remain external, or be unsupported.",
    "You are responsible for applicable copyright, licensing, confidentiality, and course-material restrictions.",
  ]) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
  section.append(heading, list);
  return section;
};

const progressText = (
  progress: Extract<ViewState, { name: "packing" }>["progress"],
): string =>
  `${progress.stage}: ${progress.completed} of ${progress.total}; ${progress.failed} failed`;

const render = (): void => {
  app.replaceChildren();
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  const body = document.createElement("section");

  if (state.name === "connect") {
    heading.textContent = "Connect to Canvas";
    body.append(
      paragraph(state.message),
      notices(),
      button(state.busy ? "Connecting…" : "Connect", () => void connect(), {
        disabled: state.busy,
        busy: state.busy,
      }),
    );
  } else if (state.name === "choose") {
    heading.textContent = "Choose one course";
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = "Accessible courses";
    fieldset.append(legend);
    for (const course of state.courses) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "course";
      radio.value = String(course.id);
      radio.checked = state.selectedId === course.id;
      radio.addEventListener("change", () =>
        update({ type: "SELECT", courseId: course.id }),
      );
      label.append(radio, document.createTextNode(courseLabel(course)));
      fieldset.append(label);
    }
    body.append(paragraph("Select exactly one accessible course."), fieldset);
  } else if (state.name === "ready") {
    const course = state.course;
    heading.textContent = "Ready to pack";
    body.append(
      paragraph(courseLabel(course), "selected-course"),
      notices(),
      button("Pack this course", () => void startCourse(course.id)),
    );
  } else if (state.name === "packing") {
    heading.textContent = "Packing course";
    const status = paragraph(progressText(state.progress), "progress");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    body.setAttribute("aria-busy", "true");
    body.append(
      status,
      paragraph("Keep the connected Canvas tab open and signed in."),
      button(
        cancelRequested ? "Cancelling…" : "Cancel",
        () => void cancelRun(),
        {
          disabled: cancelRequested,
          busy: cancelRequested,
        },
      ),
    );
  } else if (state.name === "complete") {
    heading.textContent = "Archive downloaded";
    body.append(
      paragraph("Your course ZIP was downloaded."),
      paragraph(
        `${state.counts.success} successful; ${state.counts.failed} failed; ${state.counts.unavailable} unavailable; ${state.counts.unsupported} unsupported; ${state.counts.external} external.`,
        "outcome-summary",
      ),
      paragraph(
        "Review manifest.json in the ZIP for the resource outcome list.",
      ),
      button("Start again", () => void connect()),
    );
  } else {
    heading.textContent = "GradPack stopped";
    body.append(
      paragraph(state.message),
      button("Try again", () => void connect()),
    );
  }
  app.append(heading, body);
  heading.focus();
};

const update = (event: UiEvent): void => {
  const previous = state;
  const next = reduceState(state, event);
  if (next === previous) return;
  state = next;
  if (previous.name === "packing" && next.name === "packing") {
    const status = app.querySelector<HTMLElement>(".progress");
    if (status) {
      status.textContent = progressText(next.progress);
      return;
    }
  }
  render();
};

const exactConnection = (
  value: unknown,
): { tabId: number } | { error: string } => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Invalid connection response");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || typeof keys[0] !== "string")
    throw new TypeError("Invalid connection response");
  const record = value as Record<string, unknown>;
  if (
    keys[0] === "tabId" &&
    Number.isSafeInteger(record.tabId) &&
    Number(record.tabId) >= 0
  )
    return { tabId: Number(record.tabId) };
  if (keys[0] === "error" && typeof record.error === "string")
    return { error: record.error };
  throw new TypeError("Invalid connection response");
};

async function connect(): Promise<void> {
  const runId = `run-${crypto.randomUUID()}`;
  activeRunId = runId;
  activeTabId = null;
  terminalReceived = false;
  cancelRequested = false;
  update({ type: "CONNECTING" });
  try {
    const result = exactConnection(
      await chrome.runtime.sendMessage("GRADPACK_ENSURE_RUNNER"),
    );
    if (activeRunId !== runId) return;
    if ("error" in result) {
      update({ type: "FAILED", message: RUNNER_TERMINAL_MESSAGES.connection });
      return;
    }
    activeTabId = result.tabId;
    await chrome.tabs.sendMessage(
      activeTabId,
      parseExtensionCommand({
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId,
      }),
    );
  } catch {
    if (activeRunId === runId)
      update({ type: "FAILED", message: RUNNER_TERMINAL_MESSAGES.connection });
  }
}

async function startCourse(courseId: number): Promise<void> {
  const tabId = activeTabId;
  const runId = activeRunId;
  if (tabId === null || state.name !== "ready" || state.course.id !== courseId)
    return;
  cancelRequested = false;
  update({
    type: "PROGRESS",
    progress: { stage: "discovery", completed: 0, total: 0, failed: 0 },
  });
  try {
    await chrome.tabs.sendMessage(
      tabId,
      parseExtensionCommand({
        channel: EXTENSION_CHANNEL,
        type: "START_COURSE",
        runId,
        courseId,
      }),
    );
  } catch {
    if (activeRunId === runId && !terminalReceived) {
      terminalReceived = true;
      update({ type: "FAILED", message: RUNNER_TERMINAL_MESSAGES.tab });
    }
  }
}

async function cancelRun(): Promise<void> {
  const tabId = activeTabId;
  const runId = activeRunId;
  if (
    tabId === null ||
    state.name !== "packing" ||
    terminalReceived ||
    cancelRequested
  )
    return;
  cancelRequested = true;
  render();
  try {
    await chrome.tabs.sendMessage(
      tabId,
      parseExtensionCommand({
        channel: EXTENSION_CHANNEL,
        type: "CANCEL",
        runId,
      }),
    );
  } catch {
    terminalReceived = true;
    update({ type: "FAILED", message: RUNNER_TERMINAL_MESSAGES.tab });
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (
    sender.id !== chrome.runtime.id ||
    activeTabId === null ||
    sender.tab?.id !== activeTabId
  )
    return;
  let event;
  try {
    event = parseRunnerEvent(raw);
  } catch {
    return;
  }
  if (event.runId !== activeRunId || terminalReceived) return;
  if (event.type === "COURSES")
    update({ type: "COURSES", courses: event.courses });
  else if (event.type === "PROGRESS")
    update({ type: "PROGRESS", progress: event });
  else if (event.type === "COMPLETE") {
    const previous = state;
    const counts: OutcomeCounts = {
      success: event.success,
      failed: event.failed,
      unavailable: event.unavailable,
      unsupported: event.unsupported,
      external: event.external,
    };
    update({ type: "COMPLETE", counts });
    terminalReceived = state !== previous;
  } else {
    const previous = state;
    update({ type: "FAILED", message: event.message });
    terminalReceived = state !== previous;
  }
});

render();
