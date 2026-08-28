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
  | "combined-size-exceeded"
  | "combined-resource-limit-exceeded"
  | "unknown-size-files";

export type ModuleDiscovery = "available" | "disabled";

export type CoursePlanSummary = {
  courseId: number;
  moduleDiscovery: ModuleDiscovery;
  advertisedBytes: number;
  unknownSizeCount: number;
  resourceCount: number;
};

export type CoursePlanFailureCategory =
  | "size-limit"
  | "canvas-unavailable"
  | "safety-validation"
  | "unexpected-local";

export type CoursePlanFailureSummary = {
  courseId: number;
  category: CoursePlanFailureCategory;
};

export type CourseDiscoveryProgress = {
  completed: number;
  total: number;
  currentCourseId: number;
};

export type RunPlanSummary = {
  requestedCourseCount: number;
  selected: CoursePlanSummary[];
  skipped: CoursePlanFailureSummary[];
  requestedPackaging: PackagingMode;
  effectivePackaging: PackagingMode;
  advertisedBytes: number;
  unknownSizeCount: number;
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
  indent: number;
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
  moduleDiscovery: ModuleDiscovery;
  modules: CourseModule[];
  resources: PlannedResource[];
  advertisedBytes: number;
};

export type ResourceOutcome = PlannedResource & {
  status: OutcomeStatus;
  actualBytes: number | null;
  failureCategory: string | null;
};
