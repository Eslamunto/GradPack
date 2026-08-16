import { EXTENSION_CHANNEL, RUNNER_CHANNEL } from "./constants";
import type { CourseSummary } from "./model";

export const RUNNER_TERMINAL_MESSAGES = Object.freeze({
  active: "Another GradPack operation is already active in this tab.",
  cancelled: "Packing was cancelled.",
  complete: "Your course ZIP was downloaded.",
  connection: "Open a signed-in Frankfurt School Canvas tab and try again.",
  navigation: "The Canvas tab navigated or closed. Reopen it and try again.",
  response: "Canvas returned an unavailable or invalid response.",
  safety: "GradPack stopped because a safety check failed.",
  session: "Your Canvas session ended. Sign in and try again.",
  size: "This course does not fit the 250 MB pilot safety policy.",
  tab: "The connected Canvas tab is no longer available. Reopen it and try again.",
  unexpected: "GradPack stopped because of an unexpected local error.",
  unlisted: "The selected course is no longer available.",
});

export type ExtensionCommand =
  | { channel: typeof EXTENSION_CHANNEL; type: "LIST_COURSES"; runId: string }
  | {
      channel: typeof EXTENSION_CHANNEL;
      type: "START_COURSE";
      runId: string;
      courseId: number;
    }
  | { channel: typeof EXTENSION_CHANNEL; type: "CANCEL"; runId: string };

export type RunnerEvent =
  | {
      channel: typeof RUNNER_CHANNEL;
      type: "COURSES";
      runId: string;
      courses: CourseSummary[];
    }
  | {
      channel: typeof RUNNER_CHANNEL;
      type: "PROGRESS";
      runId: string;
      stage: "discovery" | "download" | "sanitize" | "package";
      completed: number;
      total: number;
      failed: number;
    }
  | {
      channel: typeof RUNNER_CHANNEL;
      type: "COMPLETE";
      runId: string;
      message: string;
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

const courseSummary = (value: unknown): CourseSummary => {
  const input = record(value);
  exactKeys(input, ["id", "name", "courseCode", "workflowState", "concluded"]);
  if (!Number.isSafeInteger(input.id) || Number(input.id) <= 0) {
    throw new TypeError("Invalid course ID");
  }
  if (
    typeof input.name !== "string" ||
    typeof input.courseCode !== "string" ||
    typeof input.workflowState !== "string" ||
    typeof input.concluded !== "boolean"
  ) {
    throw new TypeError("Invalid course summary");
  }
  return {
    id: Number(input.id),
    name: input.name.slice(0, 500),
    courseCode: input.courseCode.slice(0, 200),
    workflowState: input.workflowState.slice(0, 100),
    concluded: input.concluded,
  };
};

const courseArray = (value: unknown): CourseSummary[] => {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new TypeError("Invalid course list");
  }
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value as
    number | undefined;
  if (
    !Number.isSafeInteger(length) ||
    length === undefined ||
    length < 0 ||
    length > 10_000
  ) {
    throw new TypeError("Invalid course list");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
    )
  ) {
    throw new TypeError("Invalid course list");
  }
  const courses: CourseSummary[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Invalid course list");
    }
    courses.push(courseSummary(descriptor.value));
  }
  return courses;
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
  if (input.type === "LIST_COURSES" || input.type === "CANCEL") {
    exactKeys(input, ["channel", "type", "runId"]);
    const id = runId(input.runId);
    return { channel: EXTENSION_CHANNEL, type: input.type, runId: id };
  }
  if (input.type === "START_COURSE") {
    exactKeys(input, ["channel", "type", "runId", "courseId"]);
    const id = runId(input.runId);
    if (!Number.isSafeInteger(input.courseId) || Number(input.courseId) <= 0) {
      throw new TypeError("Unsupported command");
    }
    return {
      channel: EXTENSION_CHANNEL,
      type: "START_COURSE",
      runId: id,
      courseId: Number(input.courseId),
    };
  }
  throw new TypeError("Unsupported command");
}

export function parseRunnerEvent(value: unknown): RunnerEvent {
  const input = record(value);
  if (input.channel !== RUNNER_CHANNEL) throw new TypeError("Invalid channel");
  if (input.type === "COURSES" && Array.isArray(input.courses)) {
    exactKeys(input, ["channel", "type", "runId", "courses"]);
    const id = runId(input.runId);
    return {
      channel: RUNNER_CHANNEL,
      type: "COURSES",
      runId: id,
      courses: courseArray(input.courses),
    };
  }
  if (input.type === "PROGRESS") {
    exactKeys(input, [
      "channel",
      "type",
      "runId",
      "stage",
      "completed",
      "total",
      "failed",
    ]);
    const id = runId(input.runId);
    const stage = input.stage;
    if (
      typeof stage !== "string" ||
      !["discovery", "download", "sanitize", "package"].includes(stage)
    ) {
      throw new TypeError("Unsupported runner event");
    }
    return {
      channel: RUNNER_CHANNEL,
      type: "PROGRESS",
      runId: id,
      stage: stage as "discovery" | "download" | "sanitize" | "package",
      completed: nonNegativeInteger(input.completed),
      total: nonNegativeInteger(input.total),
      failed: nonNegativeInteger(input.failed),
    };
  }
  if (input.type === "COMPLETE") {
    exactKeys(input, [
      "channel",
      "type",
      "runId",
      "message",
      "success",
      "failed",
      "unavailable",
      "unsupported",
      "external",
    ]);
    const id = runId(input.runId);
    const message = terminalMessage(input.message, [
      RUNNER_TERMINAL_MESSAGES.complete,
    ]);
    return {
      channel: RUNNER_CHANNEL,
      type: "COMPLETE",
      runId: id,
      message,
      success: nonNegativeInteger(input.success),
      failed: nonNegativeInteger(input.failed),
      unavailable: nonNegativeInteger(input.unavailable),
      unsupported: nonNegativeInteger(input.unsupported),
      external: nonNegativeInteger(input.external),
    };
  }
  if (input.type === "CANCELLED" || input.type === "FAILED") {
    exactKeys(input, ["channel", "type", "runId", "message"]);
    const id = runId(input.runId);
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
    return {
      channel: RUNNER_CHANNEL,
      type: input.type,
      runId: id,
      message,
    };
  }
  throw new TypeError("Unsupported runner event");
}
