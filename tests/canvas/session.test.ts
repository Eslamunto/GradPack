import { describe, expect, it, vi } from "vitest";
import {
  assertCurrentUser,
  listAccessibleCourses,
} from "../../src/canvas/session";

describe("assertCurrentUser", () => {
  it("probes the fixed current-user endpoint", async () => {
    const json = vi.fn().mockResolvedValue({ value: { id: 7 } });

    await assertCurrentUser({ json } as never);

    expect(json).toHaveBeenCalledOnce();
    expect(json.mock.calls[0]?.[0].href).toBe(
      "https://frankfurtschool.instructure.com/api/v1/users/self/profile",
    );
  });
});

describe("listAccessibleCourses", () => {
  it("merges and deduplicates active and completed enrollments", async () => {
    const fetchAll = vi
      .fn<(url: URL) => Promise<Array<Record<string, unknown>>>>()
      .mockResolvedValueOnce([
        { id: 1, name: "A", course_code: "A", workflow_state: "available" },
      ])
      .mockResolvedValueOnce([
        { id: 1, name: "A", course_code: "A", workflow_state: "available" },
        { id: 2, name: "B", course_code: "B", workflow_state: "completed" },
      ]);

    const courses = await listAccessibleCourses({ fetchAll } as never);

    expect(courses.map((course) => course.id)).toEqual([1, 2]);
    expect(
      fetchAll.mock.calls.map(([url]) =>
        url.searchParams.get("enrollment_state"),
      ),
    ).toEqual(["active", "completed"]);
  });

  it("filters invalid IDs, normalizes missing fields, and sorts by name", async () => {
    const fetchAll = vi
      .fn<(url: URL) => Promise<Array<Record<string, unknown>>>>()
      .mockResolvedValueOnce([
        { id: 3, name: "  Zebra  ", concluded: true },
        { id: -1, name: "Invalid" },
      ])
      .mockResolvedValueOnce([
        { id: 2, name: "  ", course_code: "  ", workflow_state: undefined },
        { id: 1.5, name: "Unsafe" },
      ]);

    await expect(listAccessibleCourses({ fetchAll } as never)).resolves.toEqual(
      [
        {
          id: 2,
          name: "Course 2",
          courseCode: "",
          workflowState: "unknown",
          concluded: false,
        },
        {
          id: 3,
          name: "Zebra",
          courseCode: "",
          workflowState: "unknown",
          concluded: true,
        },
      ],
    );
  });
});
