import type {
  AggregateProgress,
  CourseDiscoveryProgress,
  CourseSummary,
  PackagingMode,
  RunPlanSummary,
} from "../shared/model";

export type OutcomeCounts = {
  success: number;
  failed: number;
  unavailable: number;
  unsupported: number;
  external: number;
};

export type RetryRequest = {
  courseIds: number[];
  packaging: PackagingMode;
};

export type UiEvent =
  | { type: "CONNECTING" }
  | { type: "COURSES"; courses: CourseSummary[] }
  | { type: "SELECT"; courseId: number }
  | { type: "SELECT_ALL" }
  | { type: "CONFIGURE" }
  | { type: "SET_PACKAGING"; packaging: PackagingMode }
  | { type: "DISCOVERING" }
  | { type: "DISCOVERY_PROGRESS"; progress: CourseDiscoveryProgress }
  | { type: "PLAN_READY"; plan: RunPlanSummary }
  | { type: "CONFIRM" }
  | { type: "PROGRESS"; progress: AggregateProgress }
  | {
      type: "COMPLETE";
      packaging: PackagingMode;
      completedCourses: number;
      completedCourseIds: number[];
      failedCourses: number;
      outputCount: number;
      counts: OutcomeCounts;
    }
  | { type: "FAILED"; message: string }
  | { type: "TAB_LOST"; message: string }
  | { type: "RETRY" };

export type ViewState =
  | {
      name: "connect";
      message: string;
      busy: boolean;
      retry: RetryRequest | null;
    }
  | { name: "choose"; courses: CourseSummary[]; selectedIds: number[] }
  | {
      name: "configure";
      courses: CourseSummary[];
      selectedIds: number[];
      packaging: PackagingMode;
      busy: boolean;
      discoveryProgress: CourseDiscoveryProgress | null;
    }
  | {
      name: "review";
      courses: CourseSummary[];
      selectedIds: number[];
      plan: RunPlanSummary;
    }
  | {
      name: "packing";
      courses: CourseSummary[];
      selectedIds: number[];
      progress: AggregateProgress;
      packaging: PackagingMode;
      requestedPackaging: PackagingMode;
      plan: RunPlanSummary;
    }
  | {
      name: "complete";
      courses: CourseSummary[];
      requestedPackaging: PackagingMode;
      plan: RunPlanSummary;
      retryCourseIds: number[];
      packaging: PackagingMode;
      completedCourses: number;
      completedCourseIds: number[];
      failedCourses: number;
      outputCount: number;
      counts: OutcomeCounts;
    }
  | { name: "blocked"; message: string };

export const initialState: ViewState = {
  name: "connect",
  message: "Connect to a signed-in Canvas tab to begin.",
  busy: false,
  retry: null,
};

const blocked = (message: string): ViewState => ({ name: "blocked", message });

const selectedCourses = (
  courses: CourseSummary[],
  ids: number[],
): CourseSummary[] => courses.filter((course) => ids.includes(course.id));

