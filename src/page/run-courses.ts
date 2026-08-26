import { CanvasSessionError } from "../canvas/http";
import {
  buildCombinedZip,
  combinedCourseRoot,
  type CombinedArchiveOutput,
  type CourseArchiveOutput,
} from "../archive/combined";
import { MAX_ARCHIVE_RESOURCES, MAX_ARCHIVE_BYTES } from "../shared/constants";
import type {
  AggregateProgress,
  CoursePlan,
  CourseSummary,
  PackagingMode,
  PlanFallbackReason,
  Progress,
  RunPlanSummary,
} from "../shared/model";
import {
  freezeCoursePlan,
  RunSafetyError,
  type CourseArchiveDependencies,
  type RunDependencies,
  type RunResult,
} from "./run-course";

export type ImmutableRunPlan = Readonly<{
  courses: readonly CoursePlan[];
  summary: Readonly<RunPlanSummary>;
}>;

export type MultiCourseDependencies = {
  discover: RunDependencies["discover"];
  retrieve: RunDependencies["retrieve"];
  buildCourseArchive: (options: {
    course: CourseSummary;
    plan: CoursePlan;
    combinedRoot: string | null;
    signal: AbortSignal;
    progress: (progress: Progress) => void;
    dependencies: CourseArchiveDependencies;
  }) => Promise<RunResult>;
  buildCombinedZip: typeof buildCombinedZip;
  archiveCss: string;
  now: () => string;
  fileName: (course: CourseSummary) => string;
  combinedFileName: (courses: readonly CourseSummary[]) => string;
  download: (fileName: string, bytes: Uint8Array) => void;
};

export type MultiCourseResult = {
  effectivePackaging: PackagingMode;
  combined: CombinedArchiveOutput | null;
  completed: readonly CourseArchiveOutput[];
  failedCourseIds: readonly number[];
  counts: {
    success: number;
    failed: number;
    unavailable: number;
    unsupported: number;
    external: number;
  };
};

export class MultiCourseSafetyError extends RunSafetyError {}

const abortError = (signal: AbortSignal): DOMException =>
  signal.reason instanceof DOMException && signal.reason.name === "AbortError"
    ? signal.reason
    : new DOMException("Packing was cancelled", "AbortError");

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw abortError(signal);
};

const isAbort = (error: unknown): boolean =>
  error instanceof CanvasSessionError ||
  (error instanceof DOMException && error.name === "AbortError");

const emptyCounts = (): MultiCourseResult["counts"] => ({
  success: 0,
  failed: 0,
  unavailable: 0,
  unsupported: 0,
  external: 0,
});

const CLASSIC_ZIP_ENTRY_LIMIT = 65_535;
const COURSE_CORE_ENTRY_COUNT = 7;
const COMBINED_CORE_ENTRY_COUNT = 4;

const addCounts = (
  target: MultiCourseResult["counts"],
  source: RunResult["manifest"]["totals"],
): void => {
  target.success += source.success;
  target.failed += source.failed;
  target.unavailable += source.unavailable;
  target.unsupported += source.unsupported;
  target.external += source.external;
};

const progressForCourse =
  (
    progress: (progress: AggregateProgress) => void,
    course: CourseSummary,
    courseIndex: number,
    totalCourses: number,
    completedCourses: number,
  ): ((value: Progress) => void) =>
  (value) =>
    progress({
      ...value,
      currentCourseId: course.id,
      currentCourseIndex: courseIndex,
      totalCourses,
      completedCourses,
    });

const planSummary = (
  courses: readonly CoursePlan[],
  requestedPackaging: PackagingMode,
  effectivePackaging: PackagingMode,
  fallbackReason: PlanFallbackReason | null,
): RunPlanSummary => {
  const selected = courses.map(({ course, advertisedBytes, resources }) => ({
    courseId: course.id,
    advertisedBytes,
    unknownSizeCount: resources.filter(
      (resource) =>
        resource.kind === "file" && resource.advertisedBytes === null,
    ).length,
    resourceCount: resources.length,
  }));
  const advertisedBytes = selected.reduce(
    (total, item) => total + item.advertisedBytes,
    0,
  );
  const resourceCount = selected.reduce(
    (total, item) => total + item.resourceCount,
    0,
  );
  const unknownSizeCount = selected.reduce(
    (total, item) => total + item.unknownSizeCount,
    0,
  );
  return {
    selected,
    requestedPackaging,
    effectivePackaging,
    advertisedBytes,
    unknownSizeCount,
    resourceCount,
    fallbackReason,
  };
};

