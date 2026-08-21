import { renderCoursePages } from "./course-pages";
import { buildArchiveNavigationModel } from "./navigation-model";
import type { CoursePlan, ResourceOutcome } from "../shared/model";

export function renderIndexPage(
  plan: CoursePlan,
  outcomes: ResourceOutcome[],
  createdAt: string,
): string;
export function renderIndexPage(
  plan: unknown,
  outcomes: unknown,
  createdAt: unknown,
): string {
  const model = buildArchiveNavigationModel(
    plan as CoursePlan,
    outcomes as ResourceOutcome[],
    createdAt as string,
  );
  return renderCoursePages(model).get("index.html")!;
}
