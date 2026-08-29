// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CAPTION_FILENAME,
  PROHIBITED_TEXT_PATTERNS,
  VIDEO_FILENAME,
  VIDEO_VERSION,
  buildSrt,
  scenes,
  totalDurationSeconds,
} from "../../scripts/video/alpha7-installation-scenes.mjs";

describe("Alpha 7 installation video source", () => {
  it("uses one complete, privacy-safe 340-second scene contract", () => {
    expect(VIDEO_VERSION).toBe("0.1.0-alpha.7");
    expect(VIDEO_FILENAME).toBe("GradPack-Alpha-7-Installation-Guide.mp4");
    expect(CAPTION_FILENAME).toBe("GradPack-Alpha-7-Installation-Guide.srt");
    expect(totalDurationSeconds()).toBe(340);
    expect(scenes).toHaveLength(18);
    expect(new Set(scenes.map(({ id }) => id)).size).toBe(scenes.length);
    expect(scenes.every(({ durationSeconds }) => durationSeconds >= 10)).toBe(
      true,
    );
    expect(scenes.every(({ caption }) => caption.split("\n").length <= 2)).toBe(
      true,
    );
    expect(
      scenes.every(({ caption }) =>
        caption.split("\n").every((line) => line.length <= 52),
      ),
    ).toBe(true);

    const source = JSON.stringify(scenes);
    for (const pattern of PROHIBITED_TEXT_PATTERNS) {
      expect(source).not.toMatch(pattern);
    }
    expect(source).toContain("Example Finance Course");
    expect(source).toContain("Sample Strategy Course");
    expect(source).toContain("Documents/GradPack-Alpha-7");
    expect(source).toContain("chrome://extensions");
    expect(source).toContain("Select all courses");
    expect(source).toContain("Retry unfinished courses");
    expect(source).toContain("TEST_CHECKLIST.md");
  });

  it("builds monotonic SRT cues from the same captions", () => {
    const srt = buildSrt();
    expect(srt.match(/--> /gu)).toHaveLength(scenes.length);
    scenes.forEach(({ caption }, index) => {
      expect(srt).toContain(`${index + 1}\n`);
      expect(srt).toContain(caption);
    });
    expect(srt).toContain("00:05:40,000");
  });
});
