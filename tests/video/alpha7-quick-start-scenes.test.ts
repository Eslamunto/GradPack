// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PROHIBITED_TEXT_PATTERNS } from "../../scripts/video/alpha7-installation-scenes.mjs";
import {
  QUICK_START_CAPTION_FILENAME,
  QUICK_START_VIDEO_FILENAME,
  buildQuickStartSrt,
  quickStartContent,
  quickStartScenes,
  quickStartTotalDurationSeconds,
} from "../../scripts/video/alpha7-quick-start-scenes.mjs";

describe("Alpha 7 quick-start video source", () => {
  it("defines a unique privacy-safe 55-second contract", () => {
    expect(QUICK_START_VIDEO_FILENAME).toBe("GradPack-Alpha-7-Quick-Start.mp4");
    expect(QUICK_START_CAPTION_FILENAME).toBe(
      "GradPack-Alpha-7-Quick-Start.srt",
    );
    expect(quickStartScenes).toHaveLength(9);
    expect(
      quickStartScenes.map(({ durationSeconds }) => durationSeconds),
    ).toEqual([4, 6, 6, 6, 7, 6, 7, 6, 7]);
    expect(quickStartTotalDurationSeconds()).toBe(55);
    expect(new Set(quickStartScenes.map(({ id }) => id)).size).toBe(9);
    expect(
      quickStartScenes.every(({ caption }) =>
        caption.split("\n").every((line) => line.length <= 52),
      ),
    ).toBe(true);
    expect(
      quickStartScenes.every(({ caption }) => caption.split("\n").length <= 2),
    ).toBe(true);

    const source = JSON.stringify(quickStartScenes);
    for (const pattern of PROHIBITED_TEXT_PATTERNS) {
      expect(source).not.toMatch(pattern);
    }
    expect(source).toContain("Documents/GradPack-Alpha-7");
    expect(source).toContain("Select all courses");
    expect(source).toContain("One ZIP per course");
    expect(source).toContain("Personal study only");
    expect(source).toContain("Frankfurt School Canvas only");
    expect(source).toContain("Uses your signed-in session");
    expect(source).toContain("No telemetry/backend/upload");
    expect(source).toContain("Archives stay local");
    expect(source).toContain("never redistribute");
    expect(source).toContain("Detailed 5:40 guide");
  });

  it("keeps natural narration inside every scene", () => {
    for (const scene of quickStartScenes) {
      const words = scene.narration.trim().split(/\s+/u).length;
      expect(words).toBeLessThanOrEqual(
        Math.floor(scene.durationSeconds * 2.5),
      );
      expect(words).toBeGreaterThanOrEqual(
        Math.floor(scene.durationSeconds * 1.2),
      );
    }
  });

  it("keeps the two shortest scenes concise for Samantha", () => {
    expect(
      quickStartScenes.find(({ id }) => id === "quick-welcome")?.narration,
    ).toBe("Install GradPack and download Canvas courses offline.");
    expect(
      quickStartScenes.find(({ id }) => id === "quick-trust")?.narration,
    ).toBe(
      "No uploads. Keep archives local. Never redistribute. See the detailed guide.",
    );
  });

  it("builds nine monotonic SRT cues ending at 55 seconds", () => {
    const srt = buildQuickStartSrt();
    expect(srt.match(/--> /gu)).toHaveLength(9);
    expect(srt).toContain("00:00:55,000");
    quickStartScenes.forEach(({ caption }) => expect(srt).toContain(caption));
  });

  it("publishes independent quick-start media limits", () => {
    expect(quickStartContent.minimumDurationSeconds).toBe(54);
    expect(quickStartContent.maximumDurationSeconds).toBe(56);
    expect(quickStartContent.maximumVideoBytes).toBe(25 * 1024 * 1024);
    expect(quickStartContent.expectedCaptionEndMilliseconds).toBe(55_000);
    expect(Object.keys(quickStartContent.captureSha256).sort()).toEqual([
      "chrome-developer-mode.png",
      "chrome-quick-load-enabled.png",
    ]);
  });
});
