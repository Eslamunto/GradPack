import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPTION_FILENAME,
  VIDEO_FILENAME,
  VIDEO_VERSION,
  buildSrt,
  scenes,
  totalDurationSeconds,
} from "./alpha7-installation-scenes.mjs";
import { renderSceneSvg } from "./render-alpha7-installation.mjs";

/** @typedef {{ id: string, section: string, durationSeconds: number, visual: string, title: string, screenLines: string[], caption: string, narration: string, capture?: string }} Scene */
/** @typedef {{ resize: (width: number, height: number, options: { fit: string }) => SharpPipeline, png: () => SharpPipeline, toFile: (path: string) => Promise<unknown> }} SharpPipeline */
/** @typedef {(input: Buffer) => SharpPipeline} Sharp */
/** @typedef {{ captureDirectory: string, workDirectory: string, sourceCommit: string }} BuildArguments */
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

/**
 * @param {string[]} argv
 * @param {string} name
 */
const requiredArgument = (argv, name) => {
  const index = argv.indexOf(name);
  if (index === -1 || !argv[index + 1]) throw new Error(`${name} is required`);
  return argv[index + 1];
};

/**
 * @param {string[]} argv
 * @returns {BuildArguments}
 */
export const parseArgs = (argv) => ({
  captureDirectory: resolve(requiredArgument(argv, "--capture-dir")),
  workDirectory: resolve(requiredArgument(argv, "--work-dir")),
  sourceCommit: requiredArgument(argv, "--source-commit"),
});

/** @param {Scene} scene */
export const captureNameFor = (scene) =>
  scene.visual === "chrome-capture" ? scene.capture : null;

/**
 * @param {Scene} scene
 * @param {{ framePath: string, audioPath: string, segmentPath: string }} paths
 * @returns {string[]}
 */
export const segmentArgs = (scene, { framePath, audioPath, segmentPath }) => [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
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

/** @param {string} path */
const quoteConcatPath = (path) => path.replaceAll("'", "'\\''");

/** @param {string[]} segmentPaths */
export const concatFileContent = (segmentPaths) =>
  `${segmentPaths.map((path) => `file '${quoteConcatPath(path)}'`).join("\n")}\n`;

/**
 * @param {string} command
 * @param {string[]} args
 */
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with code ${result.status ?? "unknown"}`,
    );
  }
  return result.stdout.trim();
};

/** @param {string} audioPath */
const audioDurationSeconds = (audioPath) =>
  Number(
    run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ]),
  );

/**
 * @param {Scene} scene
 * @param {number} narrationDuration
 */
export const assertNarrationDuration = (scene, narrationDuration) => {
  if (!Number.isFinite(narrationDuration) || narrationDuration <= 0.1) {
    throw new Error(`narration for ${scene.id} contains no audio`);
  }
  if (narrationDuration > scene.durationSeconds - 0.5) {
    throw new Error(
      `narration for ${scene.id} exceeds its ${scene.durationSeconds}-second scene`,
    );
  }
};

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

/** @param {string} path */
const sha256 = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

/** @param {BuildArguments & { sharp: Sharp, content?: VideoContent }} options */
export const buildVideo = async ({
  captureDirectory,
  workDirectory,
  sourceCommit,
  sharp,
  content = detailedContent,
}) => {
  const framesDirectory = join(workDirectory, "frames");
  const audioDirectory = join(workDirectory, "audio");
  const segmentsDirectory = join(workDirectory, "segments");
  await Promise.all(
    [workDirectory, framesDirectory, audioDirectory, segmentsDirectory].map(
      (directory) => mkdir(directory, { recursive: true }),
    ),
  );

  const segmentPaths = [];
  for (const [index, scene] of content.scenes.entries()) {
    const prefix = `${String(index + 1).padStart(2, "0")}-${scene.id}`;
    const framePath = join(framesDirectory, `${prefix}.png`);
    const audioPath = join(audioDirectory, `${prefix}.aiff`);
    const segmentPath = join(segmentsDirectory, `${prefix}.mp4`);
    const captureName = captureNameFor(scene);
    const captureDataUrl = captureName
      ? `data:image/png;base64,${(await readFile(join(captureDirectory, captureName))).toString("base64")}`
      : undefined;

    await sharp(Buffer.from(renderSceneSvg(scene, { captureDataUrl })))
      .resize(1920, 1080, { fit: "fill" })
      .png()
      .toFile(framePath);
    run("say", ["-v", "Samantha", "-o", audioPath, scene.narration]);
    const narrationDuration = audioDurationSeconds(audioPath);
    assertNarrationDuration(scene, narrationDuration);
    run("ffmpeg", segmentArgs(scene, { framePath, audioPath, segmentPath }));
    segmentPaths.push(segmentPath);
  }

  const concatPath = join(workDirectory, "segments.txt");
  const videoPath = join(workDirectory, content.videoFilename);
  const captionPath = join(workDirectory, content.captionFilename);
  await writeFile(concatPath, concatFileContent(segmentPaths), "utf8");
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-c",
    "copy",
    videoPath,
  ]);
  await writeFile(captionPath, content.buildSrt(), "utf8");

  const videoStat = await stat(videoPath);
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
  const metadataPath = join(workDirectory, "build-metadata.json");
  await writeFile(
    metadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
  return { videoPath, captionPath, metadataPath };
};

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const options = parseArgs(process.argv.slice(2));
  const outputs = await buildVideo({ ...options, sharp: loadSharp() });
  process.stdout.write(`${JSON.stringify(outputs)}\n`);
}
