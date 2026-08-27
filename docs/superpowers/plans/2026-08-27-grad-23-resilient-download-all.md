# GRAD-23 Resilient Download All Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make **Download all courses** complete every safe, downloadable course even when one course cannot be planned, while clearly reporting skipped courses and allowing a one-click retry.

**Architecture:** Keep the existing sequential discovery, immutable review, bounded retrieval, and per-course 250 MiB policy. Change discovery from all-or-nothing to a typed per-course settlement model: global failures still stop the run, while course-local failures become privacy-safe summaries in the plan. Extend the strict runner protocol and Side Panel state machine to show discovery progress, ready/skipped results, partial completion, and a fresh retry of only skipped or packing-failed courses.

**Tech Stack:** TypeScript, Chrome Manifest V3 Side Panel, native DOM APIs, Vitest with jsdom, pnpm, esbuild, deterministic ZIP packaging

## Global Constraints

- Preserve the hard 250 MiB limit per course and every existing resource, entry-count, archive-path, origin, session, and response validation.
- Continue only after course-local discovery failures. Cancellation, Canvas session loss, tab navigation/closure, malformed extension messages, and run-global invariant failures remain terminal.
- Discovery remains sequential and emits bounded progress: `Checking course N of M`.
- Never send raw exception text, URLs, filenames, course content, credentials, cookies, headers, or tokens through the runner protocol or UI.
- The only public planning-failure categories are `size-limit`, `canvas-unavailable`, `safety-validation`, and `unexpected-local`.
- Review remains mandatory before retrieval, including after retry. No ready course means no **Continue** action.
- Retry uses a new run ID, refreshes the Canvas course list, rediscovers only retryable course IDs still present, and preserves the requested packaging mode.
- Packaging failures remain isolated by the existing `runCourses` orchestration and join planning failures in the retry set.
- Totals and packaging fallback decisions are calculated only from successfully planned courses.
- Keep the existing same-origin Canvas session architecture. Do not add OAuth, backend services, telemetry, cloud storage, new Chrome permissions, or multi-part archives.
- Never commit real course names, IDs, filenames, URLs, screenshots, content, or live diagnostic payloads.
- Use Node.js 22.22.2 and pnpm 11.17.0. Prefix verification commands with `CI=true` in non-interactive environments.

---

## File and Interface Map

- `src/shared/model.ts` — shared discovery-progress and course-plan-failure types; expanded `RunPlanSummary`.
- `src/shared/messages.ts` — strict `DISCOVERY_PROGRESS` and resilient `PLAN_READY` wire contracts.
- `src/page/run-courses.ts` — sequential per-course discovery settlement, typed classification, ready-only aggregate totals.
- `src/page/runner.ts` — forwards discovery progress and stores partial/all-skipped immutable plans.
- `src/sidepanel/state.ts` — configure progress, resilient review, retry lifecycle, and completion retry set.
- `src/sidepanel/main.ts` — ready/skipped review, fixed safe explanations, partial completion, and retry orchestration.
- `src/static/sidepanel.css` — compact status/list styling for ready, skipped, and retry sections.
- `tests/shared/messages.test.ts` — exact wire validation, count invariants, category allowlist, and ID disjointness.
- `tests/page/run-courses.test.ts` — course-local isolation, terminal failures, progress order, and zero-ready behavior.
- `tests/page/runner.test.ts` — runner event order and resilient plan forwarding.
- `tests/sidepanel/state.test.ts` — progress, all-skipped review, retry state, and completion retry derivation.
- `tests/sidepanel/main.test.ts` — visible review/completion copy and retry commands.
- `tests/integration/pilot-flow.test.ts` — one failed discovery plus successful archives and retry of only failed IDs.
- `README.md`, `SECURITY.md`, `docs/pilot/TEST_CHECKLIST.md` — behavior, safety boundary, and privacy-safe manual acceptance.

---

### Task 1: Add Strict Resilient-Planning Contracts

**Files:**

- Modify: `src/shared/model.ts`
- Modify: `src/shared/messages.ts`
- Test: `tests/shared/messages.test.ts`

**Interfaces:**

