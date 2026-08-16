// @vitest-environment node
import { access, readFile, readdir, rm } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
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

function runLint() {
  return execFile("pnpm", ["exec", "eslint", ".", "--max-warnings=0"]);
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

    await expect(runLint()).resolves.toBeDefined();
  }, 10_000);

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
});
