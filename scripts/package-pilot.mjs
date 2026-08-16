// @ts-check
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

export const PILOT_ARTIFACT_NAME = "gradpack-0.1.0-alpha.1.zip";
export const PILOT_FILES = Object.freeze([
  "archive.css",
  "manifest.json",
  "relay.js",
  "runner.js",
  "service-worker.js",
  "sidepanel.css",
  "sidepanel.html",
  "sidepanel.js",
]);

const FIXED_MTIME = new Date(2000, 0, 1, 0, 0, 0, 0);
const FILE_MODE = 0o100644 << 16;
const FORBIDDEN_CONTENT = [
  /(?:^|\n)\s*\/\/[#@]\s*sourceMappingURL=/u,
  /\bGradPack Dev\b/u,
  /gradpack-dev/iu,
  /__gradPackLiveSmokeV1/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bAuthorization\s*:/u,
];

/**
 * @param {string} path
 * @param {string} label
 */
const assertPlainDirectory = async (path, label) => {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new TypeError(`${label} is missing`, { cause: error });
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError(`${label} must be a plain directory`);
  }
};

/** @param {string} path */
const readPlainFile = async (path) => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || !Number.isSafeInteger(stat.size)) {
      throw new TypeError("Pilot file must be a non-empty regular file");
    }
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
};

/**
 * @param {string} path
 * @param {Uint8Array} bytes
 */
const validateText = (path, bytes) => {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`Pilot file is not UTF-8 text: ${path}`);
  }
  if (FORBIDDEN_CONTENT.some((pattern) => pattern.test(text))) {
    throw new TypeError(`Pilot file contains forbidden content: ${path}`);
  }
  if (path === "manifest.json") {
    /** @type {unknown} */
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch {
      throw new TypeError("Pilot manifest is invalid JSON");
    }
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      Array.isArray(manifest) ||
      !("name" in manifest) ||
      manifest.name !== "GradPack" ||
      !("version" in manifest) ||
      manifest.version !== "0.1.0" ||
      !("version_name" in manifest) ||
      manifest.version_name !== "0.1.0-alpha.1"
    ) {
      throw new TypeError("Pilot manifest identity is invalid");
    }
  }
};

/**
 * @param {string} path
 * @param {Uint8Array} bytes
 */
const writePlainFile = async (path, bytes) => {
  const handle = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
};

/** @typedef {{ buildRoot?: string, artifactRoot?: string }} PackagePilotOptions */

/**
 * @param {PackagePilotOptions} [options]
 * @returns {Promise<{ artifactPath: string, checksumPath: string, digest: string }>}
 */
export async function packagePilot({
  buildRoot = "dist",
  artifactRoot = "artifacts",
} = {}) {
  const buildDirectory = resolve(buildRoot);
  await assertPlainDirectory(buildDirectory, "Production build");
  const directoryEntries = await readdir(buildDirectory, {
    withFileTypes: true,
  });
  const names = directoryEntries
    .map(({ name }) => name)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (
    names.length !== PILOT_FILES.length ||
    names.some((name, index) => name !== PILOT_FILES[index])
  ) {
    throw new TypeError(
      "Production build contains missing or unexpected files",
    );
  }
  if (
    directoryEntries.some((entry) => entry.isSymbolicLink() || !entry.isFile())
  ) {
    throw new TypeError("Production build contains a symlink or non-file");
  }

  /** @type {import("fflate").Zippable} */
  const zippable = {};
  for (const path of PILOT_FILES) {
    const bytes = await readPlainFile(join(buildDirectory, path));
    validateText(path, bytes);
    zippable[path] = [
      bytes,
      {
        level: 9,
        mtime: FIXED_MTIME,
        os: 3,
        attrs: FILE_MODE,
        comment: "",
      },
    ];
  }
  const zip = zipSync(zippable);
  const digest = createHash("sha256").update(zip).digest("hex");
  const artifactDirectory = resolve(artifactRoot);
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  await assertPlainDirectory(artifactDirectory, "Artifact directory");
  const artifactPath = join(artifactDirectory, PILOT_ARTIFACT_NAME);
  const checksumPath = `${artifactPath}.sha256`;
  await writePlainFile(artifactPath, zip);
  await writePlainFile(
    checksumPath,
    new TextEncoder().encode(`${digest}  ${PILOT_ARTIFACT_NAME}\n`),
  );
  return { artifactPath, checksumPath, digest };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await packagePilot();
}
