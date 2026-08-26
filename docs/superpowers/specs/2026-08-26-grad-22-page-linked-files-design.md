# GRAD-22 Page-Linked File Discovery Design

**Status:** Approved in conversation; awaiting written-spec review  
**Issue:** GRAD-22 — Archive files linked only from Canvas page bodies  
**Date:** 2026-08-26

## Problem

A privacy-safe real-account Alpha 3 validation exposed a completeness gap. An
accessible Canvas page contained same-course file links, but those files were
not present in the broad course files index or as `File` module items. GradPack
saved the page labels while removing their unusable Canvas `href` values, and
the archive manifest contained no file resources.

The current discovery plan learns files from the broad files index and module
items. Page bodies are fetched only later, during retrieval, after the
immutable plan and its size checks have been confirmed. The sanitizer can
rewrite a page link only when its file already exists in that plan. This is a
discovery-boundary defect, not a reason to weaken sanitization.

No real course name, file name, Canvas identifier, URL, screenshot, response
body, credential, or student content belongs in source control, tests, logs,
Linear, or review artifacts.

## Goals

- Discover files referenced only by accessible Canvas page bodies.
- Download every accepted same-course file link that the signed-in session can
  retrieve, including files whose metadata endpoint is unavailable.
- Preserve an immutable confirmation plan and explicit packaging fallback.
- Preserve the 250 MiB per-course hard limit through runtime byte accounting
  when an advertised size is unknown.
- Rewrite successful page-linked files to canonical local archive paths and
  report inaccessible files transparently.
- Keep the existing exact-origin, read-only, local-only privacy boundary.

## Non-Goals

- Following arbitrary links, external origins, assignment URLs, or recursively
  parsing downloaded documents.
- Broadening Chrome permissions, Canvas host access, or accepted API routes.
- Scraping rendered Canvas DOM as a production discovery mechanism.
- Changing the 5 MiB page-detail cap or 250 MiB per-course archive cap.
- Implementing GRAD-7 browser-test infrastructure.
- Modifying or replacing any Alpha 1, Alpha 2, or Alpha 3 package.

## Selected Architecture

GradPack will perform a bounded page-link preflight during discovery. Every
page already included in the course plan is fetched through the existing exact
course-page API endpoint under the 5 MiB raw JSON cap. Successful page bodies
are parsed only long enough to extract accepted same-course file IDs; page
content is not retained in the immutable plan.

The preflight reuses the shared discovery scheduler, cancellation signal, and
bounded concurrency. It may duplicate the later page-detail request during
retrieval. That deliberate trade-off keeps sensitive page content out of the
long-lived plan, avoids unbounded page-body caching, and leaves retrieval's
existing per-resource outcomes authoritative.

The extracted IDs are unioned with files from the broad index and module
items. Each new ID is resolved through the existing exact course-file metadata
endpoint. Metadata-backed and metadata-unavailable files share the existing
`PlannedResource` model; `advertisedBytes: null` identifies an unknown-size
file, a shape the model and manifest already support.

## Accepted Link Boundary

Page-link extraction accepts only an anchor `href` which, after strict URL
parsing, has:

- HTTPS and the exact configured Canvas origin;
- no username, password, or fragment;
- the selected positive course ID;
- a positive file ID; and
- exactly one of these path/query shapes:
  - `/courses/<course-id>/files/<file-id>?wrap=1`
  - `/courses/<course-id>/files/<file-id>/download` with no query.

Relative and absolute forms are accepted because both resolve against the
fixed Canvas origin. Raw whitespace, backslashes, encoded separators, encoded
query names or values, extra query delimiters, duplicate parameters, other
courses, foreign origins, non-positive IDs, and unsupported suffixes are
rejected. The extractor does not trust `data-api-endpoint`, link text, CSS
classes, or DOM IDs. Duplicate anchors for the same file ID produce one file.

A focused `canvas/page-links` module will own page-record validation and strict
file-ID extraction so discovery and retrieval do not duplicate security
parsers. The page JSON byte cap will move to a neutral shared constant rather
than creating a discovery-to-retrieval import dependency.

## Metadata Outcomes and Planned Resources

For each newly discovered file ID:

1. A successful exact metadata response uses the official display name,
   folder, advertised size, and canonical `/files/<id>/download` URL.
2. An exact 403 or 404 metadata outcome creates an unknown-size resource with:
   - title and archive filename `file-<id>`;
   - deterministic path `files/file-<id>`;
   - `advertisedBytes: null`; and
   - exact source URL
     `/courses/<course-id>/files/<file-id>/download` on the Canvas origin.
3. Session loss, terminal transient failure, malformed metadata, mismatched
   IDs, unsafe URLs, and other response-policy violations stop planning.

An unavailable or oversized page preflight contributes no embedded IDs but
does not erase the already planned page. The later page retrieval records its
normal unavailable outcome. A terminal session, transient, response-shape, or
security failure still stops planning rather than silently reducing scope.

Files known from the broad index or module items keep their authoritative
metadata. A page-only fallback never replaces or weakens an existing file
record. Path allocation and file-ID deduplication remain deterministic.

## Confirmation and Packaging Policy

Plan summaries will add an `unknownSizeCount` for each selected course and for
the aggregate run. The Side Panel will state that these files will be streamed
under the hard course limit.

