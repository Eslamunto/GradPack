# GRAD-23 Disabled Modules Fallback Design

- **Status:** Draft for review
- **Issue:** GRAD-23 follow-up — archive courses when Modules are disabled
- **Date:** 2026-08-27

## Problem

Some otherwise accessible Canvas courses have the Modules area disabled. Canvas
returns the exact JSON response
`{"message":"That page has been disabled for this course"}` for the initial
course Modules request instead of returning a module array.

GradPack currently treats that non-array response as malformed metadata. The
resulting `TypeError` is classified as `safety-validation`, so the course is
skipped even when its Pages, Files, and Folders collections remain accessible.
This is not caused by the 250 MiB archive limit.

## Goals

- Archive every accessible page and file when a course's Modules area is
  explicitly disabled by Canvas.
- Avoid module-item requests after Canvas has reported that Modules are
  disabled.
- Tell the user before retrieval and inside the offline archive that module
  navigation was unavailable and that accessible pages and files were archived
  instead.
- Preserve strict validation for every other response, URL, identifier, size,
  and archive path.
- Preserve the existing per-course and combined ZIP safety limits.

## Non-Goals

- Bypassing Canvas permissions or retrieving inaccessible content.
- Removing all Canvas API usage. GradPack still needs the signed-in,
  same-origin course collection endpoints to discover downloadable material.
- Probing a separate Canvas UI page before discovery. That would add another
  request without eliminating the need to validate collection responses.
- Treating arbitrary Modules failures, malformed JSON, empty bodies, redirects,
  authentication failures, or unexpected error messages as a disabled course.
- Reconstructing instructor-authored module ordering when Canvas does not expose
  it.
- Changing the 250 MiB per-course limit, resource limit, ZIP format, or
  all-courses best-effort behavior.

## Selected Approach

Treat the exact Canvas disabled response on the initial Modules collection
request as a typed, non-fatal discovery state. Continue discovery through the
existing Pages, Files, and Folders collection requests. Do not issue any
module-item requests for that course.

The course remains ready when the remaining discovered material produces a
valid plan. Its plan and manifest record `moduleDiscovery: "disabled"`.
Ordinary courses record `moduleDiscovery: "available"` and retain the current
module-driven behavior.

This approach preserves one-click coverage without weakening a trust boundary:
only one exact, already observed Canvas response activates the fallback.

## Architecture and Data Flow

### Exact disabled-response classification

The HTTP boundary will recognize the disabled state only when all of the
following are true:

- the request is the initial request for the expected course Modules collection;
- the final response remains on the exact approved Canvas origin and expected
  Modules path;
- the body is JSON within the existing metadata size bound;
- the parsed value is a plain record with exactly one own data property named
  `message`; and
- that property's value is exactly
  `That page has been disabled for this course`.

The helper that validates this conservative Canvas shape will be shared with
the existing optional Pages handling rather than duplicated under a
Pages-specific name.

The HTTP layer will surface a dedicated typed condition for an unavailable
course collection. Discovery will convert that condition to the disabled
Modules state only for the Modules endpoint. It will not convert session loss,
body-size errors, transient failures after retry, malformed successful
responses, or other response bodies.

### Course discovery

Discovery starts with the existing Modules collection request because that
response determines whether module topology is available. This is the only
Modules request made in the disabled path.

When Modules are available, behavior is unchanged:

1. Validate and normalize modules and embedded items.
2. Resolve module-linked pages and files.
3. Enrich the plan from accessible Pages, Files, and Folders indexes.
4. Preserve module ordering and references in the archive.

When Modules are disabled:

1. Record `moduleDiscovery: "disabled"` and use an empty validated module list.
2. Do not request module-item endpoints.
3. Request the accessible Pages, Files, and Folders indexes through the existing
   bounded, same-origin HTTP client.
4. Validate and normalize all returned records exactly as ordinary discovery
   does.
5. Build page and file resources from those indexes, including the existing
   page-linked-file discovery behavior.
6. Calculate advertised bytes, unknown-size counts, resource counts, and
   archive limits only from material actually discovered.

An empty Pages or Files collection is valid. If every accessible collection is
empty, the course may still produce an empty, accurately labelled archive; the
notice must not imply that material was found.

### Typed model

Add a closed type:

```ts
type ModuleDiscovery = "available" | "disabled";
```

Add `moduleDiscovery` to:

- `CoursePlan`, so retrieval and archive generation retain the state;
- `CoursePlanSummary`, so the Side Panel review can display it; and
- `ArchiveManifest`, so the offline archive and technical manifest accurately
  describe how the course was discovered.

