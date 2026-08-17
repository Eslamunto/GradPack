# GRAD-15 Multi-Course Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the merged one-course GradPack pilot to select, plan, retrieve, package, cancel, and report multiple Canvas courses while preserving safe partial outputs.

**Architecture:** Keep the existing page-context Canvas runner and resource-level concurrency of two. Extract a non-downloading one-course archive builder, add a multi-course coordinator that freezes all discovery plans before retrieval and decides packaging mode, then expand the strict relay protocol and Side Panel reducer/UI around the coordinator’s run states.

**Tech Stack:** TypeScript 5.9, browser-native Manifest V3 extension, Vitest 4, `fflate`, DOMPurify, jsdom, esbuild, pnpm.

## Global Constraints

- All course discovery and retrieval use the student’s existing same-origin Canvas session.
- Only fixed read-only Canvas operations are allowed; no credentials, cookies, arbitrary URLs, methods, headers, or request bodies cross the extension boundary.
- `MAX_ARCHIVE_BYTES` remains `262_144_000` and `MAX_ARCHIVE_RESOURCES` remains `65_532` for the in-memory ZIP mechanism.
- Each course uses at most `MAX_CONCURRENCY = 2` resource retrievals; course execution is sequential.
- Every discovered resource has a terminal manifest outcome; no resource is silently omitted.
- Combined fallback or an individual-course safety stop is decided before retrieval and is visible before confirmation.
- Cancellation, session loss, tab closure/navigation, and shared failures clear transient bytes and preserve already handed-off archives.
- Synthetic fixtures contain no real identity, course content, credentials, or sensitive URLs.
- Every task follows red-green-refactor and ends with focused tests plus an intentional commit.

---

### Task 1: Define the multi-course models and strict relay protocol

**Files:**
- Modify: `src/shared/model.ts`
- Modify: `src/shared/messages.ts`
- Modify: `src/shared/constants.ts` to add any named aggregate protocol limit required by the parser
- Test: `tests/shared/messages.test.ts`
- Test: `tests/fixtures/course-plan.ts` for reusable multi-course fixtures

**Interfaces:**

- Produces `PackagingMode = "combined" | "per-course"`.
- Produces `PlanFallbackReason = "combined-size-exceeded" | "combined-resource-limit-exceeded"`.
- Produces `CoursePlanSummary = { courseId: number; advertisedBytes: number; resourceCount: number }`.
- Produces `RunPlanSummary = { selected: CoursePlanSummary[]; requestedPackaging: PackagingMode; effectivePackaging: PackagingMode; advertisedBytes: number; resourceCount: number; fallbackReason: PlanFallbackReason | null }`.
- Produces `RunStage = "discovery" | "download" | "sanitize" | "package"`, `Progress = { stage: RunStage; completed: number; total: number; failed: number }`, and `AggregateProgress = Progress & { currentCourseId: number; currentCourseIndex: number; totalCourses: number; completedCourses: number }` in `src/shared/model.ts`, so the Side Panel and page runner share the protocol type without importing page code.
- Changes extension commands to `LIST_COURSES`, `START_RUN { runId, courseIds, packaging }`, `CONFIRM_PLAN { runId }`, and `CANCEL`.
- Changes runner events to `COURSES`, `PLAN_READY`, aggregate `PROGRESS`, aggregate `COMPLETE`, `CANCELLED`, and `FAILED`.

- [ ] **Step 1: Write failing parser tests for multi-course commands and plan/progress events.**

Add tests that require exact keys and reject arbitrary fields, duplicate/empty course IDs, invalid packaging values, malformed fallback reasons, negative counts, mismatched aggregate counts, resource totals above `MAX_ARCHIVE_RESOURCES`, and stale unsupported event shapes. Include a valid `START_RUN`, `CONFIRM_PLAN`, `PLAN_READY`, aggregate `PROGRESS`, and aggregate `COMPLETE` fixture.

- [ ] **Step 2: Run the focused parser tests and verify they fail for missing protocol variants.**

Run:

```bash
pnpm exec vitest run tests/shared/messages.test.ts
```

Expected: FAIL because the current parser only accepts `START_COURSE` and single-course events.

- [ ] **Step 3: Add the model types and parser branches.**

Keep the existing `record`, `exactKeys`, `runId`, course-summary, and scalar-validation boundaries. Validate `courseIds` as a dense array of unique positive safe integers with a bounded length. Validate `PLAN_READY` so its advertised bytes/resource count and fallback mode are internally consistent. Validate `COMPLETE` so completed/failed course counts and resource outcome totals are non-negative and bounded.

