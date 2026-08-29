# GradPack Alpha 7 Installation Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a privacy-safe, beginner-friendly, narrated Alpha 7 installation and first-use MP4 for mixed macOS and Windows classmates.

**Architecture:** Keep one canonical scene module for narration, captions, timing, and synthetic on-screen content. Render each scene to SVG, rasterize with the bundled `sharp` runtime, synthesize per-scene narration with macOS `say`, assemble deterministic H.264/AAC segments with FFmpeg, and validate the final MP4/SRT before copying them into the visible Alpha 7 classmate bundle. Actual Chrome installation shots come from a temporary clean browser profile and never enter Git.

**Tech Stack:** Node.js ESM, Vitest, SVG, bundled `sharp`, macOS `say` with Samantha `en_US`, FFmpeg/FFprobe 8.1.2, temporary clean Chrome profile, Computer Use, Markdown.

## Global Constraints

- Final filename: `GradPack-Alpha-7-Installation-Guide.mp4`.
- Caption filename: `GradPack-Alpha-7-Installation-Guide.srt`.
- Version: `0.1.0-alpha.7` from merged `main` commit `3ab29b97f8d2929c341a8d173d8b424b2fdf58e1`.
- Runtime target: exactly 340 seconds in source; accepted encoded duration is 339–342 seconds.
- Video: 1920×1080, 16:9, 30 fps, H.264, `yuv420p`.
- Audio: AAC, 48 kHz, Samantha `en_US` English narration.
- Delivery size: no more than 100 MiB.
- Captions: sentence case, burned into every scene and supplied as UTF-8 SRT from the same canonical caption strings.
- Use only `Example Finance Course` and `Sample Strategy Course` as course names.
- Use only `Documents/GradPack-Alpha-7` as a visible filesystem path.
- Never expose real course data, student identity, browser history, bookmarks, passwords, unrelated tabs/extensions, archives, course contents, cookies, headers, tokens, network traffic, developer tools, or a user home-directory name.
- Use a temporary clean Chrome profile; generated screenshots, audio, frames, and temporary profiles stay outside Git.
- Do not modify the Alpha 7 ZIP or checksum.
- The existing repository gate `CI=true pnpm verify` must remain green.

---

## File Structure

- `scripts/video/alpha7-installation-scenes.mjs` — canonical timings, narration, captions, synthetic screen text, output names, SRT generation, and privacy vocabulary.
- `scripts/video/render-alpha7-installation.mjs` — deterministic SVG renderer for title, file, operating-system, Chrome, Canvas, GradPack, archive, troubleshooting, and privacy shots.
- `scripts/video/build-alpha7-installation.mjs` — rasterization, narration synthesis, per-scene FFmpeg assembly, concatenation, and output metadata.
- `scripts/video/validate-alpha7-installation.mjs` — FFprobe, SRT, size, duration, codec, source-commit, and privacy validation.
- `tests/video/alpha7-installation-scenes.test.ts` — source contract, exact timing, required concepts, caption limits, SRT, and privacy checks.
- `tests/video/alpha7-installation-renderer.test.ts` — SVG size, escaping, caption provenance, synthetic course labels, and capture embedding.
- `tests/video/alpha7-installation-validator.test.ts` — output metadata and SRT validation with invented fixtures.
- `docs/video/alpha7-installation/PRODUCTION.md` — reproducible production commands and temporary-asset rules.
- `GradPack-classmate-release-0.1.0-alpha.7/GradPack-Alpha-7-Installation-Guide.mp4` — final local artifact, not committed.
- `GradPack-classmate-release-0.1.0-alpha.7/GradPack-Alpha-7-Installation-Guide.srt` — final local caption artifact, not committed.
- `GradPack-classmate-release-0.1.0-alpha.7/SHARE_WITH_CLASSMATES.md` — local release guide updated to list the video and captions, not committed.

---

### Task 1: Lock the canonical scene and caption contract

**Files:**

- Create: `tests/video/alpha7-installation-scenes.test.ts`
- Create: `scripts/video/alpha7-installation-scenes.mjs`

**Interfaces:**

- Produces: `VIDEO_VERSION`, `VIDEO_FILENAME`, `CAPTION_FILENAME`, `scenes`, `totalDurationSeconds()`, `formatSrtTime(seconds)`, `buildSrt()`, and `PROHIBITED_TEXT_PATTERNS`.
- Consumes: no earlier task output.

- [ ] **Step 1: Write the failing source-contract test**

