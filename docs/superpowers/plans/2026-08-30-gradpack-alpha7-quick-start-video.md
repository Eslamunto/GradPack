# GradPack Alpha 7 Quick-Start Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a privacy-safe, narrated 55-second GradPack Alpha 7 quick-start MP4 and SRT covering installation and the first course download.

**Architecture:** Add an independent nine-scene quick-start content contract while reusing the approved SVG renderer, synthetic Chrome captures, narration synthesis, FFmpeg pipeline, and artifact validator. Generalize the existing build and validation entry points with an explicit content contract, retaining the detailed 5:40 guide as the default so its behavior and filenames do not change.

**Tech Stack:** Node.js ESM with JSDoc types, Vitest, SVG, bundled `sharp`, macOS `say` with Samantha `en_US`, FFmpeg/FFprobe 8.1.2, Markdown.

## Global Constraints

- Video filename: `GradPack-Alpha-7-Quick-Start.mp4`.
- Caption filename: `GradPack-Alpha-7-Quick-Start.srt`.
- Source version: GradPack `0.1.0-alpha.7` from merged `main` commit `3ab29b97f8d2929c341a8d173d8b424b2fdf58e1`.
- Canonical runtime: exactly 55 seconds; accepted encoded duration is 54–56 seconds.
- Video: 1920×1080, 16:9, 30 fps, H.264, `yuv420p`.
- Audio: Samantha `en_US` narration encoded as 48 kHz AAC; narration must not be accelerated or silent.
- Captions: sentence case, burned into the MP4 and supplied as UTF-8 SRT from the same canonical strings.
- Maximum delivery size: 25 MiB.
- Use only `Example Finance Course` and `Sample Strategy Course` as course names.
- Use only `Documents/GradPack-Alpha-7` as a visible filesystem path.
- Never expose real course/student/browser/Canvas data, account information, credentials, private paths, or downloaded course contents.
- The detailed 5:40 MP4/SRT, the existing walkthrough, and every other release artifact must remain unchanged.
- Copy verified outputs into the Alpha 7 release folder; never move temporary outputs.
- The extension ZIP and checksum must remain byte-for-byte unchanged.
- `CI=true pnpm verify` must remain green.

---

## File Structure

- `scripts/video/alpha7-quick-start-scenes.mjs` — nine-scene timing, narration, captions, output names, SRT, and quick-start content contract.
- `scripts/video/build-alpha7-quick-start.mjs` — thin CLI using the shared build pipeline with the quick-start content contract.
- `scripts/video/validate-alpha7-quick-start.mjs` — thin CLI using the shared validator with the quick-start content contract.
- `scripts/video/build-alpha7-installation.mjs` — generalized to accept an explicit content contract while preserving the detailed guide as its default.
- `scripts/video/validate-alpha7-installation.mjs` — generalized duration, size, cue-count, end-time, names, and hashes while preserving detailed defaults.
- `tests/video/alpha7-quick-start-scenes.test.ts` — exact nine-scene, timing, caption, narration, privacy, and SRT contract.
- `tests/video/alpha7-installation-build.test.ts` — shared build-content selection and filename isolation.
- `tests/video/alpha7-installation-validator.test.ts` — shared validation bounds and quick-start timing tests.
- `GradPack-classmate-release-0.1.0-alpha.7/GradPack-Alpha-7-Quick-Start.mp4` — final local artifact, not committed.
- `GradPack-classmate-release-0.1.0-alpha.7/GradPack-Alpha-7-Quick-Start.srt` — final local artifact, not committed.
- `GradPack-classmate-release-0.1.0-alpha.7/SHARE_WITH_CLASSMATES.md` — local guide update, not committed.

---

### Task 1: Lock the 55-second quick-start content contract

**Files:**

- Create: `tests/video/alpha7-quick-start-scenes.test.ts`
- Create: `scripts/video/alpha7-quick-start-scenes.mjs`

**Interfaces:**

- Consumes: `PROHIBITED_TEXT_PATTERNS` from `alpha7-installation-scenes.mjs`.
- Produces: `QUICK_START_VIDEO_FILENAME`, `QUICK_START_CAPTION_FILENAME`, `quickStartScenes`, `quickStartTotalDurationSeconds()`, `buildQuickStartSrt()`, and `quickStartContent`.

- [ ] **Step 1: Write the failing quick-start scene test**

