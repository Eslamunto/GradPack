# GRAD-22 Page-Linked Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include every accepted same-course file linked from a planned Canvas page in the offline archive, even when file metadata is unavailable, while preserving fail-closed URL validation and the 250 MiB per-course limit.

**Architecture:** Add a bounded discovery preflight for planned page bodies, extract only two exact same-course file-link forms, and resolve each discovered file through exact metadata or a deterministic unknown-size fallback. Carry unknown-size counts through immutable run planning, force combined requests to per-course packaging when needed, and stream unknown-size files against an explicit remaining-byte budget. Reuse the existing sanitizer, manifest schema, archive builder, and resource outcomes.

**Tech Stack:** TypeScript 5.9, Chrome Manifest V3, Canvas REST API, DOMParser, Vitest, pnpm, `fflate`, SHA-256, ZIP command-line verification.

## Global Constraints

- Use only synthetic course IDs, names, URLs, page bodies, and filenames in source, tests, commits, and review artifacts.
- Keep Canvas access read-only and restricted to the configured exact origin and existing course-scoped API routes.
- Accept only `/courses/<course-id>/files/<file-id>?wrap=1` and `/courses/<course-id>/files/<file-id>/download`; do not broaden link matching.
- Keep the page-detail JSON cap at exactly 5 MiB and the per-course archive cap at exactly 250 MiB.
- Keep archive manifest schema version `1`; use the existing nullable per-resource `advertisedBytes` field.
- Do not modify, replace, rename, move, or delete any Alpha 1, Alpha 2, or Alpha 3 package or validation folder.
- Do not commit generated ZIPs, sidecars, extracted extensions, real Canvas data, screenshots, identifiers, or student content.
- Use test-first red/green steps and run non-interactive verification with `CI=true`.

---

### Task 1: Add Strict Page Record and File-Link Parsing

**Files:**

- Create: `src/canvas/page-links.ts`
- Modify: `src/shared/constants.ts`
- Modify: `src/page/run-course.ts`
- Create: `tests/canvas/page-links.test.ts`
- Modify: `tests/page/retrieval.test.ts`

**Interfaces:**

- Produces: `exactCanvasPage(value: unknown): { title: string; body: string }`.
- Produces: `pageLinkedFileIds(body: string, courseId: number): number[]`.
- Produces: `CANVAS_PAGE_JSON_MAX_BYTES = 5 * 1024 * 1024`.
- Consumes: the shared parser from page retrieval without changing successful page retrieval behavior.

- [ ] **Step 1: Add failing parser tests for the two accepted forms**

Create synthetic tests that expect relative and exact-origin absolute anchors to yield one sorted, deduplicated positive file ID per file. Cover both accepted shapes and repeated anchors.

- [ ] **Step 2: Add failing rejection tests for the complete boundary**

Cover another course, another origin, HTTP, credentials, fragments, whitespace, backslashes, encoded separators, malformed IDs, unsupported suffixes, extra or duplicate query parameters, encoded query names/values, and non-anchor attributes. Assert that rejected links contribute no IDs and never throw page content into an error message.

- [ ] **Step 3: Add failing exact page-record tests**

Move the current page-detail validation contract into focused tests: own string `title`, own string `body`, 500-character title limit, and rejection of arrays, inherited/accessor fields, missing fields, and invalid types.

- [ ] **Step 4: Run the focused tests and confirm the module is missing**

```bash
CI=true pnpm exec vitest run tests/canvas/page-links.test.ts tests/page/retrieval.test.ts
```

Expected: FAIL because `src/canvas/page-links.ts` and the shared constant do not exist.

- [ ] **Step 5: Implement the strict parser and shared cap**

Implement URL parsing against `CANVAS_ORIGIN`, validate the selected course ID before parsing, inspect only `a[href]`, and return deterministic sorted unique IDs. Export the 5 MiB cap from `src/shared/constants.ts`. Replace the private `exactPage` and `PAGE_JSON_MAX_BYTES` definitions in `src/page/run-course.ts` with imports.

