import { beforeAll, describe, expect, it, vi } from "vitest";
import { EXTENSION_CHANNEL, RUNNER_CHANNEL } from "../../src/shared/constants";
import { syntheticCourse } from "../fixtures/course-plan";

type RuntimeListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0];
let listener!: RuntimeListener;
const runtimeSendMessage = vi.fn().mockResolvedValue({ tabId: 17 });
const tabsSendMessage = vi.fn().mockResolvedValue(undefined);
const sender = (
  id = "gradpack-extension",
  tabId = 17,
): chrome.runtime.MessageSender =>
  ({ id, tab: { id: tabId } }) as chrome.runtime.MessageSender;

beforeAll(async () => {
  document.body.innerHTML = '<main id="app"></main>';
  vi.spyOn(crypto, "randomUUID")
    .mockReturnValueOnce("12345678-1234-1234-1234-123456789abc")
    .mockReturnValueOnce("87654321-4321-4321-4321-cba987654321")
    .mockReturnValue("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  vi.stubGlobal("chrome", {
    runtime: {
      id: "gradpack-extension",
      onMessage: {
        addListener: vi.fn((value: RuntimeListener) => {
          listener = value;
        }),
      },
      sendMessage: runtimeSendMessage,
    },
    tabs: { sendMessage: tabsSendMessage },
  });
  await import("../../src/sidepanel/main");
});

describe("accessible Side Panel flow", () => {
  it("moves through the approved flow with correlated messages and a fresh retry run", async () => {
    expect(document.querySelector("h1")?.textContent).toBe("Connect to Canvas");
    expect(document.body.textContent).toContain("250 MB");
    expect(document.body.textContent).toContain("processed locally");
    expect(document.body.textContent).toContain("responsible");
    document.querySelector<HTMLButtonElement>("button")!.click();
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
        runId: "run-other123",
        courses: [],
      },
      sender(),
      vi.fn(),
    );
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "COURSES",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        courses: [syntheticCourse],
      },
      sender("other"),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Connect to Canvas");

    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "COURSES",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        courses: [syntheticCourse],
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Choose one course");
    expect(document.querySelector("fieldset legend")?.textContent).toBe(
      "Accessible courses",
    );
    expect(document.querySelector("label")?.textContent).toContain("SYN-101");
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "COMPLETE",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        message: "Your course ZIP was downloaded.",
        success: 0,
        failed: 0,
        unavailable: 0,
        unsupported: 0,
        external: 0,
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Choose one course");
    const radio = document.querySelector<HTMLInputElement>(
      'input[name="course"]',
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    expect(document.querySelector("h1")?.textContent).toBe("Ready to pack");

    document.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "START_COURSE",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        courseId: syntheticCourse.id,
      }),
    );
    expect(document.querySelector("h1")?.textContent).toBe("Packing course");
    expect(document.querySelector('[role="status"]')).not.toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    const focusedCancel = document.querySelector<HTMLButtonElement>("button")!;
    focusedCancel.focus();
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "PROGRESS",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        stage: "download",
        completed: 1,
        total: 3,
        failed: 0,
      },
      sender(),
      vi.fn(),
    );
    expect(document.activeElement).toBe(focusedCancel);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "download: 1 of 3; 0 failed",
    );

    const complete = {
      channel: RUNNER_CHANNEL,
      type: "COMPLETE",
      runId: "run-12345678-1234-1234-1234-123456789abc",
      message: "Your course ZIP was downloaded.",
      success: 2,
      failed: 1,
      unavailable: 1,
      unsupported: 0,
      external: 1,
    } as const;
    listener(complete, sender(), vi.fn());
    listener(complete, sender(), vi.fn());
    expect(document.querySelector("h1")?.textContent).toBe(
      "Archive downloaded",
    );
    expect(document.querySelector(".outcome-summary")?.textContent).toBe(
      "2 successful; 1 failed; 1 unavailable; 0 unsupported; 1 external.",
    );
    expect(document.body.textContent).not.toContain(syntheticCourse.name);

    document.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(17, {
        channel: EXTENSION_CHANNEL,
        type: "LIST_COURSES",
        runId: "run-87654321-4321-4321-4321-cba987654321",
      }),
    );
  });

  it("renders a fixed messaging error without HTML injection", () => {
    listener(
      {
        channel: RUNNER_CHANNEL,
        type: "FAILED",
        runId: "run-87654321-4321-4321-4321-cba987654321",
        message: "GradPack stopped because a safety check failed.",
      },
      sender(),
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).toBe("GradPack stopped");
    expect(document.querySelector("p")?.textContent).toBe(
      "GradPack stopped because a safety check failed.",
    );
    expect(document.querySelector("strong")).toBeNull();
  });

  it("sends one cancel command and disables the control while cancellation is in flight", async () => {
    document.querySelector<HTMLButtonElement>("button")!.click();
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
        courses: [syntheticCourse],
      },
      sender(),
      vi.fn(),
    );
    const radio = document.querySelector<HTMLInputElement>(
      'input[name="course"]',
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    document.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("h1")?.textContent).toBe("Packing course"),
    );
    const cancelButton = document.querySelector<HTMLButtonElement>("button")!;
    cancelButton.click();
    cancelButton.click();
    await vi.waitFor(() =>
      expect(
        tabsSendMessage.mock.calls.filter(
          ([, command]) => (command as { type?: unknown }).type === "CANCEL",
        ),
      ).toHaveLength(1),
    );
    expect(document.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );
    expect(
      document.querySelector<HTMLButtonElement>("button")?.textContent,
    ).toBe("Cancelling…");
  });
});