All message and archive validators must require exactly one of the two values.
The value is cloned, frozen, normalized, and compared wherever the surrounding
plan or manifest is cloned, frozen, normalized, or verified.

`PlanFallbackReason` is not used for this state. It describes a change in ZIP
packaging, while disabled Modules describes content discovery for one course.

### Review experience

On the review screen, a ready course with disabled Modules remains in **Ready
courses** and carries the fixed detail:

> Module navigation is unavailable; GradPack will archive accessible pages and
> files instead.

It is not listed under **Skipped courses** and does not use the
`safety-validation` category. Counts and byte totals shown on the review screen
include only resources actually discovered through Pages and Files.

The notice is per-course so mixed all-course runs remain unambiguous. No raw
Canvas response, exception text, URL, identifier, or course content is exposed
in the Side Panel message.

### Offline archive experience

For a disabled-Modules course:

- `manifest.json` contains `moduleDiscovery: "disabled"`;
- `index.html` states that module navigation was unavailable and accessible
  pages and files were archived instead;
- `modules.html` displays the same explanation rather than the misleading
  generic text `No modules were listed.`; and
- `status.html` repeats the limitation near the resource outcomes.

The Pages and Files navigation remains available. Combined archives retain the
same per-course state in each nested course manifest and may label a course as
having unavailable module navigation instead of presenting zero modules as a
complete module inventory.

For ordinary courses, `moduleDiscovery: "available"` is recorded and all
existing copy and navigation remain unchanged.

## Error Handling and Safety

The disabled fallback is narrow and fail-closed:

- a 401 or detected sign-in response remains a run-wide session failure;
- a foreign origin, unexpected redirect, or mismatched course path remains
  rejected;
- malformed JSON, an unexpected object shape, extra properties, or different
  message text remains a safety-validation failure for that course;
- a body exceeding the metadata cap remains rejected;
- malformed Pages, Files, Folders, page bodies, or file metadata still fail
  under their existing rules;
- unavailable individual resources remain visible through their existing
  outcome statuses; and
- advertised-byte, streamed-byte, resource-count, and ZIP-entry limits remain
  unchanged.

No telemetry, backend, credential storage, persistent diagnostic body, or new
Canvas permission is introduced.

## Testing Strategy

Implementation will be test-driven with synthetic course data only.

Focused HTTP and discovery tests will verify:

- the exact disabled Modules response is recognized only on the initial
  expected Modules collection request;
- the same message on an unrelated endpoint is not reclassified;
- extra keys, inherited/accessor properties, alternate text, malformed JSON,
  oversized bodies, redirects, and foreign origins remain rejected;
- a disabled course makes zero module-item requests;
- discovery continues through Pages, Files, and Folders;
- page-linked files are still included;
- empty accessible indexes create an accurate empty plan; and
- ordinary module-enabled discovery is unchanged.

Model, protocol, and archive tests will verify:

- `moduleDiscovery` is required and accepts only `available` or `disabled`;
- cloning, freezing, message parsing, snapshotting, manifest normalization, and
  deterministic ZIP verification preserve the value;
- review-plan messages carry the correct per-course state;
- manifest totals match only discovered resources; and
- combined archives preserve each nested course's state.

UI and integration tests will verify:

- the review screen shows the fixed notice beside each affected ready course;
- affected courses are not shown as skipped;
- `index.html`, `modules.html`, and `status.html` display the limitation;
- Pages and Files remain navigable offline; and
- a mixed run containing module-enabled and module-disabled courses completes
  without regressing packaging fallback, progress, retry, or completion logic.

Verification requires:

- focused unit and integration tests;
- `CI=true pnpm verify`;
- production build and release-contract checks;
- deterministic ZIP integrity and manifest checks; and
- a fresh live Chrome acceptance test against one signed-in course whose
  Modules area is disabled, confirming that accessible pages and files appear
  in the resulting offline archive.

Live acceptance evidence must remain privacy-safe. Real course names, IDs,
URLs, filenames, and content observed during testing are not copied into source
control, Linear, pull requests, or release notes.

## Acceptance Criteria

- The exact disabled Modules response no longer produces
  `safety-validation`.
- GradPack makes no module-item requests after that response.
- Every safely discoverable page and file is included in planning and
  retrieval.
- The affected course remains ready unless another existing safety or Canvas
  failure prevents a valid plan.
- Review, offline HTML, and `manifest.json` clearly report unavailable module
  navigation.
- Totals, limits, outcomes, and packaging decisions use only actually
  discovered resources.
- Unexpected or unsafe responses remain fail-closed.
- Module-enabled courses behave as before.
- The full automated verification suite passes, followed by a fresh live
  signed-in acceptance test before release.