```ts
export type CoursePlanFailureCategory =
  | "size-limit"
  | "canvas-unavailable"
  | "safety-validation"
  | "unexpected-local";

export type CoursePlanFailureSummary = {
  courseId: number;
  category: CoursePlanFailureCategory;
};

export type CourseDiscoveryProgress = {
  completed: number;
  total: number;
  currentCourseId: number;
};

export type RunPlanSummary = {
  requestedCourseCount: number;
  selected: CoursePlanSummary[];
  skipped: CoursePlanFailureSummary[];
  requestedPackaging: PackagingMode;
  effectivePackaging: PackagingMode;
  advertisedBytes: number;
  unknownSizeCount: number;
  resourceCount: number;
  fallbackReason: PlanFallbackReason | null;
};
```

- [ ] **Step 1: Add failing message-parser tests**

Add focused cases to `tests/shared/messages.test.ts` proving:

- `DISCOVERY_PROGRESS` accepts only exact keys and positive `currentCourseId`.
- `0 <= completed <= total`, and `total > 0`.
- `PLAN_READY` accepts a partial result with one selected and one skipped course.
- `PLAN_READY` accepts an all-skipped result.
- `requestedCourseCount === selected.length + skipped.length`.
- selected and skipped IDs are unique and disjoint.
- only the four fixed categories are accepted.
- advertised byte, unknown-size, and resource totals equal the selected summaries only.
- unknown fields and raw error/message fields are rejected.

- [ ] **Step 2: Run the focused contract test and verify red**

```bash
CI=true pnpm exec vitest run tests/shared/messages.test.ts
```

Expected: FAIL because the resilient planning fields and discovery event do not exist.

- [ ] **Step 3: Add shared types and exact parsing**

Add the types above to `src/shared/model.ts`. Add this runner event before `PLAN_READY`:

```ts
| ({
    channel: typeof RUNNER_CHANNEL;
    type: "DISCOVERY_PROGRESS";
    runId: string;
  } & CourseDiscoveryProgress)
```

Implement dedicated parsers for failure categories, skipped summaries, and discovery progress. Keep `exactKeys` enforcement. Permit `selected.length === 0` only when `skipped.length > 0`, and enforce all count, uniqueness, disjointness, and selected-total invariants before returning `PLAN_READY`.

- [ ] **Step 4: Run contracts and typecheck**

```bash
CI=true pnpm exec vitest run tests/shared/messages.test.ts
CI=true pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the protocol unit**

```bash
git add src/shared/model.ts src/shared/messages.ts tests/shared/messages.test.ts
git commit -m "feat: add resilient planning message contracts"
```

---

### Task 2: Isolate Course-Local Discovery Failures

**Files:**

- Modify: `src/page/run-courses.ts`
- Test: `tests/page/run-courses.test.ts`

**Interfaces:**

```ts
export type CoursePlanFailure = {
  course: CourseSummary;
  category: CoursePlanFailureCategory;
};

export type ImmutableRunPlan = {
  courses: PlannedCourse[];
  failures: CoursePlanFailure[];
  summary: RunPlanSummary;
};

