import type { CourseSummary } from "../shared/model";
import { canvasEndpoint } from "./endpoints";
import type { CanvasHttp } from "./http";

export async function assertCurrentUser(http: CanvasHttp): Promise<void> {
  await http.json<{ id: number }>(canvasEndpoint({ type: "currentUser" }));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function normalizeAccessibleCourses(
  active: readonly unknown[],
  completed: readonly unknown[],
): CourseSummary[] {
  const byId = new Map<number, CourseSummary>();
  for (const value of [...active, ...completed]) {
    if (!isRecord(value)) continue;
    const id = value.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      continue;
    }
    byId.set(id, {
      id,
      name:
        (typeof value.name === "string" && value.name.trim()) || `Course ${id}`,
      courseCode:
        (typeof value.course_code === "string" && value.course_code.trim()) ||
        "",
      workflowState:
        typeof value.workflow_state === "string"
          ? value.workflow_state
          : "unknown",
      concluded: value.concluded === true,
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAccessibleCourses(
  http: CanvasHttp,
  options: { abort?: (reason: Error | DOMException) => void } = {},
): Promise<CourseSummary[]> {
  let firstError: Error | DOMException | undefined;
  const request = (enrollmentState: "active" | "completed") =>
    http
      .fetchAll<unknown>(canvasEndpoint({ type: "courses", enrollmentState }))
      .catch((error: unknown) => {
        firstError ??=
          error instanceof Error || error instanceof DOMException
            ? error
            : new TypeError("Canvas course listing failed");
        options.abort?.(firstError);
        throw firstError;
      });
  const settled = await Promise.allSettled([
    request("active"),
    request("completed"),
  ]);
  if (firstError) throw firstError;
  const values = settled.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  return normalizeAccessibleCourses(values[0]!, values[1]!);
}
