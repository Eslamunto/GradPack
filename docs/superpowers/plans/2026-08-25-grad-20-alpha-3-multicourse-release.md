# GRAD-20 Alpha 3 Multi-Course Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reviewed-but-undistributed Alpha 2 candidate with an immutable `0.1.0-alpha.3` validation package whose Chrome and tester-facing copy accurately describes the merged multi-course workflow.

**Architecture:** Build on the committed Alpha 2 release contract without modifying either preserved package. First move every current release identity and its generated archive/package checks to Alpha 3, then correct only descriptive Chrome/Markdown surfaces for one-or-more-course, combined, and per-course behavior; package and verify the result in new temporary and visible directories.

**Tech Stack:** TypeScript 5.9, Node.js ESM, Chrome Manifest V3 JSON, Vitest, pnpm, `fflate`, SHA-256, ZIP command-line verification.

## Global Constraints

- The next distributable release identity is exactly `0.1.0-alpha.3`.
- Chrome manifest `version` remains exactly `0.1.0`.
- Archive manifest `schemaVersion` remains exactly `1`.
- The new artifact is exactly `gradpack-0.1.0-alpha.3.zip` with sidecar `gradpack-0.1.0-alpha.3.zip.sha256`.
- Do not replace, rename, move, delete, or edit any Alpha 1 or Alpha 2 artifact, checksum, extracted folder, or validation record.
- Do not change multi-course orchestration, packaging fallback behavior, the 250 MiB safety limit, ZIP entry limits, Chrome permissions, Canvas host access, privacy boundaries, or UI behavior.
- Do not commit generated ZIPs, extracted extensions, checksums, real Canvas data, screenshots, filenames, URLs, identifiers, or student content.
- Historical design documents that say the pilot started as Alpha 1 or one-course remain unchanged.
- Run non-interactive project verification with `CI=true`.

---

### Task 1: Move the Complete Release Contract to Alpha 3

**Files:**

- Modify: `package.json:3`
- Modify: `src/manifest.json:5-6`
- Modify: `src/archive/manifest.ts:11`
- Modify: `scripts/package-pilot.mjs:17,285-288`
- Modify: `SECURITY.md:21`
- Modify: `docs/pilot/INSTALL.md:9,24,30,36-37`
- Modify: `docs/pilot/TEST_CHECKLIST.md:3`
- Modify: `tests/archive/manifest.test.ts:22`
- Modify: `tests/archive/build-zip.test.ts:100`
- Modify: `tests/page/run-courses.test.ts:57`
- Modify: `tests/fixtures/course-plan.ts:280`
- Modify: `tests/package-pilot.test.ts:25-35,197-205`
- Modify: `tests/release/version-contract.test.ts`

**Interfaces:**

- Consumes: `buildManifest(plan, outcomes, createdAt): ArchiveManifest`, `packagePilot(options): Promise<{ artifactPath: string; checksumPath: string; digest: string }>`.
- Produces: one Alpha 3 identity enforced across source metadata, generated archive manifests, package input validation, artifact naming, security policy, guide, checklist, fixtures, and tests.

- [ ] **Step 1: Change release tests and synthetic accepted manifests to Alpha 3**

Replace current Alpha 2 expectations in test and fixture files with:

```ts
gradPackVersion: "0.1.0-alpha.3",
```

```ts
'{"name":"GradPack","version":"0.1.0","version_name":"0.1.0-alpha.3"}\n';
```

Set the release-test constant in `tests/release/version-contract.test.ts`:

```ts
const RELEASE_VERSION = "0.1.0-alpha.3";
```

- [ ] **Step 2: Extend the release contract to assert generated archive metadata**

Add imports to `tests/release/version-contract.test.ts`:

```ts
import { buildManifest } from "../../src/archive/manifest";
import {
  syntheticArchiveOutcomes,
  syntheticArchivePlan,
} from "../fixtures/course-plan";
```

Add this assertion after the Chrome manifest assertions:

```ts
const archiveManifest = buildManifest(
  structuredClone(syntheticArchivePlan),
  structuredClone(syntheticArchiveOutcomes),
  "2026-08-25T09:00:00.000Z",
);
expect(archiveManifest.gradPackVersion).toBe(RELEASE_VERSION);
```

- [ ] **Step 3: Add a package test that rejects stale Alpha 2 input**

Add this test inside `describe("pilot package", ...)` in
`tests/package-pilot.test.ts`:

```ts
it("rejects a stale release identity", async () => {
  const buildRoot = await makeBuild();
  await writeFile(
    join(buildRoot, "manifest.json"),
    '{"name":"GradPack","version":"0.1.0","version_name":"0.1.0-alpha.2"}\n',
  );

  await expect(
    packagePilot({
      buildRoot,
      artifactRoot: join(buildRoot, "out"),
    }),
  ).rejects.toThrow("Pilot manifest identity is invalid");
});
```

- [ ] **Step 4: Run the focused tests and confirm Alpha 2 production identity fails**

Run:

```bash
CI=true pnpm exec vitest run tests/release/version-contract.test.ts tests/package-pilot.test.ts tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts
```

Expected: FAIL because production metadata, archive manifests, package
validation, and current documentation still identify Alpha 2. The stale-input
test may already pass; the accepted Alpha 3 cases must fail for the intended
identity mismatch.

- [ ] **Step 5: Update every current production and tester release identity**

Use the exact Alpha 3 values:

```json
// package.json
"version": "0.1.0-alpha.3"
```

```json
// src/manifest.json
"version": "0.1.0",
"version_name": "0.1.0-alpha.3"
```

```ts
// src/archive/manifest.ts
const GRADPACK_VERSION = "0.1.0-alpha.3";
```

```js
// scripts/package-pilot.mjs
export const PILOT_ARTIFACT_NAME = "gradpack-0.1.0-alpha.3.zip";
```

```js
manifest.version_name !== "0.1.0-alpha.3";
```

Change the current version in `SECURITY.md`, every artifact filename and
checksum command in `docs/pilot/INSTALL.md`, and the fixed artifact version in
`docs/pilot/TEST_CHECKLIST.md` from Alpha 2 to Alpha 3.

- [ ] **Step 6: Run the focused tests, type check, and stale-current scan**

Run:

```bash
CI=true pnpm exec vitest run tests/release/version-contract.test.ts tests/package-pilot.test.ts tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts
CI=true pnpm typecheck
! rg -n "0\.1\.0-alpha\.2|gradpack-0\.1\.0-alpha\.2" package.json SECURITY.md README.md src scripts docs/pilot tests/archive tests/fixtures tests/page tests/release
rg -n "0\.1\.0-alpha\.2" tests/package-pilot.test.ts
```

Expected: all focused tests PASS, TypeScript reports no errors, current
source/tester surfaces contain no Alpha 2 identity, and the package test has
exactly one Alpha 2 match in the deliberate stale-input rejection case.

- [ ] **Step 7: Commit the Alpha 3 release contract**

```bash
git add package.json src/manifest.json src/archive/manifest.ts scripts/package-pilot.mjs SECURITY.md docs/pilot/INSTALL.md docs/pilot/TEST_CHECKLIST.md tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts tests/fixtures/course-plan.ts tests/package-pilot.test.ts tests/release/version-contract.test.ts
git diff --cached --check
git commit -m "chore: bump pilot to alpha 3"
```

### Task 2: Correct Multi-Course Product and Tester Copy

**Files:**

- Modify: `src/manifest.json:4`
- Modify: `README.md:55-67`
- Modify: `docs/pilot/INSTALL.md:11-14,50-57`
- Modify: `docs/pilot/TEST_CHECKLIST.md:7-10`
- Modify: `tests/release/version-contract.test.ts`

**Interfaces:**

- Consumes: Chrome manifest description, Markdown tester instructions, immutable multi-course planning semantics from `createRunPlan`, and the release contract test.
- Produces: accurate one-or-more-course copy without changing orchestration or safety behavior.

- [ ] **Step 1: Add failing exact copy assertions to the release contract**

In `tests/release/version-contract.test.ts`, extend the existing read to:

```ts
const [manifestText, security, install, checklist, readme] = await Promise.all([
  readFile(new URL("../../src/manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../../SECURITY.md", import.meta.url), "utf8"),
  readFile(new URL("../../docs/pilot/INSTALL.md", import.meta.url), "utf8"),
  readFile(
    new URL("../../docs/pilot/TEST_CHECKLIST.md", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../../README.md", import.meta.url), "utf8"),
]);
```

Then add these assertions:

```ts
expect(extensionManifest.description).toBe(
  "Save selected accessible Canvas courses for offline use.",
);
expect(install).toContain("select one or more accessible courses");
expect(install).toContain("combined archive or one ZIP per course");
expect(install).toContain("packaging fallback before retrieval");
expect(checklist).toContain("Selected-course count:");
expect(checklist).toContain("Requested packaging: combined / per-course");
expect(checklist).toContain("Effective packaging: combined / per-course");
expect(checklist).toContain(
  "Packaging fallback notice: pass / fail / not-shown",
);
expect(checklist).toContain("Output count:");
expect(readme).not.toContain("The one-course pilot stops before retrieval");
expect(readme).toContain("Every selected course is validated before retrieval");
expect(readme).toContain("combined-to-per-course fallback");
```