Create `tests/video/alpha7-quick-start-scenes.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PROHIBITED_TEXT_PATTERNS } from "../../scripts/video/alpha7-installation-scenes.mjs";
import {
  QUICK_START_CAPTION_FILENAME,
  QUICK_START_VIDEO_FILENAME,
  buildQuickStartSrt,
  quickStartContent,
  quickStartScenes,
  quickStartTotalDurationSeconds,
} from "../../scripts/video/alpha7-quick-start-scenes.mjs";

describe("Alpha 7 quick-start video source", () => {
  it("defines a unique privacy-safe 55-second contract", () => {
    expect(QUICK_START_VIDEO_FILENAME).toBe("GradPack-Alpha-7-Quick-Start.mp4");
    expect(QUICK_START_CAPTION_FILENAME).toBe(
      "GradPack-Alpha-7-Quick-Start.srt",
    );
    expect(quickStartScenes).toHaveLength(9);
    expect(quickStartTotalDurationSeconds()).toBe(55);
    expect(new Set(quickStartScenes.map(({ id }) => id)).size).toBe(9);
    expect(
      quickStartScenes.every(({ caption }) =>
        caption.split("\n").every((line) => line.length <= 52),
      ),
    ).toBe(true);
    expect(
      quickStartScenes.every(({ caption }) => caption.split("\n").length <= 2),
    ).toBe(true);

    const source = JSON.stringify(quickStartScenes);
    for (const pattern of PROHIBITED_TEXT_PATTERNS) {
      expect(source).not.toMatch(pattern);
    }
    expect(source).toContain("Documents/GradPack-Alpha-7");
    expect(source).toContain("Select all courses");
    expect(source).toContain("One ZIP per course");
    expect(source).toContain("Personal study only");
  });

  it("keeps natural narration inside every scene", () => {
    for (const scene of quickStartScenes) {
      const words = scene.narration.trim().split(/\s+/u).length;
      expect(words).toBeLessThanOrEqual(
        Math.floor(scene.durationSeconds * 2.5),
      );
      expect(words).toBeGreaterThanOrEqual(
        Math.floor(scene.durationSeconds * 1.2),
      );
    }
  });

  it("builds nine monotonic SRT cues ending at 55 seconds", () => {
    const srt = buildQuickStartSrt();
    expect(srt.match(/--> /gu)).toHaveLength(9);
    expect(srt).toContain("00:00:55,000");
    quickStartScenes.forEach(({ caption }) => expect(srt).toContain(caption));
  });

  it("publishes independent quick-start media limits", () => {
    expect(quickStartContent.minimumDurationSeconds).toBe(54);
    expect(quickStartContent.maximumDurationSeconds).toBe(56);
    expect(quickStartContent.maximumVideoBytes).toBe(25 * 1024 * 1024);
    expect(quickStartContent.expectedCaptionEndMilliseconds).toBe(55_000);
  });
});
```

- [ ] **Step 2: Run the test and verify the red state**

```bash
CI=true pnpm exec vitest run tests/video/alpha7-quick-start-scenes.test.ts
```

Expected: FAIL because `scripts/video/alpha7-quick-start-scenes.mjs` does not exist.

- [ ] **Step 3: Implement the complete quick-start scene source**

Create `scripts/video/alpha7-quick-start-scenes.mjs`:

