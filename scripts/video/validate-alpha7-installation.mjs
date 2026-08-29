import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPTION_FILENAME,
  PROHIBITED_TEXT_PATTERNS,
  VIDEO_FILENAME,
  VIDEO_VERSION,
  buildSrt,
  scenes,
} from "./alpha7-installation-scenes.mjs";

const SOURCE_COMMIT = "3ab29b97f8d2929c341a8d173d8b424b2fdf58e1";

/** @typedef {{ codec_type?: string, codec_name?: string, width?: number, height?: number, pix_fmt?: string, avg_frame_rate?: string, sample_rate?: string }} ProbeStream */
/** @typedef {{ streams?: ProbeStream[], format?: { duration?: string, size?: string } }} Probe */
/** @typedef {{ minimumDurationSeconds?: number, maximumDurationSeconds?: number, maximumVideoBytes?: number }} MediaLimits */
/** @typedef {{ version: string, videoFilename: string, captionFilename: string, scenes: ReadonlyArray<{ id: string, caption: string }>, buildSrt: () => string, expectedDurationSeconds: number, minimumDurationSeconds: number, maximumDurationSeconds: number, maximumVideoBytes: number, expectedCaptionEndMilliseconds: number }} ValidationContent */
/** @typedef {{ sourceCommit: string, version: string, sceneCount: number, expectedDurationSeconds: number, video: { filename: string, bytes: number, sha256: string }, captions: { filename: string, sha256: string } }} BuildMetadata */
/** @typedef {{ videoPath: string, captionPath: string, metadataPath: string, releaseDirectory: string, content?: ValidationContent }} ReleaseOptions */

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

/** @param {number} peakDecibels */
export const validateAudioPeak = (peakDecibels) => {
  if (!Number.isFinite(peakDecibels) || peakDecibels < -50) {
    throw new Error("narration audio is silent");
  }
};

/** @param {string} value */
const srtTimeToMilliseconds = (value) => {
  const [clock, milliseconds] = value.split(",");
  const [hours, minutes, seconds] = clock.split(":").map(Number);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(milliseconds);
};

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

/**
 * @param {string[]} argv
 * @param {string} name
 */
const requiredArgument = (argv, name) => {
  const index = argv.indexOf(name);
  if (index === -1 || !argv[index + 1]) throw new Error(`${name} is required`);
  return resolve(argv[index + 1]);
};

/**
 * @param {string} videoPath
 * @returns {Probe}
 */
const runFfprobe = (videoPath) => {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,sample_rate",
      "-of",
      "json",
      videoPath,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffprobe exited with code ${result.status ?? "unknown"}`);
  }
  // FFprobe is validated immediately by validateProbe.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return /** @type {Probe} */ (
    /** @type {unknown} */ (JSON.parse(result.stdout))
  );
};

/** @param {string} videoPath */
const runAudioPeak = (videoPath) => {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      videoPath,
      "-map",
      "0:a:0",
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with code ${result.status ?? "unknown"}`);
  }
  const match = result.stderr.match(
    /max_volume:\s*(-?inf|-?\d+(?:\.\d+)?)\s+dB/iu,
  );
  if (!match) throw new Error("narration audio peak is unavailable");
  return match[1]?.toLowerCase() === "-inf"
    ? Number.NEGATIVE_INFINITY
    : Number(match[1]);
};

/** @param {string} path */
const sha256 = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

/** @param {string} value */
const validatePrivacy = (value) => {
  for (const pattern of PROHIBITED_TEXT_PATTERNS) {
    if (pattern.test(value)) throw new Error(`privacy scan failed: ${pattern}`);
  }
};

/** @param {string} releaseDirectory */
const validateReleaseZip = async (releaseDirectory) => {
  const zipName = "gradpack-0.1.0-alpha.7.zip";
  const zipPath = join(releaseDirectory, zipName);
  const sidecar = await readFile(`${zipPath}.sha256`, "utf8");
  const match = sidecar.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/iu);
  if (!match || match[2] !== zipName) {
    throw new Error("release checksum sidecar is malformed");
  }
  if ((await sha256(zipPath)) !== match[1].toLowerCase()) {
    throw new Error("release ZIP checksum changed");
  }
};

/** @param {ReleaseOptions} options */
export const validateRelease = async ({
  videoPath,
  captionPath,
  metadataPath,
  releaseDirectory,
  content = detailedValidationContent,
}) => {
  const probe = runFfprobe(videoPath);
  validateProbe(probe, content);
  validateAudioPeak(runAudioPeak(videoPath));
  const srt = await readFile(captionPath, "utf8");
  validateSrt(srt, {
    expectedCueCount: content.scenes.length,
    expectedEndMilliseconds: content.expectedCaptionEndMilliseconds,
  });
  if (srt !== content.buildSrt()) {
    throw new Error("captions differ from scene source");
  }

  // The parsed structure is checked field-by-field below.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const metadata = /** @type {BuildMetadata} */ (
    /** @type {unknown} */ (JSON.parse(await readFile(metadataPath, "utf8")))
  );
  if (metadata.sourceCommit !== SOURCE_COMMIT) {
    throw new Error("source commit does not match Alpha 7");
  }
  if (
    metadata.version !== content.version ||
    metadata.sceneCount !== content.scenes.length ||
    metadata.expectedDurationSeconds !== content.expectedDurationSeconds ||
    metadata.video?.filename !== content.videoFilename ||
    metadata.captions?.filename !== content.captionFilename ||
    basename(videoPath) !== content.videoFilename ||
    basename(captionPath) !== content.captionFilename
  ) {
    throw new Error("build metadata does not match content contract");
  }
  if ((await sha256(videoPath)) !== metadata.video.sha256) {
    throw new Error("video hash does not match build metadata");
  }
  if ((await sha256(captionPath)) !== metadata.captions.sha256) {
    throw new Error("caption hash does not match build metadata");
  }
  if ((await stat(videoPath)).size !== metadata.video.bytes) {
    throw new Error("video size does not match build metadata");
  }

  validatePrivacy(JSON.stringify(content.scenes));
  validatePrivacy(srt);
  await validateReleaseZip(releaseDirectory);

  return {
    status: "pass",
    version: content.version,
    durationSeconds: Math.round(Number(probe.format.duration)),
    videoMiB: Number((Number(probe.format.size) / (1024 * 1024)).toFixed(2)),
    sceneCount: content.scenes.length,
  };
};

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const argv = process.argv.slice(2);
  const result = await validateRelease({
    videoPath: requiredArgument(argv, "--video"),
    captionPath: requiredArgument(argv, "--captions"),
    metadataPath: requiredArgument(argv, "--metadata"),
    releaseDirectory: requiredArgument(argv, "--release-dir"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
