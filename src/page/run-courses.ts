import { CanvasResponseError, CanvasSessionError } from "../canvas/http";
import { PilotSizeError } from "../canvas/discovery";
import {
  buildCombinedZip,
  type CombinedArchiveOutput,
  type CourseArchiveOutput,
} from "../archive/combined";
import {
  CLASSIC_ZIP_ENTRY_LIMIT,
  COMBINED_CORE_ENTRY_COUNT,
  COURSE_CORE_ENTRY_COUNT,
  MAX_ARCHIVE_RESOURCES,
  MAX_ARCHIVE_BYTES,
} from "../shared/constants";
import { partitionCoursePlan } from "./course-parts";
import { partFileName } from "./course-parts";
import type {
  AggregateProgress,
  CourseArchivePartPlan,
  CourseDiscoveryProgress,
  CoursePlan,
  CoursePlanFailureCategory,
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

export type CoursePlanFailure = Readonly<{
  course: Readonly<CourseSummary>;
  category: CoursePlanFailureCategory;
}>;

export type PlannedCourse = Readonly<{
  plan: CoursePlan;
  parts: readonly CourseArchivePartPlan[];
}>;

export type ImmutableRunPlan = Readonly<{
  courses: readonly PlannedCourse[];
  failures: readonly CoursePlanFailure[];
  summary: Readonly<RunPlanSummary>;
}>;

export type MultiCourseDependencies = {
  discover: RunDependencies["discover"];
  retrieve: RunDependencies["retrieve"];
  buildCourseArchive: (options: {
    course: CourseSummary;
    plan: CoursePlan;
    partPlan: CourseArchivePartPlan;
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

export type CompletedArchivePart = Readonly<{
  courseId: number;
  partIndex: number;
  totalParts: number;
  fileName: string;
}>;

export type FailedArchivePart = Readonly<{
  courseId: number;
  partIndex: number;
  totalParts: number;
}>;

type CompletedCourse = Omit<CourseArchiveOutput, "zipBytes">;
type CompletedCombined = Omit<CombinedArchiveOutput, "zipBytes">;

export type MultiCourseResult = {
  effectivePackaging: PackagingMode;
  combined: CompletedCombined | null;
  completed: readonly CompletedCourse[];
  completedParts: readonly CompletedArchivePart[];
  failedParts: readonly FailedArchivePart[];
  completedCourseIds: readonly number[];
  failedCourseIds: readonly number[];
  outputCount: number;
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
    currentPartIndex: number,
    totalParts: number,
    totalArchiveParts: number,
    completedParts: number,
    failedParts: number,
  ): ((value: Progress) => void) =>
  (value) =>
    progress({
      ...value,
      currentCourseId: course.id,
      currentCourseIndex: courseIndex,
      totalCourses,
      completedCourses,
      currentPartIndex,
      totalParts,
      totalArchiveParts,
      completedParts,
      failedParts,
    });

const planSummary = (
  courses: readonly PlannedCourse[],
  failures: readonly CoursePlanFailure[],
  requestedCourseCount: number,
  requestedPackaging: PackagingMode,
  effectivePackaging: PackagingMode,
  fallbackReason: PlanFallbackReason | null,
): RunPlanSummary => {
  const selected = courses.map(
    ({
      plan: {
        course,
        moduleDiscovery,
        advertisedBytes,
        resources,
        folderPathFallbackKeys,
      },
      parts,
    }) => ({
      courseId: course.id,
      moduleDiscovery,
      advertisedBytes,
      unknownSizeCount: resources.filter(
        (resource) =>
          resource.kind === "file" && resource.advertisedBytes === null,
      ).length,
      resourceCount: resources.length,
      folderPathFallbackCount: folderPathFallbackKeys.length,
      archivePartCount: parts.length,
    }),
  );
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
  const totalPlannedParts = selected.reduce(
    (total, item) => total + item.archivePartCount,
    0,
  );
  const expectedArchiveCount =
    effectivePackaging === "per-course"
      ? totalPlannedParts
      : selected.length > 0
        ? 1
        : 0;
  return {
    requestedCourseCount,
    selected,
    skipped: failures.map(({ course, category }) => ({
      courseId: course.id,
      category,
    })),
    requestedPackaging,
    effectivePackaging,
    advertisedBytes,
    unknownSizeCount,
    resourceCount,
    totalPlannedParts,
    expectedArchiveCount,
    fallbackReason,
  };
};

const classifyCoursePlanFailure = (
  error: unknown,
): CoursePlanFailureCategory => {
  if (error instanceof PilotSizeError) return "size-limit";
  if (error instanceof CanvasResponseError) return "canvas-unavailable";
  if (error instanceof RunSafetyError || error instanceof TypeError) {
    return "safety-validation";
  }
  return "unexpected-local";
};

export async function createRunPlan(options: {
  courses: readonly CourseSummary[];
  requestedPackaging: PackagingMode;
  signal: AbortSignal;
  dependencies: Pick<MultiCourseDependencies, "discover">;
  onProgress?: (progress: CourseDiscoveryProgress) => void;
}): Promise<ImmutableRunPlan> {
  const { courses, requestedPackaging, signal, dependencies, onProgress } =
    options;
  if (courses.length === 0)
    throw new MultiCourseSafetyError("No courses selected");
  const plannedCourses: PlannedCourse[] = [];
  const failures: CoursePlanFailure[] = [];
  for (let index = 0; index < courses.length; index += 1) {
    const course = courses[index]!;
    throwIfAborted(signal);
    try {
      const discovered = await dependencies.discover({ ...course }, signal);
      if (discovered.course.id !== course.id) {
        throw new MultiCourseSafetyError(
          `Course ${course.id} discovery returned a different course`,
        );
      }
      const plan = freezeCoursePlan(discovered);
      plannedCourses.push(
        Object.freeze({
          plan,
          parts: partitionCoursePlan(plan),
        }),
      );
    } catch (error) {
      if (isAbort(error)) throw error;
      failures.push(
        Object.freeze({
          course: Object.freeze({ ...course }),
          category: classifyCoursePlanFailure(error),
        }),
      );
    }
    onProgress?.({
      completed: index + 1,
      total: courses.length,
      currentCourseId: course.id,
    });
  }
  const summaryBase = planSummary(
    plannedCourses,
    failures,
    courses.length,
    requestedPackaging,
    requestedPackaging,
    null,
  );
  if (
    !Number.isSafeInteger(summaryBase.advertisedBytes) ||
    !Number.isSafeInteger(summaryBase.unknownSizeCount) ||
    !Number.isSafeInteger(summaryBase.resourceCount) ||
    !Number.isSafeInteger(summaryBase.totalPlannedParts) ||
    !Number.isSafeInteger(summaryBase.expectedArchiveCount)
  ) {
    throw new MultiCourseSafetyError("Selected course totals overflow");
  }
  if (
    requestedPackaging === "combined" &&
    plannedCourses.some(({ parts }) => parts.length > 1)
  ) {
    const summary = planSummary(
      plannedCourses,
      failures,
      courses.length,
      requestedPackaging,
      "per-course",
      "multipart-course",
    );
    return Object.freeze({
      courses: Object.freeze(plannedCourses),
      failures: Object.freeze(failures),
      summary: Object.freeze(summary),
    });
  }
  if (requestedPackaging === "combined" && summaryBase.unknownSizeCount > 0) {
    const summary = planSummary(
      plannedCourses,
      failures,
      courses.length,
      requestedPackaging,
      "per-course",
      "unknown-size-files",
    );
    return Object.freeze({
      courses: Object.freeze(plannedCourses),
      failures: Object.freeze(failures),
      summary: Object.freeze(summary),
    });
  }
  const combinedEntryCount =
    COMBINED_CORE_ENTRY_COUNT +
    COURSE_CORE_ENTRY_COUNT * plannedCourses.length +
    summaryBase.resourceCount;
  if (
    requestedPackaging === "combined" &&
    (summaryBase.resourceCount > MAX_ARCHIVE_RESOURCES ||
      !Number.isSafeInteger(combinedEntryCount) ||
      combinedEntryCount > CLASSIC_ZIP_ENTRY_LIMIT)
  ) {
    const summary = planSummary(
      plannedCourses,
      failures,
      courses.length,
      requestedPackaging,
      "per-course",
      "combined-resource-limit-exceeded",
    );
    return Object.freeze({
      courses: Object.freeze(plannedCourses),
      failures: Object.freeze(failures),
      summary: Object.freeze(summary),
    });
  }
  if (
    requestedPackaging === "combined" &&
    summaryBase.advertisedBytes > MAX_ARCHIVE_BYTES
  ) {
    const summary = planSummary(
      plannedCourses,
      failures,
      courses.length,
      requestedPackaging,
      "per-course",
      "combined-size-exceeded",
    );
    return Object.freeze({
      courses: Object.freeze(plannedCourses),
      failures: Object.freeze(failures),
      summary: Object.freeze(summary),
    });
  }
  return Object.freeze({
    courses: Object.freeze(plannedCourses),
    failures: Object.freeze(failures),
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
  const completed: CompletedCourse[] = [];
  const completedParts: CompletedArchivePart[] = [];
  const failedParts: FailedArchivePart[] = [];
  const completedCourseIds: number[] = [];
  const failedCourseIds: number[] = [];
  const counts = emptyCounts();
  let combined: CompletedCombined | null = null;
  let outputCount = 0;
  const pendingCombined: CourseArchiveOutput[] = [];

  const completedCourse = (
    coursePlan: CoursePlan,
    result: RunResult,
    fileName: string,
  ): CompletedCourse => ({
    course: coursePlan.course,
    fileName,
    manifest: result.manifest,
    moduleCount: coursePlan.modules.length,
    itemCount: coursePlan.modules.reduce(
      (total, module) => total + module.items.length,
      0,
    ),
  });

  const handOffPendingCombined = (): void => {
    for (const archive of pendingCombined) {
      dependencies.download(archive.fileName, archive.zipBytes);
      outputCount += 1;
    }
  };

  try {
    for (let index = 0; index < plan.courses.length; index += 1) {
      throwIfAborted(signal);
      const plannedCourse = plan.courses[index]!;
      const coursePlan = plannedCourse.plan;
      let courseComplete = true;
      let lastCompleted: CompletedCourse | null = null;
      for (const partPlan of plannedCourse.parts) {
        throwIfAborted(signal);
        const courseProgress = progressForCourse(
          progress,
          coursePlan.course,
          index,
          plan.courses.length,
          completedCourseIds.length,
          partPlan.index,
          partPlan.total,
          plan.summary.totalPlannedParts,
          completedParts.length,
          failedParts.length,
        );
        courseProgress({
          stage: "download",
          completed: 0,
          total: partPlan.resourceKeys.length,
          failed: 0,
        });
        let partBytes: Uint8Array | null = null;
        try {
          const result = await dependencies.buildCourseArchive({
            course: coursePlan.course,
            plan: coursePlan,
            partPlan,
            combinedRoot: null,
            signal,
            progress: courseProgress,
            dependencies,
          });
          partBytes = result.zipBytes;
          const outputName = partFileName(
            dependencies.fileName(coursePlan.course),
            partPlan,
          );
          addCounts(counts, result.manifest.totals);
          const descriptor = Object.freeze({
            courseId: coursePlan.course.id,
            partIndex: partPlan.index,
            totalParts: partPlan.total,
            fileName: outputName,
          });
          if (plan.summary.effectivePackaging === "per-course") {
            dependencies.download(outputName, result.zipBytes);
            outputCount += 1;
          } else {
            pendingCombined.push({
              ...completedCourse(coursePlan, result, outputName),
              zipBytes: result.zipBytes,
            });
          }
          completedParts.push(descriptor);
          lastCompleted = completedCourse(coursePlan, result, outputName);
        } catch (error) {
          if (isAbort(error)) throw error;
          courseComplete = false;
          failedParts.push(
            Object.freeze({
              courseId: coursePlan.course.id,
              partIndex: partPlan.index,
              totalParts: partPlan.total,
            }),
          );
        } finally {
          if (plan.summary.effectivePackaging === "per-course") {
            partBytes?.fill(0);
          }
        }
      }
      if (courseComplete && lastCompleted) {
        completedCourseIds.push(coursePlan.course.id);
        completed.push(lastCompleted);
      } else {
        failedCourseIds.push(coursePlan.course.id);
      }
    }
    throwIfAborted(signal);
    if (
      plan.summary.effectivePackaging === "combined" &&
      failedCourseIds.length === 0
    ) {
      const result = dependencies.buildCombinedZip({
        archives: pendingCombined,
        archiveCss: dependencies.archiveCss,
        now: dependencies.now,
        fileName: dependencies.combinedFileName,
      });
      const combinedBytes = result.zipBytes;
      const combinedFileName = dependencies.combinedFileName(
        plan.courses.map(({ plan: { course } }) => course),
      );
      combined = {
        fileName: combinedFileName,
        manifest: result.manifest,
      };
      try {
        dependencies.download(combinedFileName, combinedBytes);
        outputCount = 1;
      } finally {
        combinedBytes.fill(0);
      }
    } else if (plan.summary.effectivePackaging === "combined") {
      handOffPendingCombined();
    }
  } catch (error) {
    if (plan.summary.effectivePackaging === "combined") {
      handOffPendingCombined();
    }
    throw error;
  } finally {
    for (const archive of pendingCombined) clearBytes(archive.zipBytes);
  }

  const effectivePackaging =
    plan.summary.effectivePackaging === "combined" && failedCourseIds.length > 0
      ? "per-course"
      : plan.summary.effectivePackaging;
  return {
    effectivePackaging,
    combined,
    completed,
    completedParts: Object.freeze(completedParts),
    failedParts: Object.freeze(failedParts),
    completedCourseIds: Object.freeze(completedCourseIds),
    failedCourseIds,
    outputCount,
    counts,
  };
}