export const createRunPlan = async (
  courses: readonly CourseSummary[],
  requestedPackaging: PackagingMode,
  signal: AbortSignal,
  onProgress?: (progress: CourseDiscoveryProgress) => void,
): Promise<ImmutableRunPlan> => {
  /* ... */
};
```

- [ ] **Step 1: Add failing planner tests**

Create synthetic tests that assert:

1. The first course throws `CanvasResponseError`, the second succeeds, and the plan contains one ready course plus one `canvas-unavailable` failure.
2. An oversized course becomes `size-limit`; a later course is still planned.
3. `RunSafetyError` and `TypeError` become `safety-validation`; an ordinary `Error` becomes `unexpected-local`.
4. A returned plan whose course ID does not match the requested course becomes `safety-validation` without stopping later discovery.
5. Progress callbacks are exactly `{completed: 1, total: 3, currentCourseId: ...}` through `{completed: 3, ...}` in input order, including failures.
6. All course-local failures return a valid zero-ready plan with all skipped summaries.
7. `CanvasSessionError` and `AbortError` still reject immediately and do not attempt later courses.
8. Aggregate bytes/resources/unknown counts and fallback logic use only ready plans.

Update the existing oversized-course test that expects whole-plan rejection: it must now expect a `size-limit` skipped summary.

- [ ] **Step 2: Run the planner test and verify red**

```bash
CI=true pnpm exec vitest run tests/page/run-courses.test.ts
```

Expected: FAIL because `createRunPlan` still aborts on the first course-local failure.

- [ ] **Step 3: Implement a private exhaustive classifier**

Add a private classifier with this precedence:

```ts
const classifyCoursePlanFailure = (
  error: unknown,
): CoursePlanFailureCategory => {
  if (error instanceof PilotSizeError) return "size-limit";
  if (error instanceof CanvasResponseError) return "canvas-unavailable";
  if (error instanceof RunSafetyError || error instanceof TypeError) {
    return "safety-validation";
  }
  return "unexpected-local";
};
```

Do not pass `error.message` into model or UI state. Preserve `isAbort(error)` as the terminal check for `CanvasSessionError` and cancellation before classification.

- [ ] **Step 4: Settle each course sequentially**

Refactor the loop to append either a ready planned course or a typed failure, invoke `onProgress` once after every settled course, and continue. Preserve input order in both arrays. Build `summary.selected` from ready courses and `summary.skipped` from failures. Set `requestedCourseCount` to the original validated course count.

Return an all-skipped immutable plan. Keep combined-package fallback calculations unchanged except that they operate only on ready courses.

- [ ] **Step 5: Run focused and adjacent tests**

```bash
CI=true pnpm exec vitest run tests/page/run-courses.test.ts tests/archive/build-zip.test.ts
CI=true pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the planner unit**

```bash
git add src/page/run-courses.ts tests/page/run-courses.test.ts
git commit -m "feat: isolate course discovery failures"
```

---

### Task 3: Forward Discovery Outcomes Through the Runner

**Files:**

- Modify: `src/page/runner.ts`
- Test: `tests/page/runner.test.ts`

**Interfaces:**

- `START_RUN` posts zero or more `DISCOVERY_PROGRESS` events, followed by one `PLAN_READY` for every non-terminal discovery result.
- `CONFIRM_PLAN` remains required before `runCourses`.
- A zero-ready plan remains pending for display/retry but cannot be confirmed.

- [ ] **Step 1: Add failing runner tests**

Add cases proving:

- A partial discovery posts ordered progress events and then a partial `PLAN_READY`.
- An all-skipped discovery posts progress and `PLAN_READY`, not generic `FAILED`.
- Confirming a zero-ready plan produces the fixed safety failure and performs no retrieval.
- Session loss and cancellation still post their existing terminal events without `PLAN_READY`.

- [ ] **Step 2: Run the runner tests and verify red**

```bash
CI=true pnpm exec vitest run tests/page/runner.test.ts
```

Expected: FAIL because progress and all-skipped plans are not forwarded.

- [ ] **Step 3: Wire progress and guard confirmation**

Pass a callback to `createRunPlan` that posts strict `DISCOVERY_PROGRESS` events with the active `runId`. Store any returned immutable plan, including all-skipped plans, and post its `PLAN_READY` summary.

Before `runCourses`, require `pendingPlan.courses.length > 0`. If violated, clear the pending plan and use the existing fixed safety terminal message. Do not invent a dynamic message.

- [ ] **Step 4: Run runner, contracts, and typecheck**

