# GradPack Medium Article Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a polished, Medium-ready personal essay explaining how a repetitive MBA coursework problem became GradPack through iterative collaboration with Codex.

**Architecture:** Create one self-contained Markdown article following the approved problem-to-product narrative. Ground product claims in the repository and Alpha 7 pilot bundle, distinguish current capabilities from future plans, and finish with a reusable problem-framing exercise for non-technical readers.

**Tech Stack:** Markdown, GradPack repository documentation, Alpha 7 classmate-pilot documentation, Git history, and plain-language editorial review.

## Global Constraints

- Write for non-technical professionals and students in a first-person, conversational voice.
- Treat Codex as a collaborator and accelerator, not an autonomous inventor or one-prompt solution.
- Describe only course materials already available to the student's signed-in Canvas session.
- State that processing is local and that the current pilot has no telemetry, backend, or cloud upload.
- Describe GradPack as an alpha classmate pilot that is not yet in the Chrome Web Store.
- Present GradPack as an Apache 2.0 open-source project and link to `https://github.com/Eslamunto/GradPack`.
- Treat public GitHub visibility as a publication prerequisite: the article must not be published while the repository remains private.
- Present Chrome Web Store publication and broader Canvas compatibility as future steps.
- Keep the main call to action focused on helping readers frame a repetitive problem of their own.
- Target a Medium reading time of approximately six to eight minutes.

---

### Task 1: Create the complete article draft

**Files:**

- Create: `docs/blog/gradpack-codex-medium-draft.md`
- Reference: `docs/superpowers/specs/2026-08-30-gradpack-medium-article-design.md`
- Reference: `README.md`
- Reference: `GradPack-classmate-release-0.1.0-alpha.7/INSTALL.md`
- Reference: `GradPack-classmate-release-0.1.0-alpha.7/SHARE_WITH_CLASSMATES.md`
- Reference: `GradPack-classmate-release-0.1.0-alpha.7/WATCH_FIRST.md`

**Interfaces:**

- Consumes: the approved title, subtitle, narrative arc, voice, trust boundaries, and call to action from the article design.
- Produces: one publication-ready Markdown article containing the headline, subtitle, complete body, section headings, and closing exercise.

- [ ] **Step 1: Write the opening and problem statement**

  Open near the end of the MBA with the author facing course materials spread across Canvas. Make the manual alternative concrete: opening courses, locating modules and pages, following links, downloading files, and trying to preserve a useful structure.

- [ ] **Step 2: Explain how the problem was framed for Codex**

  Define the desired outcome and boundaries in plain language: use the existing signed-in Canvas session, collect only accessible material, preserve it locally, avoid a backend or cloud upload, and produce archives that remain useful after extraction.

- [ ] **Step 3: Tell the iterative building story**

  Describe the work as a sequence of conversations, decisions, implementation, tests, and real Canvas discoveries. Include the move from a narrow course pilot to selecting multiple courses, choosing combined or per-course archives, reviewing the plan before retrieval, recording unavailable resources transparently, and retrying unfinished courses.

- [ ] **Step 4: Explain the open-source decision accurately**

  State that GradPack is an open-source project licensed under Apache 2.0 and link to `https://github.com/Eslamunto/GradPack`. Do not say that the repository is private inside the publication draft; instead, retain a separate publication gate requiring its visibility to be changed before the Medium article goes live.

- [ ] **Step 5: Cover usability for non-technical classmates**

  Explain why working software was insufficient if classmates could not install it. Describe the privacy-safe installation walkthroughs, including a short quick-start, a detailed guide, captions, written instructions, and recreated screens containing no real student or course data.

- [ ] **Step 6: State the present status and future direction**

  Identify the current product as an unpacked alpha pilot for Frankfurt School students using Canvas. Present a Chrome Web Store release, a smoother installation experience, pilot feedback, and careful exploration of broader Canvas support as future work.

- [ ] **Step 7: End with the reusable reader framework**

  Close with five questions: what repeatedly frustrates me, what outcome do I want, what must the solution protect or avoid, what is the smallest useful version, and how will I test it in reality. Invite the reader to bring that framed problem to Codex.

### Task 2: Verify factual accuracy and editorial quality

**Files:**

- Modify: `docs/blog/gradpack-codex-medium-draft.md`
- Reference: `README.md`
- Reference: `LICENSE`
- Reference: `GradPack-classmate-release-0.1.0-alpha.7/INSTALL.md`
- Reference: `GradPack-classmate-release-0.1.0-alpha.7/SHARE_WITH_CLASSMATES.md`

**Interfaces:**

- Consumes: the complete article from Task 1 and the current project evidence.
- Produces: a tightened article with every current-state and future-state claim clearly distinguished.

- [ ] **Step 1: Audit current and future claims**

  Search the article for `open source`, `Chrome Web Store`, `Canvas`, `Frankfurt School`, `local`, `telemetry`, `backend`, and `cloud`. Compare every occurrence against the reference files and revise any unsupported implication. Separately confirm that the repository is public before publication.

- [ ] **Step 2: Audit the portrayal of Codex**

  Remove language implying that Codex independently invented or completed the product. Preserve the author's role in identifying the problem, setting constraints, choosing trade-offs, and validating the result.

- [ ] **Step 3: Perform the non-technical readability edit**

  Replace unexplained implementation jargon, shorten dense paragraphs, vary sentence length, and ensure every technical detail advances the personal story.

- [ ] **Step 4: Check structure and length**

  Confirm that the headline and subtitle match the approved design, all eight narrative beats are present, and the article remains within approximately 1,200 to 1,700 words.

- [ ] **Step 5: Run mechanical checks**

  Run: `rg -n "TBD|TODO|FIXME|available on the Chrome Web Store" docs/blog/gradpack-codex-medium-draft.md`

  Expected: no placeholders and no claim that GradPack is currently available on the Chrome Web Store.

  Run: `gh repo view Eslamunto/GradPack --json visibility,url`

  Expected before Medium publication: `visibility` is `PUBLIC` and the URL is `https://github.com/Eslamunto/GradPack`. A `PRIVATE` result blocks publication but does not block drafting.

  Run: `git diff --check -- docs/blog/gradpack-codex-medium-draft.md`

  Expected: no whitespace errors.

- [ ] **Step 6: Commit the article draft**

  ```bash
  git add docs/blog/gradpack-codex-medium-draft.md
  git commit -m "docs: draft GradPack Codex Medium article"
  ```
