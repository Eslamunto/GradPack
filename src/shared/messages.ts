import {
  EXTENSION_CHANNEL,
  MAX_ARCHIVE_RESOURCES,
  RUNNER_CHANNEL,
} from "./constants";
import type {
  AggregateProgress,
  CoursePlanSummary,
  CourseSummary,
  PackagingMode,
  PlanFallbackReason,
  RunPlanSummary,
  RunStage,
} from "./model";

export const RUNNER_TERMINAL_MESSAGES = Object.freeze({
  active: "Another GradPack operation is already active in this tab.",
  cancelled: "Packing was cancelled.",
  complete: "Your GradPack archives were downloaded.",
  connection: "Open a signed-in Frankfurt School Canvas tab and try again.",
  navigation: "The Canvas tab navigated or closed. Reopen it and try again.",
  response: "Canvas returned an unavailable or invalid response.",
  safety: "GradPack stopped because a safety check failed.",
  session: "Your Canvas session ended. Sign in and try again.",
  size: "This course does not fit the 250 MB safety policy.",
  tab: "The connected Canvas tab is no longer available. Reopen it and try again.",
  unexpected: "GradPack stopped because of an unexpected local error.",
  unlisted: "The selected course is no longer available.",
});

export type ExtensionCommand =
  | { channel: typeof EXTENSION_CHANNEL; type: "LIST_COURSES"; runId: string }
  | {
      channel: typeof EXTENSION_CHANNEL;
      type: "START_RUN";
      runId: string;
      courseIds: number[];
      packaging: PackagingMode;
    }
  | { channel: typeof EXTENSION_CHANNEL; type: "CONFIRM_PLAN"; runId: string }
  | { channel: typeof EXTENSION_CHANNEL; type: "CANCEL"; runId: string };

export type RunnerEvent =
  | {
      channel: typeof RUNNER_CHANNEL;
      type: "COURSES";
      runId: string;
      courses: CourseSummary[];
    }
  | ({
      channel: typeof RUNNER_CHANNEL;
      type: "PLAN_READY";
      runId: string;
    } & RunPlanSummary)
  | ({
      channel: typeof RUNNER_CHANNEL;
      type: "PROGRESS";
      runId: string;
    } & AggregateProgress)
  | {
      channel: typeof RUNNER_CHANNEL;
      type: "COMPLETE";
      runId: string;
      message: string;
      packaging: PackagingMode;
      completedCourses: number;
      failedCourses: number;
      outputCount: number;
      success: number;
      failed: number;
      unavailable: number;
      unsupported: number;
      external: number;
    }
  | {
      channel: typeof RUNNER_CHANNEL;
      type: "CANCELLED" | "FAILED";
      runId: string;
      message: string;
    };

const record = (value: unknown): Record<string, unknown> => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError("Expected an object message");
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Unexpected message fields");
    }
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): void => {
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== allowed.length ||
    keys.some((key) => typeof key !== "string" || !allowed.includes(key))
  ) {
    throw new TypeError("Unexpected message fields");
  }
};

const runId = (value: unknown): string => {
  if (typeof value !== "string" || !/^run-[a-z0-9-]{8,64}$/.test(value)) {
    throw new TypeError("Invalid run identifier");
  }
  return value;
};

const nonNegativeInteger = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError("Invalid count");
  }
  return Number(value);
};

const positiveInteger = (value: unknown, message: string): number => {
  const result = nonNegativeInteger(value);
  if (result <= 0) throw new TypeError(message);
  return result;
};

const courseSummary = (value: unknown): CourseSummary => {
  const input = record(value);
  exactKeys(input, ["id", "name", "courseCode", "workflowState", "concluded"]);
  const id = positiveInteger(input.id, "Invalid course ID");
  if (
    typeof input.name !== "string" ||
    typeof input.courseCode !== "string" ||
    typeof input.workflowState !== "string" ||
    typeof input.concluded !== "boolean"
  ) {
    throw new TypeError("Invalid course summary");
  }
  return {
    id,
    name: input.name.slice(0, 500),
    courseCode: input.courseCode.slice(0, 200),
    workflowState: input.workflowState.slice(0, 100),
    concluded: input.concluded,
  };
};

const denseArray = (value: unknown, max: number): unknown[] => {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new TypeError("Invalid array");
  }
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value as
    number | undefined;
  if (
    length === undefined ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > max
  ) {
    throw new TypeError("Invalid array");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
    )
  ) {
    throw new TypeError("Invalid array");
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor))
      throw new TypeError("Invalid array");
    result.push(descriptor.value);
  }
  return result;
};

const courseArray = (value: unknown): CourseSummary[] =>
  denseArray(value, 10_000).map(courseSummary);

