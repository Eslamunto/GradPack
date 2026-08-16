export const DEV_CHANNEL = "gradpack/dev/v1" as const;
export const DEV_CONTROLLER_SOURCE = "gradpack-dev-controller" as const;
export const DEV_RELAY_SOURCE = "gradpack-dev-relay" as const;
export const DEV_RUNNER_SOURCE = "gradpack-dev-runner" as const;
export const DEV_RESULT_ATTRIBUTE = "data-gradpack-dev-result" as const;

export type DevCommand = {
  channel: typeof DEV_CHANNEL;
  type:
    "RELOAD_DEV_EXTENSION" | "RUN_LIVE_SMOKE_TEST" | "CLEAR_LIVE_TEST_RESULT";
  runId: string;
};

export type DevRuntimeCommand = {
  channel: typeof DEV_CHANNEL;
  type: "ENSURE_DEV_RUNNER" | "RELOAD_DEV_EXTENSION";
  runId: string;
};

export type DevResult = {
  channel: typeof DEV_CHANNEL;
  type: "LIVE_SMOKE_RESULT";
  runId: string;
  outcome: "pass" | "fail";
  failure:
    | "none"
    | "session"
    | "courses"
    | "modules"
    | "page"
    | "file"
    | "safety"
    | "busy"
    | "timeout";
  session: "available" | "unavailable";
  courses: "available" | "empty" | "unavailable";
  modules:
    | "not-run"
    | "empty"
    | "page-only"
    | "file-only"
    | "page-and-file"
    | "forbidden"
    | "not-found"
    | "unavailable";
  page: "not-run" | "available" | "unavailable";
  file: "not-run" | "available" | "too-large" | "html" | "unavailable";
  contentType:
    "none" | "pdf" | "image" | "text" | "archive" | "office" | "other";
  redirect: "none" | "same-origin-https" | "cross-origin-https" | "unsafe";
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

const enumMember = <T extends string>(
  value: unknown,
  values: readonly T[],
): T => {
  if (typeof value !== "string" || !values.some((item) => item === value)) {
    throw new TypeError("Unsupported message value");
  }
  return value as T;
};

export function parseDevCommand(value: unknown): DevCommand {
  const input = record(value);
  if (input.channel !== DEV_CHANNEL) throw new TypeError("Invalid channel");
  if (input.type === "RELOAD_DEV_EXTENSION") {
    exactKeys(input, ["channel", "type", "runId"]);
    return {
      channel: DEV_CHANNEL,
      type: "RELOAD_DEV_EXTENSION",
      runId: runId(input.runId),
    };
  }
  if (input.type === "RUN_LIVE_SMOKE_TEST") {
    exactKeys(input, ["channel", "type", "runId"]);
    return {
      channel: DEV_CHANNEL,
      type: "RUN_LIVE_SMOKE_TEST",
      runId: runId(input.runId),
    };
  }
  if (input.type === "CLEAR_LIVE_TEST_RESULT") {
    exactKeys(input, ["channel", "type", "runId"]);
    return {
      channel: DEV_CHANNEL,
      type: "CLEAR_LIVE_TEST_RESULT",
      runId: runId(input.runId),
    };
  }
  throw new TypeError("Unsupported command");
}

export function parseDevRuntimeCommand(value: unknown): DevRuntimeCommand {
  const input = record(value);
  if (input.channel !== DEV_CHANNEL) throw new TypeError("Invalid channel");
  if (input.type === "ENSURE_DEV_RUNNER") {
    exactKeys(input, ["channel", "type", "runId"]);
    return {
      channel: DEV_CHANNEL,
      type: "ENSURE_DEV_RUNNER",
      runId: runId(input.runId),
    };
  }
  if (input.type === "RELOAD_DEV_EXTENSION") {
    exactKeys(input, ["channel", "type", "runId"]);
    return {
      channel: DEV_CHANNEL,
      type: "RELOAD_DEV_EXTENSION",
      runId: runId(input.runId),
    };
  }
  throw new TypeError("Unsupported runtime command");
}

export function parseDevResult(value: unknown): DevResult {
  const input = record(value);
  exactKeys(input, [
    "channel",
    "type",
    "runId",
    "outcome",
    "failure",
    "session",
    "courses",
    "modules",
    "page",
    "file",
    "contentType",
    "redirect",
  ]);
  if (input.channel !== DEV_CHANNEL) throw new TypeError("Invalid channel");
  if (input.type !== "LIVE_SMOKE_RESULT") {
    throw new TypeError("Unsupported result");
  }
  return {
    channel: DEV_CHANNEL,
    type: "LIVE_SMOKE_RESULT",
    runId: runId(input.runId),
    outcome: enumMember(input.outcome, ["pass", "fail"]),
    failure: enumMember(input.failure, [
      "none",
      "session",
      "courses",
      "modules",
      "page",
      "file",
      "safety",
      "busy",
      "timeout",
    ]),
    session: enumMember(input.session, ["available", "unavailable"]),
    courses: enumMember(input.courses, ["available", "empty", "unavailable"]),
    modules: enumMember(input.modules, [
      "not-run",
      "empty",
      "page-only",
      "file-only",
      "page-and-file",
      "forbidden",
      "not-found",
      "unavailable",
    ]),
    page: enumMember(input.page, ["not-run", "available", "unavailable"]),
    file: enumMember(input.file, [
      "not-run",
      "available",
      "too-large",
      "html",
      "unavailable",
    ]),
    contentType: enumMember(input.contentType, [
      "none",
      "pdf",
      "image",
      "text",
      "archive",
      "office",
      "other",
    ]),
    redirect: enumMember(input.redirect, [
      "none",
      "same-origin-https",
      "cross-origin-https",
      "unsafe",
    ]),
  };
}

export function serializeDevResult(value: DevResult): string {
  const serialized = JSON.stringify(parseDevResult(value));
  if (serialized.length > 512) {
    throw new RangeError("Serialized result exceeds 512 characters");
  }
  return serialized;
}
