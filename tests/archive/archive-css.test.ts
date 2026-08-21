import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("archive.css", () => {
  it("is a useful local-only passive stylesheet", () => {
    const css = readFileSync(resolve("src/static/archive.css"), "utf8");

    expect(css).toContain(".resource-status");
    expect(css).toContain("--gradpack-rail");
    expect(css).toContain(":focus-visible");
    expect(css).toContain(".archive-layout");
    expect(css).toContain("@media");
    expect(css).not.toMatch(/@import/iu);
    expect(css).not.toMatch(/url\s*\(/iu);
    expect(css).not.toMatch(/@font-face/iu);
    expect(css).not.toMatch(/javascript:/iu);
    expect(css).not.toMatch(/content\s*:/iu);
  });

  it("is byte-identical to the single reviewed runtime constant", async () => {
    const { ARCHIVE_CSS } = await import("../../src/archive/style");
    const css = readFileSync(resolve("src/static/archive.css"), "utf8");

    expect(css).toBe(ARCHIVE_CSS);
  });
});
