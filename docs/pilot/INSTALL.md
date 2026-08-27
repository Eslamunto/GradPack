# Install the GradPack classmate pilot

GradPack is currently an alpha classmate pilot. It is distributed manually as
an unpacked extension, not through the Chrome Web Store.

## Before installing

- Use desktop Chrome 116 or newer.
- Keep both supplied files together: `gradpack-0.1.0-alpha.6.zip` and its
  `.sha256` sidecar.
- GradPack saves the resulting course archive locally. It has no analytics,
  telemetry, backend, or cloud upload.
- GradPack can select one or more accessible courses and produce one
  combined archive or one ZIP per course.
- Unknown-size files are streamed under the hard 250 MiB per-course cap.
- If a combined request includes unknown-size files, GradPack shows the
  packaging fallback before retrieval and falls back to per-course output
  after confirmation.
- If a requested combined archive exceeds its aggregate size or entry limit,
  GradPack shows the packaging fallback before retrieval and uses per-course
  output only after confirmation.

## Verify the checksum

Run the command for your operating system in the folder containing both
supplied files. Continue only when the calculated SHA-256 matches the sidecar.

### macOS

```bash
shasum -a 256 -c gradpack-0.1.0-alpha.6.zip.sha256
```

### Linux

```bash
sha256sum -c gradpack-0.1.0-alpha.6.zip.sha256
```

### Windows PowerShell

```powershell
Get-FileHash .\gradpack-0.1.0-alpha.6.zip -Algorithm SHA256
Get-Content .\gradpack-0.1.0-alpha.6.zip.sha256
```

Compare the two hexadecimal values exactly. Stop and contact the maintainer if
they differ.

## Load the extension

1. Extract the extension ZIP into a new local folder. Do not select the ZIP
   itself in Chrome.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder.
5. Sign in to Frankfurt School Canvas in a normal Chrome tab.
6. Keep that tab open, signed in, and unnavigated while GradPack works.
7. Select GradPack in the Chrome toolbar to open its Side Panel.
8. Select individual courses or use **Select all courses** to select every
   displayed active, completed, and concluded course; then choose combined or
   per-course output and start planning.
9. Review the ready and skipped courses plus any packaging fallback notice,
   then confirm retrieval for the ready courses.
10. If GradPack reports unfinished courses after downloading the safe
    archives, select **Retry unfinished courses**. The retry checks only those
    courses again and shows a new review before retrieval.
11. Keep the resulting archive or archives local. Extract each ZIP before
    opening its `index.html`.

GradPack retrieves only resources available to the signed-in Canvas session.
Some resources may be unavailable, unsupported, or retained as labeled
external links; the archive manifest records those outcomes.

## Remove the pilot

Open `chrome://extensions`, find GradPack, and select **Remove**. You may then
delete the extracted extension folder. Course archives remain local until you
delete them separately.

## Report a defect safely

Return only the coarse fields in [TEST_CHECKLIST.md](TEST_CHECKLIST.md). Do not
send course names, filenames, IDs, URLs, screenshots, archives, page text,
request or response data, cookies, headers, or student identity. For a security
issue, follow the repository [security policy](../../SECURITY.md).