```bash
CI=true pnpm exec vitest run tests/page/runner.test.ts tests/shared/messages.test.ts
CI=true pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the runner unit**

```bash
git add src/page/runner.ts tests/page/runner.test.ts
git commit -m "feat: report resilient discovery outcomes"
```

---

### Task 4: Model Discovery Progress and Retry State

**Files:**

- Modify: `src/sidepanel/state.ts`
- Test: `tests/sidepanel/state.test.ts`

**State shape:**

- `connect` gains `retry: { courseIds: number[]; packaging: PackagingMode } | null`.
- `configure` gains `discoveryProgress: CourseDiscoveryProgress | null`.
- `packing` retains `courses`, `selectedIds`, `requestedPackaging`, and `plan`.
- `complete` retains `courses`, `requestedPackaging`, `plan`, and derived `retryCourseIds`.
- Add `UiEvent` variants `DISCOVERY_PROGRESS` and `RETRY`.

- [ ] **Step 1: Add failing reducer tests**

Cover these transitions:

- `START` clears prior progress; each valid `DISCOVERY_PROGRESS` replaces it.
- `PLAN_READY` transitions to review with both ready and skipped courses.
- An all-skipped plan enters review and cannot transition on `CONFIRM`.
- `CONFIRM` carries course context into packing.
- `COMPLETE` derives retry IDs in deterministic original-selection order from planning-skipped IDs plus ready IDs missing from `completedCourseIds`, without duplicates.
- `RETRY` from review or complete returns `connect` with retry IDs and requested packaging.
- `COURSES` during retry filters to IDs still available and enters configure; no remaining IDs enters blocked with a fixed message.
- Ordinary reconnect continues to clear selection and has no retry payload.

- [ ] **Step 2: Run state tests and verify red**

```bash
CI=true pnpm exec vitest run tests/sidepanel/state.test.ts
```

Expected: FAIL because the reducer does not model progress or retry context.

- [ ] **Step 3: Implement state transitions**

Keep all derivation in `reduceState`; do not store names or error text in retry payloads. For retry ordering, filter the original selected IDs against a set containing plan-skipped and packing-failed IDs. Keep the original `requestedPackaging` rather than the effective fallback mode.

Reject stale or impossible reducer events by returning the unchanged state, consistent with current behavior.

- [ ] **Step 4: Run state and type checks**

```bash
CI=true pnpm exec vitest run tests/sidepanel/state.test.ts
CI=true pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the state-machine unit**

```bash
git add src/sidepanel/state.ts tests/sidepanel/state.test.ts
git commit -m "feat: model skipped course retry state"
```

---

### Task 5: Build the Resilient Download-All Experience

**Files:**

- Modify: `src/sidepanel/main.ts`
- Modify: `src/static/sidepanel.css`
- Test: `tests/sidepanel/main.test.ts`
- Test: `tests/integration/pilot-flow.test.ts`

**Fixed category copy:**

```ts
const COURSE_PLAN_FAILURE_MESSAGES = Object.freeze({
  "size-limit": "This course exceeds the 250 MiB safety limit.",
  "canvas-unavailable": "Canvas did not provide usable course metadata.",
  "safety-validation": "Course metadata did not pass GradPack's safety checks.",
  "unexpected-local": "A local course operation could not be completed.",
});
```

- [ ] **Step 1: Add failing Side Panel tests**

Assert the rendered and command behavior for:

- Configure shows `Checking course 2 of 5` and keeps Cancel available.
- Partial review says how many courses are ready and skipped, shows ready totals/fallback, lists skipped synthetic course names with only fixed category copy, and enables **Continue with ready courses**.
- All-skipped review shows no Continue button and offers **Retry skipped courses**.
- Completion distinguishes full success, planning skips, and packing failures; its retry button contains the union of unresolved IDs.
- Clicking retry creates a fresh `runId`, sends `LIST_COURSES`, then sends `START_RUN` only for retry IDs still present, with the original requested packaging.
- A retry still stops at review until the user confirms.
- Stale progress/plan/complete messages from the prior run are ignored.

The integration fixture must simulate one course-local planning failure followed by at least two successful course archives, then retry only the failed synthetic course. Assert archive output counts and commands, not real filenames or course details.

- [ ] **Step 2: Run UI/integration tests and verify red**

```bash
CI=true pnpm exec vitest run tests/sidepanel/main.test.ts tests/integration/pilot-flow.test.ts
```

Expected: FAIL because resilient review and retry controls do not exist.

- [ ] **Step 3: Render progress, ready/skipped review, and completion**

Map IDs back to already validated `CourseSummary` objects for display. Never render an exception. Show totals for ready plans only. Use semantic headings, lists, status text, and native buttons; keep focus restoration behavior after rerenders.

Use these action rules:

- ready > 0: show **Continue with ready courses**;
- skipped > 0: show **Retry skipped courses**;
- ready === 0: omit Continue;
- unresolved completion IDs > 0: show **Retry unfinished courses**;
- no unresolved IDs: show only **Start again**.

- [ ] **Step 4: Implement retry orchestration**

On retry:

1. Capture retry IDs and requested packaging from reducer state.
2. Cancel a still-pending review run before replacing its run ID.
3. Dispatch `RETRY`, call the existing connection/list flow to obtain a fresh run ID and fresh course list.
4. After validated `COURSES`, automatically call `startRun()` for the reducer-filtered retry IDs.
5. Require the newly returned `PLAN_READY` review before confirmation.