```js
import { VIDEO_VERSION, formatSrtTime } from "./alpha7-installation-scenes.mjs";

export const QUICK_START_VIDEO_FILENAME = "GradPack-Alpha-7-Quick-Start.mp4";
export const QUICK_START_CAPTION_FILENAME = "GradPack-Alpha-7-Quick-Start.srt";

export const quickStartScenes = Object.freeze([
  {
    id: "quick-welcome",
    section: "Quick start",
    durationSeconds: 4,
    visual: "title",
    title: "GradPack Alpha 7 in 55 seconds",
    screenLines: ["Install", "Choose courses", "Download locally"],
    caption: "Install and download with GradPack\nin under one minute.",
    narration: "GradPack Alpha Seven: your fast Canvas offline setup.",
  },
  {
    id: "quick-download",
    section: "Download",
    durationSeconds: 6,
    visual: "files",
    title: "Download and verify",
    screenLines: [
      "Complete shared folder",
      "gradpack-0.1.0-alpha.7.zip",
      "INSTALL.md",
      "Verify before continuing",
    ],
    caption: "Download the complete folder.\nVerify the ZIP with INSTALL.md.",
    narration:
      "Download the complete shared folder. Verify the zip using INSTALL dot M D.",
  },
  {
    id: "quick-extract",
    section: "Extract",
    durationSeconds: 6,
    visual: "folders",
    title: "Extract the extension",
    screenLines: [
      "Documents/GradPack-Alpha-7",
      "Use the extracted folder",
      "Do not choose the ZIP",
    ],
    caption: "Extract to Documents/GradPack-Alpha-7.",
    narration:
      "Extract the zip to Documents slash GradPack Alpha Seven. Chrome needs the folder.",
  },
  {
    id: "quick-developer-mode",
    section: "Chrome setup",
    durationSeconds: 7,
    visual: "chrome-capture",
    capture: "chrome-developer-mode.png",
    title: "Open Chrome extensions",
    screenLines: ["chrome://extensions", "Developer mode", "On"],
    caption: "Open chrome://extensions.\nTurn on Developer mode.",
    narration:
      "Open chrome colon slash slash extensions, then turn on Developer mode.",
  },
  {
    id: "quick-load",
    section: "Chrome setup",
    durationSeconds: 8,
    visual: "chrome-capture",
    capture: "chrome-load-unpacked.png",
    title: "Load GradPack Alpha 7",
    screenLines: [
      "Load unpacked",
      "Documents/GradPack-Alpha-7",
      "0.1.0-alpha.7 enabled",
    ],
    caption: "Click Load unpacked.\nConfirm Alpha 7 is enabled.",
    narration:
      "Click Load unpacked, choose the extracted folder, and confirm Alpha Seven is enabled.",
  },
  {
    id: "quick-canvas",
    section: "Connect",
    durationSeconds: 6,
    visual: "canvas",
    title: "Refresh Canvas once",
    screenLines: [
      "Frankfurt School Canvas",
      "Signed in",
      "Refresh once",
      "Keep the tab open",
    ],
    caption: "Refresh Canvas once.\nKeep the tab open.",
    narration:
      "Sign in to Canvas, refresh once, keep the tab open, and open GradPack.",
  },
  {
    id: "quick-choose",
    section: "Choose",
    durationSeconds: 8,
    visual: "gradpack",
    title: "Choose courses",
    screenLines: [
      "Example Finance Course",
      "Sample Strategy Course",
      "Select all courses",
      "One ZIP per course",
    ],
    caption: "Choose courses or Select all courses.\nThen start discovery.",
    narration:
      "Choose courses or Select all courses. Keep one zip per course, then start discovery.",
  },
  {
    id: "quick-review",
    section: "Review",
    durationSeconds: 7,
    visual: "download",
    title: "Review and confirm",
    screenLines: [
      "Ready courses: 2",
      "Skipped courses: 0",
      "Confirm retrieval",
      "Keep Canvas open",
    ],
    caption: "Review, confirm, and wait for every ZIP.",
    narration:
      "Review ready and skipped courses, confirm retrieval, and wait for every expected zip.",
  },
  {
    id: "quick-trust",
    section: "Responsible use",
    durationSeconds: 3,
    visual: "privacy",
    title: "Your archives stay local",
    screenLines: [
      "No telemetry",
      "No cloud upload",
      "Archives stay local",
      "Personal study only",
    ],
    caption: "Archives stay local.\nPersonal study only.",
    narration: "Archives stay local. Personal study only.",
  },
]);

export const quickStartTotalDurationSeconds = () =>
  quickStartScenes.reduce((total, scene) => total + scene.durationSeconds, 0);

export const buildQuickStartSrt = () => {
  let elapsed = 0;
  return `${quickStartScenes
    .map((scene, index) => {
      const start = elapsed;
      elapsed += scene.durationSeconds;
      return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(elapsed)}\n${scene.caption}\n`;
    })
    .join("\n")}\n`;
};

export const quickStartContent = Object.freeze({
  version: VIDEO_VERSION,
  videoFilename: QUICK_START_VIDEO_FILENAME,
  captionFilename: QUICK_START_CAPTION_FILENAME,
  scenes: quickStartScenes,
  buildSrt: buildQuickStartSrt,
  expectedDurationSeconds: 55,
  minimumDurationSeconds: 54,
  maximumDurationSeconds: 56,
  maximumVideoBytes: 25 * 1024 * 1024,
  expectedCaptionEndMilliseconds: 55_000,
});
```

- [ ] **Step 4: Run and format the scene contract**

```bash
pnpm exec prettier --write scripts/video/alpha7-quick-start-scenes.mjs tests/video/alpha7-quick-start-scenes.test.ts
CI=true pnpm exec vitest run tests/video/alpha7-quick-start-scenes.test.ts
pnpm exec prettier --check scripts/video/alpha7-quick-start-scenes.mjs tests/video/alpha7-quick-start-scenes.test.ts
```

Expected: 1 test file and 4 tests PASS; Prettier reports all files matched.

- [ ] **Step 5: Commit the quick-start content contract**

```bash
git add scripts/video/alpha7-quick-start-scenes.mjs tests/video/alpha7-quick-start-scenes.test.ts
git commit -m "feat: define Alpha 7 quick-start scenes"
```

---

### Task 2: Reuse the detailed build and validator safely

**Files:**

- Modify: `scripts/video/build-alpha7-installation.mjs`
- Modify: `scripts/video/validate-alpha7-installation.mjs`
- Modify: `scripts/video/render-alpha7-installation.mjs`
- Create: `scripts/video/build-alpha7-quick-start.mjs`
- Create: `scripts/video/validate-alpha7-quick-start.mjs`
- Modify: `tests/video/alpha7-installation-build.test.ts`
- Modify: `tests/video/alpha7-installation-validator.test.ts`
- Modify: `tests/video/alpha7-installation-renderer.test.ts`

**Interfaces:**

- Consumes: `quickStartContent` from Task 1 and existing detailed scenes/SRT.
- Produces: shared `detailedContent`, content-aware `buildVideo(options)`, configurable `validateProbe(probe, limits)`, configurable `validateSrt(srt, contract)`, and content-aware `validateRelease(options)`.

- [ ] **Step 1: Write failing shared-contract tests**

Add to `tests/video/alpha7-installation-build.test.ts`:

```ts
import { quickStartContent } from "../../scripts/video/alpha7-quick-start-scenes.mjs";
import { detailedContent } from "../../scripts/video/build-alpha7-installation.mjs";

it("keeps detailed and quick-start output names isolated", () => {
  expect(detailedContent.videoFilename).toBe(
    "GradPack-Alpha-7-Installation-Guide.mp4",
  );
  expect(quickStartContent.videoFilename).toBe(
    "GradPack-Alpha-7-Quick-Start.mp4",
  );
  expect(quickStartContent.videoFilename).not.toBe(
    detailedContent.videoFilename,
  );
  expect(quickStartContent.captionFilename).not.toBe(
    detailedContent.captionFilename,
  );
});
```

Add to `tests/video/alpha7-installation-validator.test.ts`:

```ts
it("accepts quick-start duration and size limits", () => {
  const probe = {
    format: { duration: "55.000", size: String(7 * 1024 * 1024) },
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
  };
  expect(() =>
    validateProbe(probe, {
      minimumDurationSeconds: 54,
      maximumDurationSeconds: 56,
      maximumVideoBytes: 25 * 1024 * 1024,
    }),
  ).not.toThrow();
  expect(() =>
    validateProbe(
      { ...probe, format: { duration: "57", size: "1" } },
      {
        minimumDurationSeconds: 54,
        maximumDurationSeconds: 56,
        maximumVideoBytes: 25 * 1024 * 1024,
      },
    ),
  ).toThrow("54-56 seconds");
});

it("accepts nine quick-start cues ending at 55 seconds", async () => {
  const { buildQuickStartSrt } =
    await import("../../scripts/video/alpha7-quick-start-scenes.mjs");
  expect(() =>
    validateSrt(buildQuickStartSrt(), {
      expectedCueCount: 9,
      expectedEndMilliseconds: 55_000,
    }),
  ).not.toThrow();
});
```

Add to `tests/video/alpha7-installation-renderer.test.ts`:

```ts
import { quickStartScenes } from "../../scripts/video/alpha7-quick-start-scenes.mjs";

it("renders the quick-start scene shape through the shared renderer", () => {
  const scene = quickStartScenes.find(({ id }) => id === "quick-choose")!;
  const svg = renderSceneSvg(scene);
  expect(svg).toContain("Example Finance Course");
  expect(svg).toContain("Select all courses");
  expect(svg).not.toContain("undefined");
});
```

- [ ] **Step 2: Run the shared-contract tests and verify red**

```bash
CI=true pnpm exec vitest run tests/video/alpha7-installation-build.test.ts tests/video/alpha7-installation-validator.test.ts tests/video/alpha7-installation-renderer.test.ts
CI=true pnpm typecheck
```

Expected: FAIL because `detailedContent` is not exported, validator functions do not accept content-specific limits, and the renderer's JSDoc type accepts only the detailed scene union.

- [ ] **Step 3: Add the detailed content contract and make the builder content-aware**

In `scripts/video/render-alpha7-installation.mjs`, replace its imported-scene
union typedef with this structural scene interface:

```js
/** @typedef {{ id: string, section: string, durationSeconds: number, visual: string, title: string, screenLines: string[], caption: string, narration: string, capture?: string }} Scene */
```

In `scripts/video/build-alpha7-installation.mjs`, replace its `Scene` typedef
with the same structural definition, then add the content typedef and detailed
contract after the imports:

```js
/** @typedef {{ id: string, section: string, durationSeconds: number, visual: string, title: string, screenLines: string[], caption: string, narration: string, capture?: string }} Scene */
/** @typedef {{ version: string, videoFilename: string, captionFilename: string, scenes: ReadonlyArray<Scene>, buildSrt: () => string, expectedDurationSeconds: number, minimumDurationSeconds: number, maximumDurationSeconds: number, maximumVideoBytes: number, expectedCaptionEndMilliseconds: number }} VideoContent */

export const detailedContent = Object.freeze({
  version: VIDEO_VERSION,
  videoFilename: VIDEO_FILENAME,
  captionFilename: CAPTION_FILENAME,
  scenes,
  buildSrt,
  expectedDurationSeconds: totalDurationSeconds(),
  minimumDurationSeconds: 339,
  maximumDurationSeconds: 342,
  maximumVideoBytes: 100 * 1024 * 1024,
  expectedCaptionEndMilliseconds: 340_000,
});
```

Change the `buildVideo` JSDoc and parameter list to accept an optional content contract:

```js
/** @param {BuildArguments & { sharp: Sharp, content?: VideoContent }} options */
export const buildVideo = async ({
  captureDirectory,
  workDirectory,
  sourceCommit,
  sharp,
  content = detailedContent,
}) => {
```

Within `buildVideo`, change the exact loop header from
`for (const [index, scene] of scenes.entries())` to
`for (const [index, scene] of content.scenes.entries())`. Do not alter the
tested frame, narration, and segment body. Replace the output-path, caption,
and metadata block with:

```js
const videoPath = join(workDirectory, content.videoFilename);
const captionPath = join(workDirectory, content.captionFilename);
await writeFile(captionPath, content.buildSrt(), "utf8");

const metadata = {
  sourceCommit,
  version: content.version,
  sceneCount: content.scenes.length,
  expectedDurationSeconds: content.expectedDurationSeconds,
  video: {
    filename: content.videoFilename,
    bytes: videoStat.size,
    sha256: await sha256(videoPath),
  },
  captions: {
    filename: content.captionFilename,
    sha256: await sha256(captionPath),
  },
};
```

Export `loadSharp` so the thin quick-start CLI can reuse the same bundled-runtime boundary:

```js
/** @returns {Sharp} */
export const loadSharp = () => {
  const nodeModules = process.env.VIDEO_NODE_MODULES;
  if (!nodeModules) throw new Error("VIDEO_NODE_MODULES is required");
  // The bundled runtime is loaded from a user-supplied module directory.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return /** @type {Sharp} */ (
    /** @type {unknown} */ (
      createRequire(import.meta.url)(join(nodeModules, "sharp"))
    )
  );
};
```

- [ ] **Step 4: Create the thin quick-start builder CLI**

Create `scripts/video/build-alpha7-quick-start.mjs`:

```js
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { quickStartContent } from "./alpha7-quick-start-scenes.mjs";
import {
  buildVideo,
  loadSharp,
  parseArgs,
} from "./build-alpha7-installation.mjs";

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const options = parseArgs(process.argv.slice(2));
  const outputs = await buildVideo({
    ...options,
    sharp: loadSharp(),
    content: quickStartContent,
  });
  process.stdout.write(`${JSON.stringify(outputs)}\n`);
}
```

- [ ] **Step 5: Generalize validator limits while retaining detailed defaults**

In `scripts/video/validate-alpha7-installation.mjs`, add these typedefs:

```js
/** @typedef {{ minimumDurationSeconds?: number, maximumDurationSeconds?: number, maximumVideoBytes?: number }} MediaLimits */
/** @typedef {{ version: string, videoFilename: string, captionFilename: string, scenes: ReadonlyArray<{ id: string, caption: string }>, buildSrt: () => string, expectedDurationSeconds: number, minimumDurationSeconds: number, maximumDurationSeconds: number, maximumVideoBytes: number, expectedCaptionEndMilliseconds: number }} ValidationContent */
```

Extend the existing `BuildMetadata` typedef with the expected duration field:

```js
/** @typedef {{ sourceCommit: string, version: string, sceneCount: number, expectedDurationSeconds: number, video: { filename: string, bytes: number, sha256: string }, captions: { filename: string, sha256: string } }} BuildMetadata */
```

Change `validateProbe` to accept defaults matching the detailed guide:

```js
/**
 * @param {Probe} probe
 * @param {MediaLimits} [limits]
 */