- [ ] **Step 4: Run the focused parser tests and existing shared tests.**

Run:

```bash
pnpm exec vitest run tests/shared/messages.test.ts tests/shared
```

Expected: PASS, with no warnings or unrelated failures.

- [ ] **Step 5: Commit the protocol boundary.**

```bash
git add src/shared/model.ts src/shared/messages.ts src/shared/constants.ts tests/shared/messages.test.ts tests/fixtures/course-plan.ts
git commit -m "feat: add multi-course run protocol"
```

### Task 2: Extract a reusable one-course archive builder and build combined ZIPs

**Files:**
- Modify: `src/page/run-course.ts`
- Modify: `src/archive/build-zip.ts`
- Modify: `src/archive/manifest.ts`
- Create: `src/archive/combined.ts`
- Test: `tests/page/run-course.test.ts`
- Test: `tests/archive/build-zip.test.ts`
- Create: `tests/archive/combined.test.ts`

**Interfaces:**

- Produces `buildCourseArchive({ course, plan, signal, progress, dependencies }): Promise<RunResult>`; it returns a manifest and ZIP bytes but does not call Chrome download APIs.
- Preserves `runCourse({ course, signal, progress, dependencies }): Promise<RunResult>` as a compatibility wrapper that discovers a plan, calls `buildCourseArchive`, downloads the ZIP, and retains current one-course behavior.
- Produces `CourseArchiveOutput = { course: CourseSummary; fileName: string; manifest: ArchiveManifest; zipBytes: Uint8Array }`.
- Produces `CombinedArchiveInput = { archives: readonly CourseArchiveOutput[]; archiveCss: string; now: () => string; fileName: (courses: readonly CourseSummary[]) => string }`.
- Produces `CombinedArchiveManifest = { schemaVersion: number; kind: "combined"; createdAt: string; courses: readonly { courseId: number; fileName: string; manifest: ArchiveManifest }[]; totals: { success: number; failed: number; unavailable: number; unsupported: number; external: number } }`.
- Produces `buildCombinedZip(input: CombinedArchiveInput): { zipBytes: Uint8Array; manifest: CombinedArchiveManifest }`.
- A combined archive contains one safe `courses/<course-name>/` root per successful course, one root `index.html`, one root `manifest.json`, and one root `assets/archive.css`; course ZIP core files are merged under their course root without path traversal or collisions.

- [ ] **Step 1: Write failing tests proving the archive builder can build without downloading.**

Refactor-oriented tests should provide a discovered `CoursePlan`, a retrieval fake, and a download spy. Assert that `buildCourseArchive` returns a valid manifest/ZIP and never calls the download spy, while `runCourse` still calls it once. Add a cancellation test that proves returned transient bytes are cleared when building fails.

- [ ] **Step 2: Run the focused course-worker tests and verify the missing builder failure.**

Run:

```bash
pnpm exec vitest run tests/page/run-course.test.ts
```

Expected: FAIL because `buildCourseArchive` does not exist.

- [ ] **Step 3: Extract the existing retrieval/package body into `buildCourseArchive`.**

Make the builder accept a frozen pre-discovered plan and keep all current size, path, resource-outcome, sanitizer, retry, abort, byte-zeroing, and manifest invariants. Keep discovery in the compatibility `runCourse` wrapper. Do not broaden the existing Canvas or archive safety policy.

- [ ] **Step 4: Run course-worker tests and refactor only after green.**

Run:

```bash
pnpm exec vitest run tests/page/run-course.test.ts tests/archive
```

Expected: PASS for the current one-course suite and the new non-downloading builder tests.

- [ ] **Step 5: Write failing combined-archive tests.**

Cover two course ZIP inputs with colliding local paths, verify course-root namespacing, root manifest course totals, deterministic output ordering, exact entry/resource limits, and rejection of an unsafe course name or malformed nested ZIP. Verify the combined output is valid with `unzipSync`.

- [ ] **Step 6: Run the combined tests and verify they fail before implementation.**

Run:

```bash
pnpm exec vitest run tests/archive/combined.test.ts
```

Expected: FAIL because combined archive construction and manifest types are missing.

- [ ] **Step 7: Implement combined manifest and ZIP construction.**

Unpack each completed course ZIP using the existing `fflate` dependency, validate each entry with the existing archive-path rules, prefix entries under a deterministic safe course root, aggregate per-course manifests, and emit a root index/manifest/css set. Reject combined payloads above the aggregate byte or classic ZIP resource limit before creating a downloadable result.

