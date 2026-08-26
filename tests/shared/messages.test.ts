import { describe, expect, it } from "vitest";
import {
  parseExtensionCommand,
  parseRunnerEvent,
} from "../../src/shared/messages";
import { MAX_ARCHIVE_RESOURCES } from "../../src/shared/constants";

const command = (value: Record<string, unknown>): Record<string, unknown> => ({
  channel: "gradpack/extension/v1",
  runId: "run-12345678",
  ...value,
});

const progress = (
  value: Record<string, unknown> = {},
): Record<string, unknown> => ({
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

const complete = (
  value: Record<string, unknown> = {},
): Record<string, unknown> => ({
  channel: "gradpack/runner/v1",
  type: "COMPLETE",
  runId: "run-12345678",
  message: "Your GradPack archives were downloaded.",
  packaging: "per-course",
  completedCourses: 2,
  completedCourseIds: [42, 43],
  failedCourses: 0,
  outputCount: 2,
  success: 1,
  failed: 0,
  unavailable: 0,
  unsupported: 0,
  external: 0,
  ...value,
});

const perCourseResourceCount = Math.floor(MAX_ARCHIVE_RESOURCES / 2) + 1;
const largePerCourseSelected = [
  {
    courseId: 42,
    advertisedBytes: 10,
    unknownSizeCount: 0,
    resourceCount: perCourseResourceCount,
  },
  {
    courseId: 43,
    advertisedBytes: 20,
    unknownSizeCount: 0,
    resourceCount: perCourseResourceCount,
  },
];
const largePerCourseAggregate = perCourseResourceCount * 2;

const largePlanEvent = (
  value: Record<string, unknown> = {},
): Record<string, unknown> => ({
  channel: "gradpack/runner/v1",
  type: "PLAN_READY",
  runId: "run-12345678",
  selected: largePerCourseSelected,
  advertisedBytes: 30,
  unknownSizeCount: 0,
  resourceCount: largePerCourseAggregate,
  requestedPackaging: "per-course",
  effectivePackaging: "per-course",
  fallbackReason: null,
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
    expect(parseExtensionCommand(command({ type: "CANCEL" }))).toMatchObject({
      type: "CANCEL",
    });
  });

  it.each([
    { type: "START_RUN", courseIds: [], packaging: "combined" },
    { type: "START_RUN", courseIds: [42, 42], packaging: "combined" },
    { type: "START_RUN", courseIds: [42], packaging: "unsafe" },
    { type: "START_RUN", courseIds: [-1], packaging: "per-course" },
    { type: "START_RUN", courseIds: [42.5], packaging: "per-course" },
    {
      type: "START_RUN",
      courseIds: [42],
      packaging: "per-course",
      url: "https://evil.test",
    },
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
          {
            courseId: 42,
            advertisedBytes: 10,
            unknownSizeCount: 1,
            resourceCount: 2,
          },
          {
            courseId: 43,
            advertisedBytes: 20,
            unknownSizeCount: 2,
            resourceCount: 3,
          },
        ],
        advertisedBytes: 30,
        unknownSizeCount: 3,
        resourceCount: 5,
        requestedPackaging: "combined",
        effectivePackaging: "per-course",
        fallbackReason: "unknown-size-files",
      }),
    ).toMatchObject({
      type: "PLAN_READY",
      effectivePackaging: "per-course",
      unknownSizeCount: 3,
      fallbackReason: "unknown-size-files",
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
      completedCourseIds: [42, 43],
      outputCount: 2,
    });
  });

  it.each([
    ["direct", {}],
    [
      "combined fallback",
      {
        requestedPackaging: "combined",
        fallbackReason: "combined-resource-limit-exceeded",
      },
    ],
  ])(
    "accepts a valid %s per-course plan whose safe aggregate exceeds one course cap",
    (_name, overrides) => {
      expect(() => parseRunnerEvent(largePlanEvent(overrides))).not.toThrow();
    },
  );

  it("rejects an over-cap selected course in per-course mode", () => {
    const selected = [
      {
        ...largePerCourseSelected[0],
        resourceCount: MAX_ARCHIVE_RESOURCES + 1,
      },
    ];
    expect(() =>
      parseRunnerEvent(
        largePlanEvent({
          selected,
          advertisedBytes: 10,
          resourceCount: MAX_ARCHIVE_RESOURCES + 1,
        }),
      ),
    ).toThrow();
  });

  it.each([
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["inconsistent", largePerCourseAggregate + 1],
  ])("rejects an %s aggregate resource count", (_name, resourceCount) => {
    expect(() => parseRunnerEvent(largePlanEvent({ resourceCount }))).toThrow();
  });

  it("keeps the aggregate resource cap for combined mode", () => {
    expect(() =>
      parseRunnerEvent(
        largePlanEvent({
          requestedPackaging: "combined",
          effectivePackaging: "combined",
        }),
      ),
    ).toThrow();
  });

  it("accepts and rejects combined plans at the exact classic ZIP entry boundary", () => {
    const event = (resourceCount: number): Record<string, unknown> => {
      const firstCount = Math.floor(resourceCount / 2);
      const secondCount = resourceCount - firstCount;
      return {
        channel: "gradpack/runner/v1",
        type: "PLAN_READY",
        runId: "run-12345678",
        selected: [
          {
            courseId: 42,
            advertisedBytes: 0,
            unknownSizeCount: 0,
            resourceCount: firstCount,
          },
          {
            courseId: 43,
            advertisedBytes: 0,
            unknownSizeCount: 0,
            resourceCount: secondCount,
          },
        ],
        advertisedBytes: 0,
        unknownSizeCount: 0,
        resourceCount,
        requestedPackaging: "combined",
        effectivePackaging: "combined",
        fallbackReason: null,
      };
    };

    expect(() => parseRunnerEvent(event(65_517))).not.toThrow();
    expect(() => parseRunnerEvent(event(65_518))).toThrow();
  });

  it("fails closed for invalid unknown-size plan summaries and fallback reasons", () => {
    const event = {
      channel: "gradpack/runner/v1",
      type: "PLAN_READY",
      runId: "run-12345678",
      selected: [
        {
          courseId: 42,
          advertisedBytes: 10,
          unknownSizeCount: 1,
          resourceCount: 2,
        },
        {
          courseId: 43,
          advertisedBytes: 20,
          unknownSizeCount: 2,
          resourceCount: 3,
        },
      ],
      advertisedBytes: 30,
      unknownSizeCount: 3,
      resourceCount: 5,
      requestedPackaging: "combined",
      effectivePackaging: "per-course",
      fallbackReason: "unknown-size-files",
    };
    const missingUnknownSizeCount = { ...event };
    Reflect.deleteProperty(missingUnknownSizeCount, "unknownSizeCount");
    const invalidEvents = [
      missingUnknownSizeCount,
      { ...event, unknownSizeCount: -1 },
      { ...event, unknownSizeCount: 1.5 },
      { ...event, unknownSizeCount: 2 },
      { ...event, unexpected: true },
      {
        ...event,
        selected: [
          {
            courseId: 42,
            advertisedBytes: 10,
            resourceCount: 2,
          },
          event.selected[1],
        ],
      },
      {
        ...event,
        selected: [
          { ...event.selected[0], unknownSizeCount: -1 },
          event.selected[1],
        ],
      },
      {
        ...event,
        selected: [
          { ...event.selected[0], unknownSizeCount: 1.5 },
          event.selected[1],
        ],
      },
      {
        ...event,
        selected: [{ ...event.selected[0], extra: true }, event.selected[1]],
      },
      { ...event, fallbackReason: "unsafe-fallback" },
    ];

    for (const invalid of invalidEvents) {
      expect(() => parseRunnerEvent(invalid)).toThrow();
    }
  });

  it("fails closed for impossible unknown-size count relationships", () => {
    const event = {
      channel: "gradpack/runner/v1",
      type: "PLAN_READY",
      runId: "run-12345678",
      selected: [
        {
          courseId: 42,
          advertisedBytes: 10,
          unknownSizeCount: 1,
          resourceCount: 2,
        },
        {
          courseId: 43,
          advertisedBytes: 20,
          unknownSizeCount: 2,
          resourceCount: 3,
        },
      ],
      advertisedBytes: 30,
      unknownSizeCount: 3,
      resourceCount: 5,
      requestedPackaging: "combined",
      effectivePackaging: "per-course",
      fallbackReason: "unknown-size-files",
    };
    const invalidEvents = [
      {
        ...event,
        selected: [
          { ...event.selected[0], unknownSizeCount: 3 },
          event.selected[1],
        ],
        unknownSizeCount: 5,
      },
      {
        ...event,
        selected: [
          { ...event.selected[0], unknownSizeCount: 3 },
          { ...event.selected[1], unknownSizeCount: 3 },
        ],
        unknownSizeCount: 6,
      },
      {
        ...event,
        selected: [
          { ...event.selected[0], unknownSizeCount: 0 },
          { ...event.selected[1], unknownSizeCount: 0 },
        ],
        unknownSizeCount: 0,
      },
    ];

    for (const invalid of invalidEvents) {
      expect(() => parseRunnerEvent(invalid)).toThrow();
    }
  });

  it.each([
    "combined-size-exceeded",
    "combined-resource-limit-exceeded",
  ] as const)(
    "rejects a combined plan with unknown-size files and %s fallback",
    (fallbackReason) => {
      expect(() =>
        parseRunnerEvent({
          channel: "gradpack/runner/v1",
          type: "PLAN_READY",
          runId: "run-12345678",
          selected: [
            {
              courseId: 42,
              advertisedBytes: 10,
              unknownSizeCount: 1,
              resourceCount: 2,
            },
            {
              courseId: 43,
              advertisedBytes: 20,
              unknownSizeCount: 0,
              resourceCount: 3,
            },
          ],
          advertisedBytes: 30,
          unknownSizeCount: 1,
          resourceCount: 5,
          requestedPackaging: "combined",
          effectivePackaging: "per-course",
          fallbackReason,
        }),
      ).toThrow();
    },
  );

  it("accepts direct per-course and zero-unknown combined fallback plans", () => {
    const selected = [
      {
        courseId: 42,
        advertisedBytes: 10,
        unknownSizeCount: 0,
        resourceCount: 2,
      },
    ];
    expect(() =>
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "PLAN_READY",
        runId: "run-12345678",
        selected,
        advertisedBytes: 10,
        unknownSizeCount: 0,
        resourceCount: 2,
        requestedPackaging: "per-course",
        effectivePackaging: "per-course",
        fallbackReason: null,
      }),
    ).not.toThrow();
    expect(() =>
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "PLAN_READY",
        runId: "run-12345678",
        selected,
        advertisedBytes: 10,
        unknownSizeCount: 0,
        resourceCount: 2,
        requestedPackaging: "combined",
        effectivePackaging: "per-course",
        fallbackReason: "combined-size-exceeded",
      }),
    ).not.toThrow();
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
    { success: MAX_ARCHIVE_RESOURCES * 2 + 1 },
    { success: MAX_ARCHIVE_RESOURCES * 2, failed: 1 },
    { completedCourses: 3, failedCourses: 0, outputCount: 0 },
    { completedCourses: 1, failedCourses: 1, outputCount: 0 },
  ])("rejects over-cap or inconsistent terminal totals %#", (value) => {
    expect(() => parseRunnerEvent(complete(value))).toThrow();
  });

  it("accepts aggregate COMPLETE outcomes across completed courses", () => {
    expect(() =>
      parseRunnerEvent(
        complete({
          completedCourses: 2,
          outputCount: 2,
          success: MAX_ARCHIVE_RESOURCES + 1,
        }),
      ),
    ).not.toThrow();
  });

  it("accepts exact completed course IDs for a partial per-course result", () => {
    expect(
      parseRunnerEvent(
        complete({
          completedCourseIds: [42, 44],
          failedCourses: 1,
          success: 2,
        }),
      ),
    ).toMatchObject({
      type: "COMPLETE",
      completedCourses: 2,
      completedCourseIds: [42, 44],
      failedCourses: 1,
    });
  });

  it.each([
    { completedCourseIds: [42, 42] },
    { completedCourseIds: [0, 43] },
    { completedCourseIds: [42.5, 43] },
    { completedCourseIds: [42] },
    { completedCourseIds: [42, 43, 44] },
  ])("rejects malformed or inconsistent completed course IDs %#", (value) => {
    expect(() => parseRunnerEvent(complete(value))).toThrow();
  });

  it("rejects COMPLETE outcomes above the completed-course bound", () => {
    expect(() =>
      parseRunnerEvent(
        complete({
          completedCourses: 2,
          outputCount: 2,
          success: MAX_ARCHIVE_RESOURCES * 2 + 1,
        }),
      ),
    ).toThrow();
  });

  it("rejects COMPLETE when the completed-course bound overflows", () => {
    const completedCourses =
      Math.floor(Number.MAX_SAFE_INTEGER / MAX_ARCHIVE_RESOURCES) + 1;
    expect(() =>
      parseRunnerEvent(
        complete({
          completedCourses,
          completedCourseIds: [42, 43],
          outputCount: completedCourses,
        }),
      ),
    ).toThrow();
  });

  it("rejects an extra top-level or nested field", () => {
    expect(() =>
      parseRunnerEvent({ ...complete(), headers: "secret" }),
    ).toThrow();
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
    expect(() =>
      parseRunnerEvent({ ...complete(), message: "private" }),
    ).toThrow();
    expect(() =>
      parseRunnerEvent({ ...progress(), stage: "upload" }),
    ).toThrow();
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
