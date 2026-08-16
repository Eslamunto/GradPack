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
  return {
    discover: async (course) => {
      const controller = new AbortController();
      const onAbort = (): void => controller.abort(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      const http = new CanvasHttp(fetch, controller.signal);
      try {
        await assertCurrentUser(http);
        return await discoverCoursePlan(http, course, {
          abort: (reason) => controller.abort(reason),
        });
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
    retrieve: async (resource, plan, activeSignal) => {
      if (resource.kind === "file")
        return fetchFileResource(resource, activeSignal);
      if (resource.kind === "page")
        return fetchPageResource(
          resource,
          plan,
          activeSignal,
          new CanvasHttp(fetch, activeSignal),
        );
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
  terminal: boolean;
  cause: "cancelled" | "navigation" | null;
};

if (scope[marker] !== true) {
  scope[marker] = true;
  let listed: { runId: string; courses: readonly CourseSummary[] } | null =
    null;
  let listing: ActiveRun | null = null;
  let active: ActiveRun | null = null;
  const terminalizedIds = new Set<string>();

  const markTerminal = (runId: string): boolean => {
    if (terminalizedIds.has(runId)) return false;
    terminalizedIds.add(runId);
    return true;
  };

  const postFailure = (runId: string, message: string): void => {
    if (!markTerminal(runId)) return;
    post({ channel: RUNNER_CHANNEL, type: "FAILED", runId, message });
  };

  const abortOwned = (
    owned: ActiveRun,
    cause: "cancelled" | "navigation",
  ): void => {
    if (owned.terminal || owned.cause !== null) return;
    owned.cause = cause;
    owned.controller.abort(
      new DOMException(
        cause === "navigation" ? "Canvas navigation" : "Packing was cancelled",
        "AbortError",
      ),
    );
  };

  const runSelectedCourse = async (
    command: Extract<ExtensionCommand, { type: "START_COURSE" }>,
    course: CourseSummary,
  ): Promise<void> => {
    const controller = new AbortController();
    const owned: ActiveRun = {
      runId: command.runId,
      controller,
      terminal: false,
      cause: null,
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
      if (!markTerminal(command.runId)) return;
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
      if (!markTerminal(command.runId)) return;
      if (
        error instanceof DOMException &&
        error.name === "AbortError" &&
        owned.cause !== null
      ) {
        post({
          channel: RUNNER_CHANNEL,
          type: "CANCELLED",
          runId: command.runId,
          message:
            owned.cause === "navigation" ? FIXED.navigation : FIXED.cancelled,
        });
      } else {
        post({
          channel: RUNNER_CHANNEL,
          type: "FAILED",
          runId: command.runId,
          message: fixedFailure(error),
        });
      }
    } finally {
      if (active === owned) active = null;
    }
  };

  const handleCommand = async (command: ExtensionCommand): Promise<void> => {
    if (terminalizedIds.has(command.runId)) return;
    if (command.type === "CANCEL") {
      if (active?.runId === command.runId) abortOwned(active, "cancelled");
      else if (listing?.runId === command.runId)
        abortOwned(listing, "cancelled");
      return;
    }
    if (command.type === "LIST_COURSES") {
      if (
        listing?.runId === command.runId ||
        active?.runId === command.runId ||
        listed?.runId === command.runId
      ) {
        return;
      }
      if (listing || active) {
        postFailure(command.runId, FIXED.active);
        return;
      }
      if (listed) {
        markTerminal(listed.runId);
        listed = null;
      }
      const controller = new AbortController();
      const owned: ActiveRun = {
        runId: command.runId,
        controller,
        terminal: false,
        cause: null,
      };
      listing = owned;
      try {
        const http = new CanvasHttp(fetch, controller.signal);
        await assertCurrentUser(http);
        const discovered = await listAccessibleCourses(http, {
          abort: (reason) => controller.abort(reason),
        });
        if (listing !== owned || owned.terminal || controller.signal.aborted)
          return;
        const courses = discovered.map((course) =>
          Object.freeze({ ...course }),
        );
        listed = { runId: command.runId, courses };
        post({
          channel: RUNNER_CHANNEL,
          type: "COURSES",
          runId: command.runId,
          courses,
        });
      } catch (error) {
        if (owned.terminal) return;
        owned.terminal = true;
        if (!markTerminal(command.runId)) return;
        if (
          error instanceof DOMException &&
          error.name === "AbortError" &&
          owned.cause !== null
        ) {
          post({
            channel: RUNNER_CHANNEL,
            type: "CANCELLED",
            runId: command.runId,
            message:
              owned.cause === "navigation" ? FIXED.navigation : FIXED.cancelled,
          });
        } else {
          post({
            channel: RUNNER_CHANNEL,
            type: "FAILED",
            runId: command.runId,
            message: fixedFailure(error),
          });
        }
      } finally {
        if (listing === owned) listing = null;
      }
      return;
    }
    if (listing?.runId === command.runId || active?.runId === command.runId) {
      return;
    }
    if (listing || active) {
      postFailure(command.runId, FIXED.active);
      return;
    }
    if (command.runId !== listed?.runId) {
      postFailure(command.runId, FIXED.unlisted);
      return;
    }
    const course = listed.courses.find(({ id }) => id === command.courseId);
    if (!course) {
      listed = null;
      postFailure(command.runId, FIXED.unlisted);
      return;
    }
    listed = null;
    await runSelectedCourse(command, course);
  };

  const stopForNavigation = (): void => {
    if (listing) abortOwned(listing, "navigation");
    if (active) abortOwned(active, "navigation");
    if (listed) {
      markTerminal(listed.runId);
      listed = null;
    }
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
