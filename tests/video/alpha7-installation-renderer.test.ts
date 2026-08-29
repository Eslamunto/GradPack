// @vitest-environment node
import { describe, expect, it } from "vitest";
import { scenes } from "../../scripts/video/alpha7-installation-scenes.mjs";
import {
  escapeXml,
  renderSceneSvg,
  renderSyntheticChromeCaptureSvg,
  wrapWords,
} from "../../scripts/video/render-alpha7-installation.mjs";

describe("Alpha 7 installation frame renderer", () => {
  it("renders a 1080p SVG from the canonical caption", () => {
    const scene = scenes.find(({ id }) => id === "choose-courses")!;
    const svg = renderSceneSvg(scene);
    expect(svg).toContain('width="1920" height="1080"');
    expect(svg).toContain("Example Finance Course");
    expect(svg).toContain("Sample Strategy Course");
    for (const line of scene.caption.split("\n")) expect(svg).toContain(line);
    expect(svg).not.toContain("/Users/");
  });

  it("escapes text and embeds an approved clean Chrome capture", () => {
    expect(escapeXml('<unsafe & "quoted">')).toBe(
      "&lt;unsafe &amp; &quot;quoted&quot;&gt;",
    );
    expect(wrapWords("one two three four", 8)).toEqual([
      "one two",
      "three",
      "four",
    ]);
    const scene = scenes.find(({ id }) => id === "extensions-url")!;
    const svg = renderSceneSvg(scene, {
      captureDataUrl: "data:image/png;base64,c3ludGhldGlj",
    });
    expect(svg).toContain("data:image/png;base64,c3ludGhldGlj");
  });

  it("uses distinct visual accents for the guided workflow", () => {
    const expectations = [
      ["checksum-mac", "prompt-marker"],
      ["choose-courses", "selection-control"],
      ["offline-archive", "navigation-pill"],
      ["safe-feedback", "privacy-badge"],
    ];

    for (const [sceneId, marker] of expectations) {
      const scene = scenes.find(({ id }) => id === sceneId)!;
      const svg = renderSceneSvg(scene);
      expect(svg).toContain(`data-visual="${scene.visual}"`);
      expect(svg).toContain(`data-accent="${marker}"`);
      expect(svg).not.toContain("undefined");
    }
  });

  it("recreates Chrome installation states without personal browser data", () => {
    const scene = scenes.find(({ id }) => id === "extensions-url")!;
    const svg = renderSyntheticChromeCaptureSvg(scene);

    expect(svg).toContain('width="1920" height="1080"');
    expect(svg).toContain("chrome://extensions");
    expect(svg).toContain("Extensions");
    expect(svg).toContain("Developer mode");
    expect(svg).not.toContain("/Users/");
    expect(svg).not.toContain("@gmail");
  });
});
