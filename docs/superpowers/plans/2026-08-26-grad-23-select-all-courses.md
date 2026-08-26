# GRAD-23 Select All Courses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible tri-state **Select all courses** checkbox that selects every displayed active, completed, and concluded Canvas course while preserving the existing explicit planning and archive flow.

**Architecture:** Keep selection ownership in the Side Panel reducer by adding a payload-free `SELECT_ALL` event that derives IDs only from the current validated course list. Render the master state from `courses` and `selectedIds`, send the existing explicit course-ID array unchanged, and advance the immutable pilot package to Alpha 5.

**Tech Stack:** TypeScript, Chrome Manifest V3 Side Panel, native DOM APIs, Vitest with jsdom, pnpm, esbuild, deterministic ZIP packaging

## Global Constraints

- **Select all courses** includes every displayed accessible active, completed, and concluded course.
- The master checkbox is unchecked for none, checked for all, and indeterminate for a partial selection.
- Activating the master checkbox from none or partial selects all; activating it from all clears all.
- Individual course checkboxes remain usable and course order remains exactly the validated Canvas order.
- Selection never starts discovery or retrieval; packaging, immutable review, and explicit confirmation remain required.
- Keep the existing `START_RUN { runId, courseIds, packaging }` protocol and explicit ID array.
- Do not change Canvas endpoints, Chrome permissions, archive schema, privacy boundaries, safety limits, cancellation, fallback, or partial-success behavior.
- Reconnects start with no selected course IDs.
- Use Node.js 22.22.2 and pnpm 11.17.0.
- Advance the testable pilot package from `0.1.0-alpha.4` to `0.1.0-alpha.5`; preserve all earlier Alpha artifacts unchanged.
- Never record real course names, filenames, Canvas IDs or URLs, screenshots, content, credentials, cookies, headers, tokens, or student identity.

---

## File Structure

- `src/sidepanel/state.ts` — owns the `SELECT_ALL` state transition and derives selected IDs from validated courses.
- `src/sidepanel/main.ts` — renders the native tri-state checkbox and selected-course count.
- `src/static/sidepanel.css` — visually separates the master control from individual course rows.
- `tests/sidepanel/state.test.ts` — reducer behavior for none, partial, all, clearing, order, and state boundaries.
- `tests/sidepanel/main.test.ts` — checked/unchecked/indeterminate DOM states, count, label, and Continue behavior.
- `tests/integration/pilot-flow.test.ts` — proves the master control supplies all explicit IDs to the unchanged end-to-end flow.
- `package.json`, `src/manifest.json`, `src/archive/manifest.ts`, `scripts/package-pilot.mjs` — Alpha 5 source and package identity.
- `tests/release/version-contract.test.ts`, `tests/build/output.test.ts`, `tests/package-pilot.test.ts`, `tests/fixtures/course-plan.ts`, `tests/archive/build-zip.test.ts`, `tests/archive/manifest.test.ts`, `tests/page/run-courses.test.ts` — Alpha 5 contract fixtures and assertions.
- `README.md`, `SECURITY.md`, `docs/pilot/INSTALL.md`, `docs/pilot/TEST_CHECKLIST.md` — current behavior, installation, and privacy-safe acceptance guidance.

---

### Task 1: Reducer-Owned Bulk Selection

**Files:**

- Modify: `src/sidepanel/state.ts`
- Test: `tests/sidepanel/state.test.ts`

**Interfaces:**

- Consumes: `ViewState` in the `choose` state with validated `courses: CourseSummary[]` and `selectedIds: number[]`.
- Produces: `UiEvent` variant `{ type: "SELECT_ALL" }`; reducer output containing either all current course IDs in display order or an empty array.

- [ ] **Step 1: Add failing reducer coverage**

Add a concluded third course beside `secondCourse`:

```ts
const concludedCourse = {
  ...syntheticCourse,
  id: 103,
  name: "Concluded Course",
  courseCode: "SYN-103",
  workflowState: "completed",
  concluded: true,
};
```

Add this focused test inside the reducer `describe` block:

