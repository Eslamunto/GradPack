# Alpha 7 installation video production

Generated browser captures, narration, frames, and videos belong under
`/private/tmp/gradpack-alpha7-video/` and must never be committed.

Verify and extract the source extension:

```bash
cd "$GRADPACK_RELEASE_DIR"
shasum -a 256 -c gradpack-0.1.0-alpha.7.zip.sha256
mkdir -p /private/tmp/gradpack-alpha7-video/extension
unzip -q gradpack-0.1.0-alpha.7.zip -d /private/tmp/gradpack-alpha7-video/extension
```

Launch a temporary Chrome profile with no personal state:

```bash
open -na "Google Chrome" --args \
  --user-data-dir=/private/tmp/gradpack-alpha7-video/chrome-profile \
  --no-first-run --disable-sync --disable-background-networking \
  --load-extension=/private/tmp/gradpack-alpha7-video/extension \
  chrome://extensions
```

Use Computer Use to maximize only this clean window, enable Developer mode,
show the GradPack card, and capture the required states. Do not sign in, open
another tab, or expose a file picker path. Recreate the folder-selection frame
synthetically if the picker would expose a home-directory name.

If Computer Use cannot distinguish the temporary profile from the user's normal
Chrome window, stop immediately and generate all five Chrome states with
`generate-alpha7-chrome-captures.mjs`. This privacy fallback is preferred over
capturing any personal browser state.
