# GRAD-20 Alpha 2 Pilot Version Design

## Context

GRAD-20 requires a fresh production package from merged `main` for maintainer
and classmate validation. The previously distributed
`gradpack-0.1.0-alpha.1.zip` and the current merged build contain different
bytes. Reusing the `alpha.1` identity would make two distinct packages appear
to be the same release and would violate the pilot artifact immutability rule.

## Decision

Identify the next validation package consistently as `0.1.0-alpha.2`.

Chrome's numeric manifest version remains `0.1.0`. The human-readable
`version_name`, package metadata, archive metadata, artifact filename,
packaging validation, documentation, and tests change from `alpha.1` to
`alpha.2` together.

The existing `alpha.1` package and checksum remain unchanged. No GradPack
feature, permission, host scope, archive schema, data flow, or user-interface
behavior changes as part of this version bump.

## Components

- `package.json` identifies the source package as `0.1.0-alpha.2`.
- `src/manifest.json` keeps `version: 0.1.0` and changes `version_name` to
  `0.1.0-alpha.2`.
- Generated course manifests report GradPack version `0.1.0-alpha.2`.
- The pilot packager emits `gradpack-0.1.0-alpha.2.zip` and a matching
  `.sha256` sidecar, and validates the new manifest identity.
- Pilot installation and checklist references identify the exact `alpha.2`
  artifact without changing the privacy-safe test procedure.
- Existing tests and fixtures that intentionally assert the release identity
  change to `alpha.2`; unrelated schema-version assertions remain unchanged.

## Packaging and Error Handling

The existing immutable-artifact behavior remains authoritative. Packaging
must stop instead of replacing an existing `alpha.2` ZIP or checksum with
different bytes. GRAD-20 validation will package into a new directory, verify
the sidecar independently, validate ZIP integrity, and compare the exact
eight-file inventory before the extension is loaded in Chrome.

Any version mismatch between source metadata, extension manifest, archive
metadata, package filename, or packaging validation is a release-blocking
error. The package must not be given to a maintainer or classmate until all
identities agree.

## Verification

1. Run the focused version and packaging tests first.
2. Run `CI=true pnpm verify` from the isolated GRAD-20 worktree.
3. Generate the `alpha.2` package in a new artifact directory.
4. Verify its SHA-256 sidecar independently.
5. Run ZIP integrity validation and confirm the exact production inventory.
6. Confirm the prior `alpha.1` package checksum is unchanged.
7. Only then copy the `alpha.2` package, checksum, installation guide, and
   checklist into a visible validation folder for the live Chrome gate.

## Out of Scope

- Functional changes to course discovery, retrieval, transformation, or ZIP
  generation.
- Changes to Chrome permissions, Canvas host access, or privacy boundaries.
- Updating the archive manifest schema version.
- Completing the maintainer or classmate live checks in this change itself.
- Replacing, renaming, or deleting the existing `alpha.1` package.