```ts
it("selects and clears every displayed course from none, partial, and all", () => {
  const choose = reduceState(initialState, {
    type: "COURSES",
    courses: [syntheticCourse, secondCourse, concludedCourse],
  });

  const allFromNone = reduceState(choose, { type: "SELECT_ALL" });
  expect(allFromNone).toMatchObject({
    name: "choose",
    selectedIds: [101, 102, 103],
  });

  const partial = reduceState(allFromNone, {
    type: "SELECT",
    courseId: secondCourse.id,
  });
  expect(partial).toMatchObject({
    name: "choose",
    selectedIds: [101, 103],
  });
  expect(reduceState(partial, { type: "SELECT_ALL" })).toMatchObject({
    name: "choose",
    selectedIds: [101, 102, 103],
  });

  expect(reduceState(allFromNone, { type: "SELECT_ALL" })).toMatchObject({
    name: "choose",
    selectedIds: [],
  });

  expect(reduceState(initialState, { type: "SELECT_ALL" })).toBe(initialState);
});
```

- [ ] **Step 2: Run the reducer test and verify red**

Run:

```bash
pnpm exec vitest run tests/sidepanel/state.test.ts
```

Expected: FAIL because `SELECT_ALL` is not a valid `UiEvent` and has no reducer transition.

- [ ] **Step 3: Implement the payload-free reducer transition**

Add the event variant directly after `SELECT`:

```ts
  | { type: "SELECT"; courseId: number }
  | { type: "SELECT_ALL" }
```

Add this transition after the existing single-course `SELECT` block:

```ts
if (event.type === "SELECT_ALL" && state.name === "choose") {
  const allSelected =
    state.courses.length > 0 &&
    state.courses.every((course) => state.selectedIds.includes(course.id));
  return {
    ...state,
    selectedIds: allSelected ? [] : state.courses.map((course) => course.id),
  };
}
```

Do not add a course-ID payload or mutate the existing arrays.

- [ ] **Step 4: Run reducer tests and typecheck**

Run:

```bash
pnpm exec vitest run tests/sidepanel/state.test.ts
pnpm typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the reducer unit**

```bash
git add src/sidepanel/state.ts tests/sidepanel/state.test.ts
git commit -m "feat: add reducer-owned course bulk selection"
```

---

### Task 2: Accessible Tri-State Course Chooser

**Files:**

- Modify: `src/sidepanel/main.ts`
- Modify: `src/static/sidepanel.css`
- Test: `tests/sidepanel/main.test.ts`
- Test: `tests/integration/pilot-flow.test.ts`

**Interfaces:**

- Consumes: reducer event `{ type: "SELECT_ALL" }`, `state.courses`, and `state.selectedIds`.
- Produces: `input[name="course-all"]`, `.selection-count`, and the existing explicit `courseIds: number[]` start-run command.

- [ ] **Step 1: Replace manual multi-course UI setup with failing master-control assertions**

In the first `tests/sidepanel/main.test.ts` flow, replace the block that manually checks every `input[name="course"]` with:

```ts
const continueButton = [...document.querySelectorAll("button")].find(
  (candidate) => candidate.textContent === "Continue",
) as HTMLButtonElement;
const selectAll = document.querySelector<HTMLInputElement>(
  'input[name="course-all"]',
);
expect(selectAll).toBeInstanceOf(HTMLInputElement);
expect(selectAll?.type).toBe("checkbox");
expect(selectAll?.closest("label")?.textContent).toContain(
  "Select all courses",
);
expect(selectAll?.checked).toBe(false);
expect(selectAll?.indeterminate).toBe(false);
expect(document.querySelector(".selection-count")?.textContent).toBe(
  "0 of 3 courses selected.",
);
expect(continueButton.disabled).toBe(true);

selectAll?.click();
let courseCheckboxes = document.querySelectorAll<HTMLInputElement>(
  'input[name="course"]',
);
expect([...courseCheckboxes].every((checkbox) => checkbox.checked)).toBe(true);
expect(
  document.querySelector<HTMLInputElement>('input[name="course-all"]')?.checked,
).toBe(true);
expect(document.querySelector(".selection-count")?.textContent).toBe(
  "3 of 3 courses selected.",
);
expect(
  (
    [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Continue",
    ) as HTMLButtonElement
  ).disabled,
).toBe(false);

courseCheckboxes[1]!.click();
const partialSelectAll = document.querySelector<HTMLInputElement>(
  'input[name="course-all"]',
)!;
expect(partialSelectAll.checked).toBe(false);
expect(partialSelectAll.indeterminate).toBe(true);
expect(document.querySelector(".selection-count")?.textContent).toBe(
  "2 of 3 courses selected.",
);

