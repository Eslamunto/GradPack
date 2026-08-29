# GradPack Alpha 7 Installation Video Design

## Goal

Produce a beginner-friendly installation and first-use video for non-technical
Frankfurt School classmates. The video should let a mixed macOS and Windows
audience install GradPack `0.1.0-alpha.7`, download accessible Canvas courses,
and open an offline archive without needing help from a developer.

## Deliverables

The classmate release folder receives:

- `GradPack-Alpha-7-Installation-Guide.mp4` — the primary narrated video with
  burned-in English captions;
- `GradPack-Alpha-7-Installation-Guide.srt` — a separate caption track for
  players that support selectable captions; and
- an updated `SHARE_WITH_CLASSMATES.md` entry that lists the video alongside
  the existing ZIP, checksum, installation guide, and test checklist.

The MP4 is a derived release artifact and is not committed to Git. Reproducible
text sources, scene definitions, and rendering instructions may be committed;
generated screenshots, narration audio, frame sequences, and temporary browser
profiles remain outside source control.

## Audience and Format

- Audience: non-technical classmates using desktop Chrome on macOS or Windows.
- Runtime: target 5 minutes 40 seconds; acceptable final range is 5:15–6:00.
- Canvas scope: Frankfurt School Canvas only.
- Video: 1920×1080, 16:9, 30 frames per second, H.264, `yuv420p` pixel format.
- Audio: AAC, 48 kHz, clear English narration using the installed Samantha
  `en_US` system voice.
- Captions: sentence case, burned into the MP4 and supplied as UTF-8 SRT.
- Maximum delivery size: 100 MiB.
- Visual style: GradPack navy and white, large cursor targets, restrained click
  rings, simple arrows, one action per shot, and no decorative motion that
  competes with the instructions.

## Production Approach

Use the approved guided-hybrid format:

1. Record or capture generic Chrome installation actions in a temporary clean
   browser profile with no browsing history, signed-in account, personal
   bookmarks, saved passwords, or unrelated extensions.
2. Use synthetic local mock screens for Canvas course selection, GradPack
   discovery/review, download progress, and the offline archive. Synthetic
   course names use `Example Finance Course` and `Sample Strategy Course` only.
3. Use neutral Finder and File Explorer illustrations for operating-system
   differences. The main Chrome and GradPack sequence remains universal.
4. Generate narration and captions from one canonical scene script so spoken
   and displayed instructions cannot diverge.
5. Assemble scenes, highlights, narration, captions, and transitions with
   FFmpeg. Use short crossfades only between major sections; action steps use
   cuts so the cursor target remains clear.

## Storyboard

### Scene 1 — Welcome and trust (`0:00–0:30`)

Show the GradPack name, Alpha 7 version, and a simple local-laptop graphic.
Explain that GradPack works only with Frankfurt School Canvas, uses the Canvas
session already open in Chrome, has no telemetry, backend, or cloud upload, and
saves archives to the student's computer. End with the personal-study and
non-redistribution reminder.

### Scene 2 — Download the complete folder (`0:30–0:55`)

Show the five Alpha 7 distribution items together: ZIP, SHA-256 sidecar,
`INSTALL.md`, `TEST_CHECKLIST.md`, and this installation video. Tell the viewer
to download the complete shared folder rather than only the ZIP.

### Scene 3 — Verify the checksum (`0:55–1:35`)

Use a split screen:

- macOS: open Terminal in the shared folder, paste
  `shasum -a 256 -c gradpack-0.1.0-alpha.7.zip.sha256`, and highlight `OK`.
- Windows: open PowerShell in the shared folder, run `Get-FileHash` and
  `Get-Content` as documented in `INSTALL.md`, and highlight the two matching
  hexadecimal values.

Explain that the viewer should stop and contact the maintainer if verification
fails or the values differ.

### Scene 4 — Extract into a permanent folder (`1:35–2:05`)

Show macOS Finder and Windows File Explorer extracting the ZIP. Name the
example destination `Documents/GradPack-Alpha-7`. Explain that Chrome loads the
extracted folder, not the ZIP, and the folder should not be moved or deleted
while the extension is installed.

### Scene 5 — Load GradPack in Chrome (`2:05–2:55`)

In a clean Chrome profile:

1. enter `chrome://extensions` in the address bar;
2. enable **Developer mode**;
3. remove an older GradPack pilot if one is present;
4. select **Load unpacked**;
5. choose the extracted `GradPack-Alpha-7` folder; and
6. confirm that Chrome shows GradPack version `0.1.0-alpha.7`.

