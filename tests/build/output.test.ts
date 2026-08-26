// @vitest-environment node
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ESLint } from "eslint";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  PILOT_ARTIFACT_NAME,
  PILOT_FILES,
} from "../../scripts/package-pilot.mjs";

const execFile = promisify(execFileCallback);
const COMMAND_TIMEOUT_MS = 20_000;
const distDirectory = new URL("../../dist/", import.meta.url);
const developmentDistDirectory = new URL("../../dist-dev/", import.meta.url);
const sourceManifest = new URL("../../src/manifest.json", import.meta.url);
const requiredFiles = [
  "archive.css",
  "manifest.json",
  "relay.js",
  "runner.js",
  "service-worker.js",
  "sidepanel.css",
  "sidepanel.html",
  "sidepanel.js",
];

function runBuild(args: string[] = []) {
  return execFile(process.execPath, ["scripts/build.mjs", ...args]);
}

describe("production build output", () => {
  it("creates the complete loadable extension from an absent dist directory", async () => {
    await rm(distDirectory, { recursive: true, force: true });
    await expect(access(distDirectory)).rejects.toThrow();

    await runBuild();

    const files = await readdir(distDirectory);
    expect(files.sort()).toEqual(requiredFiles);

    const manifest = JSON.parse(
      await readFile(new URL("manifest.json", distDirectory), "utf8"),
    );
    expect(manifest.background.service_worker).toBe("service-worker.js");
    expect(manifest.side_panel.default_path).toBe("sidepanel.html");
    expect(manifest.content_scripts[0].js).toEqual(["relay.js"]);
    expect(manifest.permissions).toEqual(["sidePanel", "scripting"]);
    expect(manifest.host_permissions).toEqual([
      "https://frankfurtschool.instructure.com/*",
    ]);
    expect(requiredFiles).toEqual(
      expect.arrayContaining([
        manifest.background.service_worker,
        manifest.side_panel.default_path,
        ...manifest.content_scripts[0].js,
      ]),
    );
  });

  it("creates a separately identified development extension", async () => {
    await rm(developmentDistDirectory, { recursive: true, force: true });
    await expect(access(developmentDistDirectory)).rejects.toThrow();

    await runBuild(["--dev"]);

    const files = await readdir(developmentDistDirectory);
    expect(files.sort()).toEqual(requiredFiles);

    const manifest = JSON.parse(
      await readFile(
        new URL("manifest.json", developmentDistDirectory),
        "utf8",
      ),
    );
    const source = JSON.parse(await readFile(sourceManifest, "utf8"));
    expect(manifest.name).toBe("GradPack Dev");
    expect(manifest.permissions).toEqual(source.permissions);
    expect(manifest.host_permissions).toEqual(source.host_permissions);
  });

  it("keeps generated development output out of linting", async () => {
    await runBuild(["--dev"]);

    const eslint = new ESLint();
    const files = await readdir(developmentDistDirectory);
    const ignored = await Promise.all(
      files.map((file) =>
        eslint.isPathIgnored(
          fileURLToPath(new URL(file, developmentDistDirectory)),
        ),
      ),
    );

    expect(ignored).toEqual(files.map(() => true));
  });

  it("excludes development-only identifiers from production bundles", async () => {
    await runBuild();

    const files = await readdir(distDirectory);
    const developmentIdentifiers = [
      "gradpack/dev/v1",
      "gradpack-dev-controller",
      "gradpack-dev-relay",
      "gradpack-dev-runner",
      "data-gradpack-dev-result",
      "RELOAD_DEV_EXTENSION",
      "RUN_LIVE_SMOKE_TEST",
      "CLEAR_LIVE_TEST_RESULT",
    ];

    for (const file of files.filter((name) => name.endsWith(".js"))) {
      const source = await readFile(new URL(file, distDirectory), "utf8");
      for (const identifier of developmentIdentifiers) {
        expect(source).not.toContain(identifier);
      }
    }
  });

  it(
    "packages Alpha 4 through the pnpm script boundary",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "gradpack-pnpm-package-"));
      const artifactRoot = join(root, "artifacts");
      await mkdir(artifactRoot);

      try {
        await execFile(
          process.platform === "win32" ? "pnpm.cmd" : "pnpm",
          ["run", "package:pilot", "--", artifactRoot],
          {
            cwd: process.cwd(),
            maxBuffer: 1_048_576,
            timeout: COMMAND_TIMEOUT_MS,
          },
        );

        const checksumName = `${PILOT_ARTIFACT_NAME}.sha256`;
        expect((await readdir(artifactRoot)).sort()).toEqual(
          [PILOT_ARTIFACT_NAME, checksumName].sort(),
        );

        const zipBytes = await readFile(
          join(artifactRoot, PILOT_ARTIFACT_NAME),
        );
        const digest = createHash("sha256").update(zipBytes).digest("hex");
        expect(await readFile(join(artifactRoot, checksumName), "utf8")).toBe(
          `${digest}  ${PILOT_ARTIFACT_NAME}\n`,
        );

        const entries = unzipSync(zipBytes);
        expect(Object.keys(entries)).toEqual([...PILOT_FILES]);
        const manifest = JSON.parse(strFromU8(entries["manifest.json"]!)) as {
          version: string;
          version_name: string;
        };
        expect(manifest).toMatchObject({
          version: "0.1.0",
          version_name: "0.1.0-alpha.4",
        });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
    COMMAND_TIMEOUT_MS + 5_000,
  );
});
