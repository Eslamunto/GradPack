import type { Progress } from "../page/run-course";
import type { CourseSummary } from "../shared/model";

export type OutcomeCounts = {
  success: number;
  failed: number;
  unavailable: number;
  unsupported: number;
  external: number;
};

export type UiEvent =
  | { type: "CONNECTING" }
  | { type: "COURSES"; courses: CourseSummary[] }
  | { type: "SELECT"; courseId: number }
  | { type: "PROGRESS"; progress: Progress }
  | { type: "COMPLETE"; counts: OutcomeCounts }
  | { type: "FAILED"; message: string };

export type ViewState =
  | { name: "connect"; message: string; busy: boolean }
  | { name: "choose"; courses: CourseSummary[]; selectedId: number | null }
  | { name: "ready"; course: CourseSummary }
  | { name: "packing"; progress: Progress }
  | { name: "complete"; counts: OutcomeCounts }
  | { name: "blocked"; message: string };

export const initialState: ViewState = {
  name: "connect",
  message: "Open a signed-in Frankfurt School Canvas tab to begin.",
  busy: false,
};

export function reduceState(state: ViewState, event: UiEvent): ViewState {
  if (event.type === "CONNECTING") {
    return {
      name: "connect",
      message: "Connecting to the active Frankfurt School Canvas tab…",
      busy: true,
    };
  }
  if (event.type === "COURSES" && state.name === "connect") {
    return event.courses.length === 0
      ? {
          name: "blocked",
          message:
            "No accessible Canvas courses were found. Check your Canvas tab and try again.",
        }
      : { name: "choose", courses: event.courses, selectedId: null };
  }
  if (event.type === "SELECT" && state.name === "choose") {
    const course = state.courses.find(({ id }) => id === event.courseId);
    return course
      ? { name: "ready", course }
      : {
          name: "blocked",
          message: "The selected course is no longer available.",
        };
  }
  if (
    event.type === "PROGRESS" &&
    (state.name === "ready" || state.name === "packing")
  ) {
    return { name: "packing", progress: event.progress };
  }
  if (event.type === "COMPLETE" && state.name === "packing")
    return { name: "complete", counts: event.counts };
  if (
    event.type === "FAILED" &&
    (state.name === "connect" || state.name === "packing")
  )
    return { name: "blocked", message: event.message };
  return state;
}
