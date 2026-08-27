# GRAD-20 stale-extension installation guidance

## Problem

The verified Alpha 6 release ZIP and extracted extension both identify as
`0.1.0-alpha.6`, but a maintainer validation run produced an archive identifying
as Alpha 5. The browser was still executing a previously installed unpacked
Alpha 5 extension. The current installation guide does not tell an upgrading
tester to remove an older GradPack installation, and it does not tell the tester
to refresh a Canvas tab that was already open when the extension was loaded.

## Scope

This repair changes classmate-facing installation guidance only. It does not
change extension code, permissions, archive behavior, or the versioned inner
extension ZIP.

The **Load the extension** procedure will:

1. tell the tester to remove any existing GradPack installation before loading
   the supplied unpacked folder;
2. tell the tester to refresh the signed-in Frankfurt School Canvas tab once
   after loading GradPack; and
3. preserve all existing checksum, privacy, retrieval, retry, and removal
   guidance.

## Verification

Release-surface tests will require both upgrade-safety instructions so a future
documentation rewrite cannot silently remove them. The normal `pnpm verify`
suite must pass. The resulting source document will be copied into the visible
classmate release folder, and the outer classmate bundle will be regenerated
and integrity-tested.

Because neither the production extension files nor their contents change, the
inner `gradpack-0.1.0-alpha.6.zip` and its SHA-256 sidecar must remain
byte-identical. Only the outer classmate bundle checksum is expected to change.

## Live acceptance

After the documentation PR is merged, the maintainer will remove the stale
Alpha 5 installation, explicitly load the exact Alpha 6 extracted folder,
refresh Canvas, and run one real archive. Chrome and the generated archive
manifest must both report `0.1.0-alpha.6`. The independent classmate checklist
remains a separate GRAD-20 acceptance gate.
