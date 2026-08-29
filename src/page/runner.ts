import { downloadCourseZip } from "../archive/build-zip";
import { ArchiveSafetyError } from "../archive/manifest";
import { safeArchivePath } from "../archive/paths";
import { ARCHIVE_CSS } from "../archive/style";
import { buildCombinedZip } from "../archive/combined";
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
  buildCourseArchive,
} from "./run-course";
import {
  createRunPlan,
  runCourses,
  type ImmutableRunPlan,
  type MultiCourseDependencies,
} from "./run-courses";
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

const productionDependencies = (
  signal: AbortSignal,
): MultiCourseDependencies => {
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
    retrieve: async (resource, plan, activeSignal, remainingBytes) => {
      if (resource.kind === "file")
        return fetchFileResource(resource, activeSignal, {}, remainingBytes);
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
    combinedFileName: () => safeArchivePath("gradpack-combined.zip"),
    buildCourseArchive,
    buildCombinedZip,
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
  let planning: ActiveRun | null = null;
  let pendingPlan: { owned: ActiveRun; plan: ImmutableRunPlan } | null = null;
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

  const runSelectedCourses = async (
    runId: string,
    plan: ImmutableRunPlan,
    owned: ActiveRun,
  ): Promise<void> => {
    active = owned;
    try {
      const result = await runCourses({
        plan,
        signal: owned.controller.signal,
        dependencies: productionDependencies(owned.controller.signal),
        progress: (value) => {
          if (
            active === owned &&
            !owned.terminal &&
            !owned.controller.signal.aborted
          ) {
            post({
              channel: RUNNER_CHANNEL,
              type: "PROGRESS",
              runId,
              ...value,
            });
          }
        },
      });
      if (active !== owned || owned.terminal || owned.controller.signal.aborted)
        return;
      owned.terminal = true;
      if (!markTerminal(runId)) return;
      post({
        channel: RUNNER_CHANNEL,
        type: "COMPLETE",
        runId,
        message: result.outputCount === 0 ? FIXED.noArchives : FIXED.complete,
        packaging: result.effectivePackaging,
        completedCourses: result.completedCourseIds.length,
        completedCourseIds: [...result.completedCourseIds],
        failedCourses: result.failedCourseIds.length,
        outputCount: result.outputCount,
        completedParts: result.completedParts.length,
        failedParts: result.failedParts.length,
        ...result.counts,
      });
    } catch (error) {
      if (owned.terminal) return;
      owned.terminal = true;
      if (!markTerminal(runId)) return;
      if (
        error instanceof DOMException &&
        error.name === "AbortError" &&
        owned.cause !== null
      ) {
        post({
          channel: RUNNER_CHANNEL,
          type: "CANCELLED",
          runId,
          message:
            owned.cause === "navigation" ? FIXED.navigation : FIXED.cancelled,
        });
      } else {
        post({
          channel: RUNNER_CHANNEL,
          type: "FAILED",
          runId,
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
      else if (planning?.runId === command.runId)
        abortOwned(planning, "cancelled");
      else if (pendingPlan?.owned.runId === command.runId) {
        pendingPlan.owned.terminal = true;
        pendingPlan = null;
        if (markTerminal(command.runId)) {
          post({
            channel: RUNNER_CHANNEL,
            type: "CANCELLED",
            runId: command.runId,
            message: FIXED.cancelled,
          });
        }
      }
      return;
    }
    if (command.type === "LIST_COURSES") {
      if (
        listing?.runId === command.runId ||
        planning?.runId === command.runId ||
        pendingPlan?.owned.runId === command.runId ||
        active?.runId === command.runId ||
        listed?.runId === command.runId
      ) {
        return;
      }
      if (listing || planning || pendingPlan || active) {
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
    if (
      listing?.runId === command.runId ||
      planning?.runId === command.runId ||
      active?.runId === command.runId
    ) {
      return;
    }
    if (listing || planning || active) {
      postFailure(command.runId, FIXED.active);
      return;
    }
    if (command.type === "START_RUN") {
      if (pendingPlan) {
        postFailure(command.runId, FIXED.active);
        return;
      }
      if (command.runId !== listed?.runId) {
        postFailure(command.runId, FIXED.unlisted);
        return;
      }
      const listedCourses = listed.courses;
      const selected = command.courseIds.map((id) =>
        listedCourses.find((course) => course.id === id),
      );
      if (
        selected.some((course): course is undefined => course === undefined)
      ) {
        listed = null;
        postFailure(command.runId, FIXED.unlisted);
        return;
      }
      const selectedCourses = selected.filter(
        (course): course is CourseSummary => course !== undefined,
      );
      listed = null;
      const controller = new AbortController();
      const owned: ActiveRun = {
        runId: command.runId,
        controller,
        terminal: false,
        cause: null,
      };
      planning = owned;
      try {
        const plan = await createRunPlan({
          courses: selectedCourses,
          requestedPackaging: command.packaging,
          signal: controller.signal,
          dependencies: productionDependencies(controller.signal),
          onProgress: (value) => {
            if (
              planning === owned &&
              !owned.terminal &&
              !controller.signal.aborted
            ) {
              post({
                channel: RUNNER_CHANNEL,
                type: "DISCOVERY_PROGRESS",
                runId: command.runId,
                ...value,
              });
            }
          },
        });
        if (planning !== owned || owned.terminal || controller.signal.aborted)
          return;
        pendingPlan = { owned, plan };
        post({
          channel: RUNNER_CHANNEL,
          type: "PLAN_READY",
          runId: command.runId,
          ...plan.summary,
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
        if (planning === owned) planning = null;
      }
      return;
    }
    if (pendingPlan?.owned.runId !== command.runId) {
      postFailure(command.runId, FIXED.unlisted);
      return;
    }
    const pending = pendingPlan;
    pendingPlan = null;
    if (pending.plan.courses.length === 0) {
      pending.owned.terminal = true;
      postFailure(command.runId, FIXED.safety);
      return;
    }
    await runSelectedCourses(command.runId, pending.plan, pending.owned);
  };

  const stopForNavigation = (): void => {
    if (listing) abortOwned(listing, "navigation");
    if (planning) abortOwned(planning, "navigation");
    if (active) abortOwned(active, "navigation");
    if (pendingPlan) {
      pendingPlan.owned.terminal = true;
      pendingPlan = null;
    }
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
