// @ts-check
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
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
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const FORBIDDEN_CONTENT = [
  /(?:^|\n)\s*\/\/[#@]\s*sourceMappingURL=/u,
  /\bGradPack Dev\b/u,
  /gradpack-dev/iu,
  /__gradPackLiveSmokeV1/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bAuthorization\s*:/u,
];

/** @typedef {{ dev: number, ino: number }} Identity */
/** @typedef {Identity & { size: number, mtimeMs: number, ctimeMs: number }} FileSeal */
/** @typedef {{ path: string, requestedPath: string, identity: Identity }} SealedDirectory */
/** @typedef {(name: string) => void | Promise<void>} Checkpoint */

/** @param {import("node:fs").Stats} stat */
const identityOf = (stat) => ({ dev: stat.dev, ino: stat.ino });

/** @param {import("node:fs").Stats} stat */
const fileSealOf = (stat) => ({
  ...identityOf(stat),
  size: stat.size,
  mtimeMs: stat.mtimeMs,
  ctimeMs: stat.ctimeMs,
});

/**
 * @param {Identity} left
 * @param {Identity} right
 */
const sameIdentity = (left, right) =>
  left.dev === right.dev && left.ino === right.ino;

/**
 * @param {string} path
 * @param {string} label
 */
const missingAsTypeError = async (path, label) => {
  try {
    return await lstat(path);
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
};

/**
 * Canonicalizing a validated path removes any pre-existing ancestor aliases.
 * Every later operation rechecks the canonical root's filesystem identity.
 *
 * @param {string} input
 * @param {string} label
 * @param {boolean} create
 * @returns {Promise<SealedDirectory>}
 */
const sealDirectory = async (input, label, create = false) => {
  const requestedPath = resolve(input);
  if (create) await mkdir(requestedPath, { recursive: true, mode: 0o700 });
  const requestedStat = await missingAsTypeError(requestedPath, label);
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory()) {
    throw new TypeError(`${label} must be a plain directory`);
  }
  const path = await realpath(requestedPath);
  const canonicalStat = await missingAsTypeError(path, label);
  if (
    canonicalStat.isSymbolicLink() ||
    !canonicalStat.isDirectory() ||
    !sameIdentity(identityOf(requestedStat), identityOf(canonicalStat))
  ) {
    throw new TypeError(`${label} identity changed`);
  }
  return { path, requestedPath, identity: identityOf(canonicalStat) };
};

/**
 * @param {SealedDirectory} directory
 * @param {string} label
 */
const assertDirectoryIdentity = async (directory, label) => {
  const stat = await missingAsTypeError(directory.path, label);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    !sameIdentity(directory.identity, identityOf(stat))
  ) {
    throw new TypeError(`${label} identity changed`);
  }
};

/**
 * @param {import("node:fs/promises").FileHandle} handle
 * @param {string} path
 * @param {Identity} identity
 */
const assertLinkedFileIdentity = async (handle, path, identity) => {
  const [openStat, pathStat] = await Promise.all([handle.stat(), lstat(path)]);
  if (
    !openStat.isFile() ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    openStat.nlink !== 1 ||
    pathStat.nlink !== 1 ||
    !sameIdentity(identity, identityOf(openStat)) ||
    !sameIdentity(identity, identityOf(pathStat))
  ) {
    throw new TypeError(
      "Pilot file identity changed or has an unsafe link count",
    );
  }
};

/**
 * @param {import("node:fs/promises").FileHandle} handle
 * @param {string} path
 * @param {FileSeal} seal
 */
const assertBuildFileIdentity = async (handle, path, seal) => {
  await assertLinkedFileIdentity(handle, path, seal);
  const [openStat, pathStat] = await Promise.all([handle.stat(), lstat(path)]);
  for (const stat of [openStat, pathStat]) {
    if (
      stat.size !== seal.size ||
      stat.mtimeMs !== seal.mtimeMs ||
      stat.ctimeMs !== seal.ctimeMs
    ) {
      throw new TypeError("Pilot file identity or contents changed");
    }
  }
};

/**
 * @param {SealedDirectory} directory
 * @param {Checkpoint} checkpoint
 */
