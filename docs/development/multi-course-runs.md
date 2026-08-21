# Multi-course runs

GradPack multi-course runs stay local to the connected, signed-in Canvas tab.
The Side Panel first lists accessible courses, then sends the selected IDs and
requested packaging mode to the page runner. Discovery completes for every
selected course before the user confirms retrieval.

## Packaging policy

- **Per-course** produces one ZIP for each successfully completed course.
- **Combined** produces one namespaced ZIP when the aggregate advertised bytes
  and resource count fit the in-memory archive limits.
- A combined request is shown as a pre-retrieval fallback to per-course output
  when either aggregate limit would be exceeded.
- An individual course that is too large, has an unknown unsafe size, or fails
  a path/resource safety check stops before retrieval begins.

Course execution is sequential. Each course keeps the existing resource
concurrency limit of two, and every discovered resource receives a terminal
manifest outcome. Course-local failures do not invalidate already completed
course archives or prevent later selected courses from running.

## Offline archive interface

Every course ZIP contains static Home, Modules, Pages, Files, and Archive Status
pages styled as a familiar Canvas-like course workspace while retaining clear
GradPack identity. Saved Canvas pages are sanitized fragments wrapped in the
same trusted shell. Combined ZIPs add Courses and Combined Archive Status pages;
all nested course pages include a pre-rendered local backlink to the combined
course list.

The interface is fully offline and contains no archive JavaScript, remote
styles, fonts, images, or telemetry. All generated links are relative local
paths except explicitly identified external course resources. Seven core ZIP
entries are reserved per course, so a course can contain at most 65,528
discovered resource entries. The classic ZIP ceiling of 65,535 total entries is
also enforced for combined output.

## Cancellation and failures

Cancellation, Canvas session loss, tab navigation, and tab closure stop the
active run. Completed course ZIPs that have already been handed to Chrome are
preserved; the current incomplete course is never downloaded. Transient ZIP
buffers are cleared after handoff or failure.

The completion view reports the effective packaging mode, completed and failed
course counts, output count, and aggregate resource outcomes. Each archive's
`manifest.json` remains the authoritative resource-level record.

## Release acceptance

Automated tests extract individual and combined archives, parse every generated
page under a `file://` URL, reject network-bearing markup, and verify that every
local link resolves. Before a pilot merge, a maintainer must also open an
extracted individual and combined archive directly in Chrome with networking
disabled, then check keyboard order, visible focus, desktop layout, and the
single-column layout below 48rem. This manual visual gate remains required when
the test environment cannot navigate to local files.
