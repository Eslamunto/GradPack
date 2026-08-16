# GradPack Classmate Pilot Design

- **Status:** Approved for implementation planning
- **Date:** 2026-08-16
- **Delivery target:** 2026-08-17 end of day, Europe/Berlin
- **Linear:** GRAD-18 — Deliver the one-course classmate pilot
- **Related design:** `docs/design/2026-08-16-gradpack-mvp-design.md`

## 1. Purpose

This document defines a time-boxed first GradPack pilot for a small group of
Frankfurt School classmates. It narrows the approved MVP so that one useful,
privacy-conscious vertical slice can be built and tested by 17 August 2026.

The pilot does not replace the approved MVP design. Decisions in the MVP design
remain authoritative unless this addendum explicitly narrows them for the
pilot. Pilot-only technical compromises must be replaced or formally validated
before the full MVP or public release.

## 2. Success criterion

The pilot succeeds when a classmate can:

1. Install a versioned unpacked GradPack extension in current desktop Chrome.
2. Open and remain signed into Frankfurt School Canvas.
3. Open GradPack in Chrome's persistent Side Panel.
4. See the courses accessible to the active Canvas session.
5. Select exactly one course.
6. Start packing and observe clear progress.
7. Download one ZIP containing the accessible in-scope course material.
8. Extract and open the archive locally without GradPack or Canvas.
9. See which resources succeeded, failed, or remain external.

The first pilot is manually distributed. It is not a public release or Chrome
Web Store submission.

## 3. Pilot scope

### Included

- Manifest V3 extension for Chrome 116 or newer.
- Persistent Chrome Side Panel.
- Existing signed-in Frankfurt School Canvas session.
- All course states returned to the student by the supported Canvas course
  discovery request.
- Exactly one selected course per run.
- Module structure and supported module items.
- Canvas files and folders.
- Canvas pages saved as sanitized HTML.
- External links saved as references, not fetched automatically.
- One per-course ZIP.
- A simple offline `index.html`.
- A versioned `manifest.json` with transparent resource outcomes.
- Simple progress, cancellation, completion, and failure states.
- Manual unpacked-extension installation instructions.
- A versioned pilot artifact and SHA-256 checksum.

### Deferred

- Multi-course runs.
- Combined ZIPs.
- Local search.
- Polished archive navigation.
- Restart and resume.
- Windows-specific validation.
- Broad DOM fallbacks.
- Native Canvas export creation.
- Assignments, submissions, grades, quizzes, discussions, and announcements.
- Public repository release.
- Chrome Web Store submission.

## 4. User experience

The Side Panel has six states:

1. **Connect** — explain that a signed-in Frankfurt School Canvas tab must be
   open and remain open.
2. **Choose course** — show accessible courses and permit one selection.
3. **Ready** — summarize the selected course, local-only behavior, and the pilot
   size policy.
4. **Packing** — show the current stage, completed resource count, failed
   resource count, and a Cancel action.
5. **Complete** — confirm the ZIP download and summarize manifest outcomes.
6. **Blocked** — explain session, size, navigation, permission, or safety
   failures and the next safe action.

The panel uses the approved Archive Indigo visual direction but prioritizes
clarity, keyboard access, readable contrast, and reliable states over animation
or polish.

Before the first run, the student sees a concise notice that:

- material is saved locally;
- GradPack retrieves only currently accessible resources;
- some resources may fail or remain external; and
- the student is responsible for applicable copyright, licensing,
  confidentiality, and course-material restrictions.

## 5. Pilot architecture

### 5.1 Chrome Side Panel

The Side Panel owns presentation and user intent:

- detect and display the active connection state;
- request the course list;
- collect one course selection;
- start or cancel a run; and
- display validated progress and outcomes.

The panel does not construct Canvas URLs, receive credentials, or store course
content.

### 5.2 Extension service worker

The Manifest V3 service worker:

- opens the Side Panel after an extension-icon user gesture;
- validates that the active tab uses the exact approved Canvas origin;
- injects the isolated relay and page-context runner from packaged extension
  files; and
- routes small control messages when required.

The service worker does not own the long-running archive job or rely on global
in-memory state. Chrome may suspend extension service workers, so the pilot
keeps the active job bound to the required open Canvas tab.

### 5.3 Isolated relay

An isolated content script provides the boundary between extension components
and the page-context runner. It:

- accepts only versioned, allowlisted message types;
- binds every message to the active tab and a newly generated run identifier;
- validates course identifiers and scalar progress fields;
- rejects unexpected origins, message shapes, methods, and payloads; and
- forwards progress and terminal status, not course bodies or file bytes, to
  the Side Panel.

### 5.4 Page-context pilot runner

