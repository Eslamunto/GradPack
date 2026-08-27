import { EXTENSION_CHANNEL } from "../shared/constants";
import {
  parseExtensionCommand,
  parseRunnerEvent,
  RUNNER_TERMINAL_MESSAGES,
} from "../shared/messages";
import type {
  AggregateProgress,
  CoursePlanFailureCategory,
  CourseSummary,
  PackagingMode,
} from "../shared/model";
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

const COURSE_PLAN_FAILURE_MESSAGES: Readonly<
  Record<CoursePlanFailureCategory, string>
> = Object.freeze({
  "size-limit": "This course exceeds the 250 MiB safety limit.",
  "canvas-unavailable": "Canvas did not provide usable course metadata.",
  "safety-validation": "Course metadata did not pass GradPack's safety checks.",
  "unexpected-local": "A local course operation could not be completed.",
});

const courseForId = (
  courses: readonly CourseSummary[],
  courseId: number,
): CourseSummary | undefined =>
  courses.find((course) => course.id === courseId);

const courseList = (
  className: string,
  entries: readonly { course: CourseSummary; detail?: string }[],
): HTMLUListElement => {
  const list = document.createElement("ul");
  list.className = className;
  for (const { course, detail } of entries) {
    const item = document.createElement("li");
    item.textContent = detail
      ? `${courseLabel(course)} — ${detail}`
      : courseLabel(course);
    list.append(item);
  }
  return list;
};

type RenderFocus =
  { type: "course-all" } | { type: "course"; courseId: number } | null;