const readSealedBuild = async (directory, checkpoint) => {
  await assertDirectoryIdentity(directory, "Production build");
  const directoryEntries = await readdir(directory.path, {
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

  /** @type {Array<{ path: string, handle: import("node:fs/promises").FileHandle, seal: FileSeal }>} */
  const files = [];
  try {
    for (const name of PILOT_FILES) {
      await assertDirectoryIdentity(directory, "Production build");
      const path = join(directory.path, name);
      const before = await missingAsTypeError(path, "Pilot file");
      if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
        throw new TypeError("Pilot file is a symlink, hardlink, or non-file");
      }
      const handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
      const seal = fileSealOf(before);
      files.push({ path, handle, seal });
      await checkpoint(`build-file-opened:${name}`);
      await assertBuildFileIdentity(handle, path, seal);
    }
    await checkpoint("build-sealed");
    await assertDirectoryIdentity(directory, "Production build");
    for (const file of files) {
      await assertBuildFileIdentity(file.handle, file.path, file.seal);
    }

    /** @type {Map<string, Uint8Array>} */
    const output = new Map();
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const name = PILOT_FILES[index];
      if (!file || !name) throw new TypeError("Incomplete sealed build");
      const stat = await file.handle.stat();
      if (!Number.isSafeInteger(stat.size) || stat.size < 1) {
        throw new TypeError("Pilot file must be a non-empty regular file");
      }
      output.set(name, new Uint8Array(await file.handle.readFile()));
      await assertBuildFileIdentity(file.handle, file.path, file.seal);
    }
    await assertDirectoryIdentity(directory, "Production build");
    return output;
  } finally {
    await Promise.all(
      files.map(({ handle }) => handle.close().catch(() => {})),
    );
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

/** @param {string} path */
const assertSafeExistingTarget = async (path) => {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
      throw new TypeError(
        "Artifact target has an unsafe hardlink or link count",
      );
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
};

/**
 * @param {SealedDirectory} directory
 * @param {Uint8Array} bytes
 */
const createTemporaryArtifact = async (directory, bytes) => {
  await assertDirectoryIdentity(directory, "Artifact directory");
  const path = join(
    directory.path,
    `.gradpack-${randomBytes(16).toString("hex")}.tmp`,
  );
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
    0o600,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) {
      throw new TypeError("Temporary artifact has an unsafe link count");
    }
    const identity = identityOf(before);
    await handle.writeFile(bytes);
    await handle.sync();
    await assertLinkedFileIdentity(handle, path, identity);
    await assertDirectoryIdentity(directory, "Artifact directory");
    return { path, identity };
  } finally {
    await handle.close();
  }
};

/**
 * @param {{ path: string, identity: Identity }} temporary
 */
const removeTemporaryArtifact = async (temporary) => {
  try {
    const stat = await lstat(temporary.path);
    if (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      sameIdentity(temporary.identity, identityOf(stat))
    ) {
      await unlink(temporary.path);
    }
  } catch {
    // Cleanup never replaces the authoritative packaging failure.
  }
};

/**
 * @param {SealedDirectory} directory
 * @param {ReadonlyArray<{ name: string, bytes: Uint8Array }>} outputs
 * @param {Checkpoint} checkpoint
 */
const writeArtifactsAtomically = async (directory, outputs, checkpoint) => {
  await assertDirectoryIdentity(directory, "Artifact directory");
  for (const { name } of outputs) {
    await assertSafeExistingTarget(join(directory.path, name));
  }
  /** @type {Array<{ path: string, identity: Identity }>} */
  const temporary = [];
  try {
    for (const { bytes } of outputs) {
      temporary.push(await createTemporaryArtifact(directory, bytes));
    }
    await checkpoint("artifact-temporaries-written");
    await assertDirectoryIdentity(directory, "Artifact directory");
    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index];
      const staged = temporary[index];
      if (!output || !staged) throw new TypeError("Incomplete artifact write");
      await assertSafeExistingTarget(join(directory.path, output.name));
      await rename(staged.path, join(directory.path, output.name));
      const installed = await missingAsTypeError(
        join(directory.path, output.name),
        "Artifact",
      );
      if (
        installed.isSymbolicLink() ||
        !installed.isFile() ||
        installed.nlink !== 1 ||
        !sameIdentity(staged.identity, identityOf(installed))
      ) {
        throw new TypeError("Artifact identity changed");
      }
    }
    await assertDirectoryIdentity(directory, "Artifact directory");
  } finally {
    await Promise.all(temporary.map(removeTemporaryArtifact));
  }
};

/** @typedef {{ buildRoot?: string, artifactRoot?: string, checkpoint?: Checkpoint }} PackagePilotOptions */

/**
 * @param {PackagePilotOptions} [options]
 * @returns {Promise<{ artifactPath: string, checksumPath: string, digest: string }>}
 */
export async function packagePilot({
  buildRoot = "dist",
  artifactRoot = "artifacts",
  checkpoint = () => {},
} = {}) {
  if (typeof checkpoint !== "function") {
    throw new TypeError("Invalid packaging checkpoint");
  }
  const buildDirectory = await sealDirectory(buildRoot, "Production build");
  const buildFiles = await readSealedBuild(buildDirectory, checkpoint);

  /** @type {import("fflate").Zippable} */
  const zippable = {};
  for (const path of PILOT_FILES) {
    const bytes = buildFiles.get(path);
    if (!bytes) throw new TypeError("Incomplete sealed build");
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
  const artifactDirectory = await sealDirectory(
    artifactRoot,
    "Artifact directory",
    true,
  );
  await checkpoint("artifact-root-sealed");
  await assertDirectoryIdentity(artifactDirectory, "Artifact directory");
  const artifactPath = join(
    artifactDirectory.requestedPath,
    PILOT_ARTIFACT_NAME,
  );
  const checksumPath = `${artifactPath}.sha256`;
  await writeArtifactsAtomically(
    artifactDirectory,
    [
      { name: PILOT_ARTIFACT_NAME, bytes: zip },
      {
        name: `${PILOT_ARTIFACT_NAME}.sha256`,
        bytes: new TextEncoder().encode(`${digest}  ${PILOT_ARTIFACT_NAME}\n`),
      },
    ],
    checkpoint,
  );
  return { artifactPath, checksumPath, digest };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await packagePilot();
}
