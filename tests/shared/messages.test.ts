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
  currentPartIndex: 1,
  totalParts: 1,
  totalArchiveParts: 2,
  completedParts: 0,
  failedParts: 0,
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
  completedParts: 2,
  failedParts: 0,
  success: 1,
  failed: 0,
  unavailable: 0,
  unsupported: 0,
  external: 0,
  ...value,
});

const zeroOutputComplete = (
  value: Record<string, unknown> = {},
): Record<string, unknown> =>
  complete({
    message: "No course archives were downloaded.",
    packaging: "per-course",
    completedCourses: 0,
    completedCourseIds: [],
    failedCourses: 2,
    outputCount: 0,
    completedParts: 0,
    failedParts: 2,
    success: 0,
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
    moduleDiscovery: "available",
    advertisedBytes: 10,
    unknownSizeCount: 0,
    resourceCount: perCourseResourceCount,
    folderPathFallbackCount: 0,
    archivePartCount: 1,
  },
  {
    courseId: 43,
    moduleDiscovery: "available",
    advertisedBytes: 20,
    unknownSizeCount: 0,
    resourceCount: perCourseResourceCount,
    folderPathFallbackCount: 0,
    archivePartCount: 1,
  },
];
const largePerCourseAggregate = perCourseResourceCount * 2;

const largePlanEvent = (
  value: Record<string, unknown> = {},
): Record<string, unknown> => ({
  channel: "gradpack/runner/v1",
  type: "PLAN_READY",
  runId: "run-12345678",
  requestedCourseCount: 2,
  selected: largePerCourseSelected,
  skipped: [],
  advertisedBytes: 30,
  unknownSizeCount: 0,
  resourceCount: largePerCourseAggregate,
  totalPlannedParts: 2,
  expectedArchiveCount: 2,
  requestedPackaging: "per-course",
  effectivePackaging: "per-course",
  fallbackReason: null,
  ...value,
});

