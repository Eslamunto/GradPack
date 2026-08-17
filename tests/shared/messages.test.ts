import { describe, expect, it } from "vitest";
import {
  parseExtensionCommand,
  parseRunnerEvent,
} from "../../src/shared/messages";

const command = (value: Record<string, unknown>): Record<string, unknown> => ({
  channel: "gradpack/extension/v1",
  runId: "run-12345678",
  ...value,
});

const progress = (value: Record<string, unknown> = {}): Record<string, unknown> => ({
  channel: "gradpack/runner/v1",
  type: "PROGRESS",
  runId: "run-12345678",
  stage: "download",
  currentCourseId: 42,
  currentCourseIndex: 0,
  totalCourses: 2,
  completedCourses: 0,
  completed: 1,
  total: 5,
  failed: 0,
  ...value,
});

const complete = (value: Record<string, unknown> = {}): Record<string, unknown> => ({
  channel: "gradpack/runner/v1",
  type: "COMPLETE",
  runId: "run-12345678",
  message: "Your GradPack archives were downloaded.",
  packaging: "per-course",
  completedCourses: 2,
  failedCourses: 0,
  outputCount: 2,
  success: 1,
  failed: 0,
  unavailable: 0,
  unsupported: 0,
  external: 0,
  ...value,
});

describe("parseExtensionCommand", () => {
  it("accepts a valid multi-course start and plan confirmation", () => {
    expect(
      parseExtensionCommand(
        command({
          type: "START_RUN",
          courseIds: [42, 43],
          packaging: "combined",
        }),
      ),
    ).toMatchObject({
      type: "START_RUN",
      courseIds: [42, 43],
      packaging: "combined",
    });
    expect(
      parseExtensionCommand(command({ type: "CONFIRM_PLAN" })),
    ).toMatchObject({ type: "CONFIRM_PLAN" });
    expect(
      parseExtensionCommand(command({ type: "CANCEL" })),
    ).toMatchObject({ type: "CANCEL" });
  });

  it.each([
    { type: "START_RUN", courseIds: [], packaging: "combined" },
    { type: "START_RUN", courseIds: [42, 42], packaging: "combined" },
    { type: "START_RUN", courseIds: [42], packaging: "unsafe" },
    { type: "START_RUN", courseIds: [-1], packaging: "per-course" },
    { type: "START_RUN", courseIds: [42.5], packaging: "per-course" },
    { type: "START_RUN", courseIds: [42], packaging: "per-course", url: "https://evil.test" },
    { type: "FETCH_URL", url: "https://evil.test" },
  ])("rejects unsafe input %#", (value) => {
    expect(() => parseExtensionCommand(command(value))).toThrow();
  });

  it("rejects invalid run identifiers and accessor-backed command fields", () => {
    expect(() =>
      parseExtensionCommand({
        ...command({ type: "CONFIRM_PLAN" }),
        runId: "x",
      }),
    ).toThrow();
    const getter = command({ type: "CONFIRM_PLAN" });
    let invoked = false;
    Object.defineProperty(getter, "type", {
      enumerable: true,
      get() {
        invoked = true;
        return "CONFIRM_PLAN";
      },
    });
    expect(() => parseExtensionCommand(getter)).toThrow();
    expect(invoked).toBe(false);
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
    expect(event).toMatchObject({ courses: [{ name: "Economics" }] });
  });

  it("accepts a fallback plan, aggregate progress, and completion", () => {
    expect(
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "PLAN_READY",
        runId: "run-12345678",
        selected: [
          { courseId: 42, advertisedBytes: 10, resourceCount: 2 },
          { courseId: 43, advertisedBytes: 20, resourceCount: 3 },
        ],
        advertisedBytes: 30,
        resourceCount: 5,
        requestedPackaging: "combined",
        effectivePackaging: "per-course",
        fallbackReason: "combined-size-exceeded",
      }),
    ).toMatchObject({
      type: "PLAN_READY",
      effectivePackaging: "per-course",
      fallbackReason: "combined-size-exceeded",
    });
    expect(parseRunnerEvent(progress())).toMatchObject({
      type: "PROGRESS",
      currentCourseId: 42,
      completed: 1,
      total: 5,
      failed: 0,
    });
    expect(parseRunnerEvent(complete())).toMatchObject({
      type: "COMPLETE",
      packaging: "per-course",
      completedCourses: 2,
      outputCount: 2,
    });
  });

  it.each([
    { completed: 4, total: 3, failed: 0 },
    { completed: 1, total: 3, failed: 2 },
    { completed: 0, total: 65_533, failed: 0 },
    { currentCourseIndex: 2, totalCourses: 2 },
    { completedCourses: 3, totalCourses: 2 },
  ])("rejects impossible or over-cap progress counts %#", (value) => {
    expect(() => parseRunnerEvent(progress(value))).toThrow();
  });

  it.each([
    { success: 65_533 },
    { success: 65_532, failed: 1 },
    { completedCourses: 3, failedCourses: 0, outputCount: 0 },
    { completedCourses: 1, failedCourses: 1, outputCount: 0 },
  ])("rejects over-cap or inconsistent terminal totals %#", (value) => {
    expect(() => parseRunnerEvent(complete(value))).toThrow();
  });

  it("rejects an extra top-level or nested field", () => {
    expect(() => parseRunnerEvent({ ...complete(), headers: "secret" })).toThrow();
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

  it("rejects unsupported, accessor-backed, and private terminal messages", () => {
    expect(() => parseRunnerEvent({ ...complete(), message: "private" })).toThrow();
    expect(() => parseRunnerEvent({ ...progress(), stage: "upload" })).toThrow();
    const getter = complete();
    let invoked = false;
    Object.defineProperty(getter, "message", {
      enumerable: true,
      get() {
        invoked = true;
        return "Your GradPack archives were downloaded.";
      },
    });
    expect(() => parseRunnerEvent(getter)).toThrow();
    expect(invoked).toBe(false);
  });
});