const courseIds = (value: unknown): number[] => {
  const values = denseArray(value, 10_000);
  if (values.length === 0)
    throw new TypeError("At least one course is required");
  const ids = values.map((candidate) =>
    positiveInteger(candidate, "Invalid course ID"),
  );
  if (new Set(ids).size !== ids.length)
    throw new TypeError("Duplicate course ID");
  return ids;
};

const packaging = (value: unknown): PackagingMode => {
  if (value !== "combined" && value !== "per-course") {
    throw new TypeError("Invalid packaging mode");
  }
  return value;
};

const fallbackReason = (value: unknown): PlanFallbackReason | null => {
  if (
    value !== null &&
    value !== "combined-size-exceeded" &&
    value !== "combined-resource-limit-exceeded" &&
    value !== "unknown-size-files"
  ) {
    throw new TypeError("Invalid fallback reason");
  }
  return value;
};

const planSummary = (value: unknown): CoursePlanSummary => {
  const input = record(value);
  exactKeys(input, [
    "courseId",
    "advertisedBytes",
    "unknownSizeCount",
    "resourceCount",
  ]);
  return {
    courseId: positiveInteger(input.courseId, "Invalid course ID"),
    advertisedBytes: nonNegativeInteger(input.advertisedBytes),
    unknownSizeCount: nonNegativeInteger(input.unknownSizeCount),
    resourceCount: nonNegativeInteger(input.resourceCount),
  };
};

const planEvent = (input: Record<string, unknown>, id: string): RunnerEvent => {
  exactKeys(input, [
    "channel",
    "type",
    "runId",
    "selected",
    "advertisedBytes",
    "unknownSizeCount",
    "resourceCount",
    "requestedPackaging",
    "effectivePackaging",
    "fallbackReason",
  ]);
  const selected = denseArray(input.selected, 10_000).map(planSummary);
  if (selected.length === 0) throw new TypeError("Invalid plan");
  const advertisedBytes = nonNegativeInteger(input.advertisedBytes);
  const unknownSizeCount = nonNegativeInteger(input.unknownSizeCount);
  const resourceCount = nonNegativeInteger(input.resourceCount);
  if (resourceCount > MAX_ARCHIVE_RESOURCES)
    throw new TypeError("Invalid plan");
  if (
    unknownSizeCount > resourceCount ||
    selected.some((item) => item.unknownSizeCount > item.resourceCount)
  ) {
    throw new TypeError("Invalid plan counts");
  }
  if (
    selected.reduce((total, item) => total + item.advertisedBytes, 0) !==
      advertisedBytes ||
    selected.reduce((total, item) => total + item.unknownSizeCount, 0) !==
      unknownSizeCount ||
    selected.reduce((total, item) => total + item.resourceCount, 0) !==
      resourceCount
  ) {
    throw new TypeError("Invalid plan totals");
  }
  const requestedPackaging = packaging(input.requestedPackaging);
  const effectivePackaging = packaging(input.effectivePackaging);
  const reason = fallbackReason(input.fallbackReason);
  if (
    (requestedPackaging === effectivePackaging && reason !== null) ||
    (requestedPackaging !== effectivePackaging && reason === null) ||
    (effectivePackaging === "combined" && reason !== null) ||
    (reason === "unknown-size-files" && unknownSizeCount === 0)
  ) {
    throw new TypeError("Invalid packaging fallback");
  }
  return {
    channel: RUNNER_CHANNEL,
    type: "PLAN_READY",
    runId: id,
    selected,
    advertisedBytes,
    unknownSizeCount,
    resourceCount,
    requestedPackaging,
    effectivePackaging,
    fallbackReason: reason,
  };
};

const aggregateProgress = (
  input: Record<string, unknown>,
  id: string,
): RunnerEvent => {
  exactKeys(input, [
    "channel",
    "type",
    "runId",
    "stage",
    "currentCourseId",
    "currentCourseIndex",
    "totalCourses",
    "completedCourses",
    "completed",
    "total",
    "failed",
  ]);
  const stage = input.stage;
  if (
    typeof stage !== "string" ||
    !["discovery", "download", "sanitize", "package"].includes(stage)
  ) {
    throw new TypeError("Unsupported runner event");
  }
  const currentCourseId = positiveInteger(
    input.currentCourseId,
    "Invalid course ID",
  );
  const currentCourseIndex = nonNegativeInteger(input.currentCourseIndex);
  const totalCourses = positiveInteger(
    input.totalCourses,
    "Invalid course count",
  );
  const completedCourses = nonNegativeInteger(input.completedCourses);
  const completed = nonNegativeInteger(input.completed);
  const total = nonNegativeInteger(input.total);
  const failed = nonNegativeInteger(input.failed);
  if (
    currentCourseIndex >= totalCourses ||
    completedCourses > currentCourseIndex ||
    total > MAX_ARCHIVE_RESOURCES ||
    completed > total ||
    failed > completed
  ) {
    throw new TypeError("Invalid progress counts");
  }
  const value: AggregateProgress = {
    stage: stage as RunStage,
    currentCourseId,
    currentCourseIndex,
    totalCourses,
    completedCourses,
    completed,
    total,
    failed,
  };
  return { channel: RUNNER_CHANNEL, type: "PROGRESS", runId: id, ...value };
};

