# GRAD-20 Alpha 2 Pilot Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the merged GRAD-21 build a unique, internally consistent `0.1.0-alpha.2` release identity and produce a verified package for GRAD-20 live validation without modifying the prior `alpha.1` artifact.

**Architecture:** Keep Chrome's numeric extension version and the archive schema unchanged while moving every human-facing GradPack release identifier to `0.1.0-alpha.2`. Existing manifest and package validators remain the enforcement boundary; focused tests lock the source, generated archive, package filename, checksum sidecar, security policy, installation guide, and checklist to one release identity.

**Tech Stack:** TypeScript 5.9, Node.js ESM, Chrome Manifest V3 JSON, Vitest, pnpm, `fflate`, SHA-256, ZIP command-line verification.

## Global Constraints

- The release identity is exactly `0.1.0-alpha.2`.
- Chrome manifest `version` remains exactly `0.1.0`.
- Archive manifest `schemaVersion` remains exactly `1`.
- The new artifact is exactly `gradpack-0.1.0-alpha.2.zip` with sidecar `gradpack-0.1.0-alpha.2.zip.sha256`.
- Do not replace, rename, move, delete, or edit the existing `0.1.0-alpha.1` package or checksum.
- Do not change Chrome permissions, host access, Canvas behavior, archive behavior, privacy boundaries, or UI behavior.
- Do not commit generated ZIPs, extracted extensions, checksums, real Canvas data, screenshots, filenames, URLs, identifiers, or student content.
- Run non-interactive project verification with `CI=true`.

---

### Task 1: Lock the Alpha 2 Source and Package Identity

**Files:**

- Modify: `package.json:3`
- Modify: `src/manifest.json:5-6`
- Modify: `src/archive/manifest.ts:11`
- Modify: `scripts/package-pilot.mjs:17,285-288`
- Modify: `tests/archive/manifest.test.ts:22`
- Modify: `tests/archive/build-zip.test.ts:100`
- Modify: `tests/page/run-courses.test.ts:57`
- Modify: `tests/fixtures/course-plan.ts:280`
- Modify: `tests/package-pilot.test.ts:25-35,197-205`

**Interfaces:**

- Consumes: `buildManifest(plan, outcomes, createdAt): ArchiveManifest`, `packagePilot(options): Promise<{ artifactPath: string; checksumPath: string; digest: string }>`.
- Produces: one release identity shared by package metadata, Chrome `version_name`, `ArchiveManifest.gradPackVersion`, `PILOT_ARTIFACT_NAME`, and package validation.

- [ ] **Step 1: Change the focused test expectations and synthetic production manifests to Alpha 2**

Use exact replacements in test code only:

```ts
gradPackVersion: "0.1.0-alpha.2",
```

```ts
'{"name":"GradPack","version":"0.1.0","version_name":"0.1.0-alpha.2"}\n';
```

Apply them to the five test/fixture files listed above. Do not change historical design documents.

- [ ] **Step 2: Run the focused tests and confirm the old source identity fails**

Run:

```bash
CI=true pnpm exec vitest run tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts tests/package-pilot.test.ts
```

Expected: FAIL because generated archive manifests and the package validator still identify `0.1.0-alpha.1`.

- [ ] **Step 3: Update the four production release-identity sources**

Set `package.json`:

```json
"version": "0.1.0-alpha.2"
```

Keep the numeric Chrome version and update only the display version in `src/manifest.json`:

```json
"version": "0.1.0",
"version_name": "0.1.0-alpha.2"
```

Set the archive metadata constant in `src/archive/manifest.ts`:

```ts
const GRADPACK_VERSION = "0.1.0-alpha.2";
```

Set the artifact name and package manifest check in `scripts/package-pilot.mjs`:

```js
export const PILOT_ARTIFACT_NAME = "gradpack-0.1.0-alpha.2.zip";
```

```js
manifest.version_name !== "0.1.0-alpha.2";
```

- [ ] **Step 4: Run the focused tests and type check**

Run:

```bash
CI=true pnpm exec vitest run tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts tests/package-pilot.test.ts
CI=true pnpm typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Confirm no current production or test identity remains on Alpha 1**

Run:

```bash
rg -n "0\.1\.0-alpha\.1|gradpack-0\.1\.0-alpha\.1" package.json src scripts tests
```

Expected: no matches.

- [ ] **Step 6: Commit the release identity**

```bash
git add package.json src/manifest.json src/archive/manifest.ts scripts/package-pilot.mjs tests/archive/manifest.test.ts tests/archive/build-zip.test.ts tests/page/run-courses.test.ts tests/fixtures/course-plan.ts tests/package-pilot.test.ts
git diff --cached --check
git commit -m "chore: bump pilot to alpha 2"
```

### Task 2: Make Tester-Facing Documentation Identify Alpha 2

**Files:**

- Create: `tests/release/version-contract.test.ts`
- Modify: `docs/pilot/INSTALL.md:7-38`
- Modify: `docs/pilot/TEST_CHECKLIST.md:3`
- Modify: `SECURITY.md:21`

**Interfaces:**

- Consumes: the exact version literals in `package.json`, `src/manifest.json`, `scripts/package-pilot.mjs`, and tester-facing Markdown.
- Produces: an automated release contract that prevents documentation and package identity from drifting apart.

- [ ] **Step 1: Add a failing cross-file release contract test**

Create `tests/release/version-contract.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PILOT_ARTIFACT_NAME } from "../../scripts/package-pilot.mjs";