- [ ] **Step 8: Run archive tests and the full current test suite.**

Run:

```bash
pnpm exec vitest run tests/archive tests/page/run-course.test.ts
```

Expected: PASS with no regressions in existing one-course archive behavior.

- [ ] **Step 9: Commit the archive boundary.**

```bash
git add src/page/run-course.ts src/archive/build-zip.ts src/archive/manifest.ts src/archive/combined.ts tests/page/run-course.test.ts tests/archive/build-zip.test.ts tests/archive/combined.test.ts
git commit -m "feat: separate course archives and combined packaging"
```

### Task 3: Implement immutable multi-course planning and run coordination

**Files:**
- Create: `src/page/run-courses.ts`
- Test: `tests/page/run-courses.test.ts`
- Modify: `src/page/run-course.ts` only for exported shared types or helper boundaries discovered in Task 2

**Interfaces:**

- Produces `MultiCourseDependencies = { discover, buildCourseArchive, buildCombinedZip, archiveCss, now, fileName, download }`.
- Produces `createRunPlan({ courses, requestedPackaging, signal, dependencies }): Promise<ImmutableRunPlan>`; it discovers every selected course, freezes each plan, validates IDs/sizes/paths/counts, and decides effective packaging before retrieval.
- Produces `runCourses({ plan, signal, progress, dependencies }): Promise<MultiCourseResult>`; it runs frozen course plans sequentially and returns course results, effective packaging, aggregate counts, and handed-off output metadata.
- `ImmutableRunPlan` contains frozen `CoursePlan[]`, selected summaries, requested/effective packaging, aggregate advertised bytes/resource count, and `fallbackReason`.
- `MultiCourseResult = { effectivePackaging: PackagingMode; combined: CourseArchiveOutput | null; completed: readonly CourseArchiveOutput[]; failedCourseIds: readonly number[]; counts: { success: number; failed: number; unavailable: number; unsupported: number; external: number } }` distinguishes completed course outputs from course-local failures and reports whether the final output was combined or per-course.

- [ ] **Step 1: Write failing coordinator tests for immutable discovery and policy decisions.**

Use real `CoursePlan` fixtures and dependency fakes. Assert all selected courses are discovered before the first retrieval/build call, returned plan objects are frozen and copied, selection IDs cannot be replaced by a discovered different course, a combined request within byte/entry limits stays combined, an aggregate-over-limit request falls back to per-course, and an individual over-limit or unknown-size plan stops before any retrieval.

- [ ] **Step 2: Run the coordinator tests and verify they fail because no coordinator exists.**

Run:

```bash
pnpm exec vitest run tests/page/run-courses.test.ts
```

Expected: FAIL because `src/page/run-courses.ts` is missing.

- [ ] **Step 3: Implement frozen plan creation and packaging policy.**

Clone each `CoursePlan` using the same deep-copy/freeze rules as the one-course worker. Sum advertised bytes and resource counts with safe-integer checks. Use fixed fallback reasons. Throw a typed pre-retrieval safety error containing only a safe course ID/name-independent category and limit value.

- [ ] **Step 4: Run the policy tests and verify the red-green transition.**

Run:

```bash
pnpm exec vitest run tests/page/run-courses.test.ts -t "immutable|packaging|limit"
```

Expected: PASS.

- [ ] **Step 5: Write failing tests for sequential execution, aggregate progress, and partial outputs.**

Use builders that record course order and concurrency. Assert course 2 never starts before course 1 completes, resource-level progress is mapped to current course/total course fields, a deterministic course-local error allows later courses to run, per-course mode downloads successful outputs immediately, combined success downloads once, and combined partial failure downloads completed courses individually.

- [ ] **Step 6: Run the execution tests and verify they fail before `runCourses` is implemented.**

Run:

```bash
pnpm exec vitest run tests/page/run-courses.test.ts -t "sequential|progress|partial"
```

Expected: FAIL.

- [ ] **Step 7: Implement `runCourses` with abort and cleanup semantics.**

Run each frozen plan in order through `buildCourseArchive`. Classify `CanvasSessionError`, `AbortError`, navigation, and caller cancellation as run-level stops. Classify deterministic course-local build failures as failed-course results and continue. In combined mode retain successful course ZIPs only until finalization; on partial stop, hand off completed course ZIPs individually before zeroing transient buffers. Never hand off a failed current-course ZIP.