The runner executes in the Canvas page's main JavaScript world so its requests
use the existing Canvas page session. It is a self-contained, locally bundled
script with no remote executable code.

The runner:

- constructs all supported Canvas paths internally;
- performs read-only `GET` and, where necessary, `HEAD` requests;
- discovers one course's modules, files, pages, and external references;
- validates response status, final URL, content type, and expected shape;
- sanitizes saved page HTML;
- builds the archive locally in the Canvas tab; and
- initiates the final Blob-based ZIP download.

It never accepts an arbitrary URL, HTTP method, request header, request body, or
script from the Side Panel, relay, or page.

Running the ZIP builder in the page context is a pilot-only compromise. It
avoids large binary transfers through extension messaging and avoids depending
on a long-lived service worker. GRAD-11 must replace or formally validate the
mechanism before the full MVP.

### 5.5 Technology constraints

- TypeScript for production and test code.
- Browser-native HTML and CSS for the small Side Panel; no UI framework.
- A minimal, locally bundled ZIP dependency.
- A minimal, locally bundled HTML sanitizer.
- Locked dependency versions and reproducible scripts.
- No dynamic remote imports, `eval`, or remotely hosted executable code.
- No production analytics, telemetry, crash reporting, or backend.

## 6. Data flow

```text
Student opens Side Panel
    → service worker validates active Frankfurt School Canvas tab
    → isolated relay and page-context runner become available
    → Side Panel requests course discovery
    → runner performs fixed read-only Canvas requests
    → student selects one returned course identifier
    → runner discovers the immutable resource plan
    → runner applies the 250 MB safety policy
    → runner retrieves and validates resources with bounded concurrency
    → runner sanitizes pages and records outcomes
    → runner builds the local ZIP
    → browser downloads the ZIP
    → transient run state and course content are released
```

Only operational progress crosses from the runner to extension UI. Course
names may be shown in the Side Panel because the student selected them, but they
are not written to production logs, diagnostic output, Linear, source control,
or CI artifacts.

## 7. Minimal internal model

The pilot uses small discriminated models for:

- `CourseSummary` — identifier, display name, course code, and workflow state;
- `Module` — identifier, name, position, and ordered items;
- `Resource` — file, page, or external-link reference;
- `ResourceOutcome` — success, failed, unavailable, unsupported, or external;
- `RunProgress` — stage and scalar counts; and
- `ArchiveManifest` — schema version, course metadata, totals, and outcomes.

Resource identifiers remain separate from display names and archive paths.
Every discovered in-scope resource receives exactly one terminal outcome. The
pilot never silently drops a resource.

## 8. Archive contract

The ZIP uses this minimum layout:

```text
gradpack-<safe-course-name>.zip
├── index.html
├── manifest.json
├── assets/
│   └── archive.css
├── pages/
│   └── <safe-page-name>.html
└── files/
    └── <safe-folder-path>/
        └── <safe-file-name>
```

`index.html` contains:

- course title and export timestamp;
- ordered module structure;
- local links to archived pages and files;
- labeled external links; and
- a visible summary of failed, unavailable, and unsupported resources.

`manifest.json` contains:

- a schema version;
- creation timestamp and GradPack version;
- Canvas host and local course metadata;
- declared and retrieved byte totals;
- counts by resource type and outcome;
- safe local paths for successful resources; and
- sanitized failure categories without response bodies, credentials, headers,
  cookies, or sensitive query strings.

Archive paths are relative, normalized, collision-safe, and confined beneath
the archive root. Reserved platform names, traversal segments, empty names,
Unicode normalization, duplicate names, and excessive path lengths are handled
deterministically.

## 9. Safety policy

### 9.1 Size policy

- The maximum advertised total size is 250 MB.
- Every file must have a known, non-negative advertised size before retrieval.
- Missing course totals are calculated from the immutable discovered file plan.
- Any unknown file size stops the run before resource retrieval.
- A course above the limit stops before resource retrieval.
- GradPack explains the limit and does not omit resources to make the archive
  fit.

The limit bounds the first in-memory packaging mechanism. It is not presented
as a permanent product limit.

### 9.2 Request policy

- At most two Canvas requests run concurrently.
- A transient request receives at most two retries with bounded backoff.
- Pagination accepts only validated links on the exact Canvas origin.
- Redirects to login routes and login HTML returned in place of expected data
  are treated as session loss.
- State-changing `POST`, `PUT`, `PATCH`, and `DELETE` requests are impossible.

### 9.3 Content and logging policy

- Course content exists only in transient memory and the student-requested ZIP.
- Content is released after completion, cancellation, or terminal failure.
- Production logs contain operational states and counts only.
- No response bodies, course names, filenames, sensitive URLs, student
  identifiers, cookies, headers, or credentials are logged.
