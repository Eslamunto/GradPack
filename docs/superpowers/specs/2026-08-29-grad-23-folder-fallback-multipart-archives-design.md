# GRAD-23 Folder Recovery and Multipart Archives Design

- **Status:** Design approved; written review pending
- **Issue:** GRAD-23 follow-up — recover incomplete folder metadata and package
  oversized courses
- **Date:** 2026-08-29

## Problem

Live Download all testing exposed two different reasons why otherwise visible
courses can still be skipped:

- six courses returned valid file records whose `folder_id` was absent from the
  course's folder index, causing GradPack to throw `Missing folder metadata`;
  and
- one course advertised more than the existing 250 MiB per-archive safety
  limit.

Canvas can legitimately return an incomplete or unavailable folder index even
when each referenced file has valid, same-course metadata and an exact-origin
download URL. A missing display folder is therefore not sufficient reason to
discard the whole course. At the same time, removing the archive limit would
increase browser memory and ZIP-format risk. The complete solution needs both
a narrow folder-path fallback and bounded multipart packaging.

The repository and release evidence must remain synthetic and privacy-safe.
Real course names, identifiers, URLs, filenames, and content observed during
live diagnosis are not copied into source control.

## Goals

- Keep a course ready when an otherwise valid file references a folder that is
  absent from a valid folder index.
- Put affected files in a deterministic `files/unfiled/` location and disclose
  the fallback before retrieval and inside every relevant offline archive.
- Download courses larger than 250 MiB as deterministic, self-contained ZIP
  parts while preserving the 250 MiB limit for every individual ZIP.
- Keep module, page, and file navigation understandable when material is stored
  in another part.
- Retrieve, build, hand off, and clear one part at a time so browser memory use
  remains bounded.
- Preserve completed parts if a later part or course has a local failure.
- Give a precise unavailable outcome when one individual resource cannot fit
  inside a safe part.
- Preserve all existing origin, identifier, response, path, resource-count,
  entry-count, cancellation, navigation, and session safety checks.

## Non-Goals

- Raising or removing the 250 MiB `MAX_ARCHIVE_BYTES` limit.
- Producing one ZIP whose payload exceeds that limit.
- Producing one extracted website spanning multiple ZIPs. Each part is an
  independently viewable offline archive.
- Bypassing Canvas authorization or retrieving inaccessible material.
- Trusting malformed folder records, malformed file records, mismatched IDs,
  unsafe paths, redirects, or foreign-origin URLs.
- Adding a backend, filesystem permission, cloud storage, telemetry,
  credentials, or persistent diagnostic data.
- Automatically merging the parts after download.

## Selected Approach

Use two independent, composable recovery mechanisms:

1. **Safe folder fallback:** retain strict file validation, but map a file to
   `files/unfiled/` when its referenced folder cannot be resolved from the
   optional folder index.
2. **Self-contained multipart ZIPs:** partition one validated course plan into
   deterministic part plans. Every part carries the course shell, manifest,
   navigation, status, complete resource-to-part catalog, and only the local
   payload assigned to that part.

The alternatives were rejected as follows:

- keeping fail-closed behavior for absent folder references loses files whose
  own metadata has already passed every material trust check;
- flattening every course's folders discards useful valid organization;
- raising the archive limit makes memory safety device-dependent;
- creating one non-self-contained site split across ZIPs leaves broken local
  links after ordinary extraction; and
- silently dropping an individually oversized file misrepresents archive
  completeness.

## Invariants and Trust Boundaries

The feature changes organization and packaging, not trust.

- Every Canvas request remains HTTPS, exact-origin, credentialed, read-only,
  bounded, and tied to the selected course and resource identifier.
- File ID, filename, advertised size, source URL, and generated archive path
  retain their existing validation.
- A missing folder relationship is recoverable only after the file itself has
  passed those checks.
- A present folder record that is malformed, conflicting, cyclic, or unsafe
  remains a course-level safety failure.