export const validateProbe = (
  probe,
  {
    minimumDurationSeconds = 339,
    maximumDurationSeconds = 342,
    maximumVideoBytes = 100 * 1024 * 1024,
  } = {},
) => {
  const video = probe.streams?.find(({ codec_type }) => codec_type === "video");
  const audio = probe.streams?.find(({ codec_type }) => codec_type === "audio");
  if (!video) throw new Error("missing video stream");
  if (!audio) throw new Error("missing audio stream");
  if (video.codec_name !== "h264") throw new Error("video codec must be h264");
  if (video.width !== 1920 || video.height !== 1080) {
    throw new Error("video resolution must be 1920x1080");
  }
  if (video.pix_fmt !== "yuv420p") {
    throw new Error("pixel format must be yuv420p");
  }
  if (video.avg_frame_rate !== "30/1") {
    throw new Error("frame rate must be 30 fps");
  }
  if (audio.codec_name !== "aac" || audio.sample_rate !== "48000") {
    throw new Error("audio must be 48 kHz AAC");
  }
  const duration = Number(probe.format?.duration);
  if (
    !Number.isFinite(duration) ||
    duration < minimumDurationSeconds ||
    duration > maximumDurationSeconds
  ) {
    throw new Error(
      `duration is outside ${minimumDurationSeconds}-${maximumDurationSeconds} seconds`,
    );
  }
  const size = Number(probe.format?.size);
  if (!Number.isFinite(size) || size > maximumVideoBytes) {
    throw new Error("video exceeds its size limit");
  }
};
```

Delete the now-unused module-level `MAX_VIDEO_BYTES` constant.

Change `validateSrt` to accept content-specific cue limits:

```js
/**
 * @param {string} srt
 * @param {{ expectedCueCount?: number, expectedEndMilliseconds?: number }} [contract]
 */
