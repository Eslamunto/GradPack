import { EXTENSION_CHANNEL, RUNNER_CHANNEL } from "./constants";
import type { CourseSummary } from "./model";

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
      type: "COMPLETE" | "CANCELLED" | "FAILED";
      runId: string;
      message: string;
    };

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object message");
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): void => {
  const keys = Object.keys(value);
  if (
    keys.length !== allowed.length ||
    keys.some((key) => !allowed.includes(key))
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
      courses: input.courses.map(courseSummary),
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
  if (
    input.type === "COMPLETE" ||
    input.type === "CANCELLED" ||
    input.type === "FAILED"
  ) {
    exactKeys(input, ["channel", "type", "runId", "message"]);
    const id = runId(input.runId);
    if (typeof input.message !== "string") {
      throw new TypeError("Unsupported runner event");
    }
    return {
      channel: RUNNER_CHANNEL,
      type: input.type,
      runId: id,
      message: input.message.slice(0, 500),
    };
  }
  throw new TypeError("Unsupported runner event");
}
