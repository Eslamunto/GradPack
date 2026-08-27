import { beforeAll, describe, expect, it, vi } from "vitest";
import { EXTENSION_CHANNEL, RUNNER_CHANNEL } from "../../src/shared/constants";
import { syntheticCourse } from "../fixtures/course-plan";

type RuntimeListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0];
let listener!: RuntimeListener;
let tabUpdatedListener!: Parameters<
  typeof chrome.tabs.onUpdated.addListener
>[0];
const runtimeSendMessage = vi.fn().mockResolvedValue({ tabId: 17 });
const tabsSendMessage = vi.fn().mockResolvedValue(undefined);
const randomUuidValues: Array<ReturnType<Crypto["randomUUID"]>> = [
  "12345678-1234-1234-1234-123456789abc",
  "87654321-4321-4321-4321-cba987654321",
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "cccccccc-cccc-cccc-cccc-cccccccccccc",
  "dddddddd-dddd-dddd-dddd-dddddddddddd",
];
const secondCourse = {
  ...syntheticCourse,
  id: 102,
  name: "Second Course",
  courseCode: "SYN-102",
};
const thirdCourse = {
  ...syntheticCourse,
  id: 103,
  name: "Concluded Course",
  courseCode: "SYN-103",
  workflowState: "completed",
  concluded: true,
};
const sender = (
  id = "gradpack-extension",
  tabId = 17,
): chrome.runtime.MessageSender =>
  ({ id, tab: { id: tabId } }) as chrome.runtime.MessageSender;
const clickButton = (label: string): void => {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  (button as HTMLButtonElement).click();
};

beforeAll(async () => {
  document.body.innerHTML = '<main id="app"></main>';
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => randomUuidValues.shift() ?? "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  );
  vi.stubGlobal("chrome", {
    runtime: {
      id: "gradpack-extension",
      onMessage: {
        addListener: vi.fn((value: RuntimeListener) => (listener = value)),
      },
      sendMessage: runtimeSendMessage,
    },
    tabs: {
      sendMessage: tabsSendMessage,
      onRemoved: { addListener: vi.fn() },
      onUpdated: {
        addListener: vi.fn((value) => {
          tabUpdatedListener = value;
        }),
      },
    },
  });
  await import("../../src/sidepanel/main");
});

