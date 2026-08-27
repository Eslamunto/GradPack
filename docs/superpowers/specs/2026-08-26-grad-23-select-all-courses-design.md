# GRAD-23 Select All Courses Design

- **Status:** Approved
- **Issue:** GRAD-23 — Add Select all control to the course chooser
- **Date:** 2026-08-26

## Problem

GradPack supports selecting and archiving multiple accessible Canvas courses,
but every course must currently be checked individually. Users with many
active, completed, and concluded courses need a clear, accessible way to
select the complete displayed course list without bypassing the existing
planning, packaging, confirmation, or safety steps.

## Goals

- Select every accessible course displayed by the Side Panel in one action.
- Represent none, partial, and complete selection clearly.
- Preserve individual course selection after a bulk action.
- Show the current selected-course count before configuration.
- Reuse the existing explicit course-ID command and archive workflow.
- Preserve native keyboard and assistive-technology behavior.

## Non-Goals

- Filtering, searching, sorting, or grouping the course list.
- Selecting only active courses or excluding concluded courses.
- Starting discovery or retrieval automatically after selection.
- Changing Canvas discovery, permissions, message schemas, packaging policy,
  archive limits, cancellation, partial success, or archive contents.
- Persisting course selections across reconnects or Side Panel sessions.

## Selected Interaction

A native checkbox labeled **Select all courses** appears inside the
**Accessible courses** fieldset before the individual course checkboxes. It
controls every course in the currently displayed list, including active,
completed, and concluded courses.

The checkbox has three derived states:

- unchecked when no course is selected;
- checked when every displayed course is selected; and
- indeterminate when at least one but not every displayed course is selected.

Activating the checkbox while all courses are selected clears the selection.
Activating it while none or only some courses are selected selects every
displayed course. Individual course checkboxes remain fully interactive and
immediately update the master checkbox state.

The chooser shows a plain-text count such as **12 of 12 courses selected**.
The count is present for all selection states, including zero. The existing
**Continue** button remains disabled when the count is zero.

## State and Component Boundaries

The Side Panel reducer gains one focused event, `SELECT_ALL`. The reducer owns
the selection transition:

- if `selectedIds` contains every current course ID, replace it with an empty
  array;
- otherwise replace it with all current course IDs in Canvas display order.

The reducer does not accept an arbitrary ID payload for this event. It derives
the target IDs from the current validated `courses` state, preventing stale or
foreign IDs from entering selection.

The renderer derives `allSelected` and `partiallySelected` from the same
current state. It assigns `checked` and the DOM-only `indeterminate` property
to the native master checkbox on every render. No additional persistent state
is introduced, so the master control cannot drift from individual selections.

The existing `SELECT` event remains unchanged. The existing `CONFIGURE`
transition copies the explicit selected ID array into the configure state.
`START_RUN` therefore continues to send the same validated
`courseIds: number[]` command; the page runner and archive coordinator do not
need a special concept of “all.”

## Data Flow

```text
Canvas course list
  -> validated CourseSummary[]
  -> choose state with empty selectedIds
  -> SELECT_ALL derives every displayed course ID
  -> user may adjust individual checkboxes
  -> configure with explicit selectedIds
  -> existing discovery, review, confirmation, retrieval, and packaging flow
```

Reconnects create a fresh `choose` state with no selection. If Canvas returns
a different course list, no previous ID is retained. Course order remains
exactly the order supplied by the existing validated course list.

## Accessibility and Copy

The bulk control is a native `input[type="checkbox"]` with a stable visible
label. It remains keyboard-operable without custom key handlers. The browser's
native mixed-state semantics represent partial selection when the
`indeterminate` property is true.

The selected-course count is ordinary visible text adjacent to the chooser.
Selection changes already trigger a complete chooser render, so the count and
master state update together. No assertive live region is added because every
checkbox change already has immediate visible and native-control feedback.

All Canvas-provided course names continue to be rendered through `textContent`.
The feature adds no logging, analytics, storage, or new exposure of course
data.

## Safety and Error Handling

Bulk selection changes only which already validated course IDs enter the
existing plan. It does not weaken or skip:

- the requirement for at least one selected course;
- the immutable pre-retrieval plan;
- the explicit packaging choice and review confirmation;
- the 250 MiB per-course hard limit;
- combined archive size and entry limits;
- unknown-size fallback to per-course output;
- cancellation and session-loss behavior; or
- transparent partial-course and resource outcomes.

An empty course list remains the existing blocked state and never renders the
chooser. A selection event outside the `choose` state remains ignored by the
reducer. The master event cannot select a course that is absent from the
current state.

## Testing Strategy

Test-driven coverage will include:

- reducer selection of all courses from an empty selection;
- reducer clearing of all courses from a complete selection;
- reducer replacement of a partial selection with every displayed course;
- preservation of Canvas course order and active/completed/concluded entries;
- rejection or ignoring of `SELECT_ALL` outside the chooser state;
- individual selection continuing to update selected IDs;
- master checkbox checked, unchecked, and indeterminate DOM states;
- visible `0 of N`, partial, and `N of N` selected-course counts;
- native label association and keyboard-operable checkbox markup;
- **Continue** disabled at zero and enabled after bulk selection;
- the existing explicit full course-ID list reaching configuration and the
  unchanged start-run flow; and
- full format, lint, typecheck, unit, integration, and production-build
  verification.

A privacy-safe manual browser smoke test will load the production build,
connect to a signed-in Canvas tab, select all displayed active, completed, and
concluded courses, confirm the count and partial state after deselecting one,
and reach the existing plan review. The test may cancel before retrieval; it
must not record course names, IDs, URLs, screenshots, content, credentials, or
student data.

## Release Identity

The user-test package advances from `0.1.0-alpha.4` to `0.1.0-alpha.5` so the
bulk-selection build is distinguishable and immutable. Source version
metadata, generated extension metadata, packaging validation, installation
instructions, test checklist, and release-contract tests advance together.
Earlier Alpha packages and validation folders remain unchanged.

## Acceptance Criteria

- One action selects every displayed active, completed, and concluded course.
- One action clears a complete selection.
- Partial selection produces a native indeterminate master checkbox.
- Individual course checkboxes remain usable after a bulk action.
- The selected count updates immediately and **Continue** remains disabled at
  zero.
- Bulk selection reaches the unchanged configuration, plan review, and
  confirmation workflow without starting retrieval automatically.
- No permissions, Canvas endpoints, protocol fields, archive fields, privacy
  boundaries, or safety limits change.
- Focused tests, the full verification suite, package integrity checks, and a
  privacy-safe browser smoke test pass.