export const validateSrt = (
  srt,
  { expectedCueCount = 18, expectedEndMilliseconds = 340_000 } = {},
) => {
  const blocks = srt.trim().split(/\n{2,}/u);
  let previousEnd = 0;
  for (const block of blocks) {
    const lines = block.split("\n");
    const timing = lines[1]?.match(
      /^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/u,
    );
    if (!timing) throw new Error("caption timing is malformed");
    const start = srtTimeToMilliseconds(timing[1]);
    const end = srtTimeToMilliseconds(timing[2]);
    if (start < previousEnd || end <= start) {
      throw new Error("caption timing is not monotonic");
    }
    previousEnd = end;
  }
  if (blocks.length !== expectedCueCount) {
    throw new Error(`caption count must be ${expectedCueCount}`);
  }
  if (previousEnd !== expectedEndMilliseconds) {
    throw new Error(
      `captions must end at ${expectedEndMilliseconds} milliseconds`,
    );
  }
};
```

Extend the `ReleaseOptions` typedef and `validateRelease` argument with optional content:

```js
/** @typedef {{ videoPath: string, captionPath: string, metadataPath: string, releaseDirectory: string, content?: ValidationContent }} ReleaseOptions */

export const validateRelease = async ({
  videoPath,
  captionPath,
  metadataPath,
  releaseDirectory,
  content = detailedValidationContent,
}) => {
```

Define the detailed default beside the constants:

```js
export const detailedValidationContent = Object.freeze({
  version: VIDEO_VERSION,
  videoFilename: VIDEO_FILENAME,
  captionFilename: CAPTION_FILENAME,
  scenes,
  buildSrt,
  expectedDurationSeconds: 340,
  minimumDurationSeconds: 339,
  maximumDurationSeconds: 342,
  maximumVideoBytes: 100 * 1024 * 1024,
  expectedCaptionEndMilliseconds: 340_000,
});
```

Inside `validateRelease`, use the content contract for media, SRT, metadata, names, hashes, privacy source, and report fields:

```js
validateProbe(probe, content);
validateSrt(srt, {
  expectedCueCount: content.scenes.length,
  expectedEndMilliseconds: content.expectedCaptionEndMilliseconds,
});
if (srt !== content.buildSrt()) {
  throw new Error("captions differ from scene source");
}
if (
  metadata.version !== content.version ||
  metadata.sceneCount !== content.scenes.length ||
  metadata.expectedDurationSeconds !== content.expectedDurationSeconds ||
  metadata.video.filename !== content.videoFilename ||
  metadata.captions.filename !== content.captionFilename ||
  basename(videoPath) !== content.videoFilename ||
  basename(captionPath) !== content.captionFilename
) {
  throw new Error("build metadata does not match content contract");
}
validatePrivacy(JSON.stringify(content.scenes));

return {
  status: "pass",
  version: content.version,
  durationSeconds: Math.round(Number(probe.format?.duration)),
  videoMiB: Number((Number(probe.format?.size) / (1024 * 1024)).toFixed(2)),
  sceneCount: content.scenes.length,
};
```

- [ ] **Step 6: Create the thin quick-start validator CLI**

Create `scripts/video/validate-alpha7-quick-start.mjs`:

```js
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { quickStartContent } from "./alpha7-quick-start-scenes.mjs";
import { validateRelease } from "./validate-alpha7-installation.mjs";

/**
 * @param {string[]} argv
 * @param {string} name
 */
const requiredArgument = (argv, name) => {
  const index = argv.indexOf(name);
  if (index === -1 || !argv[index + 1]) throw new Error(`${name} is required`);
  return resolve(argv[index + 1]);
};

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const argv = process.argv.slice(2);
  const result = await validateRelease({
    videoPath: requiredArgument(argv, "--video"),
    captionPath: requiredArgument(argv, "--captions"),
    metadataPath: requiredArgument(argv, "--metadata"),
    releaseDirectory: requiredArgument(argv, "--release-dir"),
    content: quickStartContent,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
```

- [ ] **Step 7: Run shared regression checks**

```bash
pnpm exec prettier --write scripts/video tests/video
CI=true pnpm exec vitest run tests/video
CI=true pnpm exec eslint scripts/video tests/video --max-warnings=0
CI=true pnpm typecheck
```

Expected: all video tests PASS; ESLint and TypeScript exit 0. The existing detailed build and validator tests remain green.

- [ ] **Step 8: Commit the shared pipeline support**

```bash
git add scripts/video tests/video
git commit -m "feat: support Alpha 7 quick-start video"
```

---

### Task 3: Build, validate, and visually review the quick-start media

**Files:**

- Generate outside Git: `/private/tmp/gradpack-alpha7-quick-start/`
- Copy outside Git after validation: Alpha 7 release MP4 and SRT.

**Interfaces:**

- Consumes: quick-start builder/validator from Task 2, existing five synthetic Chrome captures, bundled `sharp`, Samantha, FFmpeg/FFprobe, and the Alpha 7 release ZIP/checksum.
- Produces: final 55-second MP4, SRT, metadata, nine frame/audio/segment files, and review contact sheet.

- [ ] **Step 1: Snapshot every pre-existing release artifact**

```bash
mkdir -p /private/tmp/gradpack-alpha7-quick-start
shasum -a 256 \
  /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7/* \
  > /private/tmp/gradpack-alpha7-quick-start/preexisting-release.sha256
```

Expected: the sidecar lists every existing release file before the quick-start
MP4/SRT or sharing-guide edit.

- [ ] **Step 2: Regenerate the synthetic Chrome captures**

```bash
VIDEO_NODE_MODULES=/Users/esso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
node scripts/video/generate-alpha7-chrome-captures.mjs \
  --output-dir /private/tmp/gradpack-alpha7-quick-start/captures
```

Expected: five 1920×1080 PNG captures and JSON reporting `captures: 5`.

- [ ] **Step 3: Build with real Samantha narration outside the sandbox**

Run outside the sandbox because sandboxed macOS `say` produces header-only silent AIFF files:

```bash
VIDEO_NODE_MODULES=/Users/esso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
node scripts/video/build-alpha7-quick-start.mjs \
  --capture-dir /private/tmp/gradpack-alpha7-quick-start/captures \
  --work-dir /private/tmp/gradpack-alpha7-quick-start/build \
  --source-commit 3ab29b97f8d2929c341a8d173d8b424b2fdf58e1
```

Expected: 9 PNG frames, 9 non-empty AIFF files, 9 MP4 segments, the quick-start MP4/SRT, and `build-metadata.json`.

- [ ] **Step 4: Validate the temporary artifacts**

```bash
node scripts/video/validate-alpha7-quick-start.mjs \
  --video /private/tmp/gradpack-alpha7-quick-start/build/GradPack-Alpha-7-Quick-Start.mp4 \
  --captions /private/tmp/gradpack-alpha7-quick-start/build/GradPack-Alpha-7-Quick-Start.srt \
  --metadata /private/tmp/gradpack-alpha7-quick-start/build/build-metadata.json \
  --release-dir /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7
```

Expected success shape:

```json
{
  "status": "pass",
  "version": "0.1.0-alpha.7",
  "durationSeconds": 55,
  "videoMiB": 0,
  "sceneCount": 9
}
```

The actual `videoMiB` may differ but must be at most 25.

- [ ] **Step 5: Decode the complete candidate and inspect audio level**

```bash
ffmpeg -v error \
  -i /private/tmp/gradpack-alpha7-quick-start/build/GradPack-Alpha-7-Quick-Start.mp4 \
  -f null -

ffmpeg -hide_banner \
  -i /private/tmp/gradpack-alpha7-quick-start/build/GradPack-Alpha-7-Quick-Start.mp4 \
  -af volumedetect -f null - 2>&1 | rg 'mean_volume|max_volume'
```

Expected: decode exits 0; `max_volume` is finite and above `-50 dB`.

- [ ] **Step 6: Create and inspect a nine-frame contact sheet**

```bash
mkdir -p /private/tmp/gradpack-alpha7-quick-start/review
ffmpeg -y -hide_banner -loglevel error -framerate 1 \
  -pattern_type glob \
  -i '/private/tmp/gradpack-alpha7-quick-start/build/frames/*.png' \
  -vf 'scale=480:270,tile=3x3' -frames:v 1 \
  /private/tmp/gradpack-alpha7-quick-start/review/contact-sheet.png
```

Use `view_image` on the contact sheet and all nine original frames. Verify readable captions, no clipping, one callout per Chrome step, the exact sequence, synthetic course labels only, and no sensitive content.

- [ ] **Step 7: Copy verified outputs into the release folder**

Copy, do not move:

```bash
cp /private/tmp/gradpack-alpha7-quick-start/build/GradPack-Alpha-7-Quick-Start.mp4 \
  /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7/
cp /private/tmp/gradpack-alpha7-quick-start/build/GradPack-Alpha-7-Quick-Start.srt \
  /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7/
```

- [ ] **Step 8: Update the local sharing guide without removing existing files**

Use `apply_patch` on the local release `SHARE_WITH_CLASSMATES.md` to:

- add `GradPack-Alpha-7-Quick-Start.mp4` and `.srt` to the inventory;
- tell classmates to watch the 55-second quick start first;
- retain the 5:40 guide as the detailed fallback; and
- preserve the personal-study and privacy-safe feedback language.

- [ ] **Step 9: Revalidate the copied artifacts and original ZIP**

```bash
node scripts/video/validate-alpha7-quick-start.mjs \
  --video /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7/GradPack-Alpha-7-Quick-Start.mp4 \
  --captions /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7/GradPack-Alpha-7-Quick-Start.srt \
  --metadata /private/tmp/gradpack-alpha7-quick-start/build/build-metadata.json \
  --release-dir /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7

cd /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7
shasum -a 256 -c gradpack-0.1.0-alpha.7.zip.sha256
unzip -t gradpack-0.1.0-alpha.7.zip
```

Expected: validator passes; ZIP reports `OK`; unzip reports no errors. After
the intentional `SHARE_WITH_CLASSMATES.md` edit, filter that guide out and
verify every other pre-existing artifact still matches the snapshot with:

```bash
rg -v 'SHARE_WITH_CLASSMATES.md' \
  /private/tmp/gradpack-alpha7-quick-start/preexisting-release.sha256 \
  > /private/tmp/gradpack-alpha7-quick-start/preexisting-unchanged.sha256
shasum -a 256 -c \
  /private/tmp/gradpack-alpha7-quick-start/preexisting-unchanged.sha256
```

Expected: every non-guide pre-existing artifact reports `OK`.

---

### Task 4: Final repository and distribution audit

**Files:**

- Verify committed: design, plan, quick-start scenes, shared build/validator changes, CLIs, and tests.
- Verify local release: all pre-existing files plus quick-start MP4 and SRT.

**Interfaces:**

- Consumes: all Task 1–3 outputs.
- Produces: clean branch, fresh repository gate, exact release inventory/hashes, and a ready-to-watch quick-start video.

- [ ] **Step 1: Run the fresh repository gate**

```bash
CI=true pnpm verify
git diff --check origin/main...HEAD
git status --short
```

Expected: formatting, lint, typecheck, all tests, and build pass; no whitespace errors; worktree is clean.

- [ ] **Step 2: Verify release inventory and hashes**

```bash
find /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7 \
  -maxdepth 1 -type f -print | sort
shasum -a 256 \
  /Users/esso/Documents/codes/personal-projects/GradPack/GradPack-classmate-release-0.1.0-alpha.7/*
```

Expected: every prior artifact remains present, plus the quick-start MP4 and SRT. The detailed guide hashes remain unchanged from their pre-task values.

- [ ] **Step 3: Run the final privacy scan**

Scan the quick-start scene JSON, SRT, sharing guide, metadata, and reviewed frames for real course names/IDs/URLs, identity, email, credentials, private user paths, placeholders, and unrelated browser content. Any match must be inspected; expected result is no prohibited information.

- [ ] **Step 4: Preserve the clean source branch and local media**

```bash
git status --short
git log -4 --oneline
```

Expected: status is clean and the quick-start source commits are visible. Do
not commit generated MP4/SRT files, captures, narration, segments, temporary
metadata, contact sheets, or local release-folder edits. Keep
`codex/installation-video` available for integration review.
