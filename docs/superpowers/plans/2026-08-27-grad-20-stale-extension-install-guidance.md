# GRAD-20 Stale Extension Installation Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent upgrading pilot testers from accidentally running an older unpacked GradPack version by documenting removal and Canvas refresh steps and protecting both instructions with a regression test.

**Architecture:** Keep the change limited to the classmate installation guide and its existing release-surface contract test. Add exact assertions first, then make the smallest documentation edit that satisfies them; no extension code, permissions, packaging logic, version, or inner release ZIP changes are permitted.

**Tech Stack:** Markdown, TypeScript, Vitest, pnpm 11.17.0, Node.js 22.

## Global Constraints

- Change classmate-facing installation guidance only.
- Do not change extension code, permissions, archive behavior, package version, or the versioned inner extension ZIP.
- Preserve all existing checksum, privacy, retrieval, retry, and removal guidance.
- Require removal of any existing GradPack installation before loading the supplied unpacked folder.
- Require one refresh of the signed-in Frankfurt School Canvas tab after GradPack is loaded.
- The normal `pnpm verify` suite must pass.
- The inner `gradpack-0.1.0-alpha.6.zip` and SHA-256 sidecar must remain byte-identical.

---

### Task 1: Protect and add upgrade-safe installation guidance

**Files:**

- Modify: `tests/build/release-files.test.ts`
- Modify: `docs/pilot/INSTALL.md`

**Interfaces:**

- Consumes: the existing `pilot release surface` Vitest suite and the `Load the extension` numbered procedure.
- Produces: two persistent release-document contracts: the guide says `If GradPack is already installed, select **Remove** and confirm before continuing.` and `Refresh the signed-in Canvas tab once after GradPack loads.`

- [ ] **Step 1: Write the failing release-surface assertions**

Add these assertions immediately after the existing required-token loop in `tests/build/release-files.test.ts`:

```ts
expect(install).toContain(
  "If GradPack is already installed, select **Remove** and confirm before continuing.",
);
expect(install).toContain(
  "Refresh the signed-in Canvas tab once after GradPack loads.",
);
```

- [ ] **Step 2: Run the focused test and verify the new contract fails**

Run:

```bash
pnpm exec vitest run tests/build/release-files.test.ts
```

Expected: FAIL in `keeps the package command and public guidance within pilot policy` because the first new sentence is absent from `docs/pilot/INSTALL.md`.

- [ ] **Step 3: Add the minimal upgrade and refresh instructions**

Replace the numbered list under `## Load the extension` in `docs/pilot/INSTALL.md` with:

```markdown
1. Extract the extension ZIP into a new local folder. Do not select the ZIP
   itself in Chrome.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. If GradPack is already installed, select **Remove** and confirm before continuing.
5. Select **Load unpacked** and choose the extracted folder.
6. Sign in to Frankfurt School Canvas in a normal Chrome tab.
7. Refresh the signed-in Canvas tab once after GradPack loads.
8. Keep that tab open, signed in, and unnavigated while GradPack works.
9. Select GradPack in the Chrome toolbar to open its Side Panel.
10. Select individual courses or use **Select all courses** to select every
    displayed active, completed, and concluded course; then choose combined or
    per-course output and start planning.
11. Review the ready and skipped courses plus any packaging fallback notice,
    then confirm retrieval for the ready courses.
12. If GradPack reports unfinished courses after downloading the safe
    archives, select **Retry unfinished courses**. The retry checks only those
    courses again and shows a new review before retrieval.
13. Keep the resulting archive or archives local. Extract each ZIP before
    opening its `index.html`.
```

- [ ] **Step 4: Run the focused test and verify the contract passes**

Run:

```bash
pnpm exec vitest run tests/build/release-files.test.ts
```

Expected: PASS with 1 test file and 3 tests passing.

- [ ] **Step 5: Run complete repository verification**

Run:

```bash
CI=true pnpm verify
```

