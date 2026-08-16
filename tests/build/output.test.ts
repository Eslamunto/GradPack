// @vitest-environment node
import { access, readFile, readdir, rm } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const distDirectory = new URL("../../dist/", import.meta.url);

describe("production build output", () => {
  it("creates the complete loadable extension from an absent dist directory", async () => {
    await rm(distDirectory, { recursive: true, force: true });
    await expect(access(distDirectory)).rejects.toThrow();

    await execFile(process.execPath, ["scripts/build.mjs"]);

    const files = await readdir(distDirectory);
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
});