Extend the local parsed manifest type with:

```ts
description: string;
```

- [ ] **Step 2: Run the release contract and confirm stale one-course copy fails**

Run:

```bash
CI=true pnpm exec vitest run tests/release/version-contract.test.ts
```

Expected: FAIL on the Chrome description and tester-copy assertions while
release identity assertions remain green.

- [ ] **Step 3: Correct the packaged Chrome description**

Set `src/manifest.json`:

```json
"description": "Save selected accessible Canvas courses for offline use."
```

- [ ] **Step 4: Correct the installation guide**

Replace the one-course limit bullet in `docs/pilot/INSTALL.md` with:

```markdown
- GradPack can select one or more accessible courses and produce one combined
  archive or one ZIP per course.
- Every selected course requires known advertised file sizes and must fit the
  existing 250 MiB per-course limit.
- If a requested combined archive exceeds its aggregate size or entry limit,
  GradPack shows the packaging fallback before retrieval and uses per-course
  output only after confirmation.
```

Replace run steps 8 and 9 with:

```markdown
8. Select one or more accessible courses, choose combined or per-course output,
   and start planning.
9. Review the plan and any packaging fallback notice, then confirm retrieval.
10. Keep the resulting archive or archives local. Extract each ZIP before
    opening its `index.html`.
```

- [ ] **Step 5: Add privacy-safe multi-course checklist fields**

After `Course list` in `docs/pilot/TEST_CHECKLIST.md`, add:

```markdown
- Selected-course count:
- Requested packaging: combined / per-course
- Effective packaging: combined / per-course
- Packaging fallback notice: pass / fail / not-shown
- Output count:
```

Keep the existing prohibition against course names, filenames, identifiers,
URLs, screenshots, archives, content, request/response data, credentials,
cookies, headers, tokens, and student identity.

- [ ] **Step 6: Correct README safety-limit language**

Replace the first two paragraphs under `### Pilot memory limits` with:

```markdown
Every selected course is validated before retrieval. GradPack stops when any
selected course has unknown advertised file sizes or exceeds 250 MiB; it never
silently omits resources to make a course fit. If a requested combined archive
exceeds its aggregate size or ZIP-entry limit while the individual courses
remain valid, GradPack shows a combined-to-per-course fallback before retrieval
and requires confirmation.

During retrieval, each course also stops if successful files plus sanitized
pages exceed the same 250 MiB per-course limit. Individual Canvas page-detail
JSON bodies are streamed under a conservative 5 MiB raw-body cap and receive a
fixed, transparent unavailable outcome when that cap is exceeded.
```

Leave the existing per-course ZIP-entry reservation paragraph unchanged.

- [ ] **Step 7: Run focused tests and formatting**

Run:

```bash
CI=true pnpm exec vitest run tests/release/version-contract.test.ts tests/build/output.test.ts tests/page/run-courses.test.ts
pnpm exec prettier --check src/manifest.json README.md docs/pilot/INSTALL.md docs/pilot/TEST_CHECKLIST.md tests/release/version-contract.test.ts
```

Expected: all focused tests PASS and all files use Prettier formatting.

- [ ] **Step 8: Commit the corrected multi-course copy**

```bash
git add src/manifest.json README.md docs/pilot/INSTALL.md docs/pilot/TEST_CHECKLIST.md tests/release/version-contract.test.ts
git diff --cached --check
git commit -m "docs: align pilot copy with multicourse flow"
```

### Task 3: Verify and Stage the Immutable Alpha 3 Candidate

**Files:**

- Read only: `/Users/esso/Documents/codes/personal-projects/GradPack/classmate-pilot-package/gradpack-0.1.0-alpha.1.zip`
- Read only: `/Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2/gradpack-0.1.0-alpha.2.zip`
- Generate outside Git: `/private/tmp/gradpack-grad20-alpha3-20260825/gradpack-0.1.0-alpha.3.zip`
- Generate outside Git: `/private/tmp/gradpack-grad20-alpha3-20260825/gradpack-0.1.0-alpha.3.zip.sha256`
- Create local handoff folder: `/Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.3/`

**Interfaces:**

- Consumes: committed Alpha 3 source, `pnpm verify`, `packagePilot({ artifactRoot })`, the committed guide/checklist, and the preserved Alpha 1/Alpha 2 candidates.
- Produces: one verified Alpha 3 candidate and extracted extension for independent review; no tracked package artifact.