describe("accessible Side Panel flow", () => {
  it("correlates a multi-course plan with local progress and partial completion", async () => {
    expect(document.querySelector("h1")?.textContent).toBe("Connect to Canvas");
    expect(document.body.textContent).toContain("250 MB");
    expect(document.body.textContent).toContain("processed locally");
    clickButton("Connect");
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId: "run-12345678-1234-1234-1234-123456789abc",
      }),
    );

    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "COURSES",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        courses: [syntheticCourse, secondCourse, thirdCourse],
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Choose courses");
    const continueButton = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Continue",
    ) as HTMLButtonElement;
    const selectAll = document.querySelector<HTMLInputElement>(
      'input[name="course-all"]',
    );
    expect(selectAll).toBeInstanceOf(HTMLInputElement);
    expect(selectAll?.type).toBe("checkbox");
    expect(selectAll?.closest("label")?.textContent).toContain(
      "Select all courses",
    );
    expect(selectAll?.checked).toBe(false);
    expect(selectAll?.indeterminate).toBe(false);
    expect(document.querySelector(".selection-count")?.textContent).toBe(
      "0 of 3 courses selected.",
    );
    expect(continueButton.disabled).toBe(true);

    selectAll?.click();
    let courseCheckboxes = document.querySelectorAll<HTMLInputElement>(
      'input[name="course"]',
    );
    expect(courseCheckboxes).toHaveLength(3);
    expect([...courseCheckboxes].every((checkbox) => checkbox.checked)).toBe(
      true,
    );
    expect(
      document.querySelector<HTMLInputElement>('input[name="course-all"]')
        ?.checked,
    ).toBe(true);
    expect(document.activeElement).toBe(
      document.querySelector<HTMLInputElement>('input[name="course-all"]'),
    );
    expect(document.querySelector(".selection-count")?.textContent).toBe(
      "3 of 3 courses selected.",
    );
    expect(
      (
        [...document.querySelectorAll("button")].find(
          (candidate) => candidate.textContent === "Continue",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    courseCheckboxes[1]!.click();
    const partialSelectAll = document.querySelector<HTMLInputElement>(
      'input[name="course-all"]',
    )!;
    expect(partialSelectAll.checked).toBe(false);
    expect(partialSelectAll.indeterminate).toBe(true);
    expect(document.activeElement).toBe(
      document.querySelectorAll<HTMLInputElement>('input[name="course"]')[1],
    );
    expect(document.querySelector(".selection-count")?.textContent).toBe(
      "2 of 3 courses selected.",
    );

    partialSelectAll.click();
    courseCheckboxes = document.querySelectorAll<HTMLInputElement>(
      'input[name="course"]',
    );
    expect([...courseCheckboxes].every((checkbox) => checkbox.checked)).toBe(
      true,
    );
    expect(document.activeElement).toBe(
      document.querySelector<HTMLInputElement>('input[name="course-all"]'),
    );
    clickButton("Continue");
    expect(document.querySelector("h1")?.textContent).toBe(
      "Configure archives",
    );
    const combined = document.querySelector<HTMLInputElement>(
      'input[value="combined"]',
    )!;
    combined.checked = true;
    combined.dispatchEvent(new Event("change"));
    clickButton("Discover selected courses");
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "START_RUN",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        courseIds: [101, 102, 103],
        packaging: "combined",
      }),
    );

    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "DISCOVERY_PROGRESS",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        completed: 2,
        total: 3,
        currentCourseId: 102,
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Checking course 2 of 3",
    );

    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "PLAN_READY",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        requestedCourseCount: 3,
        selected: [
          {
            courseId: 101,
            advertisedBytes: 19,
            unknownSizeCount: 0,
            resourceCount: 2,
          },
          {
            courseId: 102,
            advertisedBytes: 20,
            unknownSizeCount: 0,
            resourceCount: 3,
          },
        ],
        skipped: [{ courseId: 103, category: "canvas-unavailable" }],
        advertisedBytes: 39,
        unknownSizeCount: 0,
        resourceCount: 5,
        requestedPackaging: "combined",
        effectivePackaging: "combined",
        fallbackReason: null,
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Review plan");
    expect(document.querySelector(".unknown-size-notice")).toBeNull();
    expect(document.body.textContent).toContain("Discovery is complete");
    expect(document.body.textContent).toContain("2 courses ready; 1 skipped");
    expect(document.body.textContent).toContain("Concluded Course");
    expect(document.body.textContent).toContain(
      "Canvas did not provide usable course metadata.",
    );
    expect(document.body.textContent).not.toContain("private");
    clickButton("Continue with ready courses");
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "CONFIRM_PLAN",
        runId: "run-12345678-1234-1234-1234-123456789abc",
      }),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Packing courses");
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "course 1 of 2; 0 of 2",
    );
    const cancel = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Cancel",
    ) as HTMLButtonElement;
    cancel.focus();
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "PROGRESS",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        stage: "download",
        currentCourseId: 102,
        currentCourseIndex: 1,
        totalCourses: 3,
        completedCourses: 1,
        completed: 1,
        total: 5,
        failed: 0,
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "course 1 of 2; 0 of 2",
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "PROGRESS",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        stage: "download",
        currentCourseId: 102,
        currentCourseIndex: 1,
        totalCourses: 2,
        completedCourses: 1,
        completed: 1,
        total: 3,
        failed: 0,
      },
      sender(),
      vi.fn(),
    );
    expect(document.activeElement).toBe(cancel);
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "course 2 of 2",
    );
    const complete = (overrides: Record<string, unknown> = {}): void => {
      listener(
        {
          channel: RUNNER_CHANNEL,
          type: "COMPLETE",
          runId: "run-12345678-1234-1234-1234-123456789abc",
          message: "Your GradPack archives were downloaded.",
          packaging: "per-course",
          completedCourses: 1,
          completedCourseIds: [101],
          failedCourses: 1,
          outputCount: 1,
          success: 2,
          failed: 0,
          unavailable: 0,
          unsupported: 0,
          external: 0,
          ...overrides,
        },
        sender(),
        vi.fn(),
      );
    };
    complete({ packaging: "combined" });
    expect(document.querySelector("h1")?.textContent).toBe("Packing courses");
    complete({ completedCourseIds: [999] });
    expect(document.querySelector("h1")?.textContent).toBe("Packing courses");
    complete({ completedCourses: 2, completedCourseIds: [101, 101] });
    expect(document.querySelector("h1")?.textContent).toBe("Packing courses");
    complete({ completedCourses: 2, completedCourseIds: [101, 102] });
    expect(document.querySelector("h1")?.textContent).toBe("Packing courses");
    complete({ success: 1 });
    expect(document.querySelector("h1")?.textContent).toBe("Packing courses");
    complete();
    expect(document.querySelector("h1")?.textContent).toBe(
      "Archives downloaded",
    );
    expect(document.querySelector(".archive-summary")?.textContent).toContain(
      "1 archive(s) downloaded; 1 course(s) completed; 1 course(s) failed",
    );
    expect(document.body.textContent).toContain("2 unfinished course(s)");
    expect(document.body.textContent).toContain("Second Course");
    expect(document.body.textContent).toContain("Concluded Course");

    clickButton("Retry unfinished courses");
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId: "run-87654321-4321-4321-4321-cba987654321",
      }),
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "COURSES",
        runId: "run-87654321-4321-4321-4321-cba987654321",
        courses: [syntheticCourse, secondCourse, thirdCourse],
      },
      sender(),
      vi.fn(),
    );
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "START_RUN",
        runId: "run-87654321-4321-4321-4321-cba987654321",
        courseIds: [102, 103],
        packaging: "combined",
      }),
    );
    expect(document.querySelector("h1")?.textContent).toBe(
      "Configure archives",
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "PLAN_READY",
        runId: "run-87654321-4321-4321-4321-cba987654321",
        requestedCourseCount: 2,
        selected: [
          {
            courseId: 102,
            advertisedBytes: 20,
            unknownSizeCount: 0,
            resourceCount: 3,
          },
          {
            courseId: 103,
            advertisedBytes: 21,
            unknownSizeCount: 0,
            resourceCount: 4,
          },
        ],
        skipped: [],
        advertisedBytes: 41,
        unknownSizeCount: 0,
        resourceCount: 7,
        requestedPackaging: "combined",
        effectivePackaging: "combined",
        fallbackReason: null,
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Review plan");
    expect(
      tabsSendMessage.mock.calls.some(
        ([, command]) =>
          (command as { type?: unknown }).type === "CONFIRM_PLAN" &&
          (command as { runId?: unknown }).runId ===
            "run-87654321-4321-4321-4321-cba987654321",
      ),
    ).toBe(false);

    clickButton("Continue with ready courses");
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "CONFIRM_PLAN",
        runId: "run-87654321-4321-4321-4321-cba987654321",
      }),
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "COMPLETE",
        runId: "run-87654321-4321-4321-4321-cba987654321",
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
      },
      sender(),
      vi.fn(),
    );
    const zeroOutputHeading = document.querySelector("h1")?.textContent;
    const zeroOutputText = document.body.textContent;
    const zeroOutputSummary =
      document.querySelector(".archive-summary")?.textContent;

    clickButton("Retry unfinished courses");
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId: "run-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      }),
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "COURSES",
        runId: "run-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        courses: [syntheticCourse, secondCourse, thirdCourse],
      },
      sender(),
      vi.fn(),
    );
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "START_RUN",
        runId: "run-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        courseIds: [102, 103],
        packaging: "combined",
      }),
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "PLAN_READY",
        runId: "run-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        requestedCourseCount: 2,
        selected: [
          {
            courseId: 102,
            advertisedBytes: 20,
            unknownSizeCount: 0,
            resourceCount: 3,
          },
          {
            courseId: 103,
            advertisedBytes: 21,
            unknownSizeCount: 0,
            resourceCount: 4,
          },
        ],
        skipped: [],
        advertisedBytes: 41,
        unknownSizeCount: 0,
        resourceCount: 7,
        requestedPackaging: "combined",
        effectivePackaging: "combined",
        fallbackReason: null,
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Review plan");
    expect(zeroOutputHeading).toBe("No archives downloaded");
    expect(zeroOutputText).toContain("No course archives were downloaded.");
    expect(zeroOutputSummary).toContain(
      "0 archive(s) downloaded; 0 course(s) completed; 2 course(s) failed",
    );
    expect(zeroOutputText).toContain("2 unfinished course(s)");
    expect(zeroOutputText).toContain("Second Course");
    expect(zeroOutputText).toContain("Concluded Course");
  });

  it("sends one cancellation command and rejects stale or mismatched events", async () => {
    clickButton("Cancel");
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "CANCELLED",
        runId: "run-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        message: "Packing was cancelled.",
      },
      sender(),
      vi.fn(),
    );
    clickButton("Try again");
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId: "run-cccccccc-cccc-cccc-cccc-cccccccccccc",
      }),
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "COURSES",
        runId: "run-cccccccc-cccc-cccc-cccc-cccccccccccc",
        courses: [syntheticCourse],
      },
      sender(),
      vi.fn(),
    );
    const checkbox = document.querySelector<HTMLInputElement>(
      'input[name="course"]',
    )!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    clickButton("Continue");
    const combined = document.querySelector<HTMLInputElement>(
      'input[value="combined"]',
    )!;
    combined.checked = true;
    combined.dispatchEvent(new Event("change"));
    clickButton("Discover selected courses");
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "PLAN_READY",
        runId: "run-cccccccc-cccc-cccc-cccc-cccccccccccc",
        requestedCourseCount: 1,
        selected: [],
        skipped: [{ courseId: 101, category: "unexpected-local" }],
        advertisedBytes: 0,
        unknownSizeCount: 0,
        resourceCount: 0,
        requestedPackaging: "combined",
        effectivePackaging: "combined",
        fallbackReason: null,
      },
      sender(),
      vi.fn(),
    );
    expect(document.body.textContent).toContain("0 courses ready; 1 skipped");
    expect(document.body.textContent).toContain(
      "A local course operation could not be completed.",
    );
    expect(
      [...document.querySelectorAll("button")].some(
        (candidate) => candidate.textContent === "Continue with ready courses",
      ),
    ).toBe(false);
    clickButton("Retry skipped courses");
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId: "run-dddddddd-dddd-dddd-dddd-dddddddddddd",
      }),
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "COURSES",
        runId: "run-dddddddd-dddd-dddd-dddd-dddddddddddd",
        courses: [syntheticCourse],
      },
      sender(),
      vi.fn(),
    );
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "START_RUN",
        runId: "run-dddddddd-dddd-dddd-dddd-dddddddddddd",
        courseIds: [101],
        packaging: "combined",
      }),
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "PLAN_READY",
        runId: "run-dddddddd-dddd-dddd-dddd-dddddddddddd",
        requestedCourseCount: 1,
        selected: [
          {
            courseId: 101,
            advertisedBytes: 0,
            unknownSizeCount: 1,
            resourceCount: 1,
          },
        ],
        skipped: [],
        advertisedBytes: 0,
        unknownSizeCount: 1,
        resourceCount: 1,
        requestedPackaging: "combined",
        effectivePackaging: "per-course",
        fallbackReason: "unknown-size-files",
      },
      sender(),
      vi.fn(),
    );
    expect(document.body.textContent).toContain("Unknown-size files: 1");
    expect(document.body.textContent).toContain(
      "stream them under the hard 250 MiB per-course cap",
    );
    expect(document.body.textContent).toContain(
      "combined archive will be changed to separate course ZIPs",
    );
    clickButton("Cancel");
    await vi.waitFor(() =>
      expect(
        tabsSendMessage.mock.calls.filter(
          ([, command]) =>
            (command as { type?: unknown }).type === "CANCEL" &&
            (command as { runId?: unknown }).runId ===
              "run-dddddddd-dddd-dddd-dddd-dddddddddddd",
        ),
      ).toHaveLength(1),
    );
    expect(document.body.textContent).toContain("Cancelling…");
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "CANCELLED",
        runId: "run-other123",
        message: "Packing was cancelled.",
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Review plan");
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "CANCELLED",
        runId: "run-dddddddd-dddd-dddd-dddd-dddddddddddd",
        message: "Packing was cancelled.",
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("GradPack stopped");
  });

  it("stops on navigation and ignores events from another tab", async () => {
    clickButton("Try again");
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId: "run-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      }),
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "COURSES",
        runId: "run-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        courses: [syntheticCourse],
      },
      sender("other"),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Connect to Canvas");
    tabUpdatedListener(17, { status: "loading" }, {} as chrome.tabs.Tab);
    expect(document.querySelector("h1")?.textContent).toBe("GradPack stopped");
  });
});
