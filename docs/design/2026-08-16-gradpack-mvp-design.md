# GradPack MVP Design

- **Status:** Approved for implementation planning
- **Date:** 2026-08-16
- **Linear:** [COG-55](https://linear.app/cognita-reply-de/issue/COG-55/document-the-approved-gradpack-mvp-design)
- **Target:** Desktop Chrome on macOS and Windows

## 1. Product summary

GradPack is a local-first Chrome extension that helps students preserve useful,
accessible Canvas course material before they lose university access.

The initial pilot targets Frankfurt School of Finance & Management MBA students
using:

```text
https://frankfurtschool.instructure.com/
```

The architecture must keep institution-specific configuration at the boundary
so another Canvas institution can be supported later without rebuilding the
archive pipeline.

### Product promise

A student who is already signed in to Canvas can open GradPack, select any
accessible courses, and download an organized archive that remains useful after
Canvas access ends.

### Guiding principles

1. **Local first:** Course content remains on the student's device.
2. **Use existing access:** GradPack only retrieves resources the signed-in
   student can already access.
3. **No credentials:** GradPack never asks for, reads, or stores a Canvas
   password or authentication token.
4. **Useful over exhaustive emulation:** The archive preserves knowledge and
   context; it does not attempt to reproduce Canvas itself.
5. **Partial success is valuable:** One failed resource must not invalidate the
   rest of an archive.
6. **Honest output:** Missing, failed, and external resources remain visible.
7. **Reliability before breadth:** The MVP proves the end-to-end pipeline before
   adding more Canvas content types or other learning platforms.

## 2. Intended users and environment

### Primary user

A graduating student who:

- uses Canvas in desktop Chrome;
- is currently signed in through the institution's normal login flow;
- can still open current or historical course material;
- wants a personal offline reference archive; and
- accepts responsibility for complying with applicable course-material,
  copyright, licensing, and confidentiality rules.

### Pilot assumptions

- Frankfurt School provides no administrative or technical cooperation.
- The student can install an unpacked extension manually.
- A Frankfurt School Canvas tab remains open and signed in for the full packing
  run.
- The maintainer can test with a real student account.
- The pilot UI and generated archive are English-only.
- macOS and Windows are required; Linux is best-effort until tested.

### Distribution stages

1. Manually installed unpacked extension for the controlled pilot.
2. Public open-source repository after the public-release review gate.
3. Chrome Web Store submission after reliability, privacy, and store-readiness
   checks pass.

## 3. MVP scope

### Included

- Detect the Frankfurt School Canvas host and active signed-in session.
- Show every course the current student can still access, including active,
  completed, and concluded courses where Canvas exposes that status.
- Group courses by term and status where metadata is available.
- Select individual courses or all visible courses.
- Discover complete module structure and supported module references.
- Retrieve every accessible Canvas-hosted file.
- Retrieve every accessible Canvas page.
- Preserve external URLs as references without claiming they were archived.
- Deduplicate repeated Canvas files by stable Canvas file ID.
- Let the student request either one combined ZIP or separate ZIPs per course.
- Override combined packaging when the feasibility-tested safety policy says it
  would be unsafe, explaining the reason before downloads begin.
- Show discovery, retrieval, transformation, packaging, and completion progress.
- Support cancellation.
- Isolate individual resource failures.
- Generate an offline index, local search, and a machine-readable manifest.
- Sanitize every generated filename, path, URL, and saved HTML page.
- Keep all course content and run data local to the student's machine.

### Content automatically included

The MVP deliberately has no content-type settings. Every run includes:

- accessible files;
- Canvas pages;
- module structure;
- external-link references; and
- success, failure, and external-resource records.

The only student choices are the courses and the packaging mode.

### Explicitly excluded

- assignment descriptions;
- assignment submissions;
- grades;
- quizzes and quiz-question extraction;
- discussions;
- announcements;
- calendar events;
- arbitrary external-site downloading;
- authenticated third-party tools;
- Panopto, Zoom, or third-party video extraction;
- bypassing authentication, access controls, DRM, paywalls, or licensing;
- OCR;
- AI summarization or semantic search;
- analytics or telemetry;
- cloud backup;
- mobile support;
- interrupted-run recovery after the browser or extension restarts;
- incremental archives; and
- non-Canvas learning platforms.

Directly downloadable media stored as an ordinary accessible Canvas file is in
scope. Embedded or externally hosted streaming media is not.

## 4. User experience

GradPack uses Chrome's persistent Side Panel. It does not open a separate tab,
window, or short-lived toolbar popup.

### Primary flow

```text
Open Frankfurt School Canvas
        ↓
Sign in normally
        ↓
Open the GradPack Side Panel
        ↓
Verify Canvas connection
        ↓
Choose accessible courses
        ↓
Choose combined or per-course ZIPs
        ↓
Discover and estimate the selection
        ↓
Confirm any automatic packaging safety change
        ↓
Pack courses with visible progress
        ↓
Review successes, failures, and external resources
        ↓
Download and open the offline archive
```

### Side Panel states

The interface is a focused, guided flow with explicit states:

1. `unsupported-host` — The active tab is not a supported Canvas host.
2. `connecting` — The session bridge is checking the Canvas account.
3. `signed-out` — Canvas requires the student to sign in or refresh the tab.
4. `course-selection` — Accessible courses are searchable and grouped.
5. `packaging` — Combined or per-course archives can be selected.
6. `discovery` — GradPack enumerates resources and estimates the run.
7. `packaging-warning` — The requested combined archive is unsafe and will be
   changed to per-course ZIPs.
8. `packing` — The current course, phase, item counts, bytes, warnings, and
   cancel action are visible.
9. `session-paused` — The Canvas session expired; the student is asked to sign
   in again before continuing the current live run.
10. `complete` — Downloads, counts, failures, and next actions are shown.
11. `stopped` — The run was canceled or the required Canvas tab closed.
12. `fatal-error` — A run-level failure prevented a usable archive.

### Visual direction

The selected direction is **Archive Indigo**:

- deep indigo for identity and primary actions;
- warm neutral surfaces that evoke a personal library;
- green reserved for verified success;
- amber reserved for recoverable warnings;
- red reserved for destructive actions or terminal failures; and
- restrained typography and motion suitable for a long-running utility.

The extension and generated archive must meet WCAG 2.1 AA contrast, support
keyboard-only navigation, expose progress and errors to assistive technology,
and respect reduced-motion preferences.

## 5. Authentication and Canvas access

### Decision

The MVP uses the student's existing Canvas browser session. It does not use
OAuth, personal access tokens, developer keys, or institution-issued secrets.

### Same-origin session bridge

A declarative content script runs only on the configured Canvas host. It makes
read-only, same-origin requests to relative Canvas API paths. Chrome attaches
the existing Canvas session in the same way it does for normal Canvas browsing.

The extension must not:

- request the Chrome `cookies` permission;
- read or copy Canvas cookies;
- inject credentials into requests;
- collect a password or access token; or
- send state-changing `POST`, `PUT`, `PATCH`, or `DELETE` requests to Canvas.

### Feasibility gate

Full product implementation is blocked until a real Frankfurt School student
session proves this exact flow:

```text
active Canvas tab
    → current user
    → accessible course list
    → one course
    → one Canvas page
    → one Canvas file
    → local file download
```

The spike records response status, redirect behavior, content types, pagination
headers, and file-download behavior without recording course names, page text,
filenames, student identity, or file contents.

If same-origin session requests do not work, development stops and the
limitation is documented. There is no password, manual-token, or unofficial
OAuth fallback for the zero-cooperation MVP.

### Session-loss detection

The bridge treats any of the following as a lost session:

- HTTP `401` or `403` attributable to authentication;
- a redirect to a Canvas login route;
- an HTML login page returned where JSON or file content was expected; or
- failure of a lightweight current-user check after a request fails.

The current live run pauses and asks the student to sign in again in the same
Canvas tab. If the tab closes, the run stops cleanly. ZIPs already completed and
downloaded remain valid. Restart-and-resume is outside the MVP.

### DOM fallback

DOM extraction is a narrow fallback, not the primary integration strategy.

Each fallback must:

- support one explicitly named resource or metadata field;
- live behind the same normalized Canvas adapter interface;
- use stable semantic selectors where available;
- validate the extracted value before returning it;
- fail visibly when the expected page structure changes; and
- have fixture-based tests for supported and changed markup.

DOM extraction must never scrape credentials, submissions, grades, quizzes, or
other excluded content.

## 6. Architecture

```text
┌────────────────────────── Canvas tab ───────────────────────────┐
│                                                                 │
│  Signed-in Canvas page                                          │
│            │                                                    │
│            ▼                                                    │
│  Same-origin content-script bridge                              │
│            │  read-only Canvas requests                         │
└────────────┼────────────────────────────────────────────────────┘
             │ validated messages
             ▼
┌──────────────────────── Chrome extension ───────────────────────┐
│                                                                 │
│  Side Panel UI  ↔  Run coordinator / service worker             │
│                         │                                       │
│                         ▼                                       │
│                 Canvas adapter/client                           │
│                         │                                       │
│                         ▼                                       │
│                 Discovery + normalizer                          │
│                         │                                       │
│                         ▼                                       │
│                 Bounded download manager                        │
│                         │                                       │
│                         ▼                                       │
│                 Archive worker/builders                         │
│                         │                                       │
│                         ▼                                       │
│                 Chrome download handoff                         │
└─────────────────────────┼───────────────────────────────────────┘
                          ▼
                 Student's local ZIP files
```

### Component boundaries

#### Side Panel UI

Responsibilities:

- render the guided states;
- collect course and packaging choices;
- show estimates, progress, warnings, and results;
- expose cancellation and reauthentication guidance; and
- present the privacy and course-material notice.

It consumes normalized view models and progress events. It does not call Canvas
directly or construct ZIP paths.

#### Canvas session bridge

Responsibilities:

- receive an allow-listed request description;
- resolve it against the configured Canvas origin;
- execute a same-origin read request;
- validate response type and size metadata; and
- return structured results or typed errors.

It does not accept arbitrary origins, arbitrary executable code, or raw request
headers from other extension components.

#### Run coordinator

Responsibilities:

- own the packing state machine;
- route messages among the tab, Side Panel, and workers;
- persist only the minimal local state required for the current live run;
- handle cancellation and session pause; and
- release transient state after completion or cancellation.

Course bytes and page content must not be stored in `chrome.storage`. Extension
storage is limited to settings, current-run metadata, and non-sensitive progress
state.

#### Canvas adapter

Responsibilities:

- detect the supported host;
- access current-user, course, module, file, folder, and page endpoints;
- centralize Canvas pagination and throttling behavior;
- translate raw responses into internal models; and
- isolate narrow DOM fallbacks.

The MVP has one Canvas implementation. The interface remains small enough for a
future learning-platform adapter without pre-building unused Moodle, Blackboard,
or Brightspace abstractions.

#### Discovery and normalization

Responsibilities:

- enumerate the selected courses and supported resources;
- establish stable identities and relationships;
- calculate advertised byte estimates;
- classify local, external, unsupported, locked, and failed resources;
- deduplicate files by Canvas file ID; and
- produce a deterministic archive plan.

Raw Canvas responses must not cross into React components or archive builders.

#### Download manager

Responsibilities:

- bounded concurrency;
- retries with exponential backoff and jitter;
- `Retry-After` support;
- timeouts;
- cancellation;
- byte and item progress events;
- duplicate suppression; and
- typed failure collection.

The initial concurrency is four active requests. Only idempotent read requests
are retried. Network failures, `429`, and `5xx` responses receive at most three
attempts. Authentication failures pause the run rather than consuming retries.
Locked, missing, and other permanent `4xx` responses are recorded without
automatic retry.

#### Archive worker

Responsibilities:

- sanitize paths;
- transform Canvas pages into safe offline HTML;
- rewrite supported links to canonical local targets;
- generate course and top-level indexes;
- generate search data and the manifest;
- produce combined or per-course ZIPs; and
- report packaging and verification progress.

Archive work must not rely on a Manifest V3 service worker remaining alive. The
feasibility spike selects a browser-compatible streaming or disk-backed archive
mechanism and records the decision before the full download engine is built.

## 7. Internal data model

The internal model uses stable IDs and explicit resource states. Representative
types are shown for design clarity; final names can follow repository conventions.

```ts
type CourseId = string;
type ResourceId = string;

type CourseSummary = {
  id: CourseId;
  name: string;
  code?: string;
  term?: string;
  status: "active" | "completed" | "concluded" | "unknown";
};

type CourseArchivePlan = {
  course: CourseSummary;
  modules: ModulePlan[];
  files: FilePlan[];
  pages: PagePlan[];
  externalResources: ExternalResource[];
};

type ModulePlan = {
  id: ResourceId;
  name: string;
  position: number;
  items: ModuleItemPlan[];
};

type ModuleItemPlan = {
  id: ResourceId;
  title: string;
  position: number;
  indent: number;
  kind: "file" | "page" | "external" | "unsupported";
  targetId?: ResourceId;
};

type FilePlan = {
  id: ResourceId;
  displayName: string;
  contentType?: string;
  advertisedBytes?: number;
  canvasFolderPath: string[];
  localPath: string;
  downloadUrl: string;
};

type PagePlan = {
  id: ResourceId;
  slug: string;
  title: string;
  localPath: string;
};

type ArchiveFailure = {
  courseId: CourseId;
  resourceId?: ResourceId;
  resourceType: "course" | "module" | "file" | "page" | "archive";
  stage: "discovery" | "download" | "transform" | "package";
  code: string;
  reason: string;
  retryable: boolean;
  sourceUrl?: string;
};
```

Raw URLs remain internal unless they are safe Canvas URLs or intentional
external references. User-facing errors use human-readable reasons and do not
expose stack traces, cookies, headers, or sensitive identifiers.

## 8. Discovery and pagination

All Canvas list endpoints use one reusable pagination implementation.

Requirements:

- follow Canvas `Link` response headers rather than guessing page counts;
- reject a next-page URL whose origin differs from the configured Canvas host;
- detect pagination loops;
- allow cancellation between pages;
- preserve stable ordering; and
- expose page-level progress for diagnostics without logging response content.

Course discovery requests all enrollment states that remain visible to the
student. GradPack does not infer that a missing course should be accessible; it
shows only what the active session returns.

Discovery completes before packaging starts so GradPack can:

- deduplicate resources;
- calculate advertised sizes;
- present warnings;
- select the safe packaging mode; and
- create an immutable plan for the live run.

If Canvas omits a file size, the estimate is explicitly incomplete. Missing size
metadata cannot be treated as zero.

## 9. Packaging safety experiment

The product must attempt to capture every accessible in-scope resource without
an arbitrary course or file-count limit. Browser memory and writable-stream
behavior still impose real platform constraints.

Before the full archive implementation, a controlled spike must compare viable
browser-compatible packaging mechanisms using synthetic data on current Chrome
for macOS and Windows.

The experiment covers:

- one 250 MB file;
- one 1 GB file where the test machine permits it;
- many small files totaling at least 1 GB;
- multiple concurrent downloads;
- cancellation during download and packaging;
- insufficient disk space or denied save destination;
- service-worker suspension; and
- combined versus per-course archives.

The selected mechanism and measured safety policy are recorded in an architecture
decision record before the packaging UI is implemented. The policy must use
observable inputs such as advertised bytes, unknown-size resources, output mode,
and mechanism limits. It must not pretend to know available browser memory.

If a requested combined archive violates that policy, GradPack changes the run
to per-course ZIPs before retrieval begins and explains why. If a single course
still exceeds a proven mechanism limit, GradPack stops before wasting bandwidth
and reports the exact limitation. It must never silently omit resources to fit a
ZIP.

## 10. Archive format

### Combined archive

```text
GradPack_2026-08-16/
├── index.html
├── manifest.json
├── assets/
│   ├── archive.css
│   ├── search.js
│   └── search-data.js
└── courses/
    ├── corporate-strategy_12345/
    │   ├── index.html
    │   ├── modules.html
    │   ├── files/
    │   └── pages/
    └── corporate-finance_67890/
        └── ...
```

### Per-course archive

Each ZIP contains the same top-level files and one entry under `courses/`. This
keeps combined and per-course navigation behavior consistent.

### Canonical resources

- A Canvas file ID maps to one canonical local file per course archive.
- Repeated module items link to that file rather than duplicating its bytes.
- Canvas folder hierarchy is preserved where it remains safe and meaningful.
- The stable Canvas ID resolves safe-name collisions.
- Module hierarchy is represented in `modules.html` and course navigation, not
  by duplicating files into every module folder.

### Offline index

The top-level `index.html` provides:

- archive creation time and product version;
- course list and metadata;
- module navigation;
- file and page counts;
- search;
- failures and external-resource summaries; and
- the course-material responsibility notice.

The archive contains no remote JavaScript, fonts, styles, or analytics. It must
open directly from the extracted directory without a local web server.

### Search

Search is client-side and limited to:

- course names, codes, terms, and statuses;
- module and module-item titles;
- filenames and available file metadata;
- page titles; and
- text extracted from saved Canvas pages.

File contents are not indexed. There is no OCR, document parsing, vector search,
or AI search in the MVP.

Search data is emitted as a local JavaScript data file rather than fetched as
JSON, avoiding common `file://` fetch restrictions.

## 11. Manifest

Every archive contains `manifest.json` with a versioned schema.

Required top-level fields:

```json
{
  "schemaVersion": 1,
  "product": "GradPack",
  "productVersion": "0.1.0",
  "createdAt": "2026-08-16T12:00:00Z",
  "canvasHost": "frankfurtschool.instructure.com",
  "packaging": "combined",
  "status": "partial",
  "totals": {
    "courses": 18,
    "filesDownloaded": 642,
    "pagesSaved": 184,
    "externalResources": 5,
    "failures": 3,
    "bytesDownloaded": 123456789
  },
  "courses": [],
  "externalResources": [],
  "failures": []
}
```

Each course records:

- Canvas course ID;
- name, code, term, and status where available;
- archive status: `complete`, `partial`, `failed`, or `canceled`;
- planned and completed resource counts;
- advertised and downloaded bytes where known; and
- course-scoped failures and external resources.

Each successful file records its Canvas ID, canonical local path, content type,
advertised byte size when available, actual downloaded bytes, and module
references. Page records include their Canvas identity and local path.

The manifest never includes passwords, cookies, request headers, access tokens,
page bodies, or student profile data.

## 12. Offline HTML safety

Canvas page content, filenames, and metadata are untrusted input.

Saved pages must:

- remove scripts, inline event handlers, forms, frames, and executable embeds;
- remove or neutralize unsafe URL schemes;
- rewrite archived Canvas file and page links to canonical local paths;
- rewrite archived Canvas images to local paths;
- preserve unsupported or external links as clearly marked external URLs;
- add a restrictive Content Security Policy suitable for local static files;
- use escaped text for generated navigation and metadata; and
- preserve readable semantic structure where possible.

External links open only after deliberate student interaction and use safe
window-target attributes. GradPack does not request external hosts during
archive browsing.

## 13. Filename and path safety

Every path segment is normalized and sanitized before archive insertion.

The sanitizer must handle:

- `/` and `\`;
- control characters;
- `: * ? " < > |`;
- `.` and `..` segments;
- absolute and drive-prefixed paths;
- Unicode normalization;
- empty names;
- trailing spaces or periods;
- Windows reserved names;
- duplicate names;
- path-length limits; and
- path traversal attempts.

No Canvas-controlled value may escape the intended archive root. The archive
builder accepts only validated relative paths generated by the sanitizer; it
does not accept raw Canvas paths.

Collision handling is deterministic and includes the stable Canvas ID before a
numeric suffix is considered.

## 14. Failure handling

### Resource failures

A resource failure is recorded and packing continues when the remaining plan is
still usable. Examples include:

- locked or inaccessible file;
- deleted page;
- permanent `4xx` response;
- retry exhaustion;
- invalid or unsafe response;
- unsupported module item; and
- HTML transformation failure.

### Course failures

A course is `partial` when some resources succeed and others fail. A course is
`failed` only when GradPack cannot create a meaningful course index or retrieve
any planned local content.

### Run-level failures

A run stops when:

- session feasibility is lost and cannot be restored in the open tab;
- the required Canvas tab closes;
- archive initialization fails;
- the selected storage or streaming mechanism cannot safely represent the run;
- the student cancels; or
- a security invariant is violated.

When technically possible, already completed per-course ZIPs remain available.
The results screen distinguishes complete, partial, failed, and canceled output.

## 15. Chrome permissions

The baseline permission design is:

```json
{
  "permissions": ["downloads", "sidePanel", "storage"],
  "host_permissions": [
    "https://frankfurtschool.instructure.com/*"
  ]
}
```

The implementation may request a narrower equivalent based on the selected
archive mechanism. It must not add broad permissions without a documented,
reviewed need.

Specifically excluded unless a later approved design changes the requirement:

- `<all_urls>`;
- `cookies`;
- `history`;
- `bookmarks`;
- broad `tabs` access;
- blocking `webRequest`; and
- remotely hosted executable code.

## 16. Privacy and security

### Data boundary

The following remain local:

- course names and IDs;
- module and page content;
- filenames and file contents;
- student identity;
- progress and failures; and
- generated archives.

The MVP has no GradPack backend, cloud storage, telemetry, crash reporter, or
analytics provider.

### Logging

Production logs contain only operational state required for local diagnosis.
They must not include response bodies, course names, filenames, URLs containing
sensitive query parameters, cookies, headers, or student identifiers.

The feasibility build reports statuses and counts only. Any diagnostic export
must be explicitly initiated by the student and visibly previewed before it can
leave the device.

### User notice

Before the first packing run, GradPack explains:

- material is saved locally;
- GradPack retrieves only currently accessible resources;
- some external or protected resources cannot be archived; and
- the student is responsible for applicable copyright, licensing,
  confidentiality, and course-material restrictions.

The notice is informational and does not imply institutional endorsement.

### Threats addressed in the MVP

- malicious filenames and path traversal;
- unsafe Canvas HTML and script injection;
- untrusted external URLs;
- cross-origin request confusion;
- arbitrary request messages sent to the session bridge;
- session expiration and login-page masquerading;
- download floods and Canvas throttling;
- archive resource exhaustion;
- accidental secret or student-data commits; and
- remotely hosted extension code.

## 17. Testing strategy

### Unit tests

Required unit coverage includes:

- Canvas pagination: single page, multiple pages, missing links, invalid origins,
  loops, cancellation, and malformed headers;
- filename sanitization: Unicode, reserved names, collisions, traversal, empty
  names, and path-length handling;
- normalized model mapping;
- duplicate detection by Canvas file ID;
- retry and timeout policy;
- progress aggregation;
- manifest totals and statuses;
- HTML sanitization and link rewriting;
- archive path invariants; and
- packaging safety-policy decisions.

### Contract tests

The Canvas adapter uses small, anonymized fixtures covering:

- active, completed, and concluded courses;
- modules and indented module items;
- files, folders, pages, external links, and unsupported items;
- locked, hidden, and missing resources;
- pagination and throttling; and
- changed DOM fallback markup.

Fixtures must not contain real student identity, real course content, or private
Frankfurt School URLs beyond the configured public host.

### Browser-level tests

A synthetic Canvas test site exercises the unpacked extension in current Chrome:

- Side Panel opening and host detection;
- signed-in and signed-out states;
- course selection and grouping;
- combined and per-course packaging decisions;
- progress and cancellation;
- session loss and re-login;
- partial failures;
- archive download; and
- offline index navigation and search.

### Real-account pilot checklist

Manual tests on the maintainer's student account verify:

- the session bridge;
- historical course visibility;
- pagination with real data volumes;
- one page and one file download;
- one complete course archive;
- a multi-course run;
- combined-versus-separate safety behavior;
- macOS and Windows extraction;
- offline page, link, file, and search behavior; and
- absence of outbound GradPack data transfers.

Only pass/fail results, counts, browser version, OS version, and sanitized defect
descriptions may be recorded in the repository.

## 18. Open-source engineering baseline

The repository uses Apache License 2.0 and a public-history workflow built around:

- one Linear issue per focused change;
- one purpose-specific branch per issue;
- small, signed commits with clear imperative messages;
- pull requests for every change after the bootstrap commit;
- protected `main` with signed commits, linear history, resolved conversations,
  no force-pushes, and no deletion;
- automated format, type, test, build, security, and secret checks as they become
  applicable;
- reproducible builds and locked dependencies;
- reviewed dependency additions;
- no real student data or credentials in source, fixtures, screenshots, logs, or
  issue trackers; and
- maintainer-approved authorship and public materials without automated-tool
  attribution.

Before the first public release, the repository includes:

- a complete README;
- `CONTRIBUTING.md`;
- `CODE_OF_CONDUCT.md`;
- `SECURITY.md`;
- support and governance guidance;
- issue forms and a pull-request template;
- architecture decision records;
- CI and dependency/security automation;
- a changelog and release process; and
- Chrome Web Store privacy and permission documentation.

The repository remains private until the public-release checklist confirms that
the complete Git history contains no secrets, student data, institutional
confidential information, or temporary local artifacts.

## 19. Delivery gates

### Gate 0 — Repository foundation

- Signed maintainer identity is verified.
- `main` is protected.
- Local artifacts and secrets are ignored.
- Product design is approved through a pull request.

### Gate 1 — Session feasibility

- Current user request succeeds through the existing session.
- All accessible course states can be queried.
- One page is retrieved.
- One file is downloaded locally.
- No credential or cookie access is used.

Failure closes the current technical path and produces a decision record; it does
not trigger a password, token, or scraping expansion.

### Gate 2 — Archive feasibility

- The streaming or disk-backed packaging mechanism is selected.
- macOS and Windows scale tests establish the packaging safety policy.
- Cancellation and service-worker suspension are handled.
- The selected approach is documented in an architecture decision record.

### Gate 3 — One-course vertical slice

- Course discovery, modules, files, pages, offline index, search, and manifest
  work end to end for one real course.
- Individual failures produce a valid partial archive.
- Security and path tests pass.

### Gate 4 — Multi-course MVP

- All accessible courses can be selected.
- Combined and per-course packaging work within the safety policy.
- Progress, pause, cancellation, and results states work.
- Synthetic browser tests and the real-account checklist pass.

### Gate 5 — Controlled pilot

- Pilot users can install the unpacked extension.
- Feedback confirms whether expected material was captured and remains useful.
- No course content leaves student devices.
- Blocking reliability and usability defects are resolved.

### Gate 6 — Public open-source release

- Community, security, contribution, and governance files are complete.
- CI and repository rules are active.
- Git history and packaged artifacts pass privacy and secret review.
- Documentation supports independent local development.

### Gate 7 — Chrome Web Store readiness

- Permission justifications are documented.
- Privacy disclosures match observed behavior.
- Store assets and manual review steps are complete.
- The extension package is reproducible from the tagged source release.

## 20. Definition of done

The MVP is complete when a real Frankfurt School student can:

1. Install GradPack in desktop Chrome.
2. Sign in to Canvas normally.
3. Open the GradPack Side Panel without leaving Canvas.
4. See all courses the active session can access.
5. Select one or more courses.
6. Choose combined or per-course ZIPs.
7. Understand and accept any safety-driven packaging change.
8. Observe meaningful progress and cancel if needed.
9. Download every accessible in-scope resource the platform mechanism can safely
   represent without silent omission.
10. Open the extracted archive without GradPack, Canvas, or a local server.
11. Browse course and module structure.
12. Open downloaded files and sanitized pages.
13. Search archive metadata and saved page text locally.
14. See which resources failed or remain external and why.
15. Confirm that GradPack did not request a password, access cookies, or upload
    course content.

## 21. Approved decisions

- Persistent Chrome Side Panel, not a toolbar popup or separate page.
- Existing-session same-origin bridge, not OAuth or user-supplied tokens.
- Read-only Canvas interaction.
- API traversal as the primary integration, with narrow DOM fallbacks.
- Native Canvas content exports are excluded because creating them requires a
  state-changing request and may depend on permissions unavailable to students.
- All accessible course states.
- Minimal automatic content scope: files, pages, modules, and external links.
- Student choice between combined and per-course ZIPs.
- Automatic safety fallback to per-course ZIPs.
- Offline static archive with simple local search and a transparent manifest.
- Archive Indigo visual direction.
- English-first desktop Chrome pilot on macOS and Windows.
- Manual pilot before Chrome Web Store publication.
- Apache License 2.0 and a portfolio-grade, contributor-friendly public project.

No implementation work begins until this design is reviewed and the session
feasibility gate is represented in an implementation plan.