- [ ] **Step 8: Run all coordinator tests and related archive/worker tests.**

Run:

```bash
pnpm exec vitest run tests/page/run-courses.test.ts tests/page/run-course.test.ts tests/archive
```

Expected: PASS.

- [ ] **Step 9: Commit the coordinator.**

```bash
git add src/page/run-courses.ts src/page/run-course.ts tests/page/run-courses.test.ts
git commit -m "feat: orchestrate multi-course archive runs"
```

### Task 4: Integrate planning, confirmation, cancellation, and session loss in the page runner

**Files:**
- Modify: `src/page/runner.ts`
- Test: `tests/page/runner.test.ts`

**Interfaces:**

- The runner stores one `listed` course set, one `pendingPlan`, or one `active` run for a run ID; overlapping operations emit the fixed active message.
- `START_RUN` validates that every selected ID exists in the most recent course list, calls `createRunPlan`, emits `PLAN_READY`, and performs no retrieval/build/download.
- `CONFIRM_PLAN` only succeeds for the exact pending plan run ID; it calls `runCourses`, forwards aggregate progress, and emits one terminal event.
- `CANCEL` aborts listing, planning, pending confirmation, or active execution idempotently.
- `pagehide` and `beforeunload` abort pending/active work with navigation cause and clear pending plans.

- [ ] **Step 1: Replace runner mocks and add failing lifecycle tests.**

Add tests that list three courses, start a multi-course run, assert `PLAN_READY` precedes any build/download call, confirm the exact plan, forward aggregate progress, emit one `COMPLETE`, reject stale confirmations, reject unlisted IDs, and ignore duplicate terminal commands.

- [ ] **Step 2: Run the focused runner tests and verify failure against the old single-course lifecycle.**

Run:

```bash
pnpm exec vitest run tests/page/runner.test.ts
```

Expected: FAIL because the runner still parses and executes `START_COURSE` directly.

- [ ] **Step 3: Implement the new pending-plan/active-run state machine.**

Keep the existing origin/source validation, fixed terminal message mapping, bounded terminal-ID retention, and signal capture. Map pre-retrieval safety errors to fixed `FAILED` messages without passing raw exception text to the UI. Map cancellation/navigation to `CANCELLED` with the correct fixed text.

- [ ] **Step 4: Run runner tests and existing page tests.**

Run:

```bash
pnpm exec vitest run tests/page/runner.test.ts tests/page/run-course.test.ts tests/page/run-courses.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit page-runner integration.**

```bash
git add src/page/runner.ts src/canvas/session.ts tests/page/runner.test.ts
git commit -m "feat: connect the page runner to multi-course plans"
```

### Task 5: Expand the Side Panel to multi-course configuration and aggregate states

**Files:**
- Modify: `src/sidepanel/state.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `src/static/sidepanel.css` if the multi-select/review layout needs styling
- Test: `tests/sidepanel/state.test.ts`
- Test: `tests/sidepanel/main.test.ts`

**Interfaces:**

- `ViewState` gains `configure`, `review`, and aggregate `packing`/`complete` data while retaining safe `connect`/`stopped` states.
- `UiEvent` gains `PLAN_READY`, `OUTPUT_CONFIGURED`, aggregate `PROGRESS`, and a completion payload containing effective mode, output count, course counts, and resource counts.
- `reduceState` accepts only valid state transitions: course list → configure, configure → review after plan, review → packing only after confirmation, and packing → complete/stopped.
- The UI sends `START_RUN` with all checked IDs and selected packaging, then sends `CONFIRM_PLAN` only from the review state.

- [ ] **Step 1: Write failing reducer tests for multi-course state transitions.**

Cover empty course lists, selecting multiple active/completed/concluded courses, requiring at least one selection, choosing packaging, rendering a fallback plan before packing, ignoring progress before confirmation, aggregate progress updates without losing focus, completion with partial outputs, cancellation, and tab loss.

- [ ] **Step 2: Run reducer tests and verify they fail against the single-course state model.**

Run:

```bash
pnpm exec vitest run tests/sidepanel/state.test.ts
```

Expected: FAIL because the current reducer only supports one radio and `ready` state.

- [ ] **Step 3: Implement the reducer and render the accessible controls.**

Use checkbox inputs with stable labels and a fieldset legend for courses; use a second fieldset for packaging radios. Show course count, advertised total, effective mode, and a fixed fallback explanation in review. Use `role="status"`, `aria-live="polite"`, and `aria-busy` for aggregate progress. Keep all text through `textContent`; do not render server/Canvas strings as HTML.

