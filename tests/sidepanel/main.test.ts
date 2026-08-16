import { beforeAll, describe, expect, it, vi } from "vitest";
import { EXTENSION_CHANNEL, RUNNER_CHANNEL } from "../../src/shared/constants";

type RuntimeListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0];

let runtimeListener: RuntimeListener;
const runtimeSendMessage = vi.fn().mockResolvedValue({ tabId: 17 });
const tabsSendMessage = vi.fn().mockResolvedValue(undefined);

beforeAll(async () => {
  document.body.innerHTML = '<main id="app" aria-live="polite"></main>';
  vi.spyOn(crypto, "randomUUID").mockReturnValue(
    "12345678-1234-1234-1234-123456789abc",
  );
  vi.stubGlobal("chrome", {
    runtime: {
      id: "gradpack-extension",
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListener = listener;
        }),
      },
      sendMessage: runtimeSendMessage,
    },
    tabs: { sendMessage: tabsSendMessage },
  });
  await import("../../src/sidepanel/main");
  await vi.waitFor(() => expect(tabsSendMessage).toHaveBeenCalledOnce());
});

describe("side panel session connection", () => {
  it("ensures the runner and sends one exact LIST_COURSES command", () => {
    expect(runtimeSendMessage).toHaveBeenCalledWith("GRADPACK_ENSURE_RUNNER");
    expect(tabsSendMessage).toHaveBeenCalledWith(17, {
      channel: EXTENSION_CHANNEL,
      type: "LIST_COURSES",
      runId: "run-12345678-1234-1234-1234-123456789abc",
    });
  });

  it("renders choices only for the active run", () => {
    runtimeListener(
      {
        channel: RUNNER_CHANNEL,
        type: "COURSES",
        runId: "run-other123",
        courses: [],
      },
      {
        id: "gradpack-extension",
        tab: { id: 17 },
      } as chrome.runtime.MessageSender,
      vi.fn(),
    );
    expect(document.querySelector("h1")?.textContent).not.toBe(
      "Choose one course",
    );

    runtimeListener(
      {
        channel: RUNNER_CHANNEL,
        type: "COURSES",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        courses: [
          {
            id: 7,
            name: "Economics",
            courseCode: "ECON",
            workflowState: "available",
            concluded: false,
          },
        ],
      },
      {
        id: "gradpack-extension",
        tab: { id: 17 },
      } as chrome.runtime.MessageSender,
      vi.fn(),
    );

    expect(document.querySelector("h1")?.textContent).toBe("Choose one course");
    expect(document.querySelector("label")?.textContent).toBe("Economics");
    expect(
      document.querySelector<HTMLInputElement>('input[name="course"]')?.value,
    ).toBe("7");
  });

  it("renders a parsed fixed-run failure without HTML interpretation", () => {
    runtimeListener(
      {
        channel: RUNNER_CHANNEL,
        type: "FAILED",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        message: "<strong>Sign in</strong>",
      },
      {
        id: "gradpack-extension",
        tab: { id: 17 },
      } as chrome.runtime.MessageSender,
      vi.fn(),
    );

    expect(document.querySelector("h1")?.textContent).toBe("GradPack stopped");
    expect(document.querySelector("p")?.textContent).toBe(
      "<strong>Sign in</strong>",
    );
    expect(document.querySelector("strong")).toBeNull();
  });

  it("ignores events from the wrong extension sender or tab", () => {
    const before = document.querySelector("#app")?.innerHTML;
    const event = {
      channel: RUNNER_CHANNEL,
      type: "COURSES",
      runId: "run-12345678-1234-1234-1234-123456789abc",
      courses: [
        {
          id: 99,
          name: "Untrusted course",
          courseCode: "BAD",
          workflowState: "available",
          concluded: false,
        },
      ],
    } as const;

    runtimeListener(
      event,
      {
        id: "another-extension",
        tab: { id: 17 },
      } as chrome.runtime.MessageSender,
      vi.fn(),
    );
    runtimeListener(
      event,
      {
        id: "gradpack-extension",
        tab: { id: 99 },
      } as chrome.runtime.MessageSender,
      vi.fn(),
    );

    expect(document.querySelector("#app")?.innerHTML).toBe(before);
    expect(document.body.textContent).not.toContain("Untrusted course");
  });
});
