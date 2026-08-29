import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scenes } from "./alpha7-installation-scenes.mjs";
import { renderSyntheticChromeCaptureSvg } from "./render-alpha7-installation.mjs";

export const chromeCaptureScenes = Object.freeze(
  scenes.filter(({ visual }) => visual === "chrome-capture"),
);

const parseOutputDirectory = (argv) => {
  const index = argv.indexOf("--output-dir");
  if (index === -1 || !argv[index + 1]) {
    throw new Error("--output-dir is required");
  }
  return resolve(argv[index + 1]);
};

const loadSharp = () => {
  const nodeModules = process.env.VIDEO_NODE_MODULES;
  if (!nodeModules) throw new Error("VIDEO_NODE_MODULES is required");
  return createRequire(import.meta.url)(join(nodeModules, "sharp"));
};

export const generateChromeCaptures = async ({ outputDirectory, sharp }) => {
  await mkdir(outputDirectory, { recursive: true });
  for (const scene of chromeCaptureScenes) {
    const svg = renderSyntheticChromeCaptureSvg(scene);
    await sharp(Buffer.from(svg))
      .resize(1920, 1080, { fit: "fill" })
      .png()
      .toFile(join(outputDirectory, scene.capture));
  }
};

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const outputDirectory = parseOutputDirectory(process.argv.slice(2));
  await generateChromeCaptures({ outputDirectory, sharp: loadSharp() });
  process.stdout.write(
    `${JSON.stringify({ outputDirectory, captures: chromeCaptureScenes.length })}\n`,
  );
}

export const sourceDirectory = dirname(thisFile);