- [ ] **Step 4: Update message handling and cancellation.**

Validate `PLAN_READY`/aggregate events with `parseRunnerEvent`, correlate run ID and connected tab ID, preserve the active plan while review is visible, send exactly one `CONFIRM_PLAN`, and keep cancellation idempotent across planning and packing.

- [ ] **Step 5: Run Side Panel tests and accessibility-oriented assertions.**

Run:

```bash
pnpm exec vitest run tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts
```

Expected: PASS, including keyboard-label and ARIA assertions.

- [ ] **Step 6: Commit Side Panel integration.**

```bash
git add src/sidepanel/state.ts src/sidepanel/main.ts src/static/sidepanel.css tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts
git commit -m "feat: add multi-course Side Panel flow"
```

### Task 6: Add synthetic multi-course browser-flow coverage

**Files:**
- Create: `tests/integration/multi-course-flow.test.ts`
- Modify: `tests/fixtures/course-plan.ts` with three synthetic course plans and a course-plan factory
- Modify: `tests/fixtures/canvas/active-courses.json` with active, completed, and concluded course fixtures
- Modify: `tests/integration/pilot-flow.test.ts` to preserve the one-course compatibility assertion after protocol changes

**Interfaces:**

- The synthetic browser harness loads the real service worker, relay, page runner, Side Panel, discovery, retrieval, archive builder, and download handoff together.
- The test fixture exposes three privacy-safe courses representing active, completed, and concluded states and allows per-course response/failure behavior to be selected by course ID.

- [ ] **Step 1: Write failing end-to-end scenarios against the new protocol.**

Implement scenarios for:

1. three-course success with one combined download;
2. combined-size fallback that shows review text before any file request and produces per-course downloads;
3. one course-local failure that preserves another course ZIP;
4. session loss after the first course completes, preserving the completed ZIP and emitting the fixed session message; and
5. cancellation after the first course completes, preserving that ZIP and emitting one cancellation event.

Assert no response body, credential, header, or sensitive URL appears in rendered UI text or captured operational messages.

- [ ] **Step 2: Run the new integration test and verify it fails before all layers are integrated.**

Run:

```bash
pnpm exec vitest run tests/integration/multi-course-flow.test.ts
```

Expected: FAIL at protocol/state or missing multi-course fixture behavior.

- [ ] **Step 3: Wire the synthetic routes and test assertions to the implemented contracts.**

Use deterministic synthetic IDs, byte lengths, and request logs. Verify retrieval request counts stay within the two-request resource bound and that fallback/over-limit decisions happen before file/page retrieval.

- [ ] **Step 4: Run all integration and compatibility tests.**

Run:

```bash
pnpm exec vitest run tests/integration tests/page tests/sidepanel
```

Expected: PASS, including the existing one-course pilot flow.

- [ ] **Step 5: Commit the synthetic browser coverage.**

```bash
git add tests/integration/multi-course-flow.test.ts tests/fixtures/course-plan.ts tests/fixtures/canvas
git commit -m "test: cover multi-course browser flows"
```

### Task 7: Run the complete verification gate and update Linear

**Files:**
- Create: `docs/development/multi-course-runs.md` with the implemented synthetic command and user-visible output behavior
- No production-code changes are allowed in this task unless a verification failure identifies a concrete regression

- [ ] **Step 1: Run formatting, lint, typecheck, tests, and production build.**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands pass with no warnings, and `dist/` contains the production Manifest V3 bundle.

- [ ] **Step 2: Run the diff and repository hygiene checks.**

Run:

```bash
git diff --check origin/main...HEAD
git status --short
```

Expected: no whitespace errors, no generated archives, no credentials, and only intended source/tests/docs changes.

- [ ] **Step 3: Review the acceptance criteria against test evidence.**

Confirm the integration output demonstrates multi-course success, partial-course preservation, pre-retrieval fallback explanation, individual over-limit stopping, cancellation cleanup, session-loss handling, and synthetic coverage for all five required scenarios.

- [ ] **Step 4: Commit the narrowly scoped multi-course documentation update.**

```bash
git add docs/development/multi-course-runs.md
git commit -m "docs: describe multi-course archive runs"
```

- [ ] **Step 5: Report the verified branch and evidence back to the coordinator.**

Include the branch name, commit list, verification commands/results, and any remaining limitation. Do not claim GRAD-15 complete until the full gate passes.