- Each part independently enforces `MAX_ARCHIVE_BYTES`,
  `MAX_ARCHIVE_RESOURCES`, and the classic ZIP entry limit.
- Aggregate course size may exceed `MAX_ARCHIVE_BYTES`; no individual part may
  exceed it.
- Deterministic ordering and names do not depend on request completion timing.
- Cancellation, Canvas navigation, session loss, and protocol corruption
  remain run-wide terminal outcomes.

## Folder-Path Recovery

### Discovery behavior

Folder normalization continues to validate every returned folder record before
file paths are assigned. For each validated file:

1. Use its validated folder hierarchy when `folder_id` resolves to a complete,
   safe folder path.
2. Otherwise assign the file beneath `files/unfiled/` when the folder index is
   unavailable or the specific referenced folder is absent.
3. Run the existing deterministic path allocator after choosing the directory,
   including suffix-based collision resolution for duplicate sanitized names.

An unavailable complete folder index and a partial index therefore have the
same narrow effect on affected files. Valid folder paths for other files remain
unchanged.

The fallback does not apply when the folder collection successfully returns a
malformed record, duplicate conflict, unsafe path component, invalid parent
relationship, or cycle. Those responses have crossed a metadata trust boundary
and remain fail-closed.

### Typed disclosure

Add an immutable `folderPathFallbackKeys: string[]` field to `CoursePlan`. It
contains the unique canonical resource keys of files assigned to
`files/unfiled/`, in the same deterministic order as `resources`.

Add `folderPathFallbackCount` to `CoursePlanSummary` and the course-level
manifest metadata. Validators must ensure that:

- every key exists exactly once in the plan;
- every referenced resource is a file beneath `files/unfiled/`;
- no key is duplicated;
- the summary count matches the plan; and
- the manifest count matches its complete course resource catalog.

The review screen shows a fixed per-course notice and count. Each archive's
index and status pages explain that these files were safely downloaded but
their Canvas folder location was unavailable. No raw exception text is shown.

## Multipart Planning

### Part model

Introduce an immutable `CourseArchivePartPlan` containing:

- the validated course plan;
- one-based `index` and `total` values;
- the ordered resource keys whose payload or outcome belongs to this part; and
- the complete deterministic map from every course resource key to its part
  index.

Every resource is assigned to exactly one part. Empty courses still produce one
part. External and unsupported entries are assigned to part 1 because they do
not add downloadable payload. A normal course that fits the existing limits
produces one part and retains the current filename and user experience.

`CoursePlanSummary` adds `archivePartCount`. The review screen reports expected
part counts before retrieval. The value is recalculated and validated from the
immutable plan rather than trusted from UI input.

### Deterministic resource weights

Partitioning uses canonical plan resource order and conservative weights:

- a known-size file uses its validated advertised byte count;
- a page uses a new `MAX_ARCHIVED_PAGE_BYTES` bound derived from the existing
  Canvas response limit, worst-case sanitizer expansion, and fixed-wrapper
  overhead;
- an external or unsupported item uses zero payload bytes; and
- an unknown-size file is isolated in its own part.

Known-size files and pages are assigned with deterministic next-fit packing: add
items to the current part until the next item's conservative weight or resource
entry would cross a hard limit, then open the next part. The algorithm does not
reorder resources to optimize bin utilization. This makes part membership
stable and reviewable.

The runtime still measures actual successful payload bytes and validates the
finished ZIP. Conservative planning never replaces the existing runtime caps.
The page pipeline must reject any rendered page that exceeds
`MAX_ARCHIVED_PAGE_BYTES`, making the planning weight an enforced bound rather
than an estimate.

The existing aggregate course-size rejection is replaced by checked aggregate
arithmetic plus partition validation. Invalid or overflowing advertised sizes
still fail closed. An aggregate above `MAX_ARCHIVE_BYTES` is safe only when the
partitioner proves that every resulting part stays within all per-part limits.

### Unknown and individually oversized files