If any selected course contains an unknown-size file and the user requested a
combined archive, the effective mode changes to per-course before retrieval.
A new explicit fallback reason, `unknown-size-files`, appears in the
confirmation notice. A direct per-course request remains per-course.

`advertisedBytes` continues to represent the sum of known advertised sizes.
The existing pre-run check still rejects any known file or known total above
250 MiB. Unknown-size files do not bypass the hard limit; they move the final
enforcement point to the stream.

## Retrieval and Runtime Byte Safety

Known-size file retrieval remains unchanged: source URL and advertised length
must match, storage is preallocated, and any stream-size drift is rejected.

For an unknown-size file, the runner passes the course's remaining byte budget
to retrieval. The exact course-scoped source URL is revalidated before fetch.
The response must satisfy the existing session, status, content-type, redirect,
and stream-integrity policies.

- A valid `Content-Length` greater than the remaining budget stops the course
  before reading the body.
- With or without `Content-Length`, chunks are accumulated only while the total
  remains within the remaining budget.
- Crossing the budget cancels the response, zeroes temporary buffers, and
  raises the existing size-policy failure. No success archive is emitted for
  that course.
- A successful non-empty stream is assembled once, reports its actual byte
  count, and participates in the existing aggregate check.
- Exact 403/404 download responses become transparent unavailable outcomes;
  session loss and unsafe responses remain terminal.

The retrieval dependency receives a remaining-byte budget instead of reading
mutable global state. This keeps each unit testable and preserves bounded
multi-course concurrency.

## Saved Pages and Manifest Behavior

The existing resolver already rewrites accepted Canvas file links when the
file ID and archive path exist in the plan. Once page-only resources are
planned, successful downloads therefore produce local links without weakening
the sanitizer.

If retrieval marks a planned file unavailable or failed, the existing
post-retrieval page pass removes its local `href`. The visible label remains,
and the status page and manifest explain the resource outcome. GradPack never
leaves a broken local link or silently presents an unavailable file as saved.

Manifest schema version 1 remains valid. Unknown-size resources use the
existing nullable `advertisedBytes`, successful outcomes record `actualBytes`,
and total advertised bytes remain the sum of known sizes. No real source URL
or verifier-bearing URL is added to generated public navigation pages.

## Release Identity

This behavior change must ship as `0.1.0-alpha.4`. Source metadata, generated
archive metadata, packaging scripts, security/install/checklist documentation,
fixtures, and release-contract tests will advance together.

Alpha 1, Alpha 2, and Alpha 3 ZIPs, sidecars, extracted folders, and validation
records remain byte-for-byte unchanged. Alpha 4 is generated in a new temporary
artifact directory and copied to a new visible validation folder only after
the full source and package gates pass.

## Error Handling

- Exact page or file resource 403/404 outcomes are handled at their documented
  resource boundary.
- Login redirects, HTML masquerading as files, invalid JSON, mismatched IDs,
  transient exhaustion, and cancellation keep their existing classifications.
- Unknown-size overflow uses the same user-facing course-size failure as known
  size overflow.
- A discovered but inaccessible file is not silently dropped: it remains a
  planned resource and receives an unavailable manifest outcome.
- No diagnostic includes real page text, link text, filenames, identifiers,
  URLs, headers, cookies, credentials, or response bodies.

## Testing Strategy

Focused test-driven coverage will include:

- strict extraction of both accepted link forms from synthetic page HTML;
- duplicate anchor and duplicate source deduplication;
- rejection of cross-course, foreign-origin, credential-bearing,
  fragment-bearing, encoded, malformed, and unexpected-query variants;
- a page-only file when broad file and folder indexes are unavailable;
- known metadata, 403/404 metadata fallback, and authoritative metadata winning
  over a page fallback;
- unknown-size plan summaries and combined-to-per-course fallback;
- known-size behavior remaining unchanged;
- unknown streaming with and without `Content-Length`;
- exact remaining-budget success, declared overflow, streamed overflow,
  cancellation, buffer cleanup, empty body, login HTML, and inaccessible file
  outcomes;
- page-link rewriting for successful files and disabled links for unavailable
  files;
- ZIP inventory, manifest `advertisedBytes: null` plus actual bytes, and offline
  local-link integrity;
- Alpha 4 release identity and stale-package rejection.

The full `CI=true pnpm verify` gate, deterministic package verification,
checksum/inventory checks, permission invariants, independent review, and
merged-main byte reproduction remain required.

The final acceptance test uses the user's authorized local Canvas session and
downloaded archive. Only coarse pass/fail and counts may be recorded. No real
course or student data is persisted in source control, Linear, screenshots, or
review notes.

## Rollout

1. Implement and verify the synthetic discovery, planning, retrieval, and
   archive flow on the GRAD-22 branch.
2. Produce and independently verify a new Alpha 4 package without touching
   Alpha 1–3.
3. Merge through review and reproduce identical Alpha 4 bytes from merged
   `main`.
4. Reload Alpha 4 manually in Chrome and rerun the privacy-safe affected-course
   test.
5. Confirm that page-only files appear in the ZIP and their saved-page links
   open locally, or receive explicit unavailable outcomes.
6. Unblock GRAD-20 only after the retest evidence is recorded; resume GRAD-7
   afterward.