const render = (focus: RenderFocus = null): void => {
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
    const selectedIds = state.selectedIds;
    const allSelected = state.courses.every((course) =>
      selectedIds.includes(course.id),
    );
    const partiallySelected = state.selectedIds.length > 0 && !allSelected;
    const selectAllLabel = document.createElement("label");
    selectAllLabel.className = "select-all";
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.name = "course-all";
    selectAll.checked = allSelected;
    selectAll.indeterminate = partiallySelected;
    selectAll.addEventListener("change", () => update({ type: "SELECT_ALL" }));
    selectAllLabel.append(
      selectAll,
      document.createTextNode("Select all courses"),
    );
    fieldset.append(selectAllLabel);
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
      paragraph(
        `${state.selectedIds.length} of ${state.courses.length} courses selected.`,
        "selection-count",
      ),
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
    const discoveryStatus = state.busy
      ? paragraph(
          state.discoveryProgress
            ? `Checking course ${state.discoveryProgress.completed} of ${state.discoveryProgress.total}`
            : `Preparing to check ${state.selectedIds.length} course(s)`,
          "discovery-progress",
        )
      : null;
    if (discoveryStatus) {
      discoveryStatus.setAttribute("role", "status");
      discoveryStatus.setAttribute("aria-live", "polite");
    }
    body.append(
      paragraph(`${state.selectedIds.length} course(s) selected.`),
      fieldset,
      notices(),
      ...(discoveryStatus ? [discoveryStatus] : []),
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
    const review = state;
    heading.textContent = "Review plan";
    const readyCourses = review.plan.selected
      .map(({ courseId }) => courseForId(review.courses, courseId))
      .filter((course): course is CourseSummary => course !== undefined);
    const skippedCourses = review.plan.skipped
      .map((failure) => {
        const course = courseForId(review.courses, failure.courseId);
        return course
          ? {
              course,
              detail: COURSE_PLAN_FAILURE_MESSAGES[failure.category],
            }
          : null;
      })
      .filter(
        (entry): entry is { course: CourseSummary; detail: string } =>
          entry !== null,
      );
    body.append(
      paragraph(
        `${readyCourses.length} courses ready; ${skippedCourses.length} skipped.`,
        "plan-summary",
      ),
      ...(readyCourses.length > 0
        ? [
            paragraph("Ready courses", "list-heading"),
            courseList(
              "ready-courses",
              readyCourses.map((course) => ({ course })),
            ),
          ]
        : []),
      ...(skippedCourses.length > 0
        ? [
            paragraph("Skipped courses", "list-heading"),
            courseList("skipped-courses", skippedCourses),
          ]
        : []),
      paragraph(
        `Requested packaging: ${packagingLabel(state.plan.requestedPackaging)}.`,
      ),
      paragraph(
        `Effective packaging: ${packagingLabel(state.plan.effectivePackaging)}.`,
      ),
      paragraph(
        `Advertised material: ${state.plan.advertisedBytes} bytes across ${state.plan.resourceCount} resource(s).`,
      ),
      ...(state.plan.unknownSizeCount > 0
        ? [
            paragraph(
              `Unknown-size files: ${state.plan.unknownSizeCount}. GradPack will stream them under the hard 250 MiB per-course cap.`,
              "unknown-size-notice",
            ),
          ]
        : []),
      state.plan.fallbackReason === "unknown-size-files"
        ? paragraph(
            "The requested combined archive will be changed to separate course ZIPs because unknown-size files must be streamed under the hard 250 MiB per-course cap.",
            "fallback-notice",
          )
        : state.plan.fallbackReason
          ? paragraph(
              "The requested combined archive will fall back to separate course ZIPs because the combined safety limit would be exceeded.",
              "fallback-notice",
            )
          : paragraph(
              readyCourses.length > 0
                ? "Discovery is complete. Confirm to begin local retrieval."
                : "No course is ready for retrieval. Retry the skipped courses.",
            ),
      ...(readyCourses.length > 0
        ? [button("Continue with ready courses", () => void confirmPlan())]
        : [button("Retry skipped courses", () => void retryUnfinished())]),
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
    const complete = state;
    const downloaded = complete.outputCount > 0;
    heading.textContent = downloaded
      ? "Archives downloaded"
      : "No archives downloaded";
    const unfinished = complete.retryCourseIds
      .map((courseId) => {
        const course = courseForId(complete.courses, courseId);
        if (!course) return null;
        const planningFailure = complete.plan.skipped.find(
          (failure) => failure.courseId === courseId,
        );
        return {
          course,
          detail: planningFailure
            ? COURSE_PLAN_FAILURE_MESSAGES[planningFailure.category]
            : "Archive creation did not complete.",
        };
      })
      .filter(
        (entry): entry is { course: CourseSummary; detail: string } =>
          entry !== null,
      );
    body.append(
      paragraph(
        downloaded
          ? "Your GradPack archives were downloaded."
          : "No course archives were downloaded.",
      ),
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
      ...(unfinished.length > 0
        ? [
            paragraph(
              `${unfinished.length} unfinished course(s) can be retried.`,
              "unfinished-summary",
            ),
            courseList("unfinished-courses", unfinished),
            button("Retry unfinished courses", () => void retryUnfinished()),
          ]
        : []),
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
  const focusTarget =
    focus?.type === "course-all"
      ? app.querySelector<HTMLInputElement>('input[name="course-all"]')
      : focus?.type === "course"
        ? [
            ...app.querySelectorAll<HTMLInputElement>('input[name="course"]'),
          ].find((checkbox) => checkbox.value === String(focus.courseId))
        : null;
  (focusTarget ?? heading).focus();
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
  const focus: RenderFocus =
    previous.name === "choose" && next.name === "choose"
      ? event.type === "SELECT_ALL"
        ? { type: "course-all" }
        : event.type === "SELECT"
          ? { type: "course", courseId: event.courseId }
          : null
      : null;
  render(focus);
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
  if (
    tabId === null ||
    state.name !== "review" ||
    state.plan.selected.length === 0 ||
    cancelRequested
  )
    return;
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

async function retryUnfinished(): Promise<void> {
  const retryable =
    (state.name === "review" &&
      state.plan.selected.length === 0 &&
      state.plan.skipped.length > 0) ||
    (state.name === "complete" && state.retryCourseIds.length > 0);
  if (!retryable) return;
  if (state.name === "review") await cancelRun();
  update({ type: "RETRY" });
  if (state.name === "connect") await connect();
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
    const retrying = state.name === "connect" && state.retry !== null;
    update({ type: "COURSES", courses: event.courses });
    if (retrying && state.name === "configure") void startRun();
  } else if (event.type === "DISCOVERY_PROGRESS") {
    if (
      state.name !== "configure" ||
      !state.busy ||
      event.total !== state.selectedIds.length ||
      event.completed === 0 ||
      state.selectedIds[event.completed - 1] !== event.currentCourseId
    ) {
      return;
    }
    update({ type: "DISCOVERY_PROGRESS", progress: event });
  } else if (event.type === "PLAN_READY") {
    if (state.name !== "configure" || !state.busy) return;
    const plannedIds = [
      ...event.selected.map(({ courseId }) => courseId),
      ...event.skipped.map(({ courseId }) => courseId),
    ];
    if (
      event.requestedCourseCount !== state.selectedIds.length ||
      event.requestedPackaging !== state.packaging ||
      plannedIds.length !== state.selectedIds.length ||
      new Set(plannedIds).size !== plannedIds.length ||
      !state.selectedIds.every((courseId) => plannedIds.includes(courseId))
    ) {
      return;
    }
    update({ type: "PLAN_READY", plan: event });
  } else if (event.type === "PROGRESS") {
    if (state.name !== "packing") return;
    const selectedCourse = state.plan.selected[event.currentCourseIndex];
    if (
      event.totalCourses !== state.plan.selected.length ||
      selectedCourse?.courseId !== event.currentCourseId ||
      selectedCourse.resourceCount !== event.total
    ) {
      return;
    }
    update({ type: "PROGRESS", progress: event });
  } else if (event.type === "COMPLETE") {
    if (state.name !== "packing") return;
    const counts: OutcomeCounts = {
      success: event.success,
      failed: event.failed,
      unavailable: event.unavailable,
      unsupported: event.unsupported,
      external: event.external,
    };
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const resolvedCourses = event.completedCourses + event.failedCourses;
    const selectedById = new Map(
      state.plan.selected.map((selected) => [selected.courseId, selected]),
    );
    const completedAreSelected = event.completedCourseIds.every((courseId) =>
      selectedById.has(courseId),
    );
    const expectedOutcomeTotal = event.completedCourseIds.reduce(
      (sum, courseId) => sum + (selectedById.get(courseId)?.resourceCount ?? 0),
      0,
    );
    const expectedPackaging =
      event.failedCourses > 0 ? "per-course" : state.plan.effectivePackaging;
    if (
      !Number.isSafeInteger(resolvedCourses) ||
      event.packaging !== expectedPackaging ||
      resolvedCourses !== state.plan.selected.length ||
      event.failedCourses !==
        state.plan.selected.length - event.completedCourseIds.length ||
      !completedAreSelected ||
      !Number.isSafeInteger(expectedOutcomeTotal) ||
      total !== expectedOutcomeTotal
    ) {
      return;
    }
    const previous = state;
    update({
      type: "COMPLETE",
      packaging: event.packaging,
      completedCourses: event.completedCourses,
      completedCourseIds: event.completedCourseIds,
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