Accept `DISCOVERY_PROGRESS` only for the current active run while configure is busy, and validate its total against selected IDs. Validate every `PLAN_READY` requested count and course ID against the current selection before reducing it.

- [ ] **Step 5: Add minimal status styling**

Add styles only for the new progress/status groups and ready/skipped lists. Reuse existing colors, spacing, typography, button classes, and focus indicators. Do not redesign the Side Panel.

- [ ] **Step 6: Run all affected tests**

```bash
CI=true pnpm exec vitest run tests/sidepanel/main.test.ts tests/sidepanel/state.test.ts tests/integration/pilot-flow.test.ts tests/page/runner.test.ts tests/page/run-courses.test.ts tests/shared/messages.test.ts
CI=true pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the user experience**

```bash
git add src/sidepanel/main.ts src/static/sidepanel.css tests/sidepanel/main.test.ts tests/integration/pilot-flow.test.ts
git commit -m "feat: add resilient download all experience"
```

---

### Task 6: Document and Verify the Complete Contract

**Files:**

- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/pilot/TEST_CHECKLIST.md`
- Verify: all source and test files changed above

- [ ] **Step 1: Update user and safety documentation**

Document that:

- Download all checks courses sequentially.
- One course-local planning failure does not stop safe courses.
- The review page reports ready and skipped courses before any download.
- Retry rediscovers only unfinished courses.
- The 250 MiB per-course policy and terminal session/navigation/cancellation behavior are unchanged.

Add privacy-safe manual cases to `docs/pilot/TEST_CHECKLIST.md`; never include live course details.

- [ ] **Step 2: Run formatting and inspect the full diff**

```bash
CI=true pnpm format
git diff --check
git diff --stat c393665...HEAD
git status --short
```

Expected: formatting completes; diff check is silent; only in-scope source, tests, and docs are modified.

- [ ] **Step 3: Run the full repository gate**

```bash
CI=true pnpm verify
```

Expected: format check, lint, typecheck, complete Vitest suite, and production build all PASS.

- [ ] **Step 4: Inspect the production extension output**

```bash
find dist -maxdepth 2 -type f -print | sort
rg -n "localhost|127\\.0\\.0\\.1|sourceMappingURL" dist || true
```

Expected: the normal eight extension files are present, with no development hosts or source-map references.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md SECURITY.md docs/pilot/TEST_CHECKLIST.md
git commit -m "docs: explain resilient download all behavior"
```

- [ ] **Step 6: Perform privacy-safe live Chrome acceptance**

Load the freshly built `dist/` directory in Chrome and use synthetic reporting only:

1. Select all displayed courses and start discovery.
2. Confirm sequential progress reaches the total.
3. Verify the review shows ready/skipped counts without raw errors.
4. Continue and verify safe courses download even when one course is skipped.
5. Use retry and verify only unfinished courses are rediscovered and another review appears.
6. Cancel during discovery and confirm no retrieval/download begins.
7. Confirm no real course detail is copied into source, logs, screenshots, commits, or ticket evidence.

This is a live acceptance gate, not part of the automated completion claim. If Chrome extension loading cannot be automated, report it as user-owned and do not claim it passed.

- [ ] **Step 7: Final branch review**

```bash
git status --short
git log --oneline c393665..HEAD
git diff --check c393665...HEAD
```

Expected: clean worktree, scoped commits, and no whitespace errors.

---

## Final Self-Review Checklist

- [ ] Every approved design requirement has a matching implementation task and test.
- [ ] No raw exception or live Canvas detail can cross the public runner/UI contract.
- [ ] The four failure categories are exhaustive and parser-enforced.
- [ ] Course-local failures continue; session, cancellation, navigation, and protocol failures stop.
- [ ] All-skipped plans are reviewable and cannot be confirmed.
- [ ] Retry uses fresh discovery, original requested packaging, current available courses, and explicit confirmation.
- [ ] Planning and packing failures both enter the completion retry set without duplicates.
- [ ] The 250 MiB per-course and archive safety policies are unchanged.
- [ ] Focus, keyboard access, fixed copy, and stale-run rejection have coverage.
- [ ] Full verification and production-build inspection are fresh before any completion claim.
- [ ] Manual Chrome acceptance remains explicitly separate from source verification.