- [ ] **Step 6: Re-run focused tests and type checking**

```bash
CI=true pnpm exec vitest run tests/canvas/page-links.test.ts tests/page/retrieval.test.ts
CI=true pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the parsing boundary**

```bash
git add src/canvas/page-links.ts src/shared/constants.ts src/page/run-course.ts tests/canvas/page-links.test.ts tests/page/retrieval.test.ts
git diff --cached --check
git commit -m "feat: parse exact page-linked Canvas files"
```

### Task 2: Discover Page-Only Files with Metadata Fallback

**Files:**

- Modify: `src/canvas/discovery.ts`
- Modify: `tests/canvas/discovery.test.ts`
- Modify: `tests/fixtures/course-plan.ts`

**Interfaces:**

- Consumes: `CanvasHttp.jsonBoundedResource(url, CANVAS_PAGE_JSON_MAX_BYTES)` and `pageLinkedFileIds`.
- Produces: metadata-backed planned files or deterministic unknown-size `PlannedResource` values.
- Preserves: shared discovery concurrency, first-failure cancellation, deterministic path allocation, and authoritative broad-index metadata.

- [ ] **Step 1: Extend the synthetic HTTP fixture for bounded page details and exact resource errors**

Add `pageDetails`, page-resource status controls, and file-detail 403/404 controls. Expose a typed `jsonBoundedResource` mock while keeping existing fixture defaults stable.

- [ ] **Step 2: Add a failing page-only discovery test**

Use a synthetic planned page containing both accepted anchors to a file absent from the broad index and modules. Return valid exact file metadata and assert one canonical file resource, one page resource, deduplication, official filename/path, known size, and bounded page-detail call.

- [ ] **Step 3: Add failing metadata-unavailable tests**

For exact file metadata 403 and 404, assert:

```ts
{
  key: "file:777",
  kind: "file",
  title: "file-777",
  sourceId: "777",
  archivePath: "files/file-777",
  advertisedBytes: null,
  sourceUrl: `${CANVAS_ORIGIN}/courses/101/files/777/download`,
}
```

Assert that session, transient, malformed, mismatched-ID, and unsafe metadata failures still reject planning.

- [ ] **Step 4: Add failing page-preflight boundary tests**

Assert page 403/404 and `CanvasBodySizeError` contribute no embedded IDs but preserve the page resource. Assert session, malformed response, transient exhaustion, unsafe final URL, and cancellation fail the plan. Add a test that indexed metadata wins over any page fallback and another that verifies all scheduled work is settled after first terminal failure.

- [ ] **Step 5: Run the focused discovery tests and confirm failure**

```bash
CI=true pnpm exec vitest run tests/canvas/discovery.test.ts tests/canvas/page-links.test.ts
```

Expected: FAIL because discovery does not preflight page bodies or create unknown-size resources.

- [ ] **Step 6: Implement bounded page preflight**

After collecting the complete planned-page token set, schedule each exact course-page request through `DiscoveryRun` and `jsonBoundedResource`. Validate with `exactCanvasPage`, union extracted IDs with module-linked IDs, and classify only exact page 403/404 or page-body-size errors as optional page outcomes.

- [ ] **Step 7: Implement exact metadata fallback and nullable size validation**

Resolve missing IDs through the exact course-file endpoint. Catch only `CanvasResourceUnavailableError` with status 403/404 to create the deterministic unknown-size resource. Keep existing metadata for already indexed files. Update `assertPilotSize` so null file sizes contribute zero to the known total while malformed sizes and known totals still fail.

- [ ] **Step 8: Re-run focused tests, type checking, and privacy scan**

```bash
CI=true pnpm exec vitest run tests/canvas/discovery.test.ts tests/canvas/page-links.test.ts
CI=true pnpm typecheck
git diff --check
```

Expected: PASS and no real-course matches.

- [ ] **Step 9: Commit discovery**

```bash
git add src/canvas/discovery.ts tests/canvas/discovery.test.ts tests/fixtures/course-plan.ts
git diff --cached --check
git commit -m "feat: discover files linked only from pages"
```

### Task 3: Surface Unknown Sizes and Select Safe Packaging

**Files:**

- Modify: `src/shared/model.ts`
- Modify: `src/shared/messages.ts`
- Modify: `src/page/run-courses.ts`
- Modify: `src/sidepanel/main.ts`
- Modify: `tests/shared/messages.test.ts`
- Modify: `tests/page/run-courses.test.ts`
- Modify: `tests/page/runner.test.ts`
- Modify: `tests/sidepanel/state.test.ts`
- Modify: `tests/sidepanel/main.test.ts`

**Interfaces:**

- Extends: `CoursePlanSummary` with `unknownSizeCount: number`.
- Extends: `RunPlanSummary` with aggregate `unknownSizeCount: number`.
- Extends: `PlanFallbackReason` with `"unknown-size-files"`.
- Produces: combined requests with unknown-size resources become per-course before retrieval.

- [ ] **Step 1: Add failing model/parser tests**

Update synthetic valid plan messages to include exact per-course and aggregate unknown counts. Assert missing, negative, fractional, inconsistent, or extra summary fields fail closed. Assert `unknown-size-files` is accepted and arbitrary fallback strings are rejected.

- [ ] **Step 2: Add failing run-plan tests**

Assert a combined request containing one unknown-size file returns `effectivePackaging: "per-course"`, `fallbackReason: "unknown-size-files"`, and correct counts. Assert a direct per-course request remains per-course without a fallback reason. Preserve existing size and ZIP-entry fallback precedence for plans with no unknown sizes.

- [ ] **Step 3: Add failing Side Panel confirmation tests**

Assert review copy shows the unknown-size count, explains streaming under the hard course limit, and explicitly explains combined-to-per-course fallback. Assert zero unknown files does not show the warning.

- [ ] **Step 4: Run the focused suite and confirm type/test failures**

```bash
CI=true pnpm exec vitest run tests/shared/messages.test.ts tests/page/run-courses.test.ts tests/page/runner.test.ts tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts
```

Expected: FAIL because summary shapes and UI copy do not contain unknown-size state.

- [ ] **Step 5: Implement summary counting and fallback**

Count file resources with `advertisedBytes === null` per course and in aggregate. Validate exact keys and sum consistency in the message parser. In `createRunPlan`, select the unknown-size fallback before known-size combined-cap fallback because the effective packaging must be fixed before retrieval.

- [ ] **Step 6: Implement confirmation copy**

Render known advertised bytes and unknown-size files as separate facts. Explain that unknown files are streamed under the 250 MiB per-course cap and that combined output was changed to per-course when the new fallback reason is active.

- [ ] **Step 7: Re-run focused tests and type checking**

```bash
CI=true pnpm exec vitest run tests/shared/messages.test.ts tests/page/run-courses.test.ts tests/page/runner.test.ts tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts
CI=true pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit run planning and UI**

