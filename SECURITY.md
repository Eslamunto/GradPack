# Security policy

GradPack processes authenticated course material inside the user's browser, so
privacy and origin boundaries are security concerns.

Multi-course discovery is fail-closed per course. Course-local failures cross
the extension boundary only as one of four fixed categories: size limit,
Canvas unavailable, safety validation, or unexpected local operation. Raw
exception text and Canvas response details are not shown or retained in the
Side Panel. A failed course is excluded from retrieval, while independently
validated courses may continue. Session loss, navigation, cancellation,
message-contract failure, and run-global invariant failure remain terminal.

Retry creates a fresh run, refreshes the accessible course list, and includes
only unfinished course IDs that are still available. It does not bypass the
review step or any per-course 250 MiB, resource-count, path, origin, response,
or archive validation.

## Report a vulnerability privately

Use GitHub's **private vulnerability reporting** channel for this repository
when it is enabled. Do not open a public issue containing exploit details or
sensitive data. If private reporting is not available, open a minimal public
issue asking the maintainer to enable a private reporting path, without adding
the vulnerability details.

Do not include Canvas or course data, course names, filenames, IDs, URLs,
screenshots, archives, student identity, cookies, tokens, headers, request or
response bodies, or browser-profile data in any report. Use only invented,
privacy-safe reproduction material.

## Supported version

The current `0.1.0-alpha.5` classmate pilot is pre-release software. Security
fixes are made on the latest repository version; no long-term support window is
promised during the alpha pilot.
