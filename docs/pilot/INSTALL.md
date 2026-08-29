# Install the GradPack classmate pilot

GradPack is currently an alpha classmate pilot. It is distributed manually as
an unpacked extension, not through the Chrome Web Store.

## Before installing

- Use desktop Chrome 116 or newer.
- Keep both supplied files together: `gradpack-0.1.0-alpha.7.zip` and its
  `.sha256` sidecar.
- GradPack can select one or more accessible courses and produce one
  combined archive or one ZIP per course.
- Unknown-size files are streamed under the hard 250 MiB per-course cap.
- If a combined request includes unknown-size files, GradPack shows the
  packaging fallback before retrieval and falls back to per-course output
  after confirmation.
- If a requested combined archive exceeds its aggregate size or entry limit,
  GradPack shows the packaging fallback before retrieval and uses per-course
  output only after confirmation.
- A course larger than 250 MiB is downloaded as sequential self-contained ZIP
  parts, each under the same hard payload cap. Cross-part material is labelled
  **Available in Part N** instead of linked.
- A valid file whose Canvas folder placement is unavailable is saved under
  `files/unfiled/` with a visible notice. An individual file larger than the
  part cap is listed as unavailable rather than fetched.
- These behaviors require no additional permission or origin.

## Privacy and responsible use

GradPack works only with Frankfurt School Canvas and uses the session already
open in your browser. Everything is processed locally—there is no telemetry,
backend, or cloud upload. Your archives are saved only to your computer.

**For personal study:** Please keep downloaded course materials for your own
use and do not redistribute them.

## Verify the checksum

Run the command for your operating system in the folder containing both
supplied files. Continue only when the calculated SHA-256 matches the sidecar.

### macOS

```bash
shasum -a 256 -c gradpack-0.1.0-alpha.7.zip.sha256
```

### Linux

```bash
sha256sum -c gradpack-0.1.0-alpha.7.zip.sha256
```

### Windows PowerShell

```powershell
Get-FileHash .\gradpack-0.1.0-alpha.7.zip -Algorithm SHA256
Get-Content .\gradpack-0.1.0-alpha.7.zip.sha256
```

Compare the two hexadecimal values exactly. Stop and contact the maintainer if
they differ.

## Load the extension

1. Extract the extension ZIP into a new local folder. Do not select the ZIP
   itself in Chrome.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. If GradPack is already installed, select **Remove** and confirm before continuing.
5. Select **Load unpacked** and choose the extracted folder.
6. Sign in to Frankfurt School Canvas in a normal Chrome tab.
7. Refresh the signed-in Canvas tab once after GradPack loads.
8. Keep that tab open, signed in, and unnavigated until every ZIP part finishes
   downloading.
9. Select GradPack in the Chrome toolbar to open its Side Panel.
10. Select individual courses or use **Select all courses** to select every
    displayed active, completed, and concluded course; then choose combined or
    per-course output and start planning.
11. Review the ready and skipped courses, packaging fallback notice, and
    expected ZIP count; then confirm retrieval for the ready courses.
12. If GradPack reports unfinished courses after downloading the safe
    archives, select **Retry unfinished courses**. The retry checks only those
    courses again and shows a new review before retrieval.
13. Keep the resulting archive or archives local. Extract each ZIP before
    opening its `index.html`. For multipart courses, keep all numbered parts
    and open each part's `index.html` as needed.

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
issue, contact the maintainer privately through the same channel that delivered
the pilot. Do not put vulnerability details or sensitive data in a public issue.
