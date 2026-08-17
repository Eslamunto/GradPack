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

## Cancellation and failures

Cancellation, Canvas session loss, tab navigation, and tab closure stop the
active run. Completed course ZIPs that have already been handed to Chrome are
preserved; the current incomplete course is never downloaded. Transient ZIP
buffers are cleared after handoff or failure.

The completion view reports the effective packaging mode, completed and failed
course counts, output count, and aggregate resource outcomes. Each archive's
`manifest.json` remains the authoritative resource-level record.
