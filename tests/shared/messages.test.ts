import { describe, expect, it } from "vitest";
import {
  parseExtensionCommand,
  parseRunnerEvent,
} from "../../src/shared/messages";

describe("parseExtensionCommand", () => {
  it("accepts a valid one-course start command", () => {
    expect(
      parseExtensionCommand({
        channel: "gradpack/extension/v1",
        type: "START_COURSE",
        runId: "run-12345678",
        courseId: 42,
      }),
    ).toMatchObject({ type: "START_COURSE", courseId: 42 });
  });

  it.each([
    { type: "START_COURSE", runId: "x", courseId: "42" },
    { type: "FETCH_URL", runId: "run-12345678", url: "https://evil.test" },
    { type: "START_COURSE", runId: "run-12345678", courseId: -1 },
  ])("rejects unsafe input %#", (value) => {
    expect(() => parseExtensionCommand(value)).toThrow();
  });

  it("rejects an extra top-level command field", () => {
    expect(() =>
      parseExtensionCommand({
        channel: "gradpack/extension/v1",
        type: "START_COURSE",
        runId: "run-12345678",
        courseId: 42,
        url: "https://evil.test",
      }),
    ).toThrow();
  });
});

describe("parseRunnerEvent", () => {
  it("normalizes course values into a new event", () => {
    const pageEvent = {
      channel: "gradpack/runner/v1",
      type: "COURSES",
      runId: "run-12345678",
      courses: [
        {
          id: 42,
          name: "Economics",
          courseCode: "ECON-101",
          workflowState: "available",
          concluded: false,
        },
      ],
    };

    const event = parseRunnerEvent(pageEvent);
    pageEvent.courses[0]!.name = "Mutated by page";

    expect(event).toEqual({
      channel: "gradpack/runner/v1",
      type: "COURSES",
      runId: "run-12345678",
      courses: [
        {
          id: 42,
          name: "Economics",
          courseCode: "ECON-101",
          workflowState: "available",
          concluded: false,
        },
      ],
    });
  });

  it("accepts normalized progress and terminal events", () => {
    expect(
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "PROGRESS",
        runId: "run-12345678",
        stage: "download",
        completed: 1,
        total: 3,
        failed: 0,
      }),
    ).toMatchObject({ type: "PROGRESS", completed: 1, total: 3, failed: 0 });
    expect(
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "COMPLETE",
        runId: "run-12345678",
        message: "Your course ZIP was downloaded.",
        success: 1,
        failed: 0,
        unavailable: 0,
        unsupported: 0,
        external: 0,
      }),
    ).toMatchObject({
      type: "COMPLETE",
      message: "Your course ZIP was downloaded.",
    });
  });

  it.each([
    { completed: 4, total: 3, failed: 0 },
    { completed: 1, total: 3, failed: 2 },
    { completed: 0, total: 65_533, failed: 0 },
  ])(
    "rejects impossible or over-cap progress counts %#",
    ({ completed, total, failed }) => {
      expect(() =>
        parseRunnerEvent({
          channel: "gradpack/runner/v1",
          type: "PROGRESS",
          runId: "run-12345678",
          stage: "download",
          completed,
          total,
          failed,
        }),
      ).toThrow();
    },
  );

  it.each([
    { success: 65_533, failed: 0, unavailable: 0, unsupported: 0, external: 0 },
    {
      success: 65_532,
      failed: 1,
      unavailable: 0,
      unsupported: 0,
      external: 0,
    },
  ])("rejects over-cap terminal totals %#", (counts) => {
    expect(() =>
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "COMPLETE",
        runId: "run-12345678",
        message: "Your course ZIP was downloaded.",
        ...counts,
      }),
    ).toThrow();
  });

  it("rejects an extra top-level event field", () => {
    expect(() =>
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "COMPLETE",
        runId: "run-12345678",
        message: "Finished",
        headers: { authorization: "unexpected" },
      }),
    ).toThrow();
  });

  it("rejects an extra nested course field", () => {
    expect(() =>
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "COURSES",
        runId: "run-12345678",
        courses: [
          {
            id: 42,
            name: "Economics",
            courseCode: "ECON-101",
            workflowState: "available",
            concluded: false,
            body: "unexpected",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects symbol, non-enumerable, accessor, and non-plain message fields", () => {
    const valid = {
      channel: "gradpack/runner/v1",
      type: "FAILED",
      runId: "run-12345678",
      message: "GradPack stopped because a safety check failed.",
    };
    expect(() =>
      parseRunnerEvent({ ...valid, [Symbol("hidden")]: true }),
    ).toThrow();
    const hidden = { ...valid };
    Object.defineProperty(hidden, "secret", { value: true, enumerable: false });
    expect(() => parseRunnerEvent(hidden)).toThrow();
    const getter = { ...valid };
    let invoked = false;
    Object.defineProperty(getter, "message", {
      enumerable: true,
      get() {
        invoked = true;
        return valid.message;
      },
    });
    expect(() => parseRunnerEvent(getter)).toThrow();
    expect(invoked).toBe(false);
    expect(() =>
      parseRunnerEvent(Object.assign(Object.create({}), valid)),
    ).toThrow();
  });

  it("accepts only fixed terminal messages", () => {
    expect(() =>
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "FAILED",
        runId: "run-12345678",
        message: "private response detail",
      }),
    ).toThrow();
    expect(() =>
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "COMPLETE",
        runId: "run-12345678",
        message: "Your Canvas session ended. Sign in and try again.",
        success: 1,
        failed: 0,
        unavailable: 0,
        unsupported: 0,
        external: 0,
      }),
    ).toThrow();
  });

  it.each([
    { channel: "gradpack/runner/v1", type: "FETCH_URL", runId: "run-12345678" },
    {
      channel: "gradpack/runner/v1",
      type: "PROGRESS",
      runId: "run-12345678",
      stage: "upload",
      completed: 0,
      total: 0,
      failed: 0,
    },
    {
      channel: "gradpack/runner/v1",
      type: "PROGRESS",
      runId: "run-12345678",
      stage: "download",
      completed: -1,
      total: 0,
      failed: 0,
    },
    {
      channel: "gradpack/runner/v1",
      type: "PROGRESS",
      runId: "run-12345678",
      stage: { toString: (): string => "download" },
      completed: 0,
      total: 0,
      failed: 0,
    },
  ])("rejects unsupported event %#", (value) => {
    expect(() => parseRunnerEvent(value)).toThrow();
  });
});