export const reduceState = (state: ViewState, event: UiEvent): ViewState => {
  if (event.type === "CONNECTING") {
    if (state.name === "connect") return { ...state, busy: true };
    if (state.name === "complete" || state.name === "blocked") {
      return {
        name: "connect",
        message: "Connect to a signed-in Canvas tab to begin.",
        busy: true,
        retry: null,
      };
    }
  }
  if (event.type === "COURSES" && state.name === "connect") {
    if (state.retry !== null) {
      const availableById = new Map(
        event.courses.map((course) => [course.id, course]),
      );
      const selectedIds = state.retry.courseIds.filter((courseId) =>
        availableById.has(courseId),
      );
      return selectedIds.length > 0
        ? {
            name: "configure",
            courses: event.courses,
            selectedIds,
            packaging: state.retry.packaging,
            busy: false,
            discoveryProgress: null,
          }
        : blocked("The unfinished courses are no longer available.");
    }
    return event.courses.length > 0
      ? { name: "choose", courses: event.courses, selectedIds: [] }
      : blocked("No accessible Canvas courses were found.");
  }
  if (event.type === "SELECT" && state.name === "choose") {
    if (!state.courses.some((course) => course.id === event.courseId))
      return blocked("The selected course is no longer available.");
    const selectedIds = state.selectedIds.includes(event.courseId)
      ? state.selectedIds.filter((id) => id !== event.courseId)
      : [...state.selectedIds, event.courseId];
    return { ...state, selectedIds };
  }
  if (event.type === "SELECT_ALL" && state.name === "choose") {
    const allSelected =
      state.courses.length > 0 &&
      state.courses.every((course) => state.selectedIds.includes(course.id));
    return {
      ...state,
      selectedIds: allSelected ? [] : state.courses.map((course) => course.id),
    };
  }
  if (event.type === "CONFIGURE" && state.name === "choose") {
    return state.selectedIds.length > 0
      ? {
          name: "configure",
          courses: state.courses,
          selectedIds: state.selectedIds,
          packaging: "per-course",
          busy: false,
          discoveryProgress: null,
        }
      : state;
  }
  if (event.type === "SET_PACKAGING" && state.name === "configure") {
    return { ...state, packaging: event.packaging };
  }
  if (event.type === "DISCOVERING" && state.name === "configure") {
    return { ...state, busy: true, discoveryProgress: null };
  }
  if (event.type === "DISCOVERY_PROGRESS" && state.name === "configure") {
    return state.busy ? { ...state, discoveryProgress: event.progress } : state;
  }
  if (event.type === "PLAN_READY" && state.name === "configure") {
    return {
      name: "review",
      courses: state.courses,
      selectedIds: state.selectedIds,
      plan: event.plan,
    };
  }
  if (event.type === "CONFIRM" && state.name === "review") {
    const firstCourse = state.plan.selected[0];
    if (firstCourse === undefined) return state;
    return {
      name: "packing",
      courses: state.courses,
      selectedIds: state.selectedIds,
      packaging: state.plan.effectivePackaging,
      requestedPackaging: state.plan.requestedPackaging,
      plan: state.plan,
      progress: {
        stage: "discovery",
        currentCourseId: firstCourse.courseId,
        currentCourseIndex: 0,
        totalCourses: state.plan.selected.length,
        completedCourses: 0,
        completed: 0,
        total: firstCourse.resourceCount,
        failed: 0,
      },
    };
  }
  if (event.type === "PROGRESS" && state.name === "packing") {
    return { ...state, progress: event.progress };
  }
  if (event.type === "COMPLETE" && state.name === "packing") {
    const unresolvedIds = new Set([
      ...state.plan.skipped.map(({ courseId }) => courseId),
      ...state.plan.selected
        .filter(({ courseId }) => !event.completedCourseIds.includes(courseId))
        .map(({ courseId }) => courseId),
    ]);
    return {
      name: "complete",
      courses: state.courses,
      requestedPackaging: state.requestedPackaging,
      plan: state.plan,
      retryCourseIds: state.selectedIds.filter((courseId) =>
        unresolvedIds.has(courseId),
      ),
      packaging: event.packaging,
      completedCourses: event.completedCourses,
      completedCourseIds: event.completedCourseIds,
      failedCourses: event.failedCourses,
      outputCount: event.outputCount,
      counts: event.counts,
    };
  }
  if (event.type === "RETRY") {
    if (
      state.name === "review" &&
      state.plan.selected.length === 0 &&
      state.plan.skipped.length > 0
    ) {
      return {
        name: "connect",
        message: "Reconnect to retry unfinished courses.",
        busy: false,
        retry: {
          courseIds: state.selectedIds.filter((courseId) =>
            state.plan.skipped.some((failure) => failure.courseId === courseId),
          ),
          packaging: state.plan.requestedPackaging,
        },
      };
    }
    if (state.name === "complete" && state.retryCourseIds.length > 0) {
      return {
        name: "connect",
        message: "Reconnect to retry unfinished courses.",
        busy: false,
        retry: {
          courseIds: state.retryCourseIds,
          packaging: state.requestedPackaging,
        },
      };
    }
  }
  if (event.type === "FAILED") {
    if (
      state.name === "connect" ||
      state.name === "choose" ||
      state.name === "configure" ||
      state.name === "review" ||
      state.name === "packing"
    )
      return blocked(event.message);
  }
  if (
    event.type === "TAB_LOST" &&
    state.name !== "complete" &&
    state.name !== "blocked"
  ) {
    return blocked(event.message);
  }
  return state;
};

export const coursesForState = (
  state: Extract<ViewState, { name: "review" }>,
): CourseSummary[] => selectedCourses(state.courses, state.selectedIds);