const resilientPlanEvent = (
  value: Record<string, unknown> = {},
): Record<string, unknown> => ({
  channel: "gradpack/runner/v1",
  type: "PLAN_READY",
  runId: "run-12345678",
  requestedCourseCount: 2,
  selected: [
    {
      courseId: 42,
      moduleDiscovery: "available",
      advertisedBytes: 10,
      unknownSizeCount: 1,
      resourceCount: 2,
      folderPathFallbackCount: 0,
      archivePartCount: 1,
    },
  ],
  skipped: [{ courseId: 43, category: "canvas-unavailable" }],
  advertisedBytes: 10,
  unknownSizeCount: 1,
  resourceCount: 2,
  totalPlannedParts: 1,
  expectedArchiveCount: 1,
  requestedPackaging: "combined",
  effectivePackaging: "per-course",
  fallbackReason: "unknown-size-files",
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
  it("accepts strict discovery progress", () => {
    expect(
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "DISCOVERY_PROGRESS",
        runId: "run-12345678",
        completed: 2,
        total: 5,
        currentCourseId: 43,
      }),
    ).toMatchObject({
      type: "DISCOVERY_PROGRESS",
      completed: 2,
      total: 5,
      currentCourseId: 43,
    });
  });

  it.each([
    { completed: -1, total: 5, currentCourseId: 43 },
    { completed: 6, total: 5, currentCourseId: 43 },
    { completed: 0, total: 0, currentCourseId: 43 },
    { completed: 1, total: 5, currentCourseId: 0 },
    { completed: 1, total: 5, currentCourseId: 43, error: "private" },
  ])("rejects invalid discovery progress %#", (values) => {
    expect(() =>
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "DISCOVERY_PROGRESS",
        runId: "run-12345678",
        ...values,
      }),
    ).toThrow();
  });

  it("accepts partial and all-skipped resilient plans", () => {
    expect(parseRunnerEvent(resilientPlanEvent())).toMatchObject({
      requestedCourseCount: 2,
      selected: [{ courseId: 42, moduleDiscovery: "available" }],
      skipped: [{ courseId: 43, category: "canvas-unavailable" }],
    });
    expect(
      parseRunnerEvent(
        resilientPlanEvent({
          requestedCourseCount: 2,
          selected: [],
          skipped: [
            { courseId: 42, category: "size-limit" },
            { courseId: 43, category: "safety-validation" },
          ],
          advertisedBytes: 0,
          unknownSizeCount: 0,
          resourceCount: 0,
          totalPlannedParts: 0,
          expectedArchiveCount: 0,
          requestedPackaging: "per-course",
          effectivePackaging: "per-course",
          fallbackReason: null,
        }),
      ),
    ).toMatchObject({
      selected: [],
      skipped: [
        { courseId: 42, category: "size-limit" },
        { courseId: 43, category: "safety-validation" },
      ],
    });
  });

  it.each([undefined, null, "", "unavailable", false])(
    "rejects selected-course module discovery state %s",
    (moduleDiscovery) => {
      const event = resilientPlanEvent();
      const selected = event.selected as Record<string, unknown>[];
      selected[0] = { ...selected[0], moduleDiscovery };
      expect(() => parseRunnerEvent(event)).toThrow(TypeError);
    },
  );

  it.each([
    { requestedCourseCount: 3 },
    { requestedCourseCount: 1 },
    { skipped: [{ courseId: 42, category: "canvas-unavailable" }] },
    {
      skipped: [
        { courseId: 43, category: "canvas-unavailable" },
        { courseId: 43, category: "unexpected-local" },
      ],
      requestedCourseCount: 3,
    },
    { skipped: [{ courseId: 43, category: "raw-exception" }] },
    {
      skipped: [
        {
          courseId: 43,
          category: "canvas-unavailable",
          message: "private",
        },
      ],
    },
    { advertisedBytes: 11 },
    { unknownSizeCount: 0 },
    { resourceCount: 3 },
  ])("rejects invalid resilient plans %#", (values) => {
    expect(() => parseRunnerEvent(resilientPlanEvent(values))).toThrow();
  });

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
        requestedCourseCount: 2,
        selected: [
          {
            courseId: 42,
            moduleDiscovery: "available",
            advertisedBytes: 10,
            unknownSizeCount: 1,
            resourceCount: 2,
            folderPathFallbackCount: 0,
            archivePartCount: 1,
          },
          {
            courseId: 43,
            moduleDiscovery: "available",
            advertisedBytes: 20,
            unknownSizeCount: 2,
            resourceCount: 3,
            folderPathFallbackCount: 0,
            archivePartCount: 1,
          },
        ],
        skipped: [],
        advertisedBytes: 30,
        unknownSizeCount: 3,
        resourceCount: 5,
        totalPlannedParts: 2,
        expectedArchiveCount: 2,
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

  it("accepts a mixed multipart plan and more downloaded parts than courses", () => {
    const event = resilientPlanEvent({
      selected: [
        {
          courseId: 42,
          moduleDiscovery: "available",
          advertisedBytes: 10,
          unknownSizeCount: 1,
          resourceCount: 2,
          folderPathFallbackCount: 1,
          archivePartCount: 2,
        },
      ],
      totalPlannedParts: 2,
      expectedArchiveCount: 2,
      fallbackReason: "multipart-course",
    });
    expect(parseRunnerEvent(event)).toMatchObject({
      totalPlannedParts: 2,
      expectedArchiveCount: 2,
      fallbackReason: "multipart-course",
    });
    expect(
      parseRunnerEvent(
        complete({
          completedCourses: 1,
          completedCourseIds: [42],
          completedParts: 2,
          outputCount: 2,
        }),
      ),
    ).toMatchObject({ completedCourses: 1, completedParts: 2, outputCount: 2 });
  });

  it.each([
    { totalPlannedParts: 2 },
    { expectedArchiveCount: 2 },
    {
      selected: [
        {
          courseId: 42,
          moduleDiscovery: "available",
          advertisedBytes: 10,
          unknownSizeCount: 1,
          resourceCount: 2,
          folderPathFallbackCount: 3,
          archivePartCount: 1,
        },
      ],
    },
    {
      selected: [
        {
          courseId: 42,
          moduleDiscovery: "available",
          advertisedBytes: 10,
          unknownSizeCount: 1,
          resourceCount: 2,
          folderPathFallbackCount: 0,
          archivePartCount: 0,
        },
      ],
    },
  ])("rejects invalid multipart plan counts %#", (overrides) => {
    expect(() => parseRunnerEvent(resilientPlanEvent(overrides))).toThrow();
  });

  it.each([
    { currentPartIndex: 0 },
    { currentPartIndex: 2, totalParts: 1 },
    { completedParts: 2, failedParts: 1, totalArchiveParts: 2 },
  ])("rejects invalid part progress %#", (overrides) => {
    expect(() => parseRunnerEvent(progress(overrides))).toThrow();
  });

  it("accepts a strict zero-output completion", () => {
    expect(parseRunnerEvent(zeroOutputComplete())).toMatchObject({
      type: "COMPLETE",
      message: "No course archives were downloaded.",
      packaging: "per-course",
      completedCourses: 0,
      completedCourseIds: [],
      failedCourses: 2,
      outputCount: 0,
      success: 0,
      failed: 0,
      unavailable: 0,
      unsupported: 0,
      external: 0,
    });
  });

  it.each([
    ["zero failed courses", { failedCourses: 0 }],
    ["combined packaging", { packaging: "combined" }],
    [
      "download-success message",
      { message: "Your GradPack archives were downloaded." },
    ],
    ["non-empty completed IDs", { completedCourseIds: [42] }],
    ["positive success count", { success: 1 }],
    ["positive failed count", { failed: 1 }],
    ["positive unavailable count", { unavailable: 1 }],
    ["positive unsupported count", { unsupported: 1 }],
    ["positive external count", { external: 1 }],
    ["mismatched output count", { outputCount: 1 }],
  ] as const)("rejects zero-output completion with %s", (_name, value) => {
    expect(() => parseRunnerEvent(zeroOutputComplete(value))).toThrow();
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
        requestedCourseCount: 2,
        selected: [
          {
            courseId: 42,
            moduleDiscovery: "available",
            advertisedBytes: 0,
            unknownSizeCount: 0,
            resourceCount: firstCount,
            folderPathFallbackCount: 0,
            archivePartCount: 1,
          },
          {
            courseId: 43,
            moduleDiscovery: "available",
            advertisedBytes: 0,
            unknownSizeCount: 0,
            resourceCount: secondCount,
            folderPathFallbackCount: 0,
            archivePartCount: 1,
          },
        ],
        skipped: [],
        advertisedBytes: 0,
        unknownSizeCount: 0,
        resourceCount,
        totalPlannedParts: 2,
        expectedArchiveCount: 1,
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
      requestedCourseCount: 2,
      selected: [
        {
          courseId: 42,
          moduleDiscovery: "available",
          advertisedBytes: 10,
          unknownSizeCount: 1,
          resourceCount: 2,
          folderPathFallbackCount: 0,
          archivePartCount: 1,
        },
        {
          courseId: 43,
          moduleDiscovery: "available",
          advertisedBytes: 20,
          unknownSizeCount: 2,
          resourceCount: 3,
          folderPathFallbackCount: 0,
          archivePartCount: 1,
        },
      ],
      skipped: [],
      advertisedBytes: 30,
      unknownSizeCount: 3,
      resourceCount: 5,
      totalPlannedParts: 2,
      expectedArchiveCount: 2,
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
            moduleDiscovery: "available",
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
      requestedCourseCount: 2,
      selected: [
        {
          courseId: 42,
          moduleDiscovery: "available",
          advertisedBytes: 10,
          unknownSizeCount: 1,
          resourceCount: 2,
          folderPathFallbackCount: 0,
          archivePartCount: 1,
        },
        {
          courseId: 43,
          moduleDiscovery: "available",
          advertisedBytes: 20,
          unknownSizeCount: 2,
          resourceCount: 3,
          folderPathFallbackCount: 0,
          archivePartCount: 1,
        },
      ],
      skipped: [],
      advertisedBytes: 30,
      unknownSizeCount: 3,
      resourceCount: 5,
      totalPlannedParts: 2,
      expectedArchiveCount: 2,
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
          requestedCourseCount: 2,
          selected: [
            {
              courseId: 42,
              moduleDiscovery: "available",
              advertisedBytes: 10,
              unknownSizeCount: 1,
              resourceCount: 2,
              folderPathFallbackCount: 0,
              archivePartCount: 1,
            },
            {
              courseId: 43,
              moduleDiscovery: "available",
              advertisedBytes: 20,
              unknownSizeCount: 0,
              resourceCount: 3,
              folderPathFallbackCount: 0,
              archivePartCount: 1,
            },
          ],
          skipped: [],
          advertisedBytes: 30,
          unknownSizeCount: 1,
          resourceCount: 5,
          totalPlannedParts: 2,
          expectedArchiveCount: 2,
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
        moduleDiscovery: "available",
        advertisedBytes: 10,
        unknownSizeCount: 0,
        resourceCount: 2,
        folderPathFallbackCount: 0,
        archivePartCount: 1,
      },
    ];
    expect(() =>
      parseRunnerEvent({
        channel: "gradpack/runner/v1",
        type: "PLAN_READY",
        runId: "run-12345678",
        requestedCourseCount: 1,
        selected,
        skipped: [],
        advertisedBytes: 10,
        unknownSizeCount: 0,
        resourceCount: 2,
        totalPlannedParts: 1,
        expectedArchiveCount: 1,
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
        requestedCourseCount: 1,
        selected,
        skipped: [],
        advertisedBytes: 10,
        unknownSizeCount: 0,
        resourceCount: 2,
        totalPlannedParts: 1,
        expectedArchiveCount: 1,
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
          failedParts: 1,
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
