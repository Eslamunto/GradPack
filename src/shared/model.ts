export type CourseSummary = {
  id: number;
  name: string;
  courseCode: string;
  workflowState: string;
  concluded: boolean;
};

export type RunStage = "discovery" | "download" | "sanitize" | "package";
export type Progress = {
  stage: RunStage;
  completed: number;
  total: number;
  failed: number;
};

export type PackagingMode = "combined" | "per-course";
export type PlanFallbackReason =
  "combined-size-exceeded" | "combined-resource-limit-exceeded";

export type CoursePlanSummary = {
  courseId: number;
  advertisedBytes: number;
  resourceCount: number;
};

export type RunPlanSummary = {
  selected: CoursePlanSummary[];
  requestedPackaging: PackagingMode;
  effectivePackaging: PackagingMode;
  advertisedBytes: number;
  resourceCount: number;
  fallbackReason: PlanFallbackReason | null;
};

export type AggregateProgress = Progress & {
  currentCourseId: number;
  currentCourseIndex: number;
  totalCourses: number;
  completedCourses: number;
};

export type ResourceKind = "file" | "page" | "external" | "unsupported";
export type OutcomeStatus =
  "success" | "failed" | "unavailable" | "unsupported" | "external";

export type PlannedResource = {
  key: string;
  kind: ResourceKind;
  title: string;
  sourceId: string;
  archivePath: string | null;
  advertisedBytes: number | null;
  sourceUrl: string | null;
};

export type ModuleItem = {
  id: number;
  title: string;
  position: number;
  resourceKey: string | null;
  type: string;
};

export type CourseModule = {
  id: number;
  name: string;
  position: number;
  items: ModuleItem[];
};

export type CoursePlan = {
  course: CourseSummary;
  modules: CourseModule[];
  resources: PlannedResource[];
  advertisedBytes: number;
};

export type ResourceOutcome = PlannedResource & {
  status: OutcomeStatus;
  actualBytes: number | null;
  failureCategory: string | null;
};