```bash
git add src/shared/model.ts src/shared/messages.ts src/page/run-courses.ts src/sidepanel/main.ts tests/shared/messages.test.ts tests/page/run-courses.test.ts tests/page/runner.test.ts tests/sidepanel/state.test.ts tests/sidepanel/main.test.ts
git diff --cached --check
git commit -m "feat: confirm unknown file sizes safely"
```

### Task 4: Stream Unknown-Size Files Within the Remaining Course Budget

**Files:**

- Modify: `src/page/run-course.ts`
- Modify: `src/page/run-courses.ts`
- Modify: `src/page/runner.ts`
- Modify: `tests/page/retrieval.test.ts`
- Modify: `tests/page/run-course.test.ts`
- Modify: `tests/page/run-courses.test.ts`
- Modify: `tests/fixtures/course-plan.ts`

**Interfaces:**

- Extends: `RunDependencies["retrieve"]` with `remainingBytes: number`.
- Extends: `fetchFileResource(resource, signal, transport, remainingBytes)` for unknown-size files.
- Preserves: known-size preallocation and exact advertised-size checks.
- Produces: terminal size-policy failure before any over-budget course archive is emitted.

- [ ] **Step 1: Add failing unknown-stream unit tests**

Cover success with and without `Content-Length`, exact remaining-budget success, declared length over budget, streamed overflow, empty body, zero-length or malformed length, mid-stream abort, 403/404 outcomes, login HTML, unsafe redirect, and retry exhaustion. Verify body cancellation and temporary-buffer zeroing on terminal failure through observable synthetic stream behavior.