An unknown-size file receives a dedicated part. Retrieval receives the full
existing per-part byte allowance and streams under that hard cap. If the stream
crosses the limit, the file receives the fixed `individual-size-limit` outcome
and the part is still built as an explanatory archive without that payload.

A known-size file whose advertised bytes alone exceed `MAX_ARCHIVE_BYTES` also
receives a dedicated outcome-only part. GradPack does not start its payload
request. The resource remains in navigation and the manifest with the
`individual-size-limit` outcome.

This condition is resource-local. It does not skip the course, stop later
parts, or use the generic course safety message. It may make the course
completion partial.

## Manifest and Offline Archive Contract

Each part is a complete GradPack archive with the existing core files. Extend
`ArchiveManifest` with:

- `part: { index: number; total: number }`;
- course-level advertised bytes, resource count, unknown-size count, and
  `folderPathFallbackCount`; and
- a `resourceCatalog` containing every course resource's key, kind, title,
  assigned part index, and folder-fallback flag.

The existing manifest `resources` collection contains only the resources
assigned to that part and their local outcomes. The catalog is metadata only:
it contains no source URL, response body, credentials, or content. Validators
require complete one-to-one agreement between the plan map and catalog, and
between this part's catalog assignments and local resource outcomes.

Module and resource navigation uses the local outcomes first. When a referenced
resource belongs to another part, it is shown without a hyperlink and with the
fixed label `Available in Part N`. The archive never creates a broken relative
link to another extracted ZIP.

Each part's `index.html`, `modules.html`, and `status.html` visibly state
`Part N of M`. Status distinguishes:

- resources saved in this part;
- resources available in another part;
- unavailable, failed, external, or unsupported resources assigned here; and
- files using the unfiled-folder fallback.

Part totals describe the current ZIP, while course totals describe the complete
catalog. The two sets of values are named separately and validated so the UI
cannot imply that one part contains the whole course.

Multipart filenames are deterministic and filesystem-safe:

```text
gradpack-<course-slug>-part-01-of-03.zip
gradpack-<course-slug>-part-02-of-03.zip
gradpack-<course-slug>-part-03-of-03.zip
```

Part numbers are zero-padded to at least two digits and to the width of the
total when greater. Single-part courses keep the existing non-part filename.

## Orchestration and Packaging Choice

Discovery determines all course part plans before the review confirmation. No
content retrieval occurs during partitioning.

If any ready course requires multiple parts, requested combined packaging is
changed to per-course parts with the new fixed fallback reason
`multipart-course`. The review screen explains the effective packaging and
total number of ZIP downloads. A combined archive is never allowed to contain
or wrap multipart course ZIPs.

After confirmation, orchestration processes ready courses in selection order
and parts in ascending order:

1. retrieve only the active part's local resources;
2. sanitize and render that part;
3. build and verify its ZIP;
4. hand the ZIP to the browser download flow; and
5. release its payload and ZIP buffers before starting the next part.

Existing bounded per-resource concurrency may be used within the active part.
Parts are never retrieved or built in parallel. Progress includes current
course, current part, total parts, completed parts, and failed parts.

Successfully handed-off parts remain completed if a later part fails. A
part-local retrieval or packaging failure is recorded and later safe parts and
courses continue. Cancellation, navigation, session loss, protocol corruption,
or an invalid immutable plan still stops the run globally.

Retry includes only failed or incomplete parts when their validated plan is
still available in the current run. A fresh user-initiated retry after state is
lost repeats discovery and review; it never relies on persistent course
content.

## Result and Error Semantics

Add `individual-size-limit` to the fixed resource failure categories. Add
`multipart-course` to `PlanFallbackReason`.

Side Panel and completion messages use bounded structured data only. They must
distinguish:

- courses and parts ready before retrieval;
- parts successfully downloaded;
- part-local failures;
- resources unavailable because of the individual size limit;
- resources unavailable for another existing reason;
- files placed in `files/unfiled/`; and
- courses skipped because another terminal discovery safety check failed.

The generic `safety-validation` course label remains appropriate for malformed
or unsafe metadata. It is not used for an absent referenced folder or a course
that merely needs multiple safe ZIPs.

