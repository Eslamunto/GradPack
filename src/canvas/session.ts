import type { CourseSummary } from "../shared/model";
import { canvasEndpoint } from "./endpoints";
import type { CanvasHttp } from "./http";

type CanvasCourse = {
  id: number;
  name?: string;
  course_code?: string;
  workflow_state?: string;
  concluded?: boolean;
};

export async function assertCurrentUser(http: CanvasHttp): Promise<void> {
  await http.json<{ id: number }>(canvasEndpoint({ type: "currentUser" }));
}

export async function listAccessibleCourses(
  http: CanvasHttp,
): Promise<CourseSummary[]> {
  const [active, completed] = await Promise.all([
    http.fetchAll<CanvasCourse>(
      canvasEndpoint({ type: "courses", enrollmentState: "active" }),
    ),
    http.fetchAll<CanvasCourse>(
      canvasEndpoint({ type: "courses", enrollmentState: "completed" }),
    ),
  ]);
  const byId = new Map<number, CourseSummary>();
  for (const course of [...active, ...completed]) {
    if (!Number.isSafeInteger(course.id) || course.id <= 0) continue;
    byId.set(course.id, {
      id: course.id,
      name: course.name?.trim() || `Course ${course.id}`,
      courseCode: course.course_code?.trim() || "",
      workflowState: course.workflow_state ?? "unknown",
      concluded: course.concluded === true,
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