Create `tests/video/alpha7-installation-scenes.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CAPTION_FILENAME,
  PROHIBITED_TEXT_PATTERNS,
  VIDEO_FILENAME,
  VIDEO_VERSION,
  buildSrt,
  scenes,
  totalDurationSeconds,
} from "../../scripts/video/alpha7-installation-scenes.mjs";

describe("Alpha 7 installation video source", () => {
  it("uses one complete, privacy-safe 340-second scene contract", () => {
    expect(VIDEO_VERSION).toBe("0.1.0-alpha.7");
    expect(VIDEO_FILENAME).toBe("GradPack-Alpha-7-Installation-Guide.mp4");
    expect(CAPTION_FILENAME).toBe("GradPack-Alpha-7-Installation-Guide.srt");
    expect(totalDurationSeconds()).toBe(340);
    expect(scenes).toHaveLength(18);
    expect(new Set(scenes.map(({ id }) => id)).size).toBe(scenes.length);
    expect(scenes.every(({ durationSeconds }) => durationSeconds >= 10)).toBe(
      true,
    );
    expect(scenes.every(({ caption }) => caption.split("\n").length <= 2)).toBe(
      true,
    );
    expect(
      scenes.every(({ caption }) =>
        caption.split("\n").every((line) => line.length <= 52),
      ),
    ).toBe(true);

    const source = JSON.stringify(scenes);
    for (const pattern of PROHIBITED_TEXT_PATTERNS) {
      expect(source).not.toMatch(pattern);
    }
    expect(source).toContain("Example Finance Course");
    expect(source).toContain("Sample Strategy Course");
    expect(source).toContain("Documents/GradPack-Alpha-7");
    expect(source).toContain("chrome://extensions");
    expect(source).toContain("Select all courses");
    expect(source).toContain("Retry unfinished courses");
    expect(source).toContain("TEST_CHECKLIST.md");
  });

  it("builds monotonic SRT cues from the same captions", () => {
    const srt = buildSrt();
    expect(srt.match(/--> /gu)).toHaveLength(scenes.length);
    scenes.forEach(({ caption }, index) => {
      expect(srt).toContain(`${index + 1}\n`);
      expect(srt).toContain(caption);
    });
    expect(srt).toContain("00:05:40,000");
  });
});
```

- [ ] **Step 2: Run the test and verify the red state**

```bash
CI=true pnpm exec vitest run tests/video/alpha7-installation-scenes.test.ts
```

Expected: FAIL because `scripts/video/alpha7-installation-scenes.mjs` does not exist.

- [ ] **Step 3: Implement the canonical scene source**

Create `scripts/video/alpha7-installation-scenes.mjs` with this complete scene contract:

```js
export const VIDEO_VERSION = "0.1.0-alpha.7";
export const VIDEO_FILENAME = "GradPack-Alpha-7-Installation-Guide.mp4";
export const CAPTION_FILENAME = "GradPack-Alpha-7-Installation-Guide.srt";

export const PROHIBITED_TEXT_PATTERNS = Object.freeze([
  /\/courses\/\d+/iu,
  /instructure\.com\/courses/iu,
  /capital markets/iu,
  /authorization/iu,
  /bearer\s+[a-z0-9._-]+/iu,
  /cookie\s*:/iu,
  /token\s*[:=]/iu,
  /\/Users\//u,
  /C:\\Users\\/iu,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/iu,
]);

export const scenes = Object.freeze([
  {
    id: "welcome",
    section: "Welcome and trust",
    durationSeconds: 24,
    visual: "title",
    title: "Pack your courses. Keep your knowledge.",
    screenLines: [
      "GradPack 0.1.0-alpha.7",
      "Frankfurt School Canvas",
      "Local archives",
    ],
    caption: "GradPack saves accessible Canvas materials\nto your computer.",
    narration:
      "Welcome to GradPack Alpha 7. GradPack works only with Frankfurt School Canvas and uses the session already open in Chrome. Everything is processed locally, with no telemetry, backend, or cloud upload. Keep downloaded materials for personal study and do not redistribute them.",
  },
  {
    id: "complete-folder",
    section: "Download",
    durationSeconds: 18,
    visual: "files",
    title: "Download the complete shared folder",
    screenLines: [
      "gradpack-0.1.0-alpha.7.zip",
      "gradpack-0.1.0-alpha.7.zip.sha256",
      "INSTALL.md",
      "TEST_CHECKLIST.md",
      "Installation video",
    ],
    caption: "Download every file in the shared folder.",
    narration:
      "First, download the complete shared folder. Keep the extension zip, its checksum, the installation guide, the test checklist, and this video together. Do not download only the zip file.",
  },
  {
    id: "checksum-mac",
    section: "Verify",
    durationSeconds: 18,
    visual: "terminal",
    title: "macOS: verify the checksum",
    screenLines: [
      "shasum -a 256 -c",
      "gradpack-0.1.0-alpha.7.zip.sha256",
      "gradpack-0.1.0-alpha.7.zip: OK",
    ],
    caption: "On Mac, paste the checksum command\nand look for OK.",
    narration:
      "On a Mac, open Terminal in the shared folder. Copy the S H A two fifty-six command from INSTALL dot M D, paste it, and press Return. Continue only when the zip reports O K.",
  },
  {
    id: "checksum-windows",
    section: "Verify",
    durationSeconds: 18,
    visual: "powershell",
    title: "Windows: compare the checksum",
    screenLines: [
      "Get-FileHash .\\gradpack-0.1.0-alpha.7.zip",
      "Get-Content .\\gradpack-0.1.0-alpha.7.zip.sha256",
      "The two values match",
    ],
    caption: "On Windows, compare the two values.\nThey must match exactly.",
    narration:
      "On Windows, open PowerShell in the shared folder. Run the two commands from INSTALL dot M D. Compare the hexadecimal values. They must match exactly. Stop and contact the maintainer if either check fails.",
  },
  {
    id: "extract",
    section: "Extract",
    durationSeconds: 22,
    visual: "folders",
    title: "Extract into a permanent folder",
    screenLines: [
      "Documents",
      "GradPack-Alpha-7",
      "manifest.json",
      "sidepanel.html",
    ],
    caption: "Extract the zip to\nDocuments/GradPack-Alpha-7.",
    narration:
      "Extract the zip into a permanent folder, such as Documents slash GradPack Alpha 7. Chrome needs the extracted folder, not the zip. Do not move or delete this folder while GradPack is installed.",
  },
  {
    id: "extensions-url",
    section: "Chrome setup",
    durationSeconds: 12,
    visual: "chrome-capture",
    capture: "chrome-extensions.png",
    title: "Open Chrome extensions",
    screenLines: ["chrome://extensions"],
    caption: "Open chrome://extensions in Chrome.",
    narration:
      "In Chrome, enter chrome colon slash slash extensions in the address bar. This opens Chrome's extension management page.",
  },
  {
    id: "developer-mode",
    section: "Chrome setup",
    durationSeconds: 10,
    visual: "chrome-capture",
    capture: "chrome-developer-mode.png",
    title: "Enable Developer mode",
    screenLines: ["Developer mode", "On"],
    caption: "Turn on Developer mode.",
    narration:
      "Turn on Developer mode in the top right. This makes the Load unpacked button visible.",
  },
  {
    id: "remove-old",
    section: "Chrome setup",
    durationSeconds: 10,
    visual: "chrome-capture",
    capture: "chrome-remove-old.png",
    title: "Remove an older GradPack pilot",
    screenLines: ["GradPack", "Remove"],
    caption: "Remove an older GradPack version first.",
    narration:
      "If an older GradPack pilot is installed, select Remove and confirm. Previously downloaded course archives stay on your computer.",
  },
  {
    id: "load-unpacked",
    section: "Chrome setup",
    durationSeconds: 14,
    visual: "chrome-capture",
    capture: "chrome-load-unpacked.png",
    title: "Load the extracted folder",
    screenLines: ["Load unpacked", "Documents/GradPack-Alpha-7", "Select"],
    caption: "Click Load unpacked and choose\nthe extracted folder.",
    narration:
      "Click Load unpacked. Choose the extracted GradPack Alpha 7 folder, then select Open or Select Folder. Do not choose the zip file.",
  },
  {
    id: "verify-version",
    section: "Chrome setup",
    durationSeconds: 14,
    visual: "chrome-capture",
    capture: "chrome-installed.png",
    title: "Confirm Alpha 7 is installed",
    screenLines: ["GradPack", "0.1.0-alpha.7", "Enabled"],
    caption: "Confirm GradPack 0.1.0-alpha.7\nis enabled.",
    narration:
      "Chrome should now show GradPack version zero point one point zero Alpha 7 as enabled. If the version differs, remove it and load the correct extracted folder.",
  },
  {
    id: "canvas-refresh",
    section: "Connect",
    durationSeconds: 18,
    visual: "canvas",
    title: "Open and refresh Canvas",
    screenLines: [
      "Frankfurt School Canvas",
      "Signed in",
      "Refresh once",
      "Keep this tab open",
    ],
    caption: "Sign in to Canvas, refresh once,\nand keep the tab open.",
    narration:
      "Open Frankfurt School Canvas and sign in normally. Refresh the Canvas tab once after GradPack loads. Keep this tab open, signed in, and on Canvas until every download finishes.",
  },
  {
    id: "trust-card",
    section: "Connect",
    durationSeconds: 12,
    visual: "gradpack",
    title: "Your courses stay with you",
    screenLines: [
      "No telemetry",
      "No backend",
      "No cloud upload",
      "Personal study only",
    ],
    caption:
      "GradPack uses your existing Canvas session.\nArchives stay on your computer.",
    narration:
      "Open GradPack from Chrome's toolbar. The trust card confirms that GradPack uses your existing Canvas session and saves archives only to your computer.",
  },
  {
    id: "choose-courses",
    section: "Choose",
    durationSeconds: 30,
    visual: "gradpack",
    title: "Choose courses",
    screenLines: [
      "Example Finance Course",
      "Sample Strategy Course",
      "Select all courses",
      "One ZIP per course",
    ],
    caption: "Choose individual courses or\nSelect all courses.",
    narration:
      "Choose individual courses, or use Select all courses for every displayed active, completed, and concluded course. For the simplest first run, choose One zip per course. Then select Discover selected courses.",
  },
  {
    id: "review-plan",
    section: "Review",
    durationSeconds: 28,
    visual: "gradpack",
    title: "Review before downloading",
    screenLines: [
      "Ready courses: 2",
      "Skipped courses: 0",
      "Expected downloads: 2",
      "Discovery downloads nothing",
    ],
    caption: "Review ready and skipped courses\nbefore retrieval begins.",
    narration:
      "Discovery checks each course but downloads nothing. Review the ready and skipped sections, packaging choice, and expected zip count. Large courses may create numbered parts. A skipped course does not stop safe courses.",
  },
  {
    id: "download",
    section: "Download",
    durationSeconds: 26,
    visual: "download",
    title: "Confirm and keep Canvas open",
    screenLines: [
      "Confirm retrieval",
      "Course 1 of 2",
      "Part 1 of 1",
      "2 archives downloaded",
    ],
    caption: "Confirm retrieval and wait for\nevery expected zip.",
    narration:
      "Confirm retrieval only after you understand the review. Keep Canvas open while GradPack downloads each archive. Wait until the downloaded zip count matches the expected count before closing the tab.",
  },
  {
    id: "offline-archive",
    section: "Offline archive",
    durationSeconds: 28,
    visual: "archive",
    title: "Open the archive offline",
    screenLines: [
      "Extract the course zip",
      "Open index.html",
      "Home",
      "Modules",
      "Pages",
      "Files",
      "Archive Status",
    ],
    caption: "Extract a course zip and\nopen index.html.",
    narration:
      "Extract a downloaded course zip, then open index dot H T M L. Use Home, Modules, Pages, Files, and Archive Status. The generated archive works locally without GradPack or an internet connection.",
  },
  {
    id: "troubleshooting",
    section: "Help",
    durationSeconds: 20,
    visual: "troubleshooting",
    title: "If something is unfinished",
    screenLines: [
      "Keep Canvas open",
      "Retry unfinished courses",
      "Keep every numbered part",
      "Reload future versions",
    ],
    caption:
      "Use Retry unfinished courses\nwithout repeating completed downloads.",
    narration:
      "If some courses remain unfinished, use Retry unfinished courses. Keep every numbered multipart zip. For a future GradPack version, remove the old extension before loading the new folder.",
  },
  {
    id: "safe-feedback",
    section: "Privacy-safe feedback",
    durationSeconds: 18,
    visual: "privacy",
    title: "Report problems safely",
    screenLines: [
      "Use TEST_CHECKLIST.md",
      "No screenshots",
      "No course data",
      "No archives",
      "No personal information",
    ],
    caption: "Use TEST_CHECKLIST.md and\nkeep course information private.",
    narration:
      "Report problems with TEST CHECKLIST dot M D. Never send course names, files, links, screenshots, archives, course contents, credentials, browser data, or personal information. You are ready to use GradPack.",
  },
]);

export const totalDurationSeconds = () =>
  scenes.reduce((total, scene) => total + scene.durationSeconds, 0);

export const formatSrtTime = (seconds) => {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};

export const buildSrt = () => {
  let elapsed = 0;
  return `${scenes
    .map((scene, index) => {
      const start = elapsed;
      elapsed += scene.durationSeconds;
      return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(elapsed)}\n${scene.caption}\n`;
    })
    .join("\n")}\n`;
};
```

- [ ] **Step 4: Run the focused test and verify green**

```bash
CI=true pnpm exec vitest run tests/video/alpha7-installation-scenes.test.ts
pnpm exec prettier --check scripts/video/alpha7-installation-scenes.mjs tests/video/alpha7-installation-scenes.test.ts
```

Expected: 1 file, 2 tests PASS; Prettier passes.

- [ ] **Step 5: Commit the canonical source**

```bash
git add scripts/video/alpha7-installation-scenes.mjs tests/video/alpha7-installation-scenes.test.ts
git commit -m "feat: define Alpha 7 video scenes"
```

---

### Task 2: Render deterministic privacy-safe frames

**Files:**

- Create: `tests/video/alpha7-installation-renderer.test.ts`
- Create: `scripts/video/render-alpha7-installation.mjs`

**Interfaces:**

- Consumes: one scene from `scenes` plus optional `{ captureDataUrl?: string }`.
- Produces: `escapeXml(value)`, `wrapWords(value, limit)`, and `renderSceneSvg(scene, options): string` for a 1920×1080 SVG whose lower caption band uses `scene.caption` verbatim.

- [ ] **Step 1: Write the failing renderer test**

Create `tests/video/alpha7-installation-renderer.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { scenes } from "../../scripts/video/alpha7-installation-scenes.mjs";
import {
  escapeXml,
  renderSceneSvg,
  wrapWords,
} from "../../scripts/video/render-alpha7-installation.mjs";

describe("Alpha 7 installation frame renderer", () => {
  it("renders a 1080p SVG from the canonical caption", () => {
    const scene = scenes.find(({ id }) => id === "choose-courses")!;
    const svg = renderSceneSvg(scene);
    expect(svg).toContain('width="1920" height="1080"');
    expect(svg).toContain("Example Finance Course");
    expect(svg).toContain("Sample Strategy Course");
    for (const line of scene.caption.split("\n")) expect(svg).toContain(line);
    expect(svg).not.toContain("/Users/");
  });

  it("escapes text and embeds an approved clean Chrome capture", () => {
    expect(escapeXml('<unsafe & "quoted">')).toBe(
      "&lt;unsafe &amp; &quot;quoted&quot;&gt;",
    );
    expect(wrapWords("one two three four", 8)).toEqual([
      "one two",
      "three",
      "four",
    ]);
    const scene = scenes.find(({ id }) => id === "extensions-url")!;
    const svg = renderSceneSvg(scene, {
      captureDataUrl: "data:image/png;base64,c3ludGhldGlj",
    });
    expect(svg).toContain("data:image/png;base64,c3ludGhldGlj");
  });
});
```

- [ ] **Step 2: Run the renderer test and verify red**

```bash
CI=true pnpm exec vitest run tests/video/alpha7-installation-renderer.test.ts
```

Expected: FAIL because the renderer module does not exist.

- [ ] **Step 3: Implement the SVG renderer**

Create `scripts/video/render-alpha7-installation.mjs`. Use `escapeXml()` for every scene-derived value. Build a navy header, white content card, visual-specific content, click target, and a navy caption band. The complete public interface is:

```js
const XML_ENTITIES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
});

