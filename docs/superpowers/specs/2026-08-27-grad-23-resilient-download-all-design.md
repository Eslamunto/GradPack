# GRAD-23 Resilient Download All Design

- **Status:** Approved
- **Issue:** GRAD-23 follow-up — make Select all resilient to course-specific failures
- **Date:** 2026-08-27

## Problem

The GRAD-23 Select all control correctly sends every displayed active,
completed, and concluded course into the existing multi-course workflow. Live
acceptance testing exposed an all-or-nothing planning failure: one selected
course with a course-specific Canvas discovery problem stops discovery for
every selected course and produces only the generic safety message.

The reproduced failure is not caused by the 250 MiB per-course limit. A safe
course plans successfully, while another course below the limit fails during
Canvas metadata discovery. The current planner wraps that course-specific
error as a run-wide safety failure, discarding both the failing course and all
plans already completed for other courses.

## Goals

- Make Select all a one-click, best-effort workflow across every displayed
  course.
- Prevent one course or resource failure from stopping otherwise valid course
  downloads.
- Preserve strict validation for URLs, identifiers, archive paths, sizes, and
  response shapes.
- Explain ready, partial, skipped, and downloaded outcomes with safe local-only
  messages.
- Let the user retry only skipped courses without rebuilding the original
  selection manually.
- Preserve successful ZIP downloads if a later course fails.

## Non-Goals

- Removing or increasing the 250 MiB per-course hard limit.
- Trusting malformed metadata, unsafe redirects, mismatched identifiers, or
  foreign origins.
- Bypassing Canvas permissions or retrieving material the signed-in student
  cannot access.
- Adding a backend, cloud storage, telemetry, analytics, persistent logs, or
  credentials.
- Splitting one course larger than 250 MiB into multi-part archives. That is a
  separate feature because it changes the archive contract.
- Automatically retrying indefinitely or hiding skipped material from the
  student.

## Selected Approach

Use layered best-effort processing:

1. Discover every selected course independently.
2. Keep existing narrow resource fallbacks for exact, student-authorized,
   ID-bound Canvas resources.
3. Convert recoverable resource failures into explicit unavailable outcomes
   inside an otherwise valid course plan.
4. Convert terminal course-specific failures into typed skipped-course results
   instead of aborting the complete run.
5. Continue to review and packing whenever at least one course has a safe plan.
6. Preserve run-wide termination only for cancellation, navigation, session
   loss, protocol corruption, or another failure that invalidates the whole
   operation.

This approach is preferred over silently skipping courses because the user
must see incomplete coverage. It is preferred over relaxing validation because
the extension must remain fail-closed at its trust boundaries.

## Architecture and Boundaries

### Course discovery

The multi-course planner changes from fail-fast accumulation to independent
settlement. Each selected course produces one of two immutable results:

- a validated `CoursePlan`; or
- a typed `CoursePlanFailure` containing the validated course summary and a
  fixed, privacy-safe category.

Planning remains sequential so request concurrency, Canvas load, ordering, and
cancellation behavior remain bounded. A failed result is recorded, and the
planner proceeds to the next selected course.

The planner throws only when:

- no course was selected;
- the run is cancelled or the Canvas tab navigates;
- the Canvas session is unavailable for the whole run;
- the command or protocol is invalid; or
- no selected course can produce a safe plan.

If at least one course succeeds, the planner returns an immutable run plan with
both ready course plans and skipped-course failures.

### Resource discovery

Modules remain the canonical course topology. Optional broad files, folders,
and pages indexes remain accelerators rather than requirements.

Existing narrow fallback behavior is preserved:

- a precisely unavailable optional collection is treated as absent;
- a module-linked page that is unavailable or exceeds the bounded metadata
  response limit remains represented by its module entry;
- an exact, ID-bound file whose metadata endpoint returns a precisely
  unavailable response uses the existing unknown-size, same-course download
  path and is streamed under the hard byte cap; and
- unavailable retrieval outcomes remain visible in the archive manifest.

Malformed successful responses, mismatched IDs, conflicting records, unsafe
URLs, invalid file sizes, and unsafe archive paths are not converted into
fallback resources. They remain terminal for that course and become a typed
skipped-course result at the multi-course boundary.

### Packing

Packing continues sequentially over ready plans only. Each successful ZIP is
handed off immediately and is never revoked because of a later failure.
Course-local packing failures are accumulated and reported while remaining
ready courses continue.

Combined packaging is available only when every ready course satisfies the
existing combined constraints. Unknown-size files, combined byte limits, and
combined entry limits continue to trigger the existing pre-retrieval fallback
to one ZIP per course. Skipped courses are never inserted into a combined ZIP.

## Result Model

