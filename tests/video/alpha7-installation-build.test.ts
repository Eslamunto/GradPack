// @vitest-environment node
import { describe, expect, it } from "vitest";
import { scenes } from "../../scripts/video/alpha7-installation-scenes.mjs";
import {
  assertNarrationDuration,
  captureNameFor,
  concatFileContent,
  parseArgs,
  segmentArgs,
} from "../../scripts/video/build-alpha7-installation.mjs";

describe("Alpha 7 installation video build contract", () => {
  it("parses the three required build arguments", () => {
    expect(
      parseArgs([
        "--capture-dir",
        "/private/tmp/captures",
        "--work-dir",
        "/private/tmp/build",
        "--source-commit",
        "abc123",
      ]),
    ).toEqual({
      captureDirectory: "/private/tmp/captures",
      workDirectory: "/private/tmp/build",
      sourceCommit: "abc123",
    });
    expect(() => parseArgs([])).toThrow("--capture-dir");
  });

  it("maps only Chrome scenes to approved capture names", () => {
    const chromeScene = scenes.find(({ id }) => id === "extensions-url")!;
    const titleScene = scenes.find(({ id }) => id === "welcome")!;
    expect(captureNameFor(chromeScene)).toBe("chrome-extensions.png");
    expect(captureNameFor(titleScene)).toBeNull();
  });

  it("builds fixed-duration H.264 and AAC segment arguments", () => {
    const scene = scenes[0]!;
    const args = segmentArgs(scene, {
      framePath: "/tmp/frame.png",
      audioPath: "/tmp/audio.aiff",
      segmentPath: "/tmp/segment.mp4",
    });
    expect(args).toContain("libx264");
    expect(args).toContain("yuv420p");
    expect(args).toContain("aac");
    expect(args).toContain("48000");
    expect(args).toContain(String(scene.durationSeconds));
  });

  it("writes a safe FFmpeg concat manifest", () => {
    expect(concatFileContent(["/tmp/one.mp4", "/tmp/two.mp4"])).toBe(
      "file '/tmp/one.mp4'\nfile '/tmp/two.mp4'\n",
    );
  });

  it("rejects missing or overlong narration audio", () => {
    const scene = scenes[0]!;
    expect(() => assertNarrationDuration(scene, 0)).toThrow("no audio");
    expect(() => assertNarrationDuration(scene, Number.NaN)).toThrow(
      "no audio",
    );
    expect(() => assertNarrationDuration(scene, scene.durationSeconds)).toThrow(
      "exceeds",
    );
    expect(() => assertNarrationDuration(scene, 5)).not.toThrow();
  });
});
