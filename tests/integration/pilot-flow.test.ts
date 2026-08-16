/* eslint-disable @typescript-eslint/require-await -- synthetic fetch responses model the browser network seam */
import { strToU8 } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_CHANNEL } from "../../src/shared/constants";

type RuntimeListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0];

const response = (
  body: BodyInit | null,
  url: string,
  init: ResponseInit = {},
): Response => {
  const value = new Response(body, init);
  Object.defineProperty(value, "url", { value: url });
  return value;
};

describe("production pilot vertical flow", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.replaceChildren();
    const app = document.createElement("main");
    app.id = "app";
    document.body.append(app);
    delete (window as unknown as Window & Record<string, unknown>)
      .__gradPackRunnerV1;
  });

  it("wires browser, panel, relay, runner, discovery, retrieval, archive, and a single-use download", async () => {
    const runtimeListeners: RuntimeListener[] = [];
    const contexts: {
      serviceWorker?: RuntimeListener;
      content?: RuntimeListener;
      panel?: RuntimeListener;
    } = {};
    const extensionId = "gradpack-extension";
    const tabId = 17;
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(window, "postMessage").mockImplementation((message) => {
      queueMicrotask(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window,
            origin: location.origin,
            data: message,
          }),
        ),
      );
    });

    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const href =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      const url = new URL(href);
      const json = (value: unknown): Response =>
        response(JSON.stringify(value), url.href, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.pathname === "/api/v1/users/self/profile") return json({ id: 7 });
      if (url.pathname === "/api/v1/courses") {
        return json(
          url.searchParams.get("enrollment_state") === "active"
            ? [
                {
                  id: 101,
                  name: "Synthetic Course",
                  course_code: "SYN-101",
                  workflow_state: "available",
                  concluded: false,
                },
              ]
            : [],
        );
      }
      if (url.pathname === "/api/v1/courses/101/modules") {
        return json([
          {
            id: 201,
            name: "Module One",
            position: 1,
            items: [
              {
                id: 1,
                title: "slides.pdf",
                position: 1,
                type: "File",
                content_id: 301,
              },
              {
                id: 2,
                title: "Welcome",
                position: 2,
                type: "Page",
                page_url: "welcome",
              },
            ],
          },
        ]);
      }
      if (url.pathname === "/api/v1/courses/101/files") {
        return json([
          {
            id: 301,
            folder_id: 401,
            display_name: "slides.pdf",
            filename: "slides.pdf",
            size: 19,
            url: "https://frankfurtschool.instructure.com/files/301/download",
          },
        ]);
      }
      if (url.pathname === "/api/v1/courses/101/folders") {
        return json([{ id: 401, full_name: "course" }]);
      }
      if (url.pathname === "/api/v1/courses/101/pages") {
        return json([{ page_id: 501, url: "welcome", title: "Welcome" }]);
      }
      if (url.pathname === "/api/v1/courses/101/pages/welcome") {
        return json({
          title: "Welcome",
          body: '<p>Read <a href="/courses/101/files/301/download">slides</a>.</p>',
        });
      }
      if (url.pathname === "/files/301/download") {
        return response(
          strToU8("synthetic-file-data"),
          "https://cdn.synthetic.test/slides.pdf",
          {
            status: 200,
            headers: {
              "content-type": "application/pdf",
              "content-length": "19",
            },
          },
        );
      }
      throw new TypeError("Unexpected synthetic request");
    });
    vi.stubGlobal("fetch", fetcher);

    const runtimeSendMessage = vi.fn((message: unknown) => {
      if (message === "GRADPACK_ENSURE_RUNNER") {
        return new Promise((resolve) => {
          contexts.serviceWorker?.(
            message,
            { id: extensionId },
            (value?: unknown) => resolve(value),
          );
        });
      }
      contexts.panel?.(
        message,
        { id: extensionId, tab: { id: tabId } } as chrome.runtime.MessageSender,
        vi.fn(),
      );
      return Promise.resolve(undefined);
    });
    const tabsSendMessage = vi.fn((_tabId: number, message: unknown) => {
      contexts.content?.(message, { id: extensionId }, vi.fn());
      return Promise.resolve(undefined);
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "12345678-1234-1234-1234-123456789abc",
    );
    vi.stubGlobal("chrome", {
      runtime: {
        id: extensionId,
        onInstalled: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((listener: RuntimeListener) => {
            runtimeListeners.push(listener);
          }),
        },
        sendMessage: runtimeSendMessage,
      },
      sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(undefined) },
      tabs: {
        query: vi.fn().mockResolvedValue([
          {
            id: tabId,
            url: "https://frankfurtschool.instructure.com/courses/101",
          },
        ]),
        sendMessage: tabsSendMessage,
        onRemoved: { addListener: vi.fn() },
        onUpdated: { addListener: vi.fn() },
      },
      scripting: {
        executeScript: vi.fn(async () => {
          await import("../../src/page/runner");
        }),
      },
    });

    await import("../../src/service-worker");
    contexts.serviceWorker = runtimeListeners[0]!;
    const serviceWorkerListeners = runtimeListeners.length;
    await import("../../src/content/relay");
    contexts.content = runtimeListeners[serviceWorkerListeners]!;
    await import("../../src/sidepanel/main");
    contexts.panel = runtimeListeners.at(-1)!;

    document.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("h1")?.textContent).toBe(
        "Choose one course",
      ),
    );
    const radio = document.querySelector<HTMLInputElement>("input")!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    document.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("h1")?.textContent).toBe(
        "Archive downloaded",
      ),
    );
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(8);

    await tabsSendMessage(tabId, {
      channel: EXTENSION_CHANNEL,
      type: "START_COURSE",
      runId: "run-12345678-1234-1234-1234-123456789abc",
      courseId: 101,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(anchorClick).toHaveBeenCalledOnce();

    for (let index = 0; index < 128; index += 1) {
      await tabsSendMessage(tabId, {
        channel: EXTENSION_CHANNEL,
        type: "START_COURSE",
        runId: `run-evict${index.toString().padStart(4, "0")}`,
        courseId: 999,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tabsSendMessage(tabId, {
      channel: EXTENSION_CHANNEL,
      type: "LIST_COURSES",
      runId: "run-12345678-1234-1234-1234-123456789abc",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tabsSendMessage(tabId, {
      channel: EXTENSION_CHANNEL,
      type: "START_COURSE",
      runId: "run-12345678-1234-1234-1234-123456789abc",
      courseId: 101,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(anchorClick).toHaveBeenCalledOnce();
  });
});
