// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildSrt } from "../../scripts/video/alpha7-installation-scenes.mjs";
import {
  validateAudioPeak,
  validateProbe,
  validateSrt,
} from "../../scripts/video/validate-alpha7-installation.mjs";

describe("Alpha 7 installation video validator", () => {
  it("accepts the required video and audio contract", () => {
    expect(() =>
      validateProbe({
        format: { duration: "340.000", size: "50000000" },
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
            pix_fmt: "yuv420p",
            avg_frame_rate: "30/1",
          },
          {
            codec_type: "audio",
            codec_name: "aac",
            sample_rate: "48000",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a wrong codec and malformed SRT", () => {
    expect(() =>
      validateProbe({
        format: { duration: "340", size: "1" },
        streams: [],
      }),
    ).toThrow("video stream");
    expect(() =>
      validateSrt("1\n00:00:02,000 --> 00:00:01,000\nBad\n"),
    ).toThrow("caption timing");
    expect(() => validateSrt(buildSrt())).not.toThrow();
  });

  it("rejects a silent narration track", () => {
    expect(() => validateAudioPeak(Number.NEGATIVE_INFINITY)).toThrow("silent");
    expect(() => validateAudioPeak(-80)).toThrow("silent");
    expect(() => validateAudioPeak(-3.5)).not.toThrow();
  });
});
