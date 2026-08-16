// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const guide = new URL(
  "../../docs/development/live-canvas-smoke-test.md",
  import.meta.url,
);
const readme = new URL("../../README.md", import.meta.url);

describe("live Canvas smoke-test documentation", () => {
  it("publishes the development-only contributor contract", async () => {
    const [guideText, readmeText] = await Promise.all([
      readFile(guide, "utf8"),
      readFile(readme, "utf8"),
    ]);
    const documentation = `${guideText}\n${readmeText}`;

    expect(guideText).toContain("pnpm build:dev");
    expect(guideText).toContain("dist-dev");
    expect(guideText).toContain("https://frankfurtschool.instructure.com");
    expect(guideText).toContain("Live tests never run in CI");
    expect(guideText).toContain("5 MiB");
    expect(guideText).toContain("pnpm build");
    expect(guideText).toContain("data-gradpack-dev-result");
    expect(guideText).toContain("CLEAR_LIVE_TEST_RESULT");
    expect(guideText).toContain("RELOAD_DEV_EXTENSION");
    expect(guideText).toContain("RUN_LIVE_SMOKE_TEST");
    expect(readmeText).toMatch(/^## Development$/m);
    expect(readmeText).toContain("docs/development/live-canvas-smoke-test.md");
    expect(documentation).toContain("GradPack Dev");
    expect(documentation).toContain("own authorized signed-in Canvas tab");
    expect(documentation).toContain(
      "Do not share credentials, cookies, or sessions",
    );
  });
});
