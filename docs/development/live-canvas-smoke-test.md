# Live Canvas smoke test

This is contributor-only development tooling. It exercises a narrow,
read-only smoke check using the contributor's own authorized signed-in Canvas
tab. It is not an end-user GradPack feature.

## Safety boundary

Use this workflow only with an open tab at the exact origin
`https://frankfurtschool.instructure.com`. Keep the tab signed in with your
own authorized account. Do not share credentials, cookies, or sessions, and do
not inspect browser or extension storage. The harness returns only a
sanitized, schema-validated result; it never records Canvas names, identifiers,
URLs, content, headers, or authentication material.

The file check is bounded to 5 MiB. The harness uses fixed read-only requests
and stops on authentication, permission, redirect, content-type, or size
failures. Live tests never run in CI, and sanitized local results are never CI
artifacts.

`pnpm build` remains the production build: it writes `dist/` and excludes the
development relay, runner, commands, and result marker. The separate
`pnpm build:dev` command writes `dist-dev/` with the distinct **GradPack Dev**
identity. Do not load `dist-dev/` for normal use or publish it.

## One-time Chrome bootstrap

1. Run `pnpm build:dev`.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load
   unpacked**, and select this repository's `dist-dev/` directory.
3. Confirm the loaded extension is named **GradPack Dev**.
4. Open (or keep open) your own authorized signed-in Canvas tab at the exact
   origin above.

Loading the unpacked extension is the only bootstrap step that requires the
Chrome extensions page. The repeated loop uses the fixed commands below from
the existing Canvas tab.

## Build, reload, run, read, and clear

Build the development extension before each loop:

```bash
pnpm build:dev
```

In the authorized Canvas tab's DevTools Console, send only the following
envelopes. Replace every example `runId` with a fresh value matching
`run-[a-z0-9-]{8,64}`. The target origin is fixed; do not change it.

First clear the prior marker:

```js
window.postMessage(
  {
    source: "gradpack-dev-controller",
    payload: {
      channel: "gradpack/dev/v1",
      type: "CLEAR_LIVE_TEST_RESULT",
      runId: "run-clear-12345678",
    },
  },
  "https://frankfurtschool.instructure.com",
);
```

Then request the development extension reload. Wait for the browser connection
to return before refreshing the Canvas tab; the reload deliberately does not
produce a result marker.

```js
window.postMessage(
  {
    source: "gradpack-dev-controller",
    payload: {
      channel: "gradpack/dev/v1",
      type: "RELOAD_DEV_EXTENSION",
      runId: "run-reload-12345678",
    },
  },
  "https://frankfurtschool.instructure.com",
);
```

Refresh that same Canvas tab after the connection returns, then start a fresh
run:

```js
window.postMessage(
  {
    source: "gradpack-dev-controller",
    payload: {
      channel: "gradpack/dev/v1",
      type: "RUN_LIVE_SMOKE_TEST",
      runId: "run-live-12345678",
    },
  },
  "https://frankfurtschool.instructure.com",
);
```

Poll only `document.documentElement.getAttribute("data-gradpack-dev-result")`
until it contains the matching terminal result or your fixed local timeout
expires. Record only the sanitized result categories in an ignored local gate
report. A successful run has `outcome: "pass"`, session and courses available,
`modules: "page-and-file"`, page and file available, and a safe HTTPS redirect
category. Do not record any browser, account, or Canvas data.

After reading the matching result, clear it by repeating the
`CLEAR_LIVE_TEST_RESULT` envelope with another fresh valid `runId`.

## Recovery

- **Expired login:** stop the run and sign in through Canvas yourself. Do not
  export, copy, or share a session.
- **Missing relay:** confirm **GradPack Dev** is still loaded, rebuild with
  `pnpm build:dev`, reload the extension, and refresh the exact-origin tab
  before starting a new run.
- **Reload timeout:** do not retry indefinitely. Treat it as a failed local
  setup, verify the unpacked extension manually, then restart the loop with
  fresh run identifiers.
- **Chrome permission prompt:** stop and let the contributor explicitly accept
  or reject the prompt. Do not automate, bypass, or infer that decision.

If the result reports a safety, session, permission, redirect, content, or
size failure, stop at that terminal result and investigate without collecting
credentials or course data.