- [ ] **Step 2: Add failing known-size regression tests**

Confirm known-size retrieval still requires the canonical `/files/<id>/download` source shape, matching content length when present, exact non-empty stream size, and unchanged status/error classifications.

- [ ] **Step 3: Add failing course-run budget tests**

Assert each retrieval receives `maxArchiveBytes - successfulBytes`, an unknown file at the exact remainder succeeds, crossing the remainder terminates the course with the existing size-policy error, retained byte arrays are zeroed, and no download/package callback runs.

- [ ] **Step 4: Run focused tests and confirm failures**

```bash
CI=true pnpm exec vitest run tests/page/retrieval.test.ts tests/page/run-course.test.ts tests/page/run-courses.test.ts
```

Expected: FAIL because retrieval has no remaining-budget parameter and rejects null advertised sizes.

- [ ] **Step 5: Implement exact known/unknown URL validation**

Keep known files restricted to `/files/<id>/download`. Restrict unknown fallback files to `/courses/<course-id>/files/<id>/download`, with the plan course ID and resource source ID matching exactly and no query, fragment, credentials, or alternate origin.

- [ ] **Step 6: Implement bounded unknown streaming**

Validate `remainingBytes` as a safe non-negative integer at or below `MAX_ARCHIVE_BYTES`. Reject a declared length above it before reading. Otherwise retain non-empty chunks only while their sum stays within the remainder, cancel and zero chunks on failure, and assemble one final array only after a non-empty successful stream. Throw the existing size-policy error on overflow.

- [ ] **Step 7: Pass the current remaining budget from the course runner**

Change the retrieval dependency signature and all fakes/call sites. Compute the remaining budget immediately before each retrieval. Keep the runner's aggregate post-retrieval size assertion as defense in depth.

- [ ] **Step 8: Re-run focused tests and type checking**

