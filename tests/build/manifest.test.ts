// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("pilot manifest", () => {
  it("uses only the approved origin and minimum permissions", async () => {
    const manifest = JSON.parse(
      await readFile(
        new URL("../../src/manifest.json", import.meta.url),
        "utf8",
      ),
    );

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("116");
    expect(manifest.permissions).toEqual(["sidePanel", "scripting"]);
    expect(manifest.host_permissions).toEqual([
      "https://frankfurtschool.instructure.com/*",
    ]);
    expect(manifest.content_scripts[0].world).toBe("ISOLATED");
  });
});
