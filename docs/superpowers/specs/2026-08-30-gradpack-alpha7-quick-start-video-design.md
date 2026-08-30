# GradPack Alpha 7 Quick-Start Video Design

## Goal

Produce a concrete, fast, beginner-friendly GradPack Alpha 7 video that covers
installation and the first course download in approximately 55 seconds. The
quick-start video supplements the existing 5:40 installation guide; it does not
replace or modify that guide.

## Audience and success criteria

The audience is nontechnical Frankfurt School classmates using Chrome on macOS
or Windows. A successful viewer can identify the complete shared folder,
extract the extension, load it in Chrome, reconnect it to Canvas, choose
courses, review discovery, and begin retrieval without needing to understand
the implementation.

The result succeeds when:

- the encoded duration is between 54 and 56 seconds;
- every instruction is visible and narrated without accelerated speech;
- the installation and first-download flow is complete;
- the detailed 5:40 guide remains available as the fallback;
- no real course, student, account, browser, or Canvas data appears; and
- the final MP4 and SRT pass the media, privacy, and repository gates.

## Delivery contract

- Video filename: `GradPack-Alpha-7-Quick-Start.mp4`.
- Caption filename: `GradPack-Alpha-7-Quick-Start.srt`.
- Source version: GradPack `0.1.0-alpha.7` from merged `main` commit
  `3ab29b97f8d2929c341a8d173d8b424b2fdf58e1`.
- Target runtime: exactly 55 seconds in the canonical scene source; accepted
  encoded duration is 54–56 seconds.
- Video: 1920×1080, 16:9, 30 fps, H.264, `yuv420p`.
- Audio: Samantha `en_US` narration encoded as 48 kHz AAC.
- Captions: sentence case, burned into the MP4 and supplied as UTF-8 SRT from
  the same canonical strings.
- Maximum delivery size: 25 MiB.
- Distribution: copy verified MP4 and SRT into the visible Alpha 7 classmate
  bundle without changing the extension ZIP or checksum.

## Timeline and content

### Scene 1 — Quick setup (`0–4s`)

Introduce GradPack Alpha 7 as the fast route to local Canvas archives. Keep the
opening visual minimal so the first action begins immediately.

### Scene 2 — Download and verify (`4–10s`)

Show the complete shared folder. Tell viewers to keep all files together and
follow `INSTALL.md` to verify the extension ZIP before continuing. The short
video does not attempt to narrate separate Mac and Windows checksum commands;
the detailed guide and `INSTALL.md` retain those instructions.

### Scene 3 — Extract (`10–16s`)

Extract the ZIP to the neutral example location
`Documents/GradPack-Alpha-7`. State that Chrome needs the extracted folder,
not the ZIP.

### Scene 4 — Chrome extensions (`16–22s`)

Open `chrome://extensions` and enable Developer mode. Use the approved
privacy-safe synthetic Chrome surface and one unambiguous visual callout.

### Scene 5 — Load Alpha 7 (`22–29s`)

Select **Load unpacked**, choose `Documents/GradPack-Alpha-7`, and confirm that
GradPack `0.1.0-alpha.7` is enabled.

### Scene 6 — Reconnect Canvas (`29–35s`)

Sign in to Frankfurt School Canvas, refresh once, keep the tab open, and open
GradPack from Chrome.

### Scene 7 — Choose courses (`35–42s`)

Choose individual synthetic courses or **Select all courses**, retain
**One ZIP per course**, and start discovery.

### Scene 8 — Review and retrieve (`42–48s`)

Review ready and skipped courses, confirm retrieval, and keep Canvas open until
the expected ZIP count is complete.

### Scene 9 — Trust and responsible use (`48–55s`)

End with a compact reminder: archives remain on the student's computer and
downloaded materials are for personal study only. Point viewers to the detailed
guide when they need troubleshooting or platform-specific help.

## Architecture

Add a separate canonical quick-start scene module containing timing,
narration, captions, synthetic screen text, output names, and SRT generation.
Do not change the long-form scene contract.

Reuse the existing video components:

1. the SVG scene renderer and synthetic Chrome capture generator;
2. the bundled `sharp` runtime for 1920×1080 frame rasterization;
3. macOS `say` with Samantha for per-scene narration;
4. FFmpeg for fixed-duration H.264/AAC scene segments and concatenation; and
5. the validator patterns for codecs, size, timing, captions, audio level,
   source commit, filenames, and privacy.

The generator produces six deterministic Chrome captures, including one
quick-start composite that shows both **Load unpacked** and the enabled Alpha 7
card. Their SHA-256 hashes are part of the content contract, checked before
embedding, recorded in build metadata, and rechecked during validation.

The quick-start build must have independent output names and metadata so it
cannot overwrite the detailed guide. Generated frames, audio, segments, browser
captures, and build metadata remain under `/private/tmp` and outside Git.

## Privacy and safety boundaries

Use only `Example Finance Course` and `Sample Strategy Course` as course names.
The only visible filesystem path is `Documents/GradPack-Alpha-7`. Chrome views
remain synthetic because the accessibility controller cannot safely distinguish
the temporary clean profile from the user's normal Chrome state.

Never expose real course names, course IDs or URLs, student identity, email,
browser history, bookmarks, passwords, unrelated tabs or extensions, archives,
course contents, cookies, headers, tokens, network traffic, developer tools, or
a user home-directory name.

The final trust statement must preserve these promises:

- works only with Frankfurt School Canvas;
- uses the student's existing signed-in session;
- no telemetry, backend, or cloud upload;
- archives remain on the student's computer; and
- downloaded course materials are for personal study and must not be
  redistributed.

## Error handling

The build stops if a required synthetic capture is missing or differs from its
approved SHA-256 hash, narration is empty or exceeds its scene duration, FFmpeg
or FFprobe fails, the source commit or version differs, output names collide
with the long-form guide, the encoded runtime falls outside 54–56 seconds, the
video exceeds 25 MiB, captions are malformed, the audio track is silent, or a
privacy pattern matches.

No failed or partially validated MP4 or SRT is copied into the classmate
release folder.

## Verification

Automated checks must prove:

- nine unique scenes total exactly 55 seconds;
- caption lines remain readable and derive from the canonical scene source;
- narration fits a natural speech budget and produces non-silent audio;
- MP4 output is 1920×1080 H.264 at 30 fps with `yuv420p` and 48 kHz AAC;
- encoded duration is 54–56 seconds and size is at most 25 MiB;
- SRT cues are monotonic, non-overlapping, and end at 55 seconds;
- filenames and metadata identify the quick-start outputs;
- privacy scans contain no prohibited information;
- the original Alpha 7 ZIP still matches its checksum and passes `unzip -t`;
  and
- `CI=true pnpm verify` remains green.

Visual review must inspect all nine full-resolution frames and a contact sheet.
The final MP4 must decode from beginning to end, display readable burned
captions, contain audible narration, and show one clear action target per
Chrome step.

## Sharing-guide update

Update `SHARE_WITH_CLASSMATES.md` in the local release bundle to recommend the
55-second quick start first and the 5:40 installation guide for detailed help.
List both quick-start files without removing any existing release artifact.
