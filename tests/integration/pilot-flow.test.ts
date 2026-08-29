/* eslint-disable @typescript-eslint/require-await -- synthetic fetch responses model the browser network seam */
import { strFromU8, strToU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCombinedZip } from "../../src/archive/combined";
import { ARCHIVE_CSS } from "../../src/archive/style";
import { buildCourseArchive } from "../../src/page/run-course";
import {
  createRunPlan,
  runCourses,
  type MultiCourseDependencies,
} from "../../src/page/run-courses";
import { EXTENSION_CHANNEL } from "../../src/shared/constants";
import type { CoursePlan, CourseSummary } from "../../src/shared/model";

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
    let failSecondCourseDiscoveryOnce = true;
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:synthetic");
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
                  name: "Active Synthetic Course",
                  course_code: "SYN-101",
                  workflow_state: "available",
                  concluded: false,
                },
              ]
            : [
                {
                  id: 102,
                  name: "Completed Synthetic Course",
                  course_code: "SYN-102",
                  workflow_state: "completed",
                  concluded: false,
                },
                {
                  id: 103,
                  name: "Concluded Synthetic Course",
                  course_code: "SYN-103",
                  workflow_state: "completed",
                  concluded: true,
                },
              ],
        );
      }
      const courseMatch = /\/api\/v1\/courses\/(101|102|103)\//u.exec(
        url.pathname,
      );
      const courseId = courseMatch ? Number(courseMatch[1]) : null;
      const downloadMatch = /\/files\/(301|302|303)\/download$/u.exec(
        url.pathname,
      );
      const fileId =
        downloadMatch !== null
          ? Number(downloadMatch[1])
          : courseId === 103
            ? 303
            : courseId === 102
              ? 302
              : 301;
      if (url.pathname === `/api/v1/courses/${courseId}/modules`) {
        if (courseId === 102 && failSecondCourseDiscoveryOnce) {
          failSecondCourseDiscoveryOnce = false;
          return response("{", url.href, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (courseId === 103) {
          return json({
            message: "That page has been disabled for this course",
          });
        }
        return json([
          {
            id: courseId === 103 ? 203 : courseId === 102 ? 202 : 201,
            name: "Module One",
            position: 1,
            items: [
              {
                id: 1,
                title: "slides.pdf",
                position: 1,
                type: "File",
                content_id: fileId,
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
      if (url.pathname === `/api/v1/courses/${courseId}/files`) {
        return json([
          {
            id: fileId,
            folder_id: courseId === 103 ? 403 : courseId === 102 ? 402 : 401,
            display_name: "slides.pdf",
            filename: "slides.pdf",
            size: 19,
            url: `https://frankfurtschool.instructure.com/files/${fileId}/download`,
          },
        ]);
      }
      if (url.pathname === `/api/v1/courses/${courseId}/folders`) {
        return json([
          {
            id: courseId === 103 ? 403 : courseId === 102 ? 402 : 401,
            full_name: "course",
          },
        ]);
      }
      if (url.pathname === `/api/v1/courses/${courseId}/pages`) {
        return json([{ page_id: 501, url: "welcome", title: "Welcome" }]);
      }
      if (url.pathname === `/api/v1/courses/${courseId}/pages/welcome`) {
        return json({
          title: "Welcome",
          body: `<p>Read <a href="/courses/${courseId}/files/${fileId}/download">slides</a>.</p>`,
        });
      }
      if (url.pathname === `/files/${fileId}/download`) {
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
    const runIds: Array<ReturnType<Crypto["randomUUID"]>> = [
      "12345678-1234-1234-1234-123456789abc",
      "87654321-4321-4321-4321-cba987654321",
    ];
    vi.spyOn(crypto, "randomUUID").mockImplementation(
      () => runIds.shift() ?? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
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
      expect(document.querySelector("h1")?.textContent).toBe("Choose courses"),
    );
    document
      .querySelector<HTMLInputElement>('input[name="course-all"]')!
      .click();
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent === "Continue")!
      .click();
    await vi.waitFor(() =>
      expect(document.querySelector("h1")?.textContent).toBe(
        "Configure archives",
      ),
    );
    const combined = document.querySelector<HTMLInputElement>(
      'input[value="combined"]',
    )!;
    combined.checked = true;
    combined.dispatchEvent(new Event("change"));
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find(
        (candidate) => candidate.textContent === "Discover selected courses",
      )!
      .click();
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(tabId, {
        channel: EXTENSION_CHANNEL,
        type: "START_RUN",
        runId: "run-12345678-1234-1234-1234-123456789abc",
        courseIds: [101, 102, 103],
        packaging: "combined",
      }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("h1")?.textContent).toBe("Review plan"),
    );
    expect(document.body.textContent).toContain("2 courses ready; 1 skipped");
    expect(document.body.textContent).toContain(
      "Canvas did not provide usable course metadata.",
    );
    expect(document.body.textContent).toContain(
      "Module navigation is unavailable; GradPack will archive accessible pages and files instead.",
    );
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find(
        (candidate) => candidate.textContent === "Continue with ready courses",
      )!
      .click();
    await vi.waitFor(() =>
      expect(document.querySelector("h1")?.textContent).toBe(
        "Archives downloaded",
      ),
    );
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(14);
    const combinedBlob = createObjectUrl.mock.calls[0]?.[0];
    expect(combinedBlob).toBeInstanceOf(Blob);
    const combinedEntries = unzipSync(
      new Uint8Array(await (combinedBlob as Blob).arrayBuffer()),
    );
    const disabledRoot = "courses/Concluded Synthetic Course-103";
    const disabledManifest = JSON.parse(
      strFromU8(combinedEntries[`${disabledRoot}/manifest.json`]!),
    ) as { moduleDiscovery?: unknown };
    expect(disabledManifest.moduleDiscovery).toBe("disabled");
    expect(
      strFromU8(combinedEntries[`${disabledRoot}/modules.html`]!),
    ).toContain("Module navigation unavailable");
    expect(strFromU8(combinedEntries[`${disabledRoot}/pages.html`]!)).toContain(
      "Welcome",
    );
    expect(strFromU8(combinedEntries[`${disabledRoot}/files.html`]!)).toContain(
      "slides.pdf",
    );

    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find(
        (candidate) => candidate.textContent === "Retry unfinished courses",
      )!
      .click();
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(tabId, {
        channel: EXTENSION_CHANNEL,
        type: "START_RUN",
        runId: "run-87654321-4321-4321-4321-cba987654321",
        courseIds: [102],
        packaging: "combined",
      }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("h1")?.textContent).toBe("Review plan"),
    );
    expect(document.body.textContent).toContain("1 courses ready; 0 skipped");
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find(
        (candidate) => candidate.textContent === "Continue with ready courses",
      )!
      .click();
    await vi.waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(2));

    await tabsSendMessage(tabId, {
      channel: EXTENSION_CHANNEL,
      type: "START_RUN",
      runId: "run-12345678-1234-1234-1234-123456789abc",
      courseIds: [101],
      packaging: "per-course",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(anchorClick).toHaveBeenCalledTimes(2);

    for (let index = 0; index < 128; index += 1) {
      await tabsSendMessage(tabId, {
        channel: EXTENSION_CHANNEL,
        type: "START_RUN",
        runId: `run-evict${index.toString().padStart(4, "0")}`,
        courseIds: [999],
        packaging: "per-course",
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
      type: "START_RUN",
      runId: "run-12345678-1234-1234-1234-123456789abc",
      courseIds: [101],
      packaging: "per-course",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(anchorClick).toHaveBeenCalledTimes(2);
  });

  it("downloads truthful per-course archives for available and disabled Modules in one run", async () => {
    const courses: CourseSummary[] = [
      {
        id: 101,
        name: "Available Synthetic Course",
        courseCode: "SYN-101",
        workflowState: "available",
        concluded: false,
      },
      {
        id: 202,
        name: "Disabled Synthetic Course",
        courseCode: "SYN-202",
        workflowState: "completed",
        concluded: false,
      },
    ];
    const planFor = (course: CourseSummary): CoursePlan => {
      const disabled = course.id === 202;
      const fileTitle = disabled ? "reading.pdf" : "slides.pdf";
      const fileBytes = strToU8(disabled ? "reading" : "slides");
      return {
        course: { ...course },
        moduleDiscovery: disabled ? "disabled" : "available",
        modules: disabled
          ? []
          : [
              {
                id: 301,
                name: "Module One",
                position: 1,
                items: [
                  {
                    id: 401,
                    title: fileTitle,
                    position: 1,
                    indent: 0,
                    resourceKey: `file:${course.id}`,
                    type: "File",
                  },
                ],
              },
            ],
        resources: [
          {
            key: `file:${course.id}`,
            kind: "file",
            title: fileTitle,
            sourceId: String(course.id),
            archivePath: `files/${fileTitle}`,
            advertisedBytes: fileBytes.length,
            sourceUrl: `https://frankfurtschool.instructure.com/files/${course.id}/download`,
          },
          {
            key: `page:day-${course.id}`,
            kind: "page",
            title: "Day 1",
            sourceId: `day-${course.id}`,
            archivePath: "pages/day-1.html",
            advertisedBytes: 0,
            sourceUrl: null,
          },
        ],
        advertisedBytes: fileBytes.length,
      };
    };
    const downloads: Array<{ fileName: string; bytes: Uint8Array }> = [];
    const dependencies: MultiCourseDependencies = {
      discover: async (course) => planFor(course),
      retrieve: vi.fn(async (resource) => ({
        status: "success" as const,
        bytes:
          resource.kind === "page"
            ? strToU8("<p>Day 1</p>")
            : strToU8(resource.title === "reading.pdf" ? "reading" : "slides"),
      })),
      buildCourseArchive,
      buildCombinedZip,
      archiveCss: ARCHIVE_CSS,
      now: () => "2026-08-27T12:00:00.000Z",
      fileName: (course) => `gradpack-${course.id}.zip`,
      combinedFileName: () => "gradpack-combined.zip",
      download: (fileName, bytes) =>
        downloads.push({ fileName, bytes: bytes.slice() }),
    };

    const planReady = await createRunPlan({
      courses,
      requestedPackaging: "per-course",
      signal: new AbortController().signal,
      dependencies,
    });

    expect(planReady.summary.selected).toEqual([
      expect.objectContaining({
        courseId: 101,
        moduleDiscovery: "available",
        advertisedBytes: 6,
        resourceCount: 2,
      }),
      expect.objectContaining({
        courseId: 202,
        moduleDiscovery: "disabled",
        advertisedBytes: 7,
        resourceCount: 2,
      }),
    ]);
    expect(planReady.summary.skipped).toEqual([]);
    expect(planReady.summary).toMatchObject({
      advertisedBytes: 13,
      resourceCount: 4,
      unknownSizeCount: 0,
    });

    await runCourses({
      plan: planReady,
      signal: new AbortController().signal,
      progress: vi.fn(),
      dependencies,
    });

    expect(downloads).toHaveLength(2);
    const disabledDownload = downloads.find(
      ({ fileName }) => fileName === "gradpack-202.zip",
    );
    expect(disabledDownload).toBeDefined();
    const disabledEntries = unzipSync(disabledDownload!.bytes);
    const disabledManifest = JSON.parse(
      strFromU8(disabledEntries["manifest.json"]!),
    ) as { moduleDiscovery?: unknown };
    expect(disabledManifest.moduleDiscovery).toBe("disabled");
    expect(strFromU8(disabledEntries["modules.html"]!)).toContain(
      "Module navigation unavailable",
    );
    expect(strFromU8(disabledEntries["pages.html"]!)).toContain("Day 1");
    expect(strFromU8(disabledEntries["files.html"]!)).toContain("reading.pdf");
    expect(strFromU8(disabledEntries["pages/day-1.html"]!)).toContain("Day 1");
    expect(strFromU8(disabledEntries["files/reading.pdf"]!)).toBe("reading");
  });
});