The run-plan summary adds bounded, validated course-level outcome data:

- requested course count;
- ready course summaries;
- skipped course summaries with a fixed category;
- advertised bytes, unknown-size count, and resource count for ready courses;
- requested and effective packaging; and
- combined-packaging fallback reason.

Failure categories are deliberately small and fixed:

- `size-limit` — the individual course exceeds the hard archive limit;
- `canvas-unavailable` — Canvas did not provide required usable metadata;
- `safety-validation` — a course-specific integrity or safety check failed;
  and
- `unexpected-local` — an unexpected local course operation failed.

Raw exception text, URLs, response bodies, course content, credentials, and
stack traces never cross into Side Panel events or persistent storage.

## User Experience

### Discovery

After selection and packaging choice, the Side Panel shows bounded aggregate
progress such as **Checking course 7 of 32**. Course names do not need to be
announced during progress.

### Review plan

The review screen appears whenever at least one course is ready. It shows:

- courses ready;
- courses skipped during discovery;
- total advertised bytes and resources for ready courses;
- requested and effective packaging; and
- the existing combined-to-separate ZIP fallback notice when applicable.

Skipped courses appear in a compact list with their Canvas course name and one
fixed explanation. The screen states that continuing downloads every ready
course and omits skipped courses.

### Completion

The completion screen distinguishes:

- fully downloaded courses;
- partially downloaded courses with unavailable resources;
- courses that failed during packing; and
- courses skipped during discovery.

The primary success copy must not claim that all selected material was
downloaded when any course or resource was unavailable.

A **Retry skipped courses** action starts a fresh discovery run containing only
the skipped or failed course IDs and reuses the prior requested packaging. It
does not automatically retrieve anything; a successful retry still reaches the
review confirmation before packing.

If every selected course fails discovery, GradPack shows a terminal screen with
the safe per-course reasons and a retry action instead of the generic run-wide
safety message.

## Safety and Privacy

The following protections remain unchanged:

- exact Frankfurt School Canvas origin and HTTPS requirements;
- same-origin, read-only Canvas endpoints;
- explicit validated course and resource identifiers;
- bounded metadata bodies, retries, concurrency, resource counts, ZIP entries,
  text sizes, and archive bytes;
- fail-closed redirect, response, path, and identifier validation;
- the 250 MiB hard limit for each course archive;
- cancellation, navigation, and session-loss handling; and
- local-only processing with no telemetry or backend.

Best-effort behavior is introduced only after errors have been classified at a
course or resource boundary. It does not turn an unsafe response into trusted
content.

## Testing Strategy

Test-driven coverage will include:

- a regression fixture where one problematic course among valid courses no
  longer aborts the run;
- independent discovery settlement in original selection order;
- active, completed, and concluded courses in one Select all request;
- a recoverable resource failure represented as unavailable while its course
  remains ready;
- a terminal course safety failure represented as skipped while later courses
  continue planning;
- all-courses-failed behavior with no retrieval;
- session loss and cancellation remaining run-wide terminal outcomes;
- successful ZIP handoff surviving a later course packing failure;
- strict rejection of foreign URLs, mismatched IDs, malformed successful
  metadata, unsafe paths, and byte/resource overflows;
- per-course 250 MiB enforcement and combined-to-separate fallback;
- validated and internally consistent plan, progress, completion, and retry
  message counts;
- retry containing only skipped or failed course IDs; and
- accessibility coverage for review and completion status, lists, buttons, and
  focus transitions.

Verification requires:

- focused unit and integration tests;
- `CI=true pnpm verify`;
- production build and release-contract checks;
- ZIP checksum, integrity, and generated-file inventory checks; and
- a fresh live Chrome acceptance test selecting all displayed courses and
  confirming that valid ZIPs continue despite the reproduced problematic
  course.

Live validation evidence must remain privacy-safe. Course names, IDs, URLs,
filenames, and content observed during local debugging are not copied into
source control, Linear, pull requests, or release artifacts.

## Acceptance Criteria

- One click selects every displayed active, completed, and concluded course.
- One problematic course does not stop discovery or packing for valid courses.
- Recoverable resource failures remain visible without aborting their course.
- Unsafe course data remains fail-closed and skips only that course.
- Review accurately distinguishes requested, ready, and skipped courses.
- Completion accurately distinguishes full, partial, failed, and skipped
  outcomes.
- Retry includes only skipped or failed courses and still requires review before
  retrieval.
- The 250 MiB per-course cap and every existing trust boundary remain enforced.
- No telemetry, backend, credentials, or persistent diagnostic content is
  introduced.
- Automated verification, archive integrity checks, and the live 32-course
  acceptance flow pass before release.
