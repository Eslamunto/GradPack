import { CANVAS_ORIGIN } from "../shared/constants";

type Endpoint =
  | { type: "currentUser" }
  | { type: "courses"; enrollmentState: "active" | "completed" }
  | { type: "courseModules"; courseId: number }
  | { type: "moduleItems"; courseId: number; moduleId: number }
  | { type: "courseFiles"; courseId: number }
  | { type: "courseFolders"; courseId: number }
  | { type: "coursePages"; courseId: number }
  | { type: "coursePage"; courseId: number; pageUrl: string };

const positiveId = (value: number): string => {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError("Invalid ID");
  return String(value);
};

export function canvasEndpoint(endpoint: Endpoint): URL {
  const url = new URL(CANVAS_ORIGIN);

  switch (endpoint.type) {
    case "currentUser":
      url.pathname = "/api/v1/users/self/profile";
      return url;
    case "courses":
      if (
        endpoint.enrollmentState !== "active" &&
        endpoint.enrollmentState !== "completed"
      ) {
        throw new TypeError("Invalid enrollment state");
      }
      url.pathname = "/api/v1/courses";
      url.searchParams.set("enrollment_state", endpoint.enrollmentState);
      url.searchParams.append("state[]", "available");
      url.searchParams.append("state[]", "completed");
      url.searchParams.append("include[]", "concluded");
      url.searchParams.set("per_page", "100");
      return url;
    case "courseModules":
      url.pathname = `/api/v1/courses/${positiveId(endpoint.courseId)}/modules`;
      url.searchParams.append("include[]", "items");
      url.searchParams.append("include[]", "content_details");
      url.searchParams.set("per_page", "100");
      return url;
    case "moduleItems":
      url.pathname = `/api/v1/courses/${positiveId(endpoint.courseId)}/modules/${positiveId(endpoint.moduleId)}/items`;
      url.searchParams.set("per_page", "100");
      return url;
    case "courseFiles":
      url.pathname = `/api/v1/courses/${positiveId(endpoint.courseId)}/files`;
      url.searchParams.set("per_page", "100");
      return url;
    case "courseFolders":
      url.pathname = `/api/v1/courses/${positiveId(endpoint.courseId)}/folders`;
      url.searchParams.set("per_page", "100");
      return url;
    case "coursePages":
      url.pathname = `/api/v1/courses/${positiveId(endpoint.courseId)}/pages`;
      url.searchParams.set("per_page", "100");
      return url;
    case "coursePage":
      if (
        typeof endpoint.pageUrl !== "string" ||
        !/^[a-zA-Z0-9_-]{1,255}$/.test(endpoint.pageUrl)
      ) {
        throw new TypeError("Invalid page URL token");
      }
      url.pathname = `/api/v1/courses/${positiveId(endpoint.courseId)}/pages/${encodeURIComponent(endpoint.pageUrl)}`;
      return url;
    default:
      throw new TypeError("Unsupported endpoint");
  }
}
