import { EXTENSION_CHANNEL } from "../shared/constants";
import {
  parseExtensionCommand,
  parseRunnerEvent,
  RUNNER_TERMINAL_MESSAGES,
} from "../shared/messages";
import type {
  AggregateProgress,
  CourseSummary,
  PackagingMode,
} from "../shared/model";
import {
  coursesForState,
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
let lastProgressTotal: number | null = null;

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
    "Select one or more courses. Combined archives fall back to separate ZIPs when the 250 MB or resource safety limit would be exceeded.",
    "Everything is processed locally. GradPack has no storage, analytics, or backend.",
    "Keep this Canvas tab open and signed in until the ZIP downloads finish.",
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

const progressText = (progress: AggregateProgress): string =>
  `${progress.stage}: course ${progress.currentCourseIndex + 1} of ${progress.totalCourses}; ${progress.completed} of ${progress.total}; ${progress.failed} failed`;

const packagingLabel = (packaging: PackagingMode): string =>
  packaging === "combined" ? "one combined ZIP" : "one ZIP per course";

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
    heading.textContent = "Choose courses";
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = "Accessible courses";
    fieldset.append(legend);
    for (const course of state.courses) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "course";
      checkbox.value = String(course.id);
      checkbox.checked = state.selectedIds.includes(course.id);
      checkbox.addEventListener("change", () =>
        update({ type: "SELECT", courseId: course.id }),
      );
      label.append(checkbox, document.createTextNode(courseLabel(course)));
      fieldset.append(label);
    }
    body.append(
      paragraph("Select one or more accessible courses."),
      fieldset,
      button("Continue", () => update({ type: "CONFIGURE" }), {
        disabled: state.selectedIds.length === 0,
      }),
    );
  } else if (state.name === "configure") {
    heading.textContent = "Configure archives";
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = "Packaging";
    fieldset.append(legend);
    for (const [value, labelText] of [
      ["per-course", "One ZIP per course"],
      ["combined", "One combined ZIP"],
    ] as const) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "packaging";
      radio.value = value;
      radio.checked = state.packaging === value;
      radio.disabled = state.busy || cancelRequested;
      radio.addEventListener("change", () =>
        update({ type: "SET_PACKAGING", packaging: value }),
      );
      label.append(radio, document.createTextNode(labelText));
      fieldset.append(label);
    }
    body.append(
      paragraph(`${state.selectedIds.length} course(s) selected.`),
      fieldset,
      notices(),
      button(
        state.busy ? "Discovering…" : "Discover selected courses",
        () => void startRun(),
        { disabled: state.busy || cancelRequested, busy: state.busy },
      ),
      button(
        cancelRequested ? "Cancelling…" : "Cancel",
        () => void cancelRun(),
        { disabled: cancelRequested, busy: cancelRequested },
      ),
    );
  } else if (state.name === "review") {
    heading.textContent = "Review plan";
    const names = coursesForState(state).map(courseLabel).join("; ");
    body.append(
      paragraph(names, "selected-courses"),
      paragraph(
        `Requested packaging: ${packagingLabel(state.plan.requestedPackaging)}.`,
      ),
      paragraph(
        `Effective packaging: ${packagingLabel(state.plan.effectivePackaging)}.`,
      ),
      paragraph(
        `Advertised material: ${state.plan.advertisedBytes} bytes across ${state.plan.resourceCount} resource(s).`,
      ),
      state.plan.fallbackReason
        ? paragraph(
            "The requested combined archive will fall back to separate course ZIPs because the combined safety limit would be exceeded.",
            "fallback-notice",
          )
        : paragraph("Discovery is complete. Confirm to begin local retrieval."),
      button("Continue to packing", () => void confirmPlan()),
      button(
        cancelRequested ? "Cancelling…" : "Cancel",
        () => void cancelRun(),
        { disabled: cancelRequested, busy: cancelRequested },
      ),
    );
  } else if (state.name === "packing") {
    heading.textContent = "Packing courses";
    const status = paragraph(progressText(state.progress), "progress");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    body.setAttribute("aria-busy", "true");
    body.append(
      status,
      paragraph(`Output: ${packagingLabel(state.packaging)}.`),
      paragraph("Keep the connected Canvas tab open and signed in."),
      button(
        cancelRequested ? "Cancelling…" : "Cancel",
        () => void cancelRun(),
        { disabled: cancelRequested, busy: cancelRequested },
      ),
    );
  } else if (state.name === "complete") {
    heading.textContent = "Archives downloaded";
    body.append(
      paragraph("Your GradPack archives were downloaded."),
      paragraph(
        `${state.outputCount} archive(s) downloaded; ${state.completedCourses} course(s) completed; ${state.failedCourses} course(s) failed.`,
        "archive-summary",
      ),
      paragraph(
        `${state.counts.success} successful; ${state.counts.failed} failed; ${state.counts.unavailable} unavailable; ${state.counts.unsupported} unsupported; ${state.counts.external} external.`,
        "outcome-summary",
      ),
      paragraph(
        "Review manifest.json in each ZIP for the resource outcome list.",
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
  lastProgressTotal = null;
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

async function startRun(): Promise<void> {
  const tabId = activeTabId;
  const runId = activeRunId;
  if (tabId === null || state.name !== "configure" || state.busy) return;
  cancelRequested = false;
  const courseIds = [...state.selectedIds];
  const packaging = state.packaging;
  update({ type: "DISCOVERING" });
  try {
    await chrome.tabs.sendMessage(
      tabId,
      parseExtensionCommand({
        channel: EXTENSION_CHANNEL,
        type: "START_RUN",
        runId,
        courseIds,
        packaging,
      }),
    );
  } catch {
    if (activeRunId === runId && !terminalReceived) {
      terminalReceived = true;
      update({ type: "FAILED", message: RUNNER_TERMINAL_MESSAGES.tab });
    }
  }
}

async function confirmPlan(): Promise<void> {
  const tabId = activeTabId;
  const runId = activeRunId;
  if (tabId === null || state.name !== "review" || cancelRequested) return;
  cancelRequested = false;
  update({ type: "CONFIRM" });
  try {
    await chrome.tabs.sendMessage(
      tabId,
      parseExtensionCommand({
        channel: EXTENSION_CHANNEL,
        type: "CONFIRM_PLAN",
        runId,
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
    terminalReceived ||
    cancelRequested ||
    (state.name !== "configure" &&
      state.name !== "review" &&
      state.name !== "packing")
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
    if (activeRunId === runId && activeTabId === tabId && !terminalReceived) {
      terminalReceived = true;
      update({ type: "FAILED", message: RUNNER_TERMINAL_MESSAGES.tab });
    }
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
  if (event.type === "COURSES") {
    update({ type: "COURSES", courses: event.courses });
  } else if (event.type === "PLAN_READY") {
    lastProgressTotal = event.resourceCount;
    update({ type: "PLAN_READY", plan: event });
  } else if (event.type === "PROGRESS") {
    if (state.name !== "packing") return;
    if (lastProgressTotal !== null && event.total !== lastProgressTotal) return;
    update({ type: "PROGRESS", progress: event });
  } else if (event.type === "COMPLETE") {
    const counts: OutcomeCounts = {
      success: event.success,
      failed: event.failed,
      unavailable: event.unavailable,
      unsupported: event.unsupported,
      external: event.external,
    };
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (lastProgressTotal === null || total !== lastProgressTotal) return;
    const previous = state;
    update({
      type: "COMPLETE",
      packaging: event.packaging,
      completedCourses: event.completedCourses,
      failedCourses: event.failedCourses,
      outputCount: event.outputCount,
      counts,
    });
    terminalReceived = state !== previous;
  } else {
    const previous = state;
    update({ type: "FAILED", message: event.message });
    terminalReceived = state !== previous;
  }
});

const stopForConnectedTab = (tabId: number): void => {
  if (
    activeTabId !== tabId ||
    terminalReceived ||
    state.name === "complete" ||
    state.name === "blocked"
  )
    return;
  terminalReceived = true;
  cancelRequested = false;
  activeTabId = null;
  update({ type: "TAB_LOST", message: RUNNER_TERMINAL_MESSAGES.tab });
};

chrome.tabs.onRemoved.addListener((tabId) => stopForConnectedTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url !== undefined) {
    stopForConnectedTab(tabId);
  }
});

render();