const RELEASE_VERSION = "0.1.0-alpha.2";
const ARTIFACT_NAME = `gradpack-${RELEASE_VERSION}.zip`;

describe("pilot release identity", () => {
  it("keeps source, package, security, install, and checklist identity aligned", async () => {
    const packageMetadata = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const [manifestText, security, install, checklist] = await Promise.all([
      readFile(new URL("../../src/manifest.json", import.meta.url), "utf8"),
      readFile(new URL("../../SECURITY.md", import.meta.url), "utf8"),
      readFile(new URL("../../docs/pilot/INSTALL.md", import.meta.url), "utf8"),
      readFile(
        new URL("../../docs/pilot/TEST_CHECKLIST.md", import.meta.url),
        "utf8",
      ),
    ]);
    const extensionManifest = JSON.parse(manifestText) as {
      version: string;
      version_name: string;
    };

    expect(packageMetadata.version).toBe(RELEASE_VERSION);
    expect(extensionManifest.version).toBe("0.1.0");
    expect(extensionManifest.version_name).toBe(RELEASE_VERSION);
    expect(PILOT_ARTIFACT_NAME).toBe(ARTIFACT_NAME);
    expect(security).toContain(`current \`${RELEASE_VERSION}\``);
    expect(install).toContain(ARTIFACT_NAME);
    expect(install).toContain(`${ARTIFACT_NAME}.sha256`);
    expect(checklist).toContain(`Artifact version: ${RELEASE_VERSION}`);
  });
});
```

- [ ] **Step 2: Run the release contract test and confirm documentation fails**

Run:

```bash
CI=true pnpm exec vitest run tests/release/version-contract.test.ts
```

Expected: FAIL because `SECURITY.md`, `INSTALL.md`, and `TEST_CHECKLIST.md` still identify or leave blank the prior release.

- [ ] **Step 3: Update current tester-facing documentation**

Change `SECURITY.md` to:

```markdown
The current `0.1.0-alpha.2` classmate pilot is pre-release software.
```

Change every artifact command and filename in `docs/pilot/INSTALL.md` from
`gradpack-0.1.0-alpha.1.zip` to `gradpack-0.1.0-alpha.2.zip`.

Change the checklist field in `docs/pilot/TEST_CHECKLIST.md` to:

```markdown
- Artifact version: 0.1.0-alpha.2
```

Do not change `docs/design/2026-08-16-gradpack-classmate-pilot-design.md`; its statement that the pilot started at `alpha.1` is historical and remains correct.

- [ ] **Step 4: Run the release contract and documentation checks**

Run:

```bash
CI=true pnpm exec vitest run tests/release/version-contract.test.ts tests/package-pilot.test.ts tests/archive/manifest.test.ts
pnpm exec prettier --check SECURITY.md docs/pilot/INSTALL.md docs/pilot/TEST_CHECKLIST.md tests/release/version-contract.test.ts
```

Expected: all tests PASS and all four files use Prettier formatting.

- [ ] **Step 5: Scan current surfaces for stale Alpha 1 references**

Run:

```bash
rg -n "0\.1\.0-alpha\.1|gradpack-0\.1\.0-alpha\.1" package.json SECURITY.md README.md src scripts tests docs/pilot
```

Expected: no matches. Historical references under `docs/design/` and the approved GRAD-20 design/spec files are intentionally outside this command.

- [ ] **Step 6: Commit the tester-facing release contract**

```bash
git add SECURITY.md docs/pilot/INSTALL.md docs/pilot/TEST_CHECKLIST.md tests/release/version-contract.test.ts
git diff --cached --check
git commit -m "docs: prepare alpha 2 pilot validation"
```

### Task 3: Verify and Stage the Exact Alpha 2 Validation Package

**Files:**

- Read only: `/Users/esso/Documents/codes/personal-projects/GradPack/classmate-pilot-package/gradpack-0.1.0-alpha.1.zip`
- Generate outside Git: `/private/tmp/gradpack-grad20-alpha2-20260825/gradpack-0.1.0-alpha.2.zip`
- Generate outside Git: `/private/tmp/gradpack-grad20-alpha2-20260825/gradpack-0.1.0-alpha.2.zip.sha256`
- Create local handoff folder: `/Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2/`

**Interfaces:**

- Consumes: `pnpm verify`, `packagePilot({ artifactRoot })`, `PILOT_FILES`, the committed installation guide, and the committed checklist.
- Produces: one visible, checksum-verified, extracted `alpha.2` package ready for the GRAD-20 Chrome gate; no tracked repository artifact.

- [ ] **Step 1: Capture the prior package checksum without modifying it**

Run:

```bash
shasum -a 256 /Users/esso/Documents/codes/personal-projects/GradPack/classmate-pilot-package/gradpack-0.1.0-alpha.1.zip
```

Expected: `df16f5471b2ccf6c66b9a8d4c70e541e4aac9ca61113fec95251c8d42a5c5ac8`.

- [ ] **Step 2: Run the complete source verification gate**

Run:

```bash
CI=true pnpm verify
git diff --check
git status --short
```

Expected: formatting, lint, type checking, every Vitest test, and production build PASS; the worktree is clean.

- [ ] **Step 3: Create a new temporary artifact directory**

Run:

```bash
test ! -e /private/tmp/gradpack-grad20-alpha2-20260825
mkdir /private/tmp/gradpack-grad20-alpha2-20260825
```

Expected: both commands exit successfully. Do not reuse the directory if it already exists.

- [ ] **Step 4: Build the Alpha 2 artifact through the production packager**

Run from the GRAD-20 worktree:

```bash
node -e "import('./scripts/package-pilot.mjs').then(async ({packagePilot}) => console.log(JSON.stringify(await packagePilot({artifactRoot:'/private/tmp/gradpack-grad20-alpha2-20260825'}))))"
```

Expected: JSON paths ending in `gradpack-0.1.0-alpha.2.zip` and `.sha256`, plus a 64-character SHA-256 digest.

- [ ] **Step 5: Independently verify checksum, ZIP integrity, and inventory**

Run:

```bash
cd /private/tmp/gradpack-grad20-alpha2-20260825
shasum -a 256 -c gradpack-0.1.0-alpha.2.zip.sha256
unzip -t gradpack-0.1.0-alpha.2.zip
unzip -Z1 gradpack-0.1.0-alpha.2.zip
```

Expected checksum result: `gradpack-0.1.0-alpha.2.zip: OK`.

Expected exact inventory, in order:

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

- [ ] **Step 6: Reconfirm Alpha 1 immutability**

Run:

```bash
shasum -a 256 /Users/esso/Documents/codes/personal-projects/GradPack/classmate-pilot-package/gradpack-0.1.0-alpha.1.zip
```

Expected: the same `df16f5471b2ccf6c66b9a8d4c70e541e4aac9ca61113fec95251c8d42a5c5ac8` digest from Step 1.

- [ ] **Step 7: Create the visible validation handoff without overwriting existing data**

Run:

```bash
test ! -e /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2
mkdir /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2
mkdir /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2/gradpack-0.1.0-alpha.2
cp /private/tmp/gradpack-grad20-alpha2-20260825/gradpack-0.1.0-alpha.2.zip /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2/
cp /private/tmp/gradpack-grad20-alpha2-20260825/gradpack-0.1.0-alpha.2.zip.sha256 /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2/
cp docs/pilot/INSTALL.md /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2/
cp docs/pilot/TEST_CHECKLIST.md /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2/
unzip /private/tmp/gradpack-grad20-alpha2-20260825/gradpack-0.1.0-alpha.2.zip -d /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2/gradpack-0.1.0-alpha.2
```

Expected: a visible folder containing the ZIP, sidecar, installation guide,
checklist, and one extracted eight-file extension directory. This folder is a
local validation artifact and must remain untracked.

- [ ] **Step 8: Verify the visible copy and report the live-test gate**

Run:

```bash
cd /Users/esso/Documents/codes/personal-projects/GradPack/GRAD-20-validation-package-0.1.0-alpha.2
shasum -a 256 -c gradpack-0.1.0-alpha.2.zip.sha256
find gradpack-0.1.0-alpha.2 -maxdepth 1 -type f -print | sort
```

Expected: checksum PASS and exactly the eight extension files from Step 5.

Do not commit this folder. Report that automated/package validation is
complete and that GRAD-20 remains open for:

1. Maintainer installation and signed-in one-course run.
2. Extracted archive `file://` navigation and visual acceptance.
3. Independent classmate checklist completion.

Record only coarse pass/fail evidence and safe counts in Linear after each live
gate. Never record course names, filenames, Canvas IDs or URLs, screenshots,
archive content, request/response data, credentials, cookies, headers, tokens,
or student identity.