```bash
CI=true pnpm exec vitest run tests/page/retrieval.test.ts tests/page/run-course.test.ts tests/page/run-courses.test.ts
CI=true pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit bounded retrieval**

```bash
git add src/page/run-course.ts src/page/run-courses.ts src/page/runner.ts tests/page/retrieval.test.ts tests/page/run-course.test.ts tests/page/run-courses.test.ts tests/fixtures/course-plan.ts
git diff --cached --check
git commit -m "feat: bound unknown file downloads"
```

### Task 5: Verify Offline Archive Behavior End to End

**Files:**

- Modify: `tests/integration/offline-archive-navigation.test.ts`
- Modify: `tests/page/run-course.test.ts`
- Modify: `tests/archive/manifest.test.ts`
- Modify: `tests/fixtures/course-plan.ts`

**Interfaces:**

- Consumes: page-only planned file, retrieval outcome, existing `resolveLocalHref`, sanitizer, navigation model, manifest builder, and ZIP builder.
- Produces: a local link for successful page-linked files and visible disabled text plus explicit outcome for unavailable files.

- [ ] **Step 1: Add a failing successful page-only archive test**

Build a synthetic course with a page body linking to an unknown-size planned file. Retrieve synthetic bytes and assert ZIP inventory includes `files/file-<id>`, the saved page points to that local path, the manifest has `advertisedBytes: null` and exact `actualBytes`, and every non-fragment relative link resolves to a ZIP entry.

- [ ] **Step 2: Add a failing unavailable-file archive test**

Return an exact 403/404 outcome and assert the page label remains, its local `href` is removed, the file is absent from ZIP entries, and the manifest/status page reports `unavailable` with the correct failure category.

- [ ] **Step 3: Run focused integration tests and confirm failure**

```bash
CI=true pnpm exec vitest run tests/integration/offline-archive-navigation.test.ts tests/page/run-course.test.ts tests/archive/manifest.test.ts
```

Expected: FAIL until the complete discovery-to-archive behavior is wired.

- [ ] **Step 4: Make only the minimal archive integration changes**

Use existing link resolution and unavailable-link removal. If tests expose a gap, fix it without broadening accepted Canvas URLs or changing manifest schema version.

- [ ] **Step 5: Re-run integration tests and the complete source suite**

```bash
CI=true pnpm exec vitest run tests/integration/offline-archive-navigation.test.ts tests/page/run-course.test.ts tests/archive/manifest.test.ts
CI=true pnpm test
CI=true pnpm typecheck
CI=true pnpm build
git diff --check
```

Expected: all tests, types, and build PASS.

- [ ] **Step 6: Commit end-to-end behavior**

```bash
git add tests/integration/offline-archive-navigation.test.ts tests/page/run-course.test.ts tests/archive/manifest.test.ts tests/fixtures/course-plan.ts src
git diff --cached --check
git commit -m "test: verify page-linked files offline"
```

### Task 6: Advance the Immutable Pilot Release to Alpha 4

**Files:**

- Modify: `package.json`
- Modify: `src/manifest.json`
- Modify: `src/archive/manifest.ts`
- Modify: `scripts/package-pilot.mjs`
- Modify: `SECURITY.md`
- Modify: `docs/pilot/INSTALL.md`
- Modify: `docs/pilot/TEST_CHECKLIST.md`
- Modify: `tests/archive/manifest.test.ts`
- Modify: `tests/archive/build-zip.test.ts`
- Modify: `tests/page/run-courses.test.ts`
- Modify: `tests/fixtures/course-plan.ts`
- Modify: `tests/package-pilot.test.ts`
- Modify: `tests/release/version-contract.test.ts`

**Interfaces:**

- Produces: exact current identity `0.1.0-alpha.4` and artifact `gradpack-0.1.0-alpha.4.zip`.
- Preserves: Chrome manifest `version: "0.1.0"` and archive schema version `1`.

- [ ] **Step 1: Change release-contract expectations to Alpha 4 and add stale Alpha 3 rejection**

Update accepted synthetic manifests and version assertions to Alpha 4. Keep one deliberate Alpha 3 package input and assert `packagePilot` rejects it as stale.

- [ ] **Step 2: Run release tests and confirm current production identity fails**

```bash
CI=true pnpm exec vitest run tests/release/version-contract.test.ts tests/package-pilot.test.ts tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts
```

Expected: FAIL because current production surfaces still identify Alpha 3.

- [ ] **Step 3: Update all current release surfaces to Alpha 4**

Set package, Chrome `version_name`, archive manifest version, package artifact name and validation, security statement, install guide, checklist, and accepted test fixtures to `0.1.0-alpha.4`. Keep historical Alpha 1–3 design/plan documents unchanged.

- [ ] **Step 4: Run release tests and stale-current scan**

```bash
CI=true pnpm exec vitest run tests/release/version-contract.test.ts tests/package-pilot.test.ts tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts
! rg -n "0\.1\.0-alpha\.3|gradpack-0\.1\.0-alpha\.3" package.json SECURITY.md README.md src scripts docs/pilot tests/archive tests/fixtures tests/page tests/release
rg -n "0\.1\.0-alpha\.3" tests/package-pilot.test.ts
```

Expected: release tests PASS; current surfaces contain no Alpha 3 identity; exactly the deliberate stale-input test retains Alpha 3.

- [ ] **Step 5: Commit Alpha 4 identity**

```bash
git add package.json src/manifest.json src/archive/manifest.ts scripts/package-pilot.mjs SECURITY.md docs/pilot/INSTALL.md docs/pilot/TEST_CHECKLIST.md tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts tests/fixtures/course-plan.ts tests/package-pilot.test.ts tests/release/version-contract.test.ts
git diff --cached --check
git commit -m "chore: bump pilot to alpha 4"
```

### Task 7: Final Verification, Packaging, and Visible Handoff

**Files:**

- Verify only: all tracked source/test/docs files
- Generate outside Git: `/private/tmp/gradpack-grad22-alpha4-20260826/gradpack-0.1.0-alpha.4.zip`
- Generate outside Git: `/private/tmp/gradpack-grad22-alpha4-20260826/gradpack-0.1.0-alpha.4.zip.sha256`
- Create after all gates pass: `/Users/esso/Documents/codes/personal-projects/GradPack/GRAD-22-validation-package-0.1.0-alpha.4/`

**Interfaces:**

- Consumes: committed GRAD-22 branch and packaging script.
- Produces: verified source, reproducible Alpha 4 package evidence, and a Finder-visible validation folder without touching prior artifacts.

- [ ] **Step 1: Run the complete source verification suite**

```bash
CI=true pnpm test
CI=true pnpm typecheck
CI=true pnpm build
CI=true pnpm verify
git diff --check
git status --short
```

Expected: all commands PASS; only intended tracked changes, if any, are present.

- [ ] **Step 2: Run focused security and privacy scans**

```bash
rg -n "CANVAS_PAGE_JSON_MAX_BYTES|MAX_ARCHIVE_BYTES|unknown-size-files|unknownSizeCount" src tests
git diff origin/main -- src/manifest.json
```

Expected: no real-course match; the exact caps and new fallback are covered; Chrome permissions and host access are unchanged.

- [ ] **Step 3: Package Alpha 4 in a new temporary directory**

Create the exact new temporary directory, run the existing packaging command for that destination, and do not reuse any prior package directory.

```bash
mkdir -p /private/tmp/gradpack-grad22-alpha4-20260826
CI=true pnpm run package:pilot -- /private/tmp/gradpack-grad22-alpha4-20260826
```

Expected: the Alpha 4 ZIP and SHA-256 sidecar are created.

- [ ] **Step 4: Verify package checksum, integrity, inventory, and manifest**

```bash
cd /private/tmp/gradpack-grad22-alpha4-20260826
shasum -a 256 -c gradpack-0.1.0-alpha.4.zip.sha256
unzip -t gradpack-0.1.0-alpha.4.zip
unzip -Z1 gradpack-0.1.0-alpha.4.zip
```

Extract to a new subdirectory and confirm `manifest.json` has `version: 0.1.0` and `version_name: 0.1.0-alpha.4`, no source maps or secrets are present, and package verification tests still pass against the generated artifact.

- [ ] **Step 5: Copy—not move—the verified handoff into a visible new folder**

Create `/Users/esso/Documents/codes/personal-projects/GradPack/GRAD-22-validation-package-0.1.0-alpha.4/` only after confirming it does not exist. Copy the ZIP, sidecar, install guide, checklist, and extracted extension into it. Verify the copied checksum and file inventory. Do not alter any prior validation folder.

- [ ] **Step 6: Perform independent code review and resolve findings**

Review the branch diff against the approved specification with special attention to accepted URL shapes, optional error boundaries, cancellation, unknown-stream cleanup, size enforcement, manifest outcomes, and release immutability. Fix any valid finding with a focused regression test and re-run the affected plus full gates.

- [ ] **Step 7: Record fresh terminal evidence and commit any verification-only fixes**

```bash
git status --short
git log --oneline --decorate -8
git diff --check origin/main...HEAD
```

Expected: clean branch, all implementation commits present, and no generated package committed.

- [ ] **Step 8: Keep real-account acceptance as an explicit user-owned gate**

Report the visible Alpha 4 folder and exact local test steps. Do not claim the real course is accepted until the user loads Alpha 4, downloads the course while signed in, confirms the previously missing reading files are present, opens them offline, and confirms unavailable files are visibly reported rather than silently dropped.