Use zooms and click rings on the exact controls. Do not show a personal Chrome
profile or any unrelated extension.

### Scene 6 — Connect to Canvas (`2:55–3:25`)

Show a synthetic Frankfurt School Canvas dashboard with no real names, IDs,
URLs beyond the fixed authorized origin, enrolments, notifications, or profile
details. Explain that the viewer must already be signed in, refresh the Canvas
tab once after loading GradPack, keep that tab open, and open GradPack from the
Chrome toolbar. Show the approved `Your courses stay with you` trust card.

### Scene 7 — Choose and discover courses (`3:25–4:20`)

Use only the synthetic course names. Demonstrate individual selection and
**Select all courses**, then choose **One ZIP per course** as the simplest
classmate default. Start discovery, show ready and skipped course sections,
explain that discovery downloads nothing, and point out the expected ZIP count.
Confirm retrieval only after the review screen is understood.

Briefly explain that large courses may produce numbered ZIP parts and that a
skipped course does not prevent safe courses from downloading.

### Scene 8 — Download and open offline (`4:20–5:05`)

Keep the Canvas tab open during a synthetic download. Show every expected ZIP
arriving, extract one archive, and open `index.html`. Demonstrate Home, Modules,
Pages, Files, and Archive Status. Disconnect the network indicator before the
final navigation shot to reinforce that the generated archive works offline.

Do not show actual course pages, filenames, archive contents, or downloaded
materials.

### Scene 9 — Common issues and safe feedback (`5:05–5:40`)

Cover four recovery points:

1. keep the signed-in Canvas tab open and unnavigated until downloads finish;
2. use **Retry unfinished courses** after successful archives download;
3. keep all numbered multipart ZIPs; and
4. remove the old unpacked extension before loading a future pilot version.

Close by directing classmates to `TEST_CHECKLIST.md`. Tell them not to send
course names, filenames, Canvas IDs or URLs, screenshots, archives, page or file
contents, cookies, headers, tokens, browser-profile data, or personal
information.

## Narration and Caption Rules

- Use plain language and imperative steps: “Click Load unpacked,” not “invoke
  the unpacked-extension loader.”
- Explain one action before the cursor performs it.
- Keep captions to two lines and approximately 42 characters per line when
  practical.
- Leave captions visible long enough to read at a comfortable pace.
- Pronounce `ZIP` as “zip,” `SHA-256` as “S H A two fifty-six,” and `Canvas` as
  the product name.
- Never narrate a long checksum value; tell viewers to compare the displayed
  values.
- Avoid claims that every Canvas resource can be downloaded. Say “accessible
  materials” and retain visible ready, skipped, unavailable, external, and
  multipart outcomes.

## Privacy and Safety Boundaries

The video and all production assets must contain no real:

- course names, course codes, filenames, Canvas IDs, or per-course URLs;
- student names, email addresses, avatars, notifications, or profile details;
- browser history, bookmarks, saved passwords, unrelated tabs, or extensions;
- archives, course pages, file contents, screenshots supplied by testers;
- cookies, headers, tokens, authorization data, request/response bodies, or
  developer-tools output; or
- user home-directory names in visible paths.

Use a temporary browser profile and synthetic assets. Crop or recreate
operating-system paths so they show only `Documents/GradPack-Alpha-7`. The final
video, SRT, narration script, scene sources, and generated frames must pass a
privacy scan before distribution.

## Verification and Acceptance

Automated verification must establish:

- MP4 codec, resolution, frame rate, pixel format, audio codec, and duration;
- MP4 size at or below 100 MiB;
- SRT parses with monotonic, non-overlapping cues within the video duration;
- burned captions and SRT derive from the same canonical scene script;
- Alpha 7 filenames, commands, and version labels match the merged release;
- no prohibited privacy patterns or placeholders appear in text assets,
  metadata, extracted frames, narration transcript, or captions; and
- the existing Alpha 7 ZIP and checksum remain unchanged.

Manual acceptance must confirm:

1. a non-technical viewer can identify every click target;
2. narration and captions remain synchronized and understandable;
3. Mac and Windows viewers can follow their checksum and extraction branch;
4. the real installation order matches `INSTALL.md`;
5. no sensitive or real course information is visible; and
6. the MP4 plays from beginning to end in QuickTime and Chrome.
