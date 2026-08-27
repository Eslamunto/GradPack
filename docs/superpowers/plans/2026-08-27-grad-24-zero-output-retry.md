# GRAD-24 Zero-output Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the exact unfinished-course retry set when every course that reached archive packing fails and no ZIP is downloaded.

**Architecture:** Keep course-local packing failures on the existing structured `COMPLETE` path, including the zero-output case, because the run resolved normally and still has a privacy-safe aggregate result. Tighten the runner-event parser so zero output is accepted only for an all-failed per-course result with empty completed IDs, positive failed count, zero resource outcomes, and a fixed zero-download message. Reuse the reducer's completed-ID complement to preserve original selection order, and render accurate zero-download copy in the Side Panel.

**Tech Stack:** TypeScript, Chrome MV3, Vitest, JSDOM, pnpm.

## Global Constraints

- Keep run-global safety, session, navigation, cancellation, and message-contract failures terminal.
- Never expose raw exception text, response bodies, course content, credentials, headers, or sensitive URLs.
- Zero-output results must not claim that an archive was downloaded.
- Retry must start a fresh discovery and review for only unfinished course IDs in original selected order.
- Do not weaken the 250 MiB per-course limit, origin validation, resource-count limits, or archive validation.

---

### Task 1: Define the strict zero-output runner contract

**Files:**

- Modify: `src/shared/messages.ts`
- Test: `tests/shared/messages.test.ts`

**Interfaces:**

- Consumes: existing `RunnerEvent` `COMPLETE` fields.
- Produces: `RUNNER_TERMINAL_MESSAGES.noArchives` and parser support for a strict zero-output `COMPLETE` result.

- [ ] **Step 1: Write failing parser tests**

Add a valid all-failed event with `completedCourses: 0`, `completedCourseIds: []`, `failedCourses: 2`, `outputCount: 0`, all outcome counts zero, `packaging: "per-course"`, and message `No course archives were downloaded.`. Add table-driven rejection cases for zero failed courses, combined packaging, a download-success message, non-empty completed IDs, positive outcome counts, and mismatched output counts.

- [ ] **Step 2: Run the focused parser test and verify RED**

Run: `CI=true pnpm exec vitest run tests/shared/messages.test.ts`

Expected: FAIL because zero completed courses and zero output are currently rejected.

- [ ] **Step 3: Implement strict parser validation**

Add:

```ts
noArchives: "No course archives were downloaded.",
```

Parse both fixed completion messages, then distinguish:

```ts
const zeroOutput = completedCourses === 0;
const validZeroOutput =
  zeroOutput &&
  message === RUNNER_TERMINAL_MESSAGES.noArchives &&
  packagingMode === "per-course" &&
  completedCourseIds.length === 0 &&
  failedCourses > 0 &&
  outputCount === 0;
```

Require the normal completion message and existing positive-output invariants when `zeroOutput` is false. After parsing counts, require total outcomes to equal zero for `validZeroOutput`.

- [ ] **Step 4: Run the focused parser test and verify GREEN**

Run: `CI=true pnpm exec vitest run tests/shared/messages.test.ts`

Expected: PASS.

### Task 2: Emit and render all-failed structured completion

**Files:**

- Modify: `src/page/runner.ts`
- Modify: `src/sidepanel/main.ts`
- Test: `tests/page/runner.test.ts`
- Test: `tests/sidepanel/state.test.ts`
- Test: `tests/sidepanel/main.test.ts`

**Interfaces:**

- Consumes: strict zero-output `COMPLETE` contract from Task 1.
- Produces: exact retry IDs and truthful zero-download Side Panel copy.

- [ ] **Step 1: Write failing runner and UI tests**

Make `runCourses` resolve with no completed archives and all selected IDs in `failedCourseIds`; assert the runner emits a parser-accepted `COMPLETE` event with the fixed zero-download message and zero outcomes. Add reducer coverage asserting all selected IDs become `retryCourseIds` in original order. Update the Side Panel flow test to accept a strict zero-output event, show `No archives downloaded`, list every unfinished course, and send a fresh `START_RUN` containing only those unfinished IDs.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `CI=true pnpm exec vitest run tests/page/runner.test.ts tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts`

Expected: runner and Side Panel tests FAIL because the runner emits `FAILED` and zero-output UI copy is unavailable.

- [ ] **Step 3: Emit structured zero-output completion**

Remove the runner's generic `FAILED` early return for `outputCount === 0`. Emit `COMPLETE` for every resolved `runCourses` result and select the message with:

```ts
message: outputCount === 0 ? FIXED.noArchives : FIXED.complete,
```

- [ ] **Step 4: Render truthful zero-output copy**

In the complete view, derive `const downloaded = complete.outputCount > 0` and use `No archives downloaded` plus `No course archives were downloaded.` when false. Preserve the aggregate summary, unfinished list, targeted retry button, and Start again button.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `CI=true pnpm exec vitest run tests/page/runner.test.ts tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts`

Expected: PASS.

### Task 3: Prove the cross-layer retry and release gate

**Files:**

- Create: `tests/integration/all-packing-failed-retry.test.ts`
- Modify: `docs/pilot/TEST_CHECKLIST.md`

**Interfaces:**

- Consumes: `runCourses`, strict runner parser, and Side Panel reducer contract.
- Produces: a cross-layer regression and a manual classmate check for zero-output retry.

- [ ] **Step 1: Write the integration regression**

Build a two-course synthetic immutable plan, run it with `buildCourseArchive` rejecting both courses using invented errors, form the strict zero-output event from the result, pass it through `parseRunnerEvent`, and reduce an equivalent packing state. Assert no downloads occur and the resulting retry IDs equal both original selected IDs in order.

- [ ] **Step 2: Run the integration test and verify it passes only with Tasks 1-2**

Run: `CI=true pnpm exec vitest run tests/integration/all-packing-failed-retry.test.ts`

Expected: PASS after Tasks 1-2; it would fail against the original parser contract.

- [ ] **Step 3: Extend the privacy-safe manual checklist**

Add:

```md
- Zero-output retry keeps all unfinished courses: pass / fail / not-tested
- Zero-output screen says no archives downloaded: pass / fail / not-tested
```

- [ ] **Step 4: Run the full release gate**

Run: `CI=true pnpm verify`

Expected: formatting, lint, typecheck, all tests, and production build pass.

- [ ] **Step 5: Inspect and commit the exact scope**

Run:

```bash
git diff --check
git status --short
git diff
```

Commit message: `fix: preserve retry when every archive fails`