partialSelectAll.click();
courseCheckboxes = document.querySelectorAll<HTMLInputElement>(
  'input[name="course"]',
);
expect([...courseCheckboxes].every((checkbox) => checkbox.checked)).toBe(true);
```

Update `thirdCourse` in the same test file so the visible list spans the
required Canvas states:

```ts
const thirdCourse = {
  ...syntheticCourse,
  id: 103,
  name: "Concluded Course",
  courseCode: "SYN-103",
  workflowState: "completed",
  concluded: true,
};
```

Use the master checkbox in `tests/integration/pilot-flow.test.ts` by replacing the loop over individual course inputs with:

```ts
document.querySelector<HTMLInputElement>('input[name="course-all"]')!.click();
```

The integration test's existing two-course retrieval and output assertions remain unchanged and prove that both explicit IDs entered the existing flow.

- [ ] **Step 2: Run focused UI tests and verify red**

Run:

```bash
pnpm exec vitest run tests/sidepanel/main.test.ts tests/integration/pilot-flow.test.ts
```

Expected: FAIL because the master checkbox and selected-count element do not exist.

- [ ] **Step 3: Render the native master checkbox and count**

Inside the `state.name === "choose"` branch in `src/sidepanel/main.ts`, after appending the legend and before iterating over courses, add:

```ts
const allSelected = state.courses.every((course) =>
  state.selectedIds.includes(course.id),
);
const partiallySelected = state.selectedIds.length > 0 && !allSelected;
const selectAllLabel = document.createElement("label");
selectAllLabel.className = "select-all";
const selectAll = document.createElement("input");
selectAll.type = "checkbox";
selectAll.name = "course-all";
selectAll.checked = allSelected;
selectAll.indeterminate = partiallySelected;
selectAll.addEventListener("change", () => update({ type: "SELECT_ALL" }));
selectAllLabel.append(selectAll, document.createTextNode("Select all courses"));
fieldset.append(selectAllLabel);
```

Replace the chooser body's introductory paragraph with the instruction plus an explicit count after the fieldset:

```ts
body.append(
  paragraph("Select one or more accessible courses."),
  fieldset,
  paragraph(
    `${state.selectedIds.length} of ${state.courses.length} courses selected.`,
    "selection-count",
  ),
  button("Continue", () => update({ type: "CONFIGURE" }), {
    disabled: state.selectedIds.length === 0,
  }),
);
```

Add this focused styling to `src/static/sidepanel.css`:

```css
.select-all {
  margin-block-end: 0.75rem;
  border-bottom: 1px solid #d9dcec;
  padding-block-end: 0.75rem;
  font-weight: 700;
}

.selection-count {
  margin-block: 0.25rem;
}
```

- [ ] **Step 4: Run Side Panel and integration tests**

Run:

```bash
pnpm exec vitest run tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts tests/integration/pilot-flow.test.ts
```

Expected: all focused tests PASS, including the unchanged `START_RUN` expectation with every explicit course ID.

- [ ] **Step 5: Run formatting, lint, and type checks**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all commands PASS. If formatting fails, run:

```bash
pnpm exec prettier --write src/sidepanel/main.ts src/static/sidepanel.css tests/sidepanel/main.test.ts tests/integration/pilot-flow.test.ts
```

Inspect the formatting diff and rerun all three checks.

- [ ] **Step 6: Commit the accessible chooser**

```bash
git add src/sidepanel/main.ts src/static/sidepanel.css tests/sidepanel/main.test.ts tests/integration/pilot-flow.test.ts
git commit -m "feat: add accessible select all course control"
```

---

### Task 3: Advance the Immutable Pilot to Alpha 5

**Files:**

- Modify: `package.json`
- Modify: `src/manifest.json`
- Modify: `src/archive/manifest.ts`
- Modify: `scripts/package-pilot.mjs`
- Modify: `tests/release/version-contract.test.ts`
- Modify: `tests/build/output.test.ts`
- Modify: `tests/package-pilot.test.ts`
- Modify: `tests/fixtures/course-plan.ts`
- Modify: `tests/archive/build-zip.test.ts`
- Modify: `tests/archive/manifest.test.ts`
- Modify: `tests/page/run-courses.test.ts`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/pilot/INSTALL.md`
- Modify: `docs/pilot/TEST_CHECKLIST.md`

**Interfaces:**

- Consumes: completed GRAD-23 chooser behavior and the fixed `PILOT_FILES` inventory.
- Produces: source, archive, build, package, documentation, and tests aligned on `0.1.0-alpha.5` and `gradpack-0.1.0-alpha.5.zip`.

- [ ] **Step 1: Make release-contract tests require Alpha 5 and Select all guidance**

Set the release constant in `tests/release/version-contract.test.ts`:

```ts
const RELEASE_VERSION = "0.1.0-alpha.5";
```

Add these documentation assertions beside the existing installation and checklist assertions:

```ts
expect(install).toContain("Select all courses");
expect(checklist).toContain("Select-all control: pass / fail");
expect(readme).toContain("Select all courses");
```

Update all current-release fixture expectations in these test files from
`0.1.0-alpha.4` to `0.1.0-alpha.5`:

```text
tests/build/output.test.ts
tests/package-pilot.test.ts
tests/fixtures/course-plan.ts
tests/archive/build-zip.test.ts
tests/archive/manifest.test.ts
tests/page/run-courses.test.ts
```

In `tests/package-pilot.test.ts`, rename the stale-release test and make its
deliberately stale manifest Alpha 4:

```ts
it("rejects the stale Alpha 4 release identity", async () => {
  const buildRoot = await makeBuild();
  await writeFile(
    join(buildRoot, "manifest.json"),
    '{"name":"GradPack","version":"0.1.0","version_name":"0.1.0-alpha.4"}\n',
  );

  await expect(
    packagePilot({
      buildRoot,
      artifactRoot: join(buildRoot, "out"),
    }),
  ).rejects.toThrow("Pilot manifest identity is invalid");
});
```

Rename the production boundary test title in `tests/build/output.test.ts` to
`packages Alpha 5 through the pnpm script boundary` and require
`version_name: "0.1.0-alpha.5"`.

- [ ] **Step 2: Run release tests and verify red**

Run:

```bash
pnpm exec vitest run tests/release/version-contract.test.ts tests/build/output.test.ts tests/package-pilot.test.ts tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts
```

Expected: FAIL because source metadata, package identity, and pilot documentation still advertise Alpha 4.

- [ ] **Step 3: Align source and package identity on Alpha 5**

Apply these exact values:

```json
// package.json
"version": "0.1.0-alpha.5"

// src/manifest.json
"version": "0.1.0",
"version_name": "0.1.0-alpha.5"
```

In `src/archive/manifest.ts`:

```ts
const GRADPACK_VERSION = "0.1.0-alpha.5";
```

In `scripts/package-pilot.mjs`:

```js
export const PILOT_ARTIFACT_NAME = "gradpack-0.1.0-alpha.5.zip";
```

Update the package manifest identity check to require:

```js
manifest.version_name !== "0.1.0-alpha.5";
```

Do not change `PILOT_FILES`, Manifest V3 version `0.1.0`, permissions, host
permissions, archive schema version, or dependency versions.

- [ ] **Step 4: Update current pilot guidance without changing privacy boundaries**

In `README.md`, describe the chooser with this exact sentence in the pilot or development guidance:

```md
Use **Select all courses** to choose every displayed active, completed, and
concluded course, or keep using the individual course checkboxes.
```

Change `SECURITY.md` supported version to `0.1.0-alpha.5`.

Change every current package/checksum command in `docs/pilot/INSTALL.md` from
`gradpack-0.1.0-alpha.4` to `gradpack-0.1.0-alpha.5`, and replace installation
step 8 with:

```md
8. Select individual courses or use **Select all courses** to select every
   displayed active, completed, and concluded course; then choose combined or
   per-course output and start planning.
```

Change the checklist version and add the bulk-selection result directly after
`Course list`:

```md
- Artifact version: 0.1.0-alpha.5
  ...
- Course list: pass / fail
- Select-all control: pass / fail
- Selected-course count:
```

Keep all existing warnings against sharing course names, files, identifiers,
URLs, screenshots, content, credentials, or student identity.

- [ ] **Step 5: Prove there are no accidental current Alpha 4 references**

Run:

```bash
rg -n "0\.1\.0-alpha\.4|Alpha 4|alpha\.4" package.json src scripts tests README.md SECURITY.md docs/pilot
```

Expected: exactly one deliberate stale-identity fixture in
`tests/package-pilot.test.ts`. Historical design specifications and preserved
artifact folders are outside this scan and remain unchanged.

- [ ] **Step 6: Run release, archive, and package tests**

Run:

