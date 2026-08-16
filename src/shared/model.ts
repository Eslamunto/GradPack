export type CourseSummary = {
  id: number;
  name: string;
  courseCode: string;
  workflowState: string;
  concluded: boolean;
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
