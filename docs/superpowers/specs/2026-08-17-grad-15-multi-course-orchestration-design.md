# GRAD-15 Multi-Course Orchestration Design

- **Linear:** [GRAD-15](https://linear.app/cognita-reply-de/issue/GRAD-15/implement-multi-course-orchestration-progress-and-cancellation)
- **Status:** Approved for implementation planning
- **Date:** 2026-08-17
- **Baseline:** merged one-course pilot on `origin/main`

## 1. Objective

Extend the validated one-course GradPack vertical slice to all user-selected
accessible Canvas courses while preserving the local-only boundary, explicit
safety limits, accurate progress, cancellation, and usable partial results.

The feature will keep the existing Canvas page-context runner and resource
retrieval mechanisms. A dedicated coordinator will own the run-level decisions
that do not belong in the current one-course archive worker.

## 2. Scope

The implementation includes:

- multi-select course discovery and selection across all returned enrollment
  states;
- immutable discovery of every selected course before resource retrieval;
- combined and per-course output selection;
- automatic combined-to-per-course fallback when the combined advertised size
  exceeds the proven mechanism limit but every individual course fits;
- pre-retrieval stopping for unknown sizes and individual courses above the
  mechanism limit;
- bounded execution with aggregate progress;
- cancellation, connected-tab closure/navigation, Canvas session loss, retry,
  and partial-course failure handling;
- preservation of already completed course archives; and
- synthetic integration coverage for success, fallback, session loss,
  cancellation, and partial failure.

The implementation does not add restart/resume after extension or browser
restart, remote storage, telemetry, new Canvas content types, or a new runtime
such as an offscreen document.

## 3. Design decisions

### 3.1 Coordinator around the existing course worker

The current one-course pipeline is split at its packaging boundary:

- the reusable course worker discovers, retrieves, transforms, and builds one
  course archive, returning its manifest and ZIP bytes;
- a compatibility wrapper preserves the existing one-course entry point; and
- a new multi-course coordinator owns all selected-course plans, packaging
  policy, course sequencing, output handoff, and aggregate terminal state.

Courses execute sequentially. Each course continues to use the existing
resource-level concurrency of two, preserving the global request bound while
making cancellation and memory cleanup deterministic.

### 3.2 Discovery before retrieval

`START_RUN` performs discovery for every selected course. The coordinator
copies and freezes each returned `CoursePlan`, verifies that its course ID
matches the selected course, validates resource/path/count invariants, and
aggregates advertised byte totals. No file or page retrieval begins before
this complete immutable plan exists.

The coordinator then calculates the effective packaging mode:

| Requested mode | Discovered plan | Effective behavior |
| --- | --- | --- |
| `per-course` | every course fits | one ZIP per successful course |
| `combined` | combined total fits | one combined ZIP after all courses finish |
| `combined` | combined total exceeds the limit, every course fits | emit a warning; require confirmation; use per-course ZIPs |
| either mode | any course has unknown size or exceeds the limit | stop before retrieval and report the exact course limitation |

The review/confirmation step is part of the run protocol. This ensures an
automatic packaging change is visible before any retrieval begins.

### 3.3 Preserve completed outputs

In per-course mode, a successful course ZIP is handed to Chrome immediately.
In combined mode, completed course ZIPs are held transiently until the run can
be finalized. If every course succeeds, the coordinator creates one combined
ZIP with a safe course-root directory for each course. If a course-local
failure occurs, or cancellation/session loss stops the run, the coordinator
hands off completed course ZIPs individually before clearing transient state.

The current course is never handed off as an incomplete archive. Successful
course output that has already been handed to Chrome is not revoked or deleted.

## 4. Component contracts

### 4.1 Shared models

The shared model layer will define the following concepts:

- `PackagingMode`: `"combined" | "per-course"`;
- immutable run-plan summaries containing the run ID, selected courses,
  advertised total, effective mode, and optional fallback reason;
- per-course archive results containing the course ID, output filename,
  manifest, and output status;
- aggregate progress containing stage, current course position, completed
  courses, resource completed/total counts, and failed count; and
- sanitized run-level failure categories that never include response bodies,
  credentials, headers, or sensitive query strings.

The existing `CoursePlan`, `PlannedResource`, and `ResourceOutcome` contracts
remain the resource-level source of truth.

### 4.2 Extension command protocol

The versioned extension channel will accept these run commands:

- `LIST_COURSES { runId }`;
- `START_RUN { runId, courseIds, packaging }`;
- `CONFIRM_PLAN { runId }`; and
- `CANCEL { runId }`.

Commands use exact-key validation. Course IDs, packaging mode, array length,
and run identifier are validated before reaching the page runner. No arbitrary
URL, method, header, body, or script is accepted through the protocol.

### 4.3 Runner events

The runner will emit:

- `COURSES` with all validated accessible course summaries;
- `PLAN_READY` with selected-course summaries, advertised totals, effective
  packaging mode, and an optional fixed fallback explanation;
- aggregate `PROGRESS` with the current course, course index/total, stage,
  completed/total resources, and failed count;
- `COMPLETE` with effective output mode, completed/failed course counts,
  resource outcome totals, and output count; and
- fixed-message `FAILED` or `CANCELLED` terminal events.

Every event is correlated to the active run ID. A confirmation for another run
or an already-terminal run is ignored. The runner accepts at most one listing,
planning, or active operation at a time.

## 5. Run lifecycle

```text
connect
  -> select accessible courses
  -> choose combined or per-course output
  -> discover every selected course
  -> review immutable plan and any fallback warning
  -> confirm plan
  -> retrieve and package courses with aggregate progress
  -> download combined or completed per-course outputs
  -> show complete or stopped result
```

The Side Panel states are:

- `connect` — locate the signed-in Canvas tab;
- `choose` — keyboard-accessible multi-course selection;
- `configure` — choose combined or per-course packaging;
- `review` — show discovered totals, effective mode, and fallback reason;
- `packing` — show current course, stage, aggregate counts, and Cancel;
- `complete` — show downloaded outputs and resource/course outcome totals; and
- `stopped` — show a fixed safe reason and the next action.

The UI displays course names only as user-facing selection/output context. It
does not log course names, filenames, response bodies, cookies, credentials,
or request headers.

## 6. Error handling

### Pre-retrieval failures

Malformed plans, selected-course mismatches, unknown file sizes, individual
course size violations, resource-count violations, and unsafe archive paths
stop the run before retrieval. The error identifies the safe course-level
limitation without exposing Canvas response content.

### Course-local failures

Individual resource failures continue within the course and appear in its
manifest. A deterministic course-local archive/retrieval failure records that
course as failed and allows later selected courses to run. Successful course
archives are preserved.

### Run-level failures

Canvas session loss, login-page responses, connected-tab navigation or closure,
cancellation, and shared runtime failures stop the run. Abort signals cascade
through discovery, retry delays, response readers, packaging, and download
handoff. The current course is discarded; completed outputs are preserved as
described above.

### Cleanup

Every coordinator and course-worker path uses `finally` cleanup. Maps and
retained byte buffers are cleared, retained bytes are zeroed where possible,
abort listeners are removed, and no incomplete archive is downloaded.

## 7. Verification strategy

### Unit tests

Tests will cover:

- immutable all-course planning and selected-course validation;
- packaging-mode decisions and the exact 250 MB boundary;
- individual over-limit/unknown-size stopping before retrieval;
- sequential bounded execution and aggregate progress invariants;
- course-local failure continuation;
- cancellation and session-loss propagation;
- preservation of completed outputs;
- combined archive namespacing and manifest aggregation;
- exact command/event parsing and stale-plan rejection; and
- Side Panel state transitions and accessible controls.

### Synthetic integration tests

The existing synthetic runtime harness will cover:

- multiple active, completed, and concluded courses completing successfully;
- combined-to-per-course fallback with explanation before retrieval;
- one course failing while another course archive remains usable;
- session loss and connected-tab closure after a completed course;
- cancellation after a completed course; and
- aggregate progress and terminal counts that remain consistent.

Fixtures remain anonymized and local. Generated course-like archives are not
published as CI artifacts.

## 8. Completion checks

The implementation is complete when formatting, linting, type checking, all
unit/integration tests, and the production extension build pass, and the
GRAD-15 acceptance criteria are demonstrated by synthetic tests.
