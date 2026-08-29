# GradPack Trust Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a warm, factual trust card before course retrieval and matching privacy-and-responsible-use guidance to the pilot installation guide.

**Architecture:** Keep the change presentation-only. A focused `trustCard()` DOM builder owns the approved student-facing copy, the existing `notices()` builder retains only operational guidance, and the installation guide repeats the approved wording. Existing Side Panel and release-surface tests lock the copy, placement, non-duplication, and unchanged permission boundary.

**Tech Stack:** TypeScript, DOM APIs, CSS, Vitest with jsdom, Markdown, Chrome Manifest V3, pnpm 11.17.0.

## Global Constraints

- Use the exact approved heading: `Your courses stay with you`.
- Use the exact approved trust statement: `GradPack works only with Frankfurt School Canvas and uses the session already open in your browser. Everything is processed locally—there is no telemetry, backend, or cloud upload. Your archives are saved only to your computer.`
- Use the exact approved responsible-use statement: `For personal study: Please keep downloaded course materials for your own use and do not redistribute them.`
- Show the trust card in the course-selection and archive-configuration views before discovery or retrieval.
- Keep the card informational: no checkbox, dismissal control, link, consent state, or focus target.
- Preserve operational notices about archive limits, the signed-in Canvas tab, and unavailable resources.
- Do not change Chrome permissions, host access, Canvas session handling, discovery, retrieval, archive contents, manifests, downloads, telemetry, persistence, backend, or cloud behavior.
- Keep the notice English-only and specific to the Frankfurt School classmate pilot.
- Keep the Side Panel legible at its existing 280 px minimum width and avoid icon-only meaning.

---

## File Structure

- `src/sidepanel/main.ts` — builds the semantic trust card, removes superseded notice-list copy, and places the card in the choose/configure views.
- `src/static/sidepanel.css` — extends the existing white-card language with restrained trust-card spacing and responsible-use separation.
- `tests/sidepanel/main.test.ts` — locks exact copy, placement, single-card rendering, and removal of the old generic notice.
- `docs/pilot/INSTALL.md` — presents the same approved message before checksum verification and consolidates duplicate local-processing bullets.
- `tests/build/release-files.test.ts` — locks the public installation guidance to the approved trust and responsible-use meaning.
- `src/manifest.json` — read-only verification target; it must not change.

---

### Task 1: Render the student trust card in the Side Panel

**Files:**
- Modify: `tests/sidepanel/main.test.ts:75-170`
- Modify: `src/sidepanel/main.ts:61-79,132-230`
- Modify: `src/static/sidepanel.css:42-77`
- Verify unchanged: `src/manifest.json`

**Interfaces:**
- Consumes: existing `paragraph(text: string, className?: string): HTMLParagraphElement` and the `choose` / `configure` branches of `render()`.
- Produces: private `trustCard(): HTMLElement` that returns one semantic `section.trust-card` containing an `h2`, trust paragraph, and `p.responsible-use`.

- [ ] **Step 1: Add failing Side Panel assertions**

In `tests/sidepanel/main.test.ts`, immediately after the existing `Choose courses` heading assertion, add:

```ts
    const chooseTrustCard = document.querySelector(".trust-card");
    expect(chooseTrustCard).toBeInstanceOf(HTMLElement);
    expect(chooseTrustCard?.querySelector("h2")?.textContent).toBe(
      "Your courses stay with you",
    );
    expect(chooseTrustCard?.textContent).toContain(
      "GradPack works only with Frankfurt School Canvas and uses the session already open in your browser.",
    );
    expect(chooseTrustCard?.textContent).toContain(
      "Everything is processed locally—there is no telemetry, backend, or cloud upload.",
    );
    expect(chooseTrustCard?.textContent).toContain(
      "Your archives are saved only to your computer.",
    );
    expect(chooseTrustCard?.querySelector(".responsible-use")?.textContent).toBe(
      "For personal study: Please keep downloaded course materials for your own use and do not redistribute them.",
    );
    expect(document.querySelectorAll(".trust-card")).toHaveLength(1);
```

Immediately after the existing `Configure archives` heading assertion, add:

```ts
    expect(document.querySelectorAll(".trust-card")).toHaveLength(1);
    expect(document.querySelector(".trust-card h2")?.textContent).toBe(
      "Your courses stay with you",
    );
    expect(document.body.textContent).not.toContain(
      "Everything is processed locally. GradPack has no storage, analytics, or backend.",
    );
    expect(document.body.textContent).not.toContain(
      "You are responsible for applicable copyright, licensing, confidentiality, and course-material restrictions.",
    );
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
CI=true pnpm exec vitest run tests/sidepanel/main.test.ts
```

Expected: FAIL because `.trust-card` is absent and the old generic notice remains.

- [ ] **Step 3: Add the semantic trust-card builder**

In `src/sidepanel/main.ts`, immediately before `notices()`, add:

```ts
const trustCard = (): HTMLElement => {
  const section = document.createElement("section");
  section.className = "trust-card";

  const heading = document.createElement("h2");
  heading.textContent = "Your courses stay with you";

  const trust = paragraph(
    "GradPack works only with Frankfurt School Canvas and uses the session already open in your browser. Everything is processed locally—there is no telemetry, backend, or cloud upload. Your archives are saved only to your computer.",
  );

  const responsibleUse = paragraph(
    "Please keep downloaded course materials for your own use and do not redistribute them.",
    "responsible-use",
  );
  const label = document.createElement("strong");
  label.textContent = "For personal study: ";
  responsibleUse.prepend(label);

  section.append(heading, trust, responsibleUse);
  return section;
};
```

In the `notices()` string array, remove these two superseded items:

```ts
    "Everything is processed locally. GradPack has no storage, analytics, or backend.",
    "You are responsible for applicable copyright, licensing, confidentiality, and course-material restrictions.",
```

Do not change the remaining archive-limit, signed-in-tab, or resource-availability items.

- [ ] **Step 4: Place exactly one card in each approved view**

In the `choose` branch, add `trustCard()` after the introductory paragraph and before `fieldset`:

```ts
    body.append(
      paragraph("Select one or more accessible courses."),
      trustCard(),
      fieldset,
```

In the `configure` branch, add `trustCard()` after the selected-course count and before the packaging fieldset:

```ts
    body.append(
      paragraph(`${state.selectedIds.length} course(s) selected.`),
      trustCard(),
      fieldset,
      notices(),
```

Do not add a trust card to progress, completion, stopped, or retry-only views.

- [ ] **Step 5: Style the trust card within the existing visual language**

In `src/static/sidepanel.css`, add `.trust-card` to the white-card border group and the padded-card group:

```css
fieldset,
.notices,
.trust-card,
.selected-course,
```

```css
fieldset,
.notices,
.trust-card {
  padding: 1rem;
}
```

Then add:

```css
.trust-card h2 {
  margin-block: 0 0.5rem;
}

.trust-card p {
  margin-block: 0.5rem 0;
}

.trust-card .responsible-use {
  border-top: 1px solid #d9dcec;
  padding-top: 0.75rem;
  color: #3f4d72;
}
```

- [ ] **Step 6: Run the focused Side Panel checks**

Run:

```bash
CI=true pnpm exec vitest run tests/sidepanel/main.test.ts tests/sidepanel/state.test.ts
pnpm exec prettier --check src/sidepanel/main.ts src/static/sidepanel.css tests/sidepanel/main.test.ts
git diff --exit-code origin/main -- src/manifest.json
```

Expected: both test files PASS, Prettier reports all three files formatted, and the manifest diff command produces no output.

- [ ] **Step 7: Commit the Side Panel trust card**

```bash
git add src/sidepanel/main.ts src/static/sidepanel.css tests/sidepanel/main.test.ts
git commit -m "feat: add student trust summary"
```

---

### Task 2: Align the pilot installation guidance

**Files:**
- Modify: `tests/build/release-files.test.ts:30-82`
- Modify: `docs/pilot/INSTALL.md:6-34`

**Interfaces:**
- Consumes: the exact approved copy from `docs/superpowers/specs/2026-08-29-gradpack-trust-summary-design.md`.
- Produces: public `Privacy and responsible use` installation section with the same trust and personal-use meaning as the Side Panel.

- [ ] **Step 1: Add failing release-guidance assertions**

In the `keeps the package command and public guidance within pilot policy` test, immediately after reading `install`, add:

```ts
    const normalizedInstall = install.replace(/\s+/gu, " ");
```