export async function createRunPlan(options: {
  courses: readonly CourseSummary[];
  requestedPackaging: PackagingMode;
  signal: AbortSignal;
  dependencies: Pick<MultiCourseDependencies, "discover">;
}): Promise<ImmutableRunPlan> {
  const { courses, requestedPackaging, signal, dependencies } = options;
  if (courses.length === 0)
    throw new MultiCourseSafetyError("No courses selected");
  const plans: CoursePlan[] = [];
  for (const course of courses) {
    throwIfAborted(signal);
    try {
      const discovered = await dependencies.discover({ ...course }, signal);
      if (discovered.course.id !== course.id) {
        throw new MultiCourseSafetyError(
          `Course ${course.id} discovery returned a different course`,
        );
      }
      plans.push(freezeCoursePlan(discovered));
    } catch (error) {
      if (isAbort(error)) throw error;
      if (error instanceof MultiCourseSafetyError) throw error;
      throw new MultiCourseSafetyError(
        `Course ${course.id} failed pre-retrieval safety validation`,
      );
    }
  }
  const summaryBase = planSummary(
    plans,
    requestedPackaging,
    requestedPackaging,
    null,
  );
  if (
    !Number.isSafeInteger(summaryBase.advertisedBytes) ||
    !Number.isSafeInteger(summaryBase.unknownSizeCount) ||
    !Number.isSafeInteger(summaryBase.resourceCount)
  ) {
    throw new MultiCourseSafetyError("Selected course totals overflow");
  }
  if (requestedPackaging === "combined" && summaryBase.unknownSizeCount > 0) {
    const summary = planSummary(
      plans,
      requestedPackaging,
      "per-course",
      "unknown-size-files",
    );
    return Object.freeze({
      courses: Object.freeze(plans),
      summary: Object.freeze(summary),
    });
  }
  const combinedEntryCount =
    COMBINED_CORE_ENTRY_COUNT +
    plans.reduce(
      (total, plan) => total + COURSE_CORE_ENTRY_COUNT + plan.resources.length,
      0,
    );
  if (
    summaryBase.resourceCount > MAX_ARCHIVE_RESOURCES ||
    (requestedPackaging === "combined" &&
      (!Number.isSafeInteger(combinedEntryCount) ||
        combinedEntryCount > CLASSIC_ZIP_ENTRY_LIMIT))
  ) {
    if (requestedPackaging === "combined") {
      const summary = planSummary(
        plans,
        requestedPackaging,
        "per-course",
        "combined-resource-limit-exceeded",
      );
      return Object.freeze({
        courses: Object.freeze(plans),
        summary: Object.freeze(summary),
      });
    }
    throw new MultiCourseSafetyError("Selected course resource limit exceeded");
  }
  if (
    requestedPackaging === "combined" &&
    summaryBase.advertisedBytes > MAX_ARCHIVE_BYTES
  ) {
    const summary = planSummary(
      plans,
      requestedPackaging,
      "per-course",
      "combined-size-exceeded",
    );
    return Object.freeze({
      courses: Object.freeze(plans),
      summary: Object.freeze(summary),
    });
  }
  return Object.freeze({
    courses: Object.freeze(plans),
    summary: Object.freeze(summaryBase),
  });
}

const clearBytes = (bytes: Uint8Array): void => {
  bytes.fill(0);
};

export async function runCourses(options: {
  plan: ImmutableRunPlan;
  signal: AbortSignal;
  progress: (progress: AggregateProgress) => void;
  dependencies: MultiCourseDependencies;
}): Promise<MultiCourseResult> {
  const { plan, signal, progress, dependencies } = options;
  const completed: CourseArchiveOutput[] = [];
  const failedCourseIds: number[] = [];
  const handedOff = new Set<number>();
  const counts = emptyCounts();
  let combined: CombinedArchiveOutput | null = null;

  const handOffCompleted = (): void => {
    for (const archive of completed) {
      if (handedOff.has(archive.course.id)) continue;
      dependencies.download(archive.fileName, archive.zipBytes);
      handedOff.add(archive.course.id);
    }
  };

  try {
    for (let index = 0; index < plan.courses.length; index += 1) {
      throwIfAborted(signal);
      const coursePlan = plan.courses[index]!;
      const courseProgress = progressForCourse(
        progress,
        coursePlan.course,
        index,
        plan.courses.length,
        completed.length,
      );
      courseProgress({
        stage: "download",
        completed: 0,
        total: coursePlan.resources.length,
        failed: 0,
      });
      try {
        const result = await dependencies.buildCourseArchive({
          course: coursePlan.course,
          plan: coursePlan,
          combinedRoot:
            plan.summary.effectivePackaging === "combined"
              ? combinedCourseRoot(coursePlan.course)
              : null,
          signal,
          progress: courseProgress,
          dependencies,
        });
        const archive: CourseArchiveOutput = {
          course: coursePlan.course,
          fileName: dependencies.fileName(coursePlan.course),
          manifest: result.manifest,
          moduleCount: coursePlan.modules.length,
          itemCount: coursePlan.modules.reduce(
            (total, module) => total + module.items.length,
            0,
          ),
          zipBytes: result.zipBytes,
        };
        completed.push(archive);
        addCounts(counts, result.manifest.totals);
        if (plan.summary.effectivePackaging === "per-course") {
          dependencies.download(archive.fileName, archive.zipBytes);
          handedOff.add(archive.course.id);
        }
        courseProgress({
          stage: "package",
          completed: coursePlan.resources.length,
          total: coursePlan.resources.length,
          failed:
            result.manifest.totals.failed + result.manifest.totals.unavailable,
        });
      } catch (error) {
        if (isAbort(error)) throw error;
        failedCourseIds.push(coursePlan.course.id);
      }
    }
    throwIfAborted(signal);
    if (
      plan.summary.effectivePackaging === "combined" &&
      failedCourseIds.length === 0
    ) {
      const result = dependencies.buildCombinedZip({
        archives: completed,
        archiveCss: dependencies.archiveCss,
        now: dependencies.now,
        fileName: dependencies.combinedFileName,
      });
      combined = {
        fileName: dependencies.combinedFileName(
          plan.courses.map(({ course }) => course),
        ),
        manifest: result.manifest,
        zipBytes: result.zipBytes,
      };
      dependencies.download(combined.fileName, combined.zipBytes);
    } else if (plan.summary.effectivePackaging === "combined") {
      handOffCompleted();
    }
  } catch (error) {
    handOffCompleted();
    throw error;
  } finally {
    for (const archive of completed) clearBytes(archive.zipBytes);
    if (combined) clearBytes(combined.zipBytes);
  }

  return {
    effectivePackaging: plan.summary.effectivePackaging,
    combined,
    completed,
    failedCourseIds,
    counts,
  };
}
