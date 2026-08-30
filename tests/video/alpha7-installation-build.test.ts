// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scenes } from "../../scripts/video/alpha7-installation-scenes.mjs";
import { quickStartContent } from "../../scripts/video/alpha7-quick-start-scenes.mjs";
import {
  assertNarrationDuration,
  assertApprovedCapture,
  captureNameFor,
  concatFileContent,
  detailedContent,
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

  it("keeps detailed and quick-start output names isolated", () => {
    expect(detailedContent.videoFilename).toBe(
      "GradPack-Alpha-7-Installation-Guide.mp4",
    );
    expect(quickStartContent.videoFilename).toBe(
      "GradPack-Alpha-7-Quick-Start.mp4",
    );
    expect(quickStartContent.videoFilename).not.toBe(
      detailedContent.videoFilename,
    );
    expect(quickStartContent.captionFilename).not.toBe(
      detailedContent.captionFilename,
    );
  });

  it("rejects capture bytes outside the approved synthetic contract", () => {
    const approved = Buffer.from("approved synthetic pixels");
    const captureSha256 = {
      "chrome-approved.png": createHash("sha256")
        .update(approved)
        .digest("hex"),
    };
    expect(() =>
      assertApprovedCapture("chrome-approved.png", approved, captureSha256),
    ).not.toThrow();
    expect(() =>
      assertApprovedCapture(
        "chrome-approved.png",
        Buffer.from("personal screenshot"),
        captureSha256,
      ),
    ).toThrow("approved synthetic capture");
    expect(() =>
      assertApprovedCapture("missing.png", approved, captureSha256),
    ).toThrow("approved synthetic capture");
  });
});