## Testing Strategy

Implementation is test-driven and uses synthetic fixtures only.

### Folder recovery

- a valid file whose `folder_id` is missing from a valid folder index is placed
  beneath `files/unfiled/`;
- an unavailable complete folder index applies the same disclosed fallback;
- valid folder paths in a partial index remain unchanged;
- duplicate sanitized unfiled names receive deterministic collision suffixes;
- fallback keys, counts, summaries, manifests, and offline notices agree;
- malformed folders, unsafe paths, conflicting IDs, mismatched files, and
  foreign URLs still fail closed; and
- ordinary complete folder indexes behave unchanged.

### Partitioning and limits

- canonical resource order yields deterministic part membership and filenames;
- exact-limit, one-byte-over, empty, unknown-size, page-only, and mixed-resource
  boundaries are covered;
- no part exceeds byte, resource, or ZIP-entry limits;
- unknown-size files receive dedicated parts and stream under the active part's
  cap;
- a known or streamed individually oversized file becomes
  `individual-size-limit` without aborting its course;
- every resource is assigned exactly once and every catalog is complete;
- a course that fits remains a single unchanged ZIP; and
- multipart requirements force combined packaging to per-course parts with the
  correct fixed reason and output count.

### Archive and orchestration

- every part independently passes manifest normalization and ZIP verification;
- module, page, file, index, and status navigation identify `Part N of M`;
- resources in other parts are visible, unlinked, and labelled accurately;
- part totals and course totals cannot be confused or forged;
- retrieval, build, handoff, and buffer release occur sequentially by part;
- completed parts survive a later part-local failure;
- later safe parts and courses continue after a local failure;
- cancellation, navigation, session loss, and protocol corruption remain
  global stops; and
- mixed ordinary, folder-fallback, disabled-Modules, and multipart courses work
  in one Download all run.

### Verification suite

Before release, run:

- focused discovery, model, protocol, partitioner, retrieval, archive,
  navigation, Side Panel, and multi-course integration tests;
- `CI=true pnpm verify`;
- production build and release-contract checks;
- deterministic ZIP checksum, entry inventory, manifest, and integrity checks;
  and
- privacy and placeholder scans over committed evidence and generated release
  files.

## Live Acceptance

Using a fresh production build in a signed-in Chrome session:

- the six previously skipped folder-index cases become ready and show the
  unfiled fallback notice;
- the previously oversized course becomes ready with its expected part count;
- Download all retrieves every safe part, and each ZIP remains within the
  existing cap;
- every extracted archive opens offline and visibly identifies its course and
  part;
- cross-part resources show `Available in Part N` without broken links;
- affected files exist beneath `files/unfiled/` with deterministic names;
- missing folder relationships no longer produce the generic course safety
  label;
- a synthetic or safely bounded individual oversized-resource case produces an
  explicit unavailable outcome; and
- ordinary single-part course downloads remain unchanged.

Only counts, fixed categories, aggregate sizes, and pass/fail results may be
recorded as repository evidence. Live course names, IDs, filenames, URLs, and
content remain local and uncommitted.

## Acceptance Criteria

- Missing or unavailable folder relationships recover only validated files and
  disclose `files/unfiled/` placement everywhere required.
- Malformed or unsafe metadata remains fail-closed.
- A course larger than 250 MiB is planned as deterministic self-contained ZIP
  parts instead of being skipped.
- Every ZIP independently respects all existing byte, resource, and entry
  limits.
- A single resource that cannot fit is explicit, unrequested when known in
  advance, and does not stop the rest of the course.
- Review accurately reports effective packaging, course count, part count,
  unfiled fallback count, and individual unavailable resources.
- Offline navigation distinguishes local resources from material in another
  part without broken links.
- Packing is sequential by part and preserves successful downloads after local
  failures.
- No new origin, permission, backend, persistence, credential, or telemetry
  surface is introduced.
- Automated verification and fresh privacy-safe live acceptance pass before
  release.
