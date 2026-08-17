import { describe, expect, it } from "vitest";
import {
  parseDevCommand,
  parseDevResult,
  parseDevRuntimeCommand,
  serializeDevResult,
} from "../../src/dev/protocol";

const result = {
  channel: "gradpack/dev/v1",
  type: "LIVE_SMOKE_RESULT",
  runId: "run-live-12345678",
  outcome: "pass",
  failure: "none",
  session: "available",
  courses: "available",
  modules: "page-and-file",
  page: "available",
  file: "available",
  contentType: "pdf",
  redirect: "same-origin-https",
} as const;

describe("parseDevCommand", () => {
  it.each([
    "RELOAD_DEV_EXTENSION",
    "RUN_LIVE_SMOKE_TEST",
    "CLEAR_LIVE_TEST_RESULT",
  ] as const)("accepts %s", (type) => {
    expect(
      parseDevCommand({
        channel: "gradpack/dev/v1",
        type,
        runId: "run-live-12345678",
      }),
    ).toEqual({ channel: "gradpack/dev/v1", type, runId: "run-live-12345678" });
  });

  it.each([
    {
      channel: "gradpack/extension/v1",
      type: "RUN_LIVE_SMOKE_TEST",
      runId: "run-live-12345678",
    },
    { channel: "gradpack/dev/v1", type: "UNKNOWN", runId: "run-live-12345678" },
    { channel: "gradpack/dev/v1", type: "RUN_LIVE_SMOKE_TEST" },
    {
      channel: "gradpack/dev/v1",
      type: "RUN_LIVE_SMOKE_TEST",
      runId: "run-live-12345678",
      extra: true,
    },
    {
      channel: "gradpack/dev/v1",
      type: "RUN_LIVE_SMOKE_TEST",
      runId: "run-LIVE-12345678",
    },
    {
      channel: "gradpack/dev/v1",
      type: "RUN_LIVE_SMOKE_TEST",
      runId: { toString: (): string => "run-live-12345678" },
    },
  ])("rejects invalid input %#", (value) => {
    expect(() => parseDevCommand(value)).toThrow(TypeError);
  });

  it("rejects a non-enumerable own extra field", () => {
    const command = {
      channel: "gradpack/dev/v1",
      type: "RUN_LIVE_SMOKE_TEST",
      runId: "run-live-12345678",
    };
    Object.defineProperty(command, "stealth", { value: true });

    expect(() => parseDevCommand(command)).toThrow(TypeError);
  });

  it("rejects a symbol-keyed own extra field", () => {
    const extra = Symbol("stealth");
    const command = {
      channel: "gradpack/dev/v1",
      type: "RUN_LIVE_SMOKE_TEST",
      runId: "run-live-12345678",
      [extra]: true,
    };

    expect(() => parseDevCommand(command)).toThrow(TypeError);
  });
});

describe("parseDevRuntimeCommand", () => {
  it.each(["ENSURE_DEV_RUNNER", "RELOAD_DEV_EXTENSION"] as const)(
    "accepts %s",
    (type) => {
      expect(
        parseDevRuntimeCommand({
          channel: "gradpack/dev/v1",
          type,
          runId: "run-live-12345678",
        }),
      ).toEqual({
        channel: "gradpack/dev/v1",
        type,
        runId: "run-live-12345678",
      });
    },
  );

  it.each([
    {
      channel: "gradpack/runner/v1",
      type: "ENSURE_DEV_RUNNER",
      runId: "run-live-12345678",
    },
    {
      channel: "gradpack/dev/v1",
      type: "RUN_LIVE_SMOKE_TEST",
      runId: "run-live-12345678",
    },
    {
      channel: "gradpack/dev/v1",
      type: "ENSURE_DEV_RUNNER",
      runId: "run-live-12345678",
      detail: "free-form",
    },
  ])("rejects invalid input %#", (value) => {
    expect(() => parseDevRuntimeCommand(value)).toThrow(TypeError);
  });
});

describe("parseDevResult", () => {
  it("accepts the canonical closed result", () => {
    expect(parseDevResult(result)).toEqual(result);
  });

  it.each([
    ["outcome", ["pass", "fail"]],
    [
      "failure",
      [
        "none",
        "session",
        "courses",
        "modules",
        "page",
        "file",
        "safety",
        "busy",
        "timeout",
      ],
    ],
    ["session", ["available", "unavailable"]],
    ["courses", ["available", "empty", "unavailable"]],
    [
      "modules",
      [
        "not-run",
        "empty",
        "page-only",
        "file-only",
        "page-and-file",
        "forbidden",
        "not-found",
        "unavailable",
      ],
    ],
    ["page", ["not-run", "available", "unavailable"]],
    ["file", ["not-run", "available", "too-large", "html", "unavailable"]],
    [
      "contentType",
      ["none", "pdf", "image", "text", "archive", "office", "other"],
    ],
    ["redirect", ["none", "same-origin-https", "cross-origin-https", "unsafe"]],
  ] as const)("accepts every %s enum variant", (key, values) => {
    for (const value of values) {
      expect(parseDevResult({ ...result, [key]: value })).toEqual({
        ...result,
        [key]: value,
      });
    }
  });

  it.each([
    { ...result, channel: "gradpack/dev/v2" },
    { ...result, type: "LIVE_SMOKE_PROGRESS" },
    { ...result, runId: "run-short" },
    { ...result, outcome: "PASS" },
    { ...result, session: "available", detail: "free-form" },
    Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== "redirect"),
    ),
    { ...result, contentType: "unknown" },
    { ...result, failure: { toString: (): string => "none" } },
  ])("rejects invalid result %#", (value) => {
    expect(() => parseDevResult(value)).toThrow(TypeError);
  });

  it("serializes the canonical result as a compact bounded JSON round trip", () => {
    const serialized = serializeDevResult(result);

    expect(JSON.parse(serialized)).toEqual(result);
    expect(serialized).toHaveLength(277);
    expect(serialized.length).toBeLessThanOrEqual(512);
  });
});
