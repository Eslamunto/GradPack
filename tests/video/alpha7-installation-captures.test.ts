// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chromeCaptureScenes } from "../../scripts/video/generate-alpha7-chrome-captures.mjs";

describe("Alpha 7 synthetic Chrome captures", () => {
  it("defines the five exact privacy-safe capture outputs", () => {
    expect(chromeCaptureScenes.map(({ capture }) => capture)).toEqual([
      "chrome-extensions.png",
      "chrome-developer-mode.png",
      "chrome-remove-old.png",
      "chrome-load-unpacked.png",
      "chrome-installed.png",
    ]);
    expect(
      chromeCaptureScenes.every(({ visual }) => visual === "chrome-capture"),
    ).toBe(true);
  });
});