After the existing installation-token loop, add:

```ts
    expect(install).toContain("## Privacy and responsible use");
    expect(normalizedInstall).toContain(
      "GradPack works only with Frankfurt School Canvas and uses the session already open in your browser. Everything is processed locally—there is no telemetry, backend, or cloud upload. Your archives are saved only to your computer.",
    );
    expect(normalizedInstall).toContain(
      "**For personal study:** Please keep downloaded course materials for your own use and do not redistribute them.",
    );
```

- [ ] **Step 2: Run the release-surface test and verify the red state**

Run:

```bash
CI=true pnpm exec vitest run tests/build/release-files.test.ts
```

Expected: FAIL because `INSTALL.md` does not yet have the new section or approved copy.

- [ ] **Step 3: Add the matching installation-guide section**

In `docs/pilot/INSTALL.md`, remove this duplicate bullet from `Before installing`:

```markdown
- GradPack saves the resulting course archive locally. It has no analytics,
  telemetry, backend, or cloud upload.
```

Shorten the final `Before installing` bullet to avoid repeating the new trust statement:

```markdown
- These behaviors require no additional permission or origin.
```

Immediately before `## Verify the checksum`, add:

```markdown
## Privacy and responsible use

GradPack works only with Frankfurt School Canvas and uses the session already
open in your browser. Everything is processed locally—there is no telemetry,
backend, or cloud upload. Your archives are saved only to your computer.

**For personal study:** Please keep downloaded course materials for your own
use and do not redistribute them.
```

- [ ] **Step 4: Run the documentation contract checks**

Run:

```bash
CI=true pnpm exec vitest run tests/build/release-files.test.ts tests/release/version-contract.test.ts
pnpm exec prettier --check docs/pilot/INSTALL.md tests/build/release-files.test.ts
```

Expected: both test files PASS and Prettier reports both modified files formatted.

- [ ] **Step 5: Commit the installation guidance**

```bash
git add docs/pilot/INSTALL.md tests/build/release-files.test.ts
git commit -m "docs: add privacy and responsible use guidance"
```

---

### Task 3: Verify the complete presentation-only change

**Files:**
- Verify: `src/sidepanel/main.ts`
- Verify: `src/static/sidepanel.css`
- Verify: `docs/pilot/INSTALL.md`
- Verify unchanged: `src/manifest.json`

**Interfaces:**
- Consumes: completed Side Panel and installation-guide changes from Tasks 1 and 2.
- Produces: fresh automated evidence and a manual narrow-width acceptance result; no source interface.

- [ ] **Step 1: Run the full repository gate**

Run:

```bash
CI=true pnpm verify
```

Expected: formatting, ESLint, TypeScript, all Vitest tests, and `node scripts/build.mjs` complete with exit code 0.

- [ ] **Step 2: Confirm the permission and behavior boundary stayed unchanged**

Run:

```bash
git diff --exit-code origin/main -- src/manifest.json src/shared/messages.ts src/shared/model.ts src/page src/canvas src/archive
```

Expected: no output and exit code 0.

- [ ] **Step 3: Inspect the final diff for exact copy and scope**

Run:

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: no whitespace errors; the diff is limited to the design/plan documents, Side Panel presentation and tests, installation guide, and release-guidance test; commit history contains the design, Side Panel, and documentation commits.

- [ ] **Step 4: Perform the manual Side Panel acceptance**

Build and load the worktree's `dist/` folder as an unpacked extension. At the Side Panel's narrow width, verify:

1. `Your courses stay with you` appears once on `Choose courses`.
2. The exact trust and personal-use meaning remains easy to scan without horizontal scrolling.
3. After selecting courses and continuing, the card appears once on `Configure archives`.
4. Operational notices and primary buttons remain visually clear.
5. The trust card introduces no checkbox, link, dismissal control, or focus stop.

Expected: all five checks pass without exposing or recording course names, IDs, URLs, screenshots, or archive contents.

- [ ] **Step 5: Record the final verification state**

Run:

```bash
git status --short
```

Expected: empty output. If the manual check requires a copy or style correction, return to the relevant task, add or update the focused regression assertion first, make the minimal fix, rerun `CI=true pnpm verify`, and commit the correction before reporting completion.
