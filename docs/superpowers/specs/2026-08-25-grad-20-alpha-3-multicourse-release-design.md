# GRAD-20 Alpha 3 Multi-Course Release Design

## Context

The `0.1.0-alpha.2` candidate consistently versions the merged GradPack build,
but independent review found that its packaged Chrome description and pilot
guide still describe a one-course product. The merged extension supports
selecting one or more courses and choosing combined or per-course output.

Alpha 2 has already been generated, checksum-verified, extracted, and recorded
as immutable validation evidence. Changing its packaged manifest would create
different bytes under the same release identity.

## Considered Approaches

1. **Issue Alpha 3 and preserve Alpha 2 — selected.** Correct the multi-course
   copy and strengthen the release contract under a new immutable identity.
2. **Regenerate Alpha 2 with corrected copy — rejected.** This would violate
   the approved immutable-artifact rule even though Alpha 2 was not distributed
   to a classmate.
3. **Keep Alpha 2 and retain one-course copy — rejected.** The package would
   materially misdescribe the implemented product and steer testers away from
   the merged workflow.

## Decision

The next distributable validation package is `0.1.0-alpha.3`.

Alpha 1 and Alpha 2 packages and checksums remain unchanged. Chrome's numeric
manifest version remains `0.1.0`, and the archive manifest schema remains
version 1. No permission, host-access, privacy, retrieval, packaging, archive,
or UI behavior changes are part of Alpha 3.

## Release Identity

The following surfaces change together to `0.1.0-alpha.3`:

- `package.json` version;
- Chrome `version_name`;
- generated archive `gradPackVersion`;
- pilot ZIP filename and SHA-256 sidecar filename;
- package validator identity;
- current-version security and tester documentation;
- release tests and privacy-safe checklist.

The new artifact is exactly `gradpack-0.1.0-alpha.3.zip` with sidecar
`gradpack-0.1.0-alpha.3.zip.sha256`.

## Corrected Product Copy

The packaged Chrome description becomes:

> Save selected accessible Canvas courses for offline use.

The installation guide states that a user may select one or more accessible
courses and choose either one combined archive or one ZIP per course. Each
selected course must have known advertised file sizes and fit the existing
250 MiB per-course safety limit. When a requested combined archive exceeds its
aggregate size or entry limit while individual courses remain valid, GradPack
shows the packaging fallback before retrieval and uses per-course output only
after confirmation.

The guide instructs testers to review the plan, any fallback notice, and the
resulting archive or archives. It does not imply that every GRAD-20 maintainer
or classmate check must use multiple courses; GRAD-20 may still complete its
narrow one-course smoke test while accurately documenting the product it loads.

The checklist adds privacy-safe fields for selected-course count, requested
packaging, effective packaging, fallback notice, and output count. It must not
collect course names, filenames, Canvas identifiers or URLs, screenshots,
archives, content, request/response data, credentials, cookies, headers,
tokens, or student identity.

The README memory-limit section changes from “one-course pilot” to
selected-course language and documents the visible combined-to-per-course
fallback. Historical design documents that correctly state where the pilot
started remain unchanged.

## Release Contract

The cross-file release contract continues to verify package metadata, Chrome
numeric/display versions, artifact filename, security policy, installation
guide, and checklist. It additionally builds a synthetic archive manifest and
asserts `gradPackVersion: 0.1.0-alpha.3`.

The package tests explicitly prove that a production manifest with a stale
`version_name` is rejected. Existing deterministic-package tests continue to
prove the accepted Alpha 3 identity, fixed inventory, checksum sidecar, and
immutable target behavior.

The contract remains test-based rather than introducing a new shared runtime
version module. JSON, TypeScript, Node packaging, and Markdown surfaces have
different consumers; a release test is the smallest boundary that detects
drift without adding production coupling.

## Packaging and Error Handling

Alpha 3 packaging uses a new artifact directory and a new visible handoff
folder. The package process must stop rather than replace a pre-existing Alpha
3 ZIP or checksum with different bytes.

Before and after Alpha 3 staging, the Alpha 1 and Alpha 2 checksums are
recalculated and compared with their recorded values. Any change, identity
mismatch, checksum failure, unexpected ZIP member, permission change, or host
permission change blocks distribution.

## Verification

1. Change release tests to Alpha 3 and add failing expectations for corrected
   multi-course copy, generated archive metadata, and stale package identity.
2. Confirm the focused tests fail for the intended Alpha 2/single-course
   reasons.
3. Implement the minimal identity and copy changes.
4. Run focused release, package, archive-manifest, build-output, and
   documentation tests.
5. Run `CI=true pnpm verify`.
6. Generate Alpha 3 in a new artifact directory.
7. Independently verify SHA-256, ZIP integrity, exact eight-file inventory,
   numeric/display manifest versions, permissions, and host permissions.
8. Reconfirm Alpha 1 and Alpha 2 checksums are unchanged.
9. Copy Alpha 3, its sidecar, the guide, checklist, and extracted extension to
   a new visible validation folder.
10. Obtain a fresh independent review before integration.

After integration, reproduce Alpha 3 from merged `main` and require identical
bytes before beginning the maintainer Chrome gate.

## Out of Scope

- Deleting, renaming, moving, or modifying Alpha 1 or Alpha 2 artifacts.
- Changing multi-course orchestration or packaging fallback behavior.
- Changing the 250 MiB safety limit or ZIP entry limits.
- Changing Chrome permissions, Canvas host scope, or privacy boundaries.
- Changing the archive schema version.
- Completing the maintainer real-account, extracted `file://`, or classmate
  gates as part of this source change.
