import { downloadCourseZip } from "../archive/build-zip";
import { ArchiveSafetyError } from "../archive/manifest";
import { safeArchivePath } from "../archive/paths";
import { ARCHIVE_CSS } from "../archive/style";
import { discoverCoursePlan, PilotSizeError } from "../canvas/discovery";
import {
  CanvasHttp,
  CanvasResponseError,
  CanvasSessionError,
} from "../canvas/http";
import { assertCurrentUser, listAccessibleCourses } from "../canvas/session";
import {
  fetchFileResource,
  fetchPageResource,
  RunSafetyError,
  runCourse,
  type RunDependencies,
} from "./run-course";
import { RUNNER_CHANNEL } from "../shared/constants";
import {
  parseExtensionCommand,
  parseRunnerEvent,
  RUNNER_TERMINAL_MESSAGES,
  type ExtensionCommand,
  type RunnerEvent,
} from "../shared/messages";
import type { CourseSummary } from "../shared/model";

const marker = "__gradPackRunnerV1";
const scope = window as unknown as Window & Record<string, unknown>;

const FIXED = RUNNER_TERMINAL_MESSAGES;

function post(event: RunnerEvent): void {
  window.postMessage(
    { source: "gradpack-runner", payload: parseRunnerEvent(event) },
    location.origin,
  );
}

const fixedFailure = (error: unknown): string => {
  if (error instanceof CanvasSessionError) return FIXED.session;
  if (error instanceof PilotSizeError) return FIXED.size;
  if (
    error instanceof RunSafetyError ||
    error instanceof ArchiveSafetyError ||
    error instanceof TypeError
  )
    return FIXED.safety;
  if (error instanceof CanvasResponseError) return FIXED.response;
  return FIXED.unexpected;
};

const productionDependencies = (signal: AbortSignal): RunDependencies => {
  const http = new CanvasHttp(fetch, signal);
  return {
    discover: async (course) => {
      await assertCurrentUser(http);
      return discoverCoursePlan(http, course);
    },
    retrieve: async (resource, plan, activeSignal) => {
      if (resource.kind === "file")
        return fetchFileResource(resource, activeSignal);
      if (resource.kind === "page")
        return fetchPageResource(resource, plan, activeSignal, http);
      throw new RunSafetyError("Unexpected retrieval kind");
    },
    archiveCss: ARCHIVE_CSS,
    now: () => new Date().toISOString(),
    fileName: (course) => safeArchivePath(`gradpack-${course.name}.zip`),
    download: downloadCourseZip,
  };
};

type ActiveRun = {
  runId: string;
  controller: AbortController;
  navigation: boolean;
  terminal: boolean;
};

if (scope[marker] !== true) {
  scope[marker] = true;
  let courses: CourseSummary[] = [];
  let listedRunId = "";
  let listing = false;
  let active: ActiveRun | null = null;

  const postFailure = (runId: string, message: string): void => {
    post({ channel: RUNNER_CHANNEL, type: "FAILED", runId, message });
  };

  const runSelectedCourse = async (
    command: Extract<ExtensionCommand, { type: "START_COURSE" }>,
    course: CourseSummary,
  ): Promise<void> => {
    const controller = new AbortController();
    const owned: ActiveRun = {
      runId: command.runId,
      controller,
      navigation: false,
      terminal: false,
    };
    active = owned;
    try {
      const result = await runCourse({
        course,
        signal: controller.signal,
        dependencies: productionDependencies(controller.signal),
        progress: (value) => {
          if (
            active === owned &&
            !owned.terminal &&
            !controller.signal.aborted
          ) {
            post({
              channel: RUNNER_CHANNEL,
              type: "PROGRESS",
              runId: command.runId,
              ...value,
            });
          }
        },
      });
      if (active !== owned || owned.terminal || controller.signal.aborted)
        return;
      owned.terminal = true;
      const totals = result.manifest.totals;
      post({
        channel: RUNNER_CHANNEL,
        type: "COMPLETE",
        runId: command.runId,
        message: FIXED.complete,
        success: totals.success,
        failed: totals.failed,
        unavailable: totals.unavailable,
        unsupported: totals.unsupported,
        external: totals.external,
      });
    } catch (error) {
      if (owned.terminal) return;
      owned.terminal = true;
      const cancelled = controller.signal.aborted;
      post({
        channel: RUNNER_CHANNEL,
        type: cancelled ? "CANCELLED" : "FAILED",
        runId: command.runId,
        message: cancelled
          ? owned.navigation
            ? FIXED.navigation
            : FIXED.cancelled
          : fixedFailure(error),
      });
    } finally {
      if (active === owned) active = null;
    }
  };

  const handleCommand = async (command: ExtensionCommand): Promise<void> => {
    if (command.type === "CANCEL") {
      if (active?.runId === command.runId && !active.terminal) {
        active.controller.abort(
          new DOMException("Packing was cancelled", "AbortError"),
        );
      }
      return;
    }
    if (command.type === "LIST_COURSES") {
      if (listing || active) {
        postFailure(command.runId, FIXED.active);
        return;
      }
      listing = true;
      courses = [];
      listedRunId = "";
      try {
        const http = new CanvasHttp();
        await assertCurrentUser(http);
        const discovered = await listAccessibleCourses(http);
        courses = discovered.map((course) => Object.freeze({ ...course }));
        listedRunId = command.runId;
        post({
          channel: RUNNER_CHANNEL,
          type: "COURSES",
          runId: command.runId,
          courses,
        });
      } catch (error) {
        postFailure(command.runId, fixedFailure(error));
      } finally {
        listing = false;
      }
      return;
    }
    if (listing || active) {
      postFailure(command.runId, FIXED.active);
      return;
    }
    if (command.runId !== listedRunId) {
      postFailure(command.runId, FIXED.unlisted);
      return;
    }
    const course = courses.find(({ id }) => id === command.courseId);
    if (!course) {
      postFailure(command.runId, FIXED.unlisted);
      return;
    }
    await runSelectedCourse(command, course);
  };

  const stopForNavigation = (): void => {
    if (!active || active.terminal) return;
    active.navigation = true;
    active.controller.abort(
      new DOMException("Canvas navigation", "AbortError"),
    );
  };

  window.addEventListener("pagehide", stopForNavigation);
  window.addEventListener("beforeunload", stopForNavigation);
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (typeof event.data !== "object" || event.data === null) return;
    const envelope = event.data as { source?: unknown; payload?: unknown };
    if (envelope.source !== "gradpack-relay") return;
    try {
      void handleCommand(parseExtensionCommand(envelope.payload));
    } catch {
      // Invalid commands are ignored without retaining their payloads.
    }
  });
}
