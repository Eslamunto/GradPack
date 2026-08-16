# Live Canvas Test Harness Design

- **Status:** Approved
- **Date:** 2026-08-16
- **Linear:** GRAD-18 — Deliver the one-course classmate pilot
- **Related design:** `docs/design/2026-08-16-gradpack-classmate-pilot-design.md`

## 1. Purpose

GradPack needs a repeatable live smoke test against a developer's existing,
signed-in Frankfurt School Canvas session. The test must shorten the feedback
loop without exposing credentials or course data and without adding a testing
interface to the production extension.

This harness is contributor-facing development tooling. It does not change the
pilot's user experience, archive contract, or production permissions.

## 2. Success criteria

The harness succeeds when a developer can:

1. Build and load a clearly identified development-only GradPack extension.
2. Leave a signed-in Frankfurt School Canvas tab open.
3. Rebuild and reload the development extension without repeatedly operating
   Chrome's extension-management page.
4. Trigger fixed live smoke-test commands through the open Canvas tab.
5. Receive only schema-validated, sanitized status categories.
6. Confirm through automated tests that the production build contains no
   harness entry point, command, or manifest capability.

After the one-time development-extension bootstrap, ordinary build, reload,
run, and result collection should not require manual interaction. Reauthentication
and browser permission prompts remain explicit human actions.

## 3. Build separation

The existing production command remains authoritative:

- `pnpm build` writes the Chrome Web Store-compatible extension to `dist/`.
- `pnpm build:dev` writes the development extension to `dist-dev/`.

The development build uses a distinct extension name and enables the harness
at compile time. Production code paths are removed by the production build,
not merely hidden at runtime. Production manifest permissions and host access
remain unchanged.

Build-contract tests inspect both outputs. They fail if the production bundle
contains the development channel, reload command, result marker, or another
harness-specific identifier.

## 4. Components

### 4.1 Development command bridge

The existing isolated relay gains a development-only bridge on the exact
Frankfurt School Canvas origin. It accepts a small discriminated union of fixed
commands:

- `RELOAD_DEV_EXTENSION`
- `RUN_LIVE_SMOKE_TEST`
- `CLEAR_LIVE_TEST_RESULT`

Messages must have the expected channel, version, origin, source window, exact
field set, scalar bounds, and fresh run identifier. Arbitrary code, URLs, HTTP
methods, headers, bodies, course identifiers, and payloads are rejected.

The bridge is absent from production output.

### 4.2 Development reload path

The development service worker accepts only the closed reload command from the
packaged development relay and invokes Chrome's extension reload operation.
The controlling browser then refreshes the existing Canvas tab so the newly
built content script and runner are installed in that document.

Reload has no data payload and produces no persistent state. A missing relay,
stale build, or disconnected browser yields a bounded failure instead of a
retry loop.

### 4.3 Live smoke-test runner

The live runner reuses GradPack's production endpoint constructors, HTTP
boundary validation, pagination limits, concurrency limits, and response-shape
checks. It operates only on course identifiers discovered during the same
ephemeral run.

The initial live gate validates:

- the current authenticated Canvas session;
- accessible-course discovery;
- module discovery for one bounded candidate set;
- direct retrieval of one representative Canvas page; and
- bounded streaming of one representative non-HTML Canvas file.

It never logs or returns course names, course identifiers, module names, file
names, URLs, response bodies, cookies, tokens, or headers. File bytes are read
only through the existing bounded validator and are discarded after the smoke
test.

### 4.4 Sanitized result marker

The development relay exposes one fixed result marker in the Canvas document
for local automation to read. The marker contains only a terminal status and
allowlisted coarse categories, for example session, permissions, resource
availability, content type, redirect class, or safety bound.

The marker has a maximum length, cannot contain free-form server text, and is
removed before a new run. Production builds neither create nor read it.

## 5. Data flow

```text
Developer builds dist-dev
    → existing development relay requests extension reload
    → browser refreshes the signed-in Canvas tab
    → local controller posts a closed smoke-test command
    → relay and runner validate origin, shape, run, and course discovery
    → runner performs bounded read-only Canvas requests
    → relay writes one sanitized terminal result marker
    → local controller reads and clears the marker
```

The controller interacts with the visible tab and DOM only. It does not inspect
cookies, passwords, browser profiles, local storage, session storage, or
extension storage.

## 6. Safety and privacy boundaries

- Live testing is opt-in and local; it never runs in CI.
- Only the exact Frankfurt School Canvas HTTPS origin is accepted.
- All Canvas requests use internally constructed, allowlisted read-only paths.
- The harness cannot accept an arbitrary course identifier or URL.
- Module and item traversal is bounded, with concurrency no greater than two.
- Representative file streaming has a hard five-MiB ceiling and aborts when
  the bound is reached.
- Cross-origin, downgraded, login, HTML, and unexpected redirects fail closed.
- No production logging, analytics, telemetry, screenshots, or captured Canvas
  content are introduced.
- Authentication expiry and Chrome permission prompts stop the run and require
  the developer to act explicitly.

## 7. Error handling

Each command has one terminal result correlated to its run identifier. Timeouts,
malformed messages, missing extension components, stale runs, concurrent runs,
session failures, permission failures, unsafe redirects, unsupported content,
and resource bounds map to fixed categories.

The controller may retry only idempotent setup operations within a small fixed
limit. It does not automatically retry authentication, permission, or safety
failures. A reload timeout leaves the prior extension state untouched and
reports a bootstrap failure.

## 8. Verification

Automated tests cover:

- RED/GREEN behavior for each development command and parser boundary;
- wrong origin, source, version, field set, run identifier, and sender;
- production-build exclusion of every harness identifier;
- distinct development manifest identity;
- reload success, timeout, and stale-relay behavior;
- result sanitization, length bounds, replacement, and clearing;
- same-run course selection and busy-run rejection;
- module/page/file request and streaming bounds; and
- authentication, permission, redirect, HTML, and abort failures.

The normal `pnpm verify` gate continues to build and inspect the production
artifact. A separate opt-in command builds the development artifact and runs
its automated contract tests. The live smoke test is recorded only as a
sanitized local gate result and is never uploaded as a CI artifact.

## 9. Repository policy

The harness source, tests, and contributor documentation are committed because
they define a reproducible engineering workflow. Generated `dist-dev/` output,
live results, browser state, and local diagnostic reports remain ignored.

Public documentation clearly labels the harness as development-only and states
that it requires the contributor's own authorized Canvas access. It does not
encourage sharing sessions, credentials, or downloaded course material.