- [ ] **Step 1: Record the preserved package checksums**

Run:

```bash
shasum -a 256 /Users/esso/Documents/codes/personal-projects/GradPack/classmate-pilot-package/gradpack-0.1.0-alpha.1.zip
shasum -a 256 /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2/gradpack-0.1.0-alpha.2.zip
```

Expected:

```text
df16f5471b2ccf6c66b9a8d4c70e541e4aac9ca61113fec95251c8d42a5c5ac8  ...alpha.1.zip
56d32de66552835a886592e494b414fab033bd59bd6cb06c9c7488194b0aa403  ...alpha.2.zip
```

- [ ] **Step 2: Run the complete source verification gate**

Run:

```bash
CI=true pnpm verify
git diff --check
git status --short
```

Expected: formatting, lint, type checking, every Vitest test, and production
build PASS; the worktree is clean.

- [ ] **Step 3: Create a new Alpha 3 artifact directory**

Run:

```bash
test ! -e /private/tmp/gradpack-grad20-alpha3-20260825
mkdir /private/tmp/gradpack-grad20-alpha3-20260825
```

Expected: both commands exit successfully. Stop rather than reusing or deleting
an existing directory.

- [ ] **Step 4: Generate the production Alpha 3 pair**

Run from the GRAD-20 worktree:

```bash
node -e "import('./scripts/package-pilot.mjs').then(async ({packagePilot}) => console.log(JSON.stringify(await packagePilot({artifactRoot:'/private/tmp/gradpack-grad20-alpha3-20260825'}))))"
```

Expected: Alpha 3 ZIP/sidecar paths and a 64-character digest.

- [ ] **Step 5: Verify checksum, ZIP integrity, and exact inventory**

Run from `/private/tmp/gradpack-grad20-alpha3-20260825`:

```bash
shasum -a 256 -c gradpack-0.1.0-alpha.3.zip.sha256
unzip -t gradpack-0.1.0-alpha.3.zip
unzip -Z1 gradpack-0.1.0-alpha.3.zip
```

Expected exact inventory:

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

- [ ] **Step 6: Inspect packaged identity and permission invariants**

Extract to a new directory and print only public manifest fields:

```bash
mkdir /private/tmp/gradpack-grad20-alpha3-20260825/extracted
unzip /private/tmp/gradpack-grad20-alpha3-20260825/gradpack-0.1.0-alpha.3.zip -d /private/tmp/gradpack-grad20-alpha3-20260825/extracted
node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('/private/tmp/gradpack-grad20-alpha3-20260825/extracted/manifest.json','utf8')); console.log(JSON.stringify({description:m.description,version:m.version,version_name:m.version_name,permissions:m.permissions,host_permissions:m.host_permissions}))"
```

Expected:

```json
{
  "description": "Save selected accessible Canvas courses for offline use.",
  "version": "0.1.0",
  "version_name": "0.1.0-alpha.3",
  "permissions": ["sidePanel", "scripting"],
  "host_permissions": ["https://frankfurtschool.instructure.com/*"]
}
```

- [ ] **Step 7: Reconfirm Alpha 1 and Alpha 2 immutability**

Repeat Step 1 and require the same two digests exactly.

- [ ] **Step 8: Create and verify the visible Alpha 3 handoff**

Run:

```bash
test ! -e /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.3
mkdir /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.3
cp /private/tmp/gradpack-grad20-alpha3-20260825/gradpack-0.1.0-alpha.3.zip /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.3/
cp /private/tmp/gradpack-grad20-alpha3-20260825/gradpack-0.1.0-alpha.3.zip.sha256 /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.3/
cp docs/pilot/INSTALL.md /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.3/
cp docs/pilot/TEST_CHECKLIST.md /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.3/
cp -R /private/tmp/gradpack-grad20-alpha3-20260825/extracted /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.3/gradpack-0.1.0-alpha.3
cd /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.3
shasum -a 256 -c gradpack-0.1.0-alpha.3.zip.sha256
find gradpack-0.1.0-alpha.3 -maxdepth 1 -type f -print | sort
```

Expected: checksum PASS and exactly the eight production files.

- [ ] **Step 9: Obtain fresh independent review before integration**

Request a read-only review of `origin/main..HEAD` against:

- `docs/superpowers/specs/2026-08-25-grad-20-alpha-3-multicourse-release-design.md`;
- this implementation plan;
- the Important multi-course-copy finding;
- the Minor release-contract finding.

Do not proceed with any Critical or Important issue unresolved. Keep the
maintainer Chrome, merged-main byte reproduction, extracted `file://`, and
classmate gates open.