```bash
pnpm exec vitest run tests/release/version-contract.test.ts tests/build/output.test.ts tests/package-pilot.test.ts tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit Alpha 5 identity and guidance**

```bash
git add package.json src/manifest.json src/archive/manifest.ts scripts/package-pilot.mjs tests/release/version-contract.test.ts tests/build/output.test.ts tests/package-pilot.test.ts tests/fixtures/course-plan.ts tests/archive/build-zip.test.ts tests/archive/manifest.test.ts tests/page/run-courses.test.ts README.md SECURITY.md docs/pilot/INSTALL.md docs/pilot/TEST_CHECKLIST.md
git commit -m "chore: prepare GRAD-23 Alpha 5 pilot"
```

---

### Task 4: Full Verification and Alpha 5 Validation Package

**Files:**

- Verify: all tracked source and test files
- Generate outside source control: `/private/tmp/gradpack-grad23-alpha5`
- Generate outside source control: `GRAD-23-validation-package-0.1.0-alpha.5/`

**Interfaces:**

- Consumes: committed GRAD-23 source and package identity.
- Produces: a checksum-verified Alpha 5 ZIP, sidecar, extracted extension, installation guide, and checklist for browser acceptance.

- [ ] **Step 1: Run the complete source gate**

Run:

```bash
CI=true pnpm verify
git diff --check origin/main...HEAD
```

Expected: formatting, lint, typecheck, all tests, build, and whitespace checks PASS.

- [ ] **Step 2: Generate a fresh immutable package in a new temporary directory**

Run:

```bash
mkdir -p /private/tmp/gradpack-grad23-alpha5
CI=true pnpm package:pilot -- /private/tmp/gradpack-grad23-alpha5
```

Expected: only `gradpack-0.1.0-alpha.5.zip` and
`gradpack-0.1.0-alpha.5.zip.sha256` are created in the temporary destination.

- [ ] **Step 3: Verify checksum, ZIP integrity, and exact inventory**

Run:

```bash
cd /private/tmp/gradpack-grad23-alpha5
shasum -a 256 -c gradpack-0.1.0-alpha.5.zip.sha256
unzip -t gradpack-0.1.0-alpha.5.zip
unzip -Z1 gradpack-0.1.0-alpha.5.zip | sort
```

Expected checksum and ZIP integrity: PASS. Expected sorted ZIP inventory:

```text
archive.css
manifest.json
relay.js
runner.js
service-worker.js
sidepanel.css
sidepanel.html
sidepanel.js
```

- [ ] **Step 4: Create the visible validation handoff without modifying earlier packages**

Create `GRAD-23-validation-package-0.1.0-alpha.5/` at the repository root with
this exact inventory:

```text
INSTALL.md
TEST_CHECKLIST.md
gradpack-0.1.0-alpha.5.zip
gradpack-0.1.0-alpha.5.zip.sha256
extracted-extension/archive.css
extracted-extension/manifest.json
extracted-extension/relay.js
extracted-extension/runner.js
extracted-extension/service-worker.js
extracted-extension/sidepanel.css
extracted-extension/sidepanel.html
extracted-extension/sidepanel.js
```

Copy the generated ZIP and sidecar from the temporary directory, copy the
tracked Alpha 5 installation guide and checklist, and extract the ZIP into the
new `extracted-extension` folder. Do not move, overwrite, rename, or delete any
Alpha 1–4 validation package.

- [ ] **Step 5: Compare the handoff bytes to the verified source package**

Run checksum verification inside the visible folder, compare its ZIP and
sidecar byte-for-byte to `/private/tmp/gradpack-grad23-alpha5`, and compare all
eight extracted files to the current `dist/` output.

Expected: checksum PASS; ZIP and sidecar comparisons PASS; extracted files
match `dist/`; exact visible inventory contains 12 files.

- [ ] **Step 6: Perform privacy-safe browser acceptance**

Load `GRAD-23-validation-package-0.1.0-alpha.5/extracted-extension` from
`chrome://extensions`. In a signed-in Canvas tab:

1. Connect GradPack and confirm the chooser starts at `0 of N courses selected`.
2. Activate **Select all courses** and confirm `N of N` plus every course checkbox.
3. Deselect one course and confirm the master checkbox is indeterminate and the count is `N-1 of N`.
4. Activate **Select all courses** and confirm all courses are selected again.
5. Continue to packaging and begin discovery.
6. Confirm the review contains every selected course and no retrieval began before explicit confirmation.
7. Cancel safely before retrieval if downloading the full real course set is not desired.

Record only coarse pass/fail results and counts. Do not record course names,
IDs, URLs, screenshots, content, credentials, or student data.

- [ ] **Step 7: Verify repository cleanliness and review the complete branch**

Run:

```bash
git status --short
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

Expected: only the intentionally untracked visible validation package may be
present; no generated package is staged; commits are limited to the design,
reducer, chooser, and Alpha 5 release changes; diff check PASS.