- No diagnostic export is included in the classmate pilot.

## 10. HTML and link safety

Saved Canvas page HTML is treated as untrusted.

The sanitizer removes or neutralizes:

- scripts and active embeds;
- inline event handlers;
- dangerous URL schemes;
- forms and state-changing controls;
- executable or auto-loading third-party content; and
- markup that can escape the generated document structure.

Known archived Canvas resources are rewritten to safe local relative paths.
External links remain explicit external references and are never fetched
automatically. The generated archive contains no remotely hosted executable
code.

## 11. Failure handling

### Resource-level failures

An inaccessible, missing, unsupported, or transiently failed individual
resource does not invalidate the course archive. The runner records a sanitized
outcome, continues within the safety policy, and includes the outcome in the
manifest and offline index.

### Run-level failures

The run stops without claiming success when:

- the active Canvas tab closes or navigates;
- the session expires or a login page is returned;
- the selected course cannot be validated;
- a file size is unknown or the total exceeds 250 MB;
- pagination leaves the approved origin or loops;
- a response violates its expected content type or schema;
- an unsafe archive path cannot be normalized; or
- cancellation is requested.

A stopped run releases transient content. It does not silently produce an
incomplete ZIP. The Side Panel gives a concise reason and a safe next action.

## 12. Verification strategy

### Unit tests

Required unit tests cover:

- exact-origin and Canvas-path allowlisting;
- course identifier validation;
- pagination validation and loop detection;
- size aggregation and the 250 MB boundary;
- retry classification and limits;
- filename and path sanitization;
- HTML sanitization and link rewriting;
- manifest totals and terminal outcomes; and
- progress-state transitions and cancellation.

### Synthetic integration tests

Synthetic fixtures cover:

- signed-in and signed-out responses;
- active, completed, and concluded courses;
- modules, pages, files, folders, and external links;
- unavailable, missing, unsupported, and failed resources;
- multi-page API responses;
- login redirects and masquerading HTML;
- an archive below the limit;
- an archive exactly at the limit;
- an archive above the limit; and
- an unknown file size.

Fixtures contain no real student identity, course material, credentials, or
private URLs beyond the configured public Canvas host.

### Manual gates

1. The maintainer installs a clean build and completes the feasibility flow:
   current user, course list, one page, one file, and local download.
2. The maintainer archives one real course below the pilot limit and inspects
   its index, pages, files, links, and manifest.
3. The maintainer confirms no GradPack data transfer leaves the device.
4. One classmate installs the exact artifact and completes a smoke test.
5. Wider classmate sharing occurs only after blocking installation, privacy,
   archive-corruption, and session failures are resolved.

Only pass/fail results, safe counts, browser version, operating-system version,
and sanitized defect descriptions may be recorded.

## 13. Distribution artifact

The manually shared pilot contains:

- a versioned ZIP of the unpacked extension;
- an SHA-256 checksum;
- concise Chrome installation steps;
- the requirement to keep the Canvas tab open and signed in;
- the one-course and 250 MB limitations;
- a short test checklist; and
- a privacy and course-material notice.

The pilot version starts at `0.1.0-alpha.1`. The artifact is produced from a
clean checkout using a documented build command. Generated course archives,
real fixtures, local screenshots, browser profiles, and temporary packaging
files are never committed.

## 14. Delivery gates

### Gate A — Foundation

- Reproducible install, format, type-check, test, and build scripts work.
- Chrome loads the unpacked extension without manifest errors.
- The extension icon opens the Side Panel on the approved Canvas host.

### Gate B — Session feasibility

- Current-user and course-list requests succeed through the existing session.
- One page and one file can be retrieved without credentials or cookie access.
- Failure stops the pilot path; it does not introduce passwords, tokens,
  unofficial OAuth, or broad scraping.

### Gate C — Synthetic archive

- A synthetic course produces the required ZIP layout.
- Safety, sanitizer, path, size, and manifest tests pass.
- Cancellation and resource-level failures behave as designed.

### Gate D — Maintainer validation

- One real course below the limit produces a usable offline archive.
- Only privacy-safe validation results are retained.
- No blocking defect remains.

### Gate E — Classmate smoke test

- One classmate installs the exact artifact and completes a course archive.
- The checksum and instructions match the tested artifact.
- Wider sharing is approved only after the smoke test passes.

## 15. Deadline rule

The 17 August target does not override the session-feasibility, privacy,
archive-integrity, or classmate-smoke-test gates. If a required gate fails, the
pilot is not described as working and is not shared more widely. The failure is
documented without student content, and the next safe technical step is chosen.

## 16. References

- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome extension service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome extension messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