export const escapeXml = (value) =>
  String(value).replace(/[&<>"']/gu, (character) => XML_ENTITIES[character]);

export const wrapWords = (value, limit) => {
  const lines = [];
  let current = "";
  for (const word of String(value).split(/\s+/u)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= limit) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
};

const textLines = (lines, { x, y, size = 42, gap = 58, color = "#17213b" }) =>
  lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * gap}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="${size}" fill="${color}">${escapeXml(line)}</text>`,
    )
    .join("");

const visualBody = (scene, captureDataUrl) => {
  if (scene.visual === "chrome-capture" && captureDataUrl) {
    return `<image href="${escapeXml(captureDataUrl)}" x="180" y="250" width="1560" height="560" preserveAspectRatio="xMidYMid slice"/><circle cx="1495" cy="715" r="42" fill="none" stroke="#f2b134" stroke-width="12"/>`;
  }
  const lines = scene.screenLines.flatMap((line) => wrapWords(line, 42));
  return `<rect x="180" y="250" width="1560" height="560" rx="28" fill="#ffffff" stroke="#d9dcec" stroke-width="3"/>${textLines(lines, { x: 255, y: 350, size: 40, gap: 62 })}`;
};

export const renderSceneSvg = (scene, { captureDataUrl } = {}) => {
  const captions = scene.caption.split("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <rect width="1920" height="1080" fill="#f5f6fb"/>
    <rect width="1920" height="170" fill="#172b82"/>
    <text x="110" y="78" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" font-weight="700" fill="#dbe2ff">${escapeXml(scene.section.toUpperCase())}</text>
    <text x="110" y="138" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="52" font-weight="800" fill="#ffffff">${escapeXml(scene.title)}</text>
    ${visualBody(scene, captureDataUrl)}
    <rect y="865" width="1920" height="215" fill="#17213b"/>
    ${textLines(captions, { x: 960, y: captions.length === 1 ? 985 : 945, size: 48, gap: 62, color: "#ffffff" }).replaceAll('x="960"', 'x="960" text-anchor="middle"')}
  </svg>`;
};
```

After the basic interface is green, add visual-specific accents without changing the interface: terminal/powershell prompt bars, folders, GradPack checkboxes, progress bars, archive navigation pills, and privacy-safe status badges. All displayed strings still come from `scene.screenLines`.

- [ ] **Step 4: Run renderer and source checks**

```bash
CI=true pnpm exec vitest run tests/video/alpha7-installation-scenes.test.ts tests/video/alpha7-installation-renderer.test.ts
pnpm exec prettier --check scripts/video tests/video
```

Expected: 2 files, 4 tests PASS; Prettier passes.

- [ ] **Step 5: Commit the renderer**

```bash
git add scripts/video/render-alpha7-installation.mjs tests/video/alpha7-installation-renderer.test.ts
git commit -m "feat: render Alpha 7 video frames"
```

---

### Task 3: Capture only generic Chrome installation surfaces

**Files:**

- Create: `docs/video/alpha7-installation/PRODUCTION.md`
- Generate outside Git: `/private/tmp/gradpack-alpha7-video/captures/*.png`

**Interfaces:**

- Consumes: verified Alpha 7 ZIP and checksum from `GradPack-classmate-release-0.1.0-alpha.7/`.
- Produces: `chrome-extensions.png`, `chrome-developer-mode.png`, `chrome-remove-old.png`, `chrome-load-unpacked.png`, and `chrome-installed.png`, each 1920×1080 with no prohibited data.

- [ ] **Step 1: Document the clean-capture procedure**

Create `docs/video/alpha7-installation/PRODUCTION.md` with these exact boundaries and commands:

````markdown
# Alpha 7 installation video production

Generated browser captures, narration, frames, and videos belong under
`/private/tmp/gradpack-alpha7-video/` and must never be committed.

Verify and extract the source extension:

```bash
cd /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7
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
````

- [ ] **Step 2: Verify the release input before capture**

Run the checksum and extraction commands from `PRODUCTION.md`.

Expected: checksum prints `OK`; the extracted manifest has
`version_name: 0.1.0-alpha.7`.

- [ ] **Step 3: Capture the clean Chrome states**

Use the `computer-use:computer-use` skill. Launch the temporary profile with the
documented command, maximize the clean window, and capture only the Chrome
content area. Use synthetic recreation for `chrome-load-unpacked.png` if the
native picker exposes a username. Save the five exact filenames under
`/private/tmp/gradpack-alpha7-video/captures/`.

- [ ] **Step 4: Inspect and privacy-scan captures**

Use `view_image` on every PNG. Then run:

```bash
find /private/tmp/gradpack-alpha7-video/captures -type f -name '*.png' -print | sort
sips -g pixelWidth -g pixelHeight /private/tmp/gradpack-alpha7-video/captures/*.png
```

Expected: exactly five reviewed 1920×1080 images; no account avatar, email,
bookmark, browser history, unrelated extension, username path, real Canvas
content, or notification is visible.

- [ ] **Step 5: Commit production instructions only**

```bash
git add docs/video/alpha7-installation/PRODUCTION.md
git commit -m "docs: document privacy-safe video capture"
```

---

### Task 4: Build narrated MP4 and SRT artifacts

**Files:**

- Create: `scripts/video/build-alpha7-installation.mjs`
- Test: `tests/video/alpha7-installation-scenes.test.ts`
- Generate outside Git: `/private/tmp/gradpack-alpha7-video/build/`

**Interfaces:**

- Consumes: canonical `scenes`, `buildSrt()`, `renderSceneSvg()`, five capture PNGs, `VIDEO_NODE_MODULES`, `say`, `ffmpeg`, and `ffprobe`.
- Produces: a 340-second MP4, SRT, one PNG and narration AIFF per scene, and `build-metadata.json` under the temporary build root.

- [ ] **Step 1: Extend the source test with narration-budget checks**

Add to `tests/video/alpha7-installation-scenes.test.ts`:

```ts
it("keeps narration within a readable scene budget", () => {
  for (const scene of scenes) {
    const words = scene.narration.trim().split(/\s+/u).length;
    expect(words).toBeLessThanOrEqual(Math.floor(scene.durationSeconds * 2.7));
    expect(words).toBeGreaterThanOrEqual(
      Math.floor(scene.durationSeconds * 0.8),
    );
  }
});
```

- [ ] **Step 2: Run the budget test and verify red if any scene is too dense**

```bash
CI=true pnpm exec vitest run tests/video/alpha7-installation-scenes.test.ts
```

Expected: the test identifies any narration that exceeds 162 words per minute.
Shorten only the failing narration while preserving its approved meaning, then
rerun until the source test passes.

- [ ] **Step 3: Implement the build script**

Create `scripts/video/build-alpha7-installation.mjs`. It must:

1. resolve `sharp` through `createRequire(import.meta.url)` with
   `VIDEO_NODE_MODULES` added to `NODE_PATH` before launch;
2. create `frames`, `audio`, and `segments` directories under `--work-dir`;
3. render each SVG, embedding the matching capture as a base64 data URL;
4. rasterize SVG to 1920×1080 PNG with `sharp`;
5. call `say -v Samantha -o <scene>.aiff <narration>`;
6. reject narration audio longer than `durationSeconds - 0.5`;
7. create a fixed-duration H.264/AAC segment with this argument contract:

```js
[
  "-y",
  "-loop",
  "1",
  "-framerate",
  "30",
  "-i",
  framePath,
  "-i",
  audioPath,
  "-filter_complex",
  `[1:a]apad=pad_dur=${scene.durationSeconds}[a]`,
  "-map",
  "0:v:0",
  "-map",
  "[a]",
  "-t",
  String(scene.durationSeconds),
  "-r",
  "30",
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "21",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-ar",
  "48000",
  "-b:a",
  "160k",
  segmentPath,
];
```

8. concatenate same-codec segments with FFmpeg's concat demuxer and `-c copy`;
9. write `buildSrt()` beside the MP4; and
10. write metadata containing source commit, version, scene count, expected
    duration, output names, and SHA-256 values.

Export pure helpers `parseArgs(argv)`, `captureNameFor(scene)`,
`segmentArgs(scene, paths)`, and `concatFileContent(segmentPaths)` for tests.
Call external commands with `spawnSync` and throw an error containing only the
command name and exit code, never captured environment or browser data.

- [ ] **Step 4: Build the temporary video**

```bash
VIDEO_NODE_MODULES=/Users/esso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
NODE_PATH=/Users/esso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
node scripts/video/build-alpha7-installation.mjs \
  --capture-dir /private/tmp/gradpack-alpha7-video/captures \
  --work-dir /private/tmp/gradpack-alpha7-video/build \
  --source-commit 3ab29b97f8d2929c341a8d173d8b424b2fdf58e1
```

Expected: 18 PNG frames, 18 AIFF narration files, 18 MP4 segments, one final
MP4, one SRT, and one metadata JSON.

- [ ] **Step 5: Commit the build pipeline**

```bash
git add scripts/video/build-alpha7-installation.mjs tests/video/alpha7-installation-scenes.test.ts
git commit -m "feat: build narrated Alpha 7 video"
```

---

### Task 5: Validate and distribute the final video

**Files:**

- Create: `tests/video/alpha7-installation-validator.test.ts`
- Create: `scripts/video/validate-alpha7-installation.mjs`
- Modify outside Git: `GradPack-classmate-release-0.1.0-alpha.7/SHARE_WITH_CLASSMATES.md`
- Copy outside Git: final MP4 and SRT into `GradPack-classmate-release-0.1.0-alpha.7/`

**Interfaces:**

- Consumes: FFprobe JSON, SRT text, output file size, build metadata, scene source, and the original Alpha 7 ZIP/checksum.
- Produces: `validateProbe(probe)`, `validateSrt(srt)`, `validateRelease(options)`, and a successful validation report with no sensitive data.

- [ ] **Step 1: Write failing validator tests**

Create `tests/video/alpha7-installation-validator.test.ts` with invented
metadata asserting:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  validateProbe,
  validateSrt,
} from "../../scripts/video/validate-alpha7-installation.mjs";
import { buildSrt } from "../../scripts/video/alpha7-installation-scenes.mjs";

describe("Alpha 7 installation video validator", () => {
  it("accepts the required video and audio contract", () => {
    expect(() =>
      validateProbe({
        format: { duration: "340.000", size: "50000000" },
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
            pix_fmt: "yuv420p",
            avg_frame_rate: "30/1",
          },
          { codec_type: "audio", codec_name: "aac", sample_rate: "48000" },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a wrong codec and malformed SRT", () => {
    expect(() =>
      validateProbe({ format: { duration: "340", size: "1" }, streams: [] }),
    ).toThrow("video stream");
    expect(() =>
      validateSrt("1\n00:00:02,000 --> 00:00:01,000\nBad\n"),
    ).toThrow("caption timing");
    expect(() => validateSrt(buildSrt())).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the validator tests and verify red**

```bash
CI=true pnpm exec vitest run tests/video/alpha7-installation-validator.test.ts
```

Expected: FAIL because the validator module does not exist.

- [ ] **Step 3: Implement output validation**

Create `scripts/video/validate-alpha7-installation.mjs`. Implement:

```js
export const validateProbe = (probe) => {
  const video = probe.streams?.find(({ codec_type }) => codec_type === "video");
  const audio = probe.streams?.find(({ codec_type }) => codec_type === "audio");
  if (!video) throw new Error("missing video stream");
  if (!audio) throw new Error("missing audio stream");
  if (video.codec_name !== "h264") throw new Error("video codec must be h264");
  if (video.width !== 1920 || video.height !== 1080)
    throw new Error("video resolution must be 1920x1080");
  if (video.pix_fmt !== "yuv420p")
    throw new Error("pixel format must be yuv420p");
  if (video.avg_frame_rate !== "30/1")
    throw new Error("frame rate must be 30 fps");
  if (audio.codec_name !== "aac" || audio.sample_rate !== "48000")
    throw new Error("audio must be 48 kHz AAC");
  const duration = Number(probe.format?.duration);
  if (duration < 339 || duration > 342)
    throw new Error("duration is outside 339-342 seconds");
  if (Number(probe.format?.size) > 100 * 1024 * 1024)
    throw new Error("video exceeds 100 MiB");
};

export const validateSrt = (srt) => {
  const cues = [
    ...srt.matchAll(
      /(\d+)\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\n([^\n]+(?:\n[^\n]+)?)/gu,
    ),
  ];
  if (cues.length !== 18) throw new Error("caption count must be 18");
  const toMs = (value) => {
    const [clock, millis] = value.split(",");
    const [hours, minutes, seconds] = clock.split(":").map(Number);
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(millis);
  };
  let previousEnd = 0;
  for (const cue of cues) {
    const start = toMs(cue[2]);
    const end = toMs(cue[3]);
    if (start < previousEnd || end <= start)
      throw new Error("caption timing is not monotonic");
    previousEnd = end;
  }
  if (previousEnd !== 340000)
    throw new Error("captions must end at 340 seconds");
};
```

The executable path must call FFprobe with JSON output, read the SRT and build
metadata, validate source commit/version/output names, compare current Alpha 7
ZIP and sidecar checksums with pre-build values, scan committed text and SRT
against `PROHIBITED_TEXT_PATTERNS`, and print only this success shape:

```json
{
  "status": "pass",
  "version": "0.1.0-alpha.7",
  "durationSeconds": 340,
  "videoMiB": 0,
  "sceneCount": 18
}
```

- [ ] **Step 4: Run focused and full repository gates**

```bash
CI=true pnpm exec vitest run tests/video
CI=true pnpm verify
```

Expected: all video tests and the full existing repository gate PASS.

- [ ] **Step 5: Validate the temporary outputs**

```bash
node scripts/video/validate-alpha7-installation.mjs \
  --video /private/tmp/gradpack-alpha7-video/build/GradPack-Alpha-7-Installation-Guide.mp4 \
  --captions /private/tmp/gradpack-alpha7-video/build/GradPack-Alpha-7-Installation-Guide.srt \
  --metadata /private/tmp/gradpack-alpha7-video/build/build-metadata.json \
  --release-dir /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7
```

Expected: the one-line JSON success shape with `status: pass`.

- [ ] **Step 6: Inspect visual and audio acceptance samples**

Extract one frame near the middle of every scene:

```bash
mkdir -p /private/tmp/gradpack-alpha7-video/review-frames
ffmpeg -y -i /private/tmp/gradpack-alpha7-video/build/GradPack-Alpha-7-Installation-Guide.mp4 \
  -vf "fps=1/20,scale=480:-1,tile=5x4" -frames:v 1 \
  /private/tmp/gradpack-alpha7-video/review-frames/contact-sheet.png
```

Use `view_image` on the contact sheet and play the MP4 from beginning to end in
QuickTime and Chrome. Verify click targets, caption readability, narration sync,
Mac/Windows branches, correct Alpha 7 order, and zero sensitive content.

- [ ] **Step 7: Copy verified artifacts and update the local sharing guide**

Copy, do not move, the verified MP4 and SRT into the Alpha 7 release folder.
Use `apply_patch` to add both filenames to `SHARE_WITH_CLASSMATES.md`, update the
classmate message to “Watch the installation video first,” and keep all existing
privacy and personal-study language.

Re-run:

```bash
shasum -a 256 -c gradpack-0.1.0-alpha.7.zip.sha256
unzip -t gradpack-0.1.0-alpha.7.zip
```

Expected: the original extension ZIP still reports `OK` and no compression
errors.

- [ ] **Step 8: Commit validator source only**

```bash
git add scripts/video/validate-alpha7-installation.mjs tests/video/alpha7-installation-validator.test.ts
git commit -m "test: validate Alpha 7 installation video"
```

---

### Task 6: Final source and distribution audit

**Files:**

- Verify committed: `scripts/video/`, `tests/video/`, `docs/video/alpha7-installation/`, design, and plan.
- Verify local release: Alpha 7 ZIP, sidecar, guides, MP4, and SRT.

**Interfaces:**

- Consumes: all completed source and generated outputs.
- Produces: clean Git status, final hashes, playable media, and exact distribution inventory.

- [ ] **Step 1: Run fresh completion verification**

```bash
CI=true pnpm verify
git diff --check origin/main...HEAD
git status --short
```

Expected: repository gate passes; no whitespace errors; worktree is clean.

- [ ] **Step 2: Verify exact release inventory and hashes**

```bash
find /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7 -maxdepth 1 -type f -print | sort
shasum -a 256 /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7/*
```

Expected: the existing ZIP, sidecar, `INSTALL.md`, `TEST_CHECKLIST.md`,
`SHARE_WITH_CLASSMATES.md`, final MP4, and final SRT are present.

- [ ] **Step 3: Run the final privacy scan**

Scan committed video sources, SRT, sharing guide, FFprobe metadata, and extracted
review frames for course URLs/IDs, known real course names, account identifiers,
credentials, tokens, user paths, and placeholders. Any match must be inspected;
expected result is no prohibited content.

- [ ] **Step 4: Preserve the working branch for review**

Do not commit the generated MP4, SRT, captures, audio, frames, browser profile,
or local release-folder edits. Keep `codex/installation-video` available for a
source PR after the user watches the finished MP4.