const terminalMessage = (
  value: unknown,
  allowed: readonly string[],
): string => {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError("Unsupported runner event");
  }
  return value;
};

export function parseExtensionCommand(value: unknown): ExtensionCommand {
  const input = record(value);
  if (input.channel !== EXTENSION_CHANNEL)
    throw new TypeError("Invalid channel");
  const id = runId(input.runId);
  if (
    input.type === "LIST_COURSES" ||
    input.type === "CANCEL" ||
    input.type === "CONFIRM_PLAN"
  ) {
    exactKeys(input, ["channel", "type", "runId"]);
    return { channel: EXTENSION_CHANNEL, type: input.type, runId: id };
  }
  if (input.type === "START_RUN") {
    exactKeys(input, ["channel", "type", "runId", "courseIds", "packaging"]);
    return {
      channel: EXTENSION_CHANNEL,
      type: "START_RUN",
      runId: id,
      courseIds: courseIds(input.courseIds),
      packaging: packaging(input.packaging),
    };
  }
  throw new TypeError("Unsupported command");
}

export function parseRunnerEvent(value: unknown): RunnerEvent {
  const input = record(value);
  if (input.channel !== RUNNER_CHANNEL) throw new TypeError("Invalid channel");
  const id = runId(input.runId);
  if (input.type === "COURSES" && Array.isArray(input.courses)) {
    exactKeys(input, ["channel", "type", "runId", "courses"]);
    return {
      channel: RUNNER_CHANNEL,
      type: "COURSES",
      runId: id,
      courses: courseArray(input.courses),
    };
  }
  if (input.type === "PLAN_READY") return planEvent(input, id);
  if (input.type === "PROGRESS") return aggregateProgress(input, id);
  if (input.type === "COMPLETE") {
    exactKeys(input, [
      "channel",
      "type",
      "runId",
      "message",
      "packaging",
      "completedCourses",
      "failedCourses",
      "outputCount",
      "success",
      "failed",
      "unavailable",
      "unsupported",
      "external",
    ]);
    const message = terminalMessage(input.message, [
      RUNNER_TERMINAL_MESSAGES.complete,
    ]);
    const packagingMode = packaging(input.packaging);
    const completedCourses = nonNegativeInteger(input.completedCourses);
    const failedCourses = nonNegativeInteger(input.failedCourses);
    const outputCount = nonNegativeInteger(input.outputCount);
    if (
      completedCourses === 0 ||
      outputCount === 0 ||
      (packagingMode === "combined" && outputCount !== 1) ||
      (packagingMode === "per-course" && outputCount !== completedCourses)
    ) {
      throw new TypeError("Invalid terminal course counts");
    }
    const counts = {
      success: nonNegativeInteger(input.success),
      failed: nonNegativeInteger(input.failed),
      unavailable: nonNegativeInteger(input.unavailable),
      unsupported: nonNegativeInteger(input.unsupported),
      external: nonNegativeInteger(input.external),
    };
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (!Number.isSafeInteger(total) || total > MAX_ARCHIVE_RESOURCES) {
      throw new TypeError("Invalid terminal counts");
    }
    return {
      channel: RUNNER_CHANNEL,
      type: "COMPLETE",
      runId: id,
      message,
      packaging: packagingMode,
      completedCourses,
      failedCourses,
      outputCount,
      ...counts,
    };
  }
  if (input.type === "CANCELLED" || input.type === "FAILED") {
    exactKeys(input, ["channel", "type", "runId", "message"]);
    const message = terminalMessage(
      input.message,
      input.type === "CANCELLED"
        ? [
            RUNNER_TERMINAL_MESSAGES.cancelled,
            RUNNER_TERMINAL_MESSAGES.navigation,
          ]
        : [
            RUNNER_TERMINAL_MESSAGES.active,
            RUNNER_TERMINAL_MESSAGES.response,
            RUNNER_TERMINAL_MESSAGES.safety,
            RUNNER_TERMINAL_MESSAGES.session,
            RUNNER_TERMINAL_MESSAGES.size,
            RUNNER_TERMINAL_MESSAGES.unexpected,
            RUNNER_TERMINAL_MESSAGES.unlisted,
          ],
    );
    return { channel: RUNNER_CHANNEL, type: input.type, runId: id, message };
  }
  throw new TypeError("Unsupported runner event");
}
