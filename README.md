# GradPack

> Pack your courses. Keep your knowledge.

GradPack is an open-source Chrome extension for students who want to preserve
their accessible Canvas course materials as a useful local archive.

The project is currently an **alpha classmate pilot** distributed manually as
an unpacked extension. It is not yet published on the Chrome Web Store.

The pilot saves selected accessible Canvas courses into transparent local ZIPs,
either one ZIP per course or one combined archive. Each archive has a
Canvas-familiar, GradPack-branded static interface with Home, Modules, Pages,
Files, and Archive Status navigation. It works fully offline, contains no
archive JavaScript, and records per-resource outcomes. GradPack uses the
student's existing signed-in Frankfurt School Canvas tab and has no analytics,
telemetry, backend, or cloud upload.

Use **Select all courses** to choose every displayed active, completed, and
concluded course, or keep using the individual course checkboxes.

GradPack checks selected courses sequentially before downloading anything. If
one course cannot be planned safely, the review screen identifies it as
skipped with a fixed privacy-safe reason while keeping the other safe courses
ready for download. After the ready archives finish, **Retry unfinished
courses** refreshes Canvas access and rediscovers only skipped or packing-failed
courses under a new run. Every retry still requires review and confirmation
before retrieval.

## Pilot installation

Pilot testers should use the versioned artifact and checksum supplied by the
maintainer, then follow the [installation guide](docs/pilot/INSTALL.md) and
return only the privacy-safe fields in the [test checklist](docs/pilot/TEST_CHECKLIST.md).

The approved scope and safety boundaries are documented in the
[classmate-pilot design](docs/design/2026-08-16-gradpack-classmate-pilot-design.md)
and the [full MVP design](docs/design/2026-08-16-gradpack-mvp-design.md).

## License

Licensed under the [Apache License 2.0](LICENSE).

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change and
[SECURITY.md](SECURITY.md) before reporting a vulnerability.

## Development

Prerequisites: Node.js 22.22.2 and pnpm 11.17.0.

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm build
pnpm package:pilot
```

To inspect the local build, open `chrome://extensions`, enable Developer mode,
select **Load unpacked**, and choose this repository's `dist/` directory. Keep a
signed-in Frankfurt School Canvas tab open while GradPack is running.

Contributors can use the development-only [live Canvas smoke-test
workflow](docs/development/live-canvas-smoke-test.md) to verify an authorized
local session. It is not an end-user feature.

### Pilot memory limits

Every selected course is validated before retrieval.

A course-local Canvas response, size-limit, safety-validation, or unexpected
local planning failure does not weaken validation and does not stop other safe
courses. Canvas session loss, tab navigation or closure, cancellation, invalid
extension messages, and run-wide safety failures still stop the operation.

Unknown-size files are streamed under the hard 250 MiB per-course cap. When
they are present, a combined request falls back to per-course output before
retrieval and requires confirmation. A requested combined archive that exceeds
its aggregate size or ZIP-entry limit while the individual courses remain valid
uses the same visible combined-to-per-course fallback. GradPack never silently
omits resources to make a course fit.

During retrieval, each course also stops if successful files plus sanitized
pages exceed the same 250 MiB per-course limit. Individual Canvas page-detail
JSON bodies are streamed under a conservative 5 MiB raw-body cap and receive a
fixed, transparent unavailable outcome when that cap is exceeded.

Each course archive reserves seven ZIP entries for its generated interface and
manifest, leaving a maximum of 65,528 discovered resource entries. GradPack
stops safely when a course would exceed that limit; it never drops resources to
make an archive fit.