Expected: formatting, lint, typecheck, all Vitest tests, and production build pass.

- [ ] **Step 6: Confirm scope and inner artifact immutability**

Run:

```bash
git status --short
git diff --check
git diff -- tests/build/release-files.test.ts docs/pilot/INSTALL.md
shasum -a 256 /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.6/gradpack-0.1.0-alpha.6.zip
```

Expected: only the plan, test, and installation guide are changed in the worktree; `git diff --check` is silent; the inner ZIP checksum is `34c32e6d4dc984c7daf9abc8ffc4fa61724a1948fa73f2743c99ecf642dca40e`.

- [ ] **Step 7: Commit the implementation**

```bash
git add docs/pilot/INSTALL.md tests/build/release-files.test.ts docs/superpowers/plans/2026-08-27-grad-20-stale-extension-install-guidance.md
git commit -m "docs: prevent stale GradPack pilot installs"
```

Expected: a new commit on `codex/grad-20-install-guidance` containing only the approved documentation, regression test, and implementation plan.

### Task 2: Deliver and validate the corrected pilot bundle

**Files:**

- Update after merge: `/Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.6/INSTALL.md`
- Regenerate after merge: `/Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.6-bundle.zip`
- Preserve: `/Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.6/gradpack-0.1.0-alpha.6.zip`
- Preserve: `/Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.6/gradpack-0.1.0-alpha.6.zip.sha256`

**Interfaces:**

- Consumes: the merged `docs/pilot/INSTALL.md` and existing Alpha 6 classmate release payload.
- Produces: a regenerated outer classmate bundle whose guide contains both upgrade-safety instructions while the inner extension artifact remains byte-identical.

- [ ] **Step 1: Open a PR and wait for repository CI**

Push `codex/grad-20-install-guidance`, open a PR referencing GRAD-20, and wait for all required GitHub checks. Expected: CI passes on the exact PR head before merge.

- [ ] **Step 2: Merge and verify the exact main commit**

Squash-merge the PR, fetch `origin/main`, and run `CI=true pnpm verify` from a clean worktree at the merged SHA. Expected: the complete verification suite passes on the exact remote main commit.

- [ ] **Step 3: Refresh only the visible release guide**

Replace the visible release folder's `INSTALL.md` with the merged guide using an atomic temporary-file replacement. Expected: both files are byte-identical and the other three payload files are unchanged.

- [ ] **Step 4: Regenerate and integrity-test the outer bundle**

Create a temporary ZIP containing the `GradPack-classmate-release-0.1.0-alpha.6` directory with only `INSTALL.md`, `TEST_CHECKLIST.md`, `gradpack-0.1.0-alpha.6.zip`, and `gradpack-0.1.0-alpha.6.zip.sha256`; test it with `unzip -t`; then replace the existing outer bundle. Expected: ZIP integrity passes and its checksum changes only because `INSTALL.md` changed.

- [ ] **Step 5: Verify the inner extension artifact remained unchanged**

Run SHA-256 verification against the inner ZIP and sidecar in both the visible folder and regenerated outer bundle. Expected checksum: `34c32e6d4dc984c7daf9abc8ffc4fa61724a1948fa73f2743c99ecf642dca40e` everywhere.

- [ ] **Step 6: Perform live Alpha 6 acceptance**

With the user's approved local Chrome action, remove the stale Alpha 5 unpacked extension, load `/Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.6/extracted-extension`, refresh the signed-in Canvas tab, and archive one accessible course. Expected: Chrome and the generated archive manifest both report `0.1.0-alpha.6`, ZIP integrity passes, and the offline index opens.

- [ ] **Step 7: Record privacy-safe acceptance evidence**

Update GRAD-20 with only coarse version, counts, pass/fail outcomes, checksum, and the remaining independent-classmate gate. Do not include course names, filenames, IDs, URLs, screenshots, archives, page text, request or response data, cookies, headers, or student identity.
