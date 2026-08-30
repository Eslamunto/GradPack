// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APPROVED_CAPTURE_SHA256 } from "../../scripts/video/alpha7-installation-scenes.mjs";
import { chromeCaptureScenes } from "../../scripts/video/generate-alpha7-chrome-captures.mjs";

describe("Alpha 7 synthetic Chrome captures", () => {
  it("defines the six exact privacy-safe capture outputs", () => {
    expect(chromeCaptureScenes.map(({ capture }) => capture)).toEqual([
      "chrome-extensions.png",
      "chrome-developer-mode.png",
      "chrome-remove-old.png",
      "chrome-load-unpacked.png",
      "chrome-installed.png",
      "chrome-quick-load-enabled.png",
    ]);
    expect(
      chromeCaptureScenes.every(({ visual }) => visual === "chrome-capture"),
    ).toBe(true);
    expect(APPROVED_CAPTURE_SHA256).toEqual({
      "chrome-developer-mode.png":
        "e1dcfd4cd527e5ec08e47680890c45fbe848f886ae1b676715beb3cf03db7817",
      "chrome-extensions.png":
        "f5bd4ece60ea290444ed134458aa17de329c27093b3db5734009495e47f48e13",
      "chrome-installed.png":
        "09055b83470cbe74526be5302aee6eebba58c98c09ebcae1bcc0836b6a53f6ba",
      "chrome-load-unpacked.png":
        "d8af144f5524cf57a77b01db6753e8b27fab3ab041f34997909549916d2e5482",
      "chrome-quick-load-enabled.png":
        "7768d2ac0d68d05310f61279d47c9ec152beaee90d9a9428312eced473e64566",
      "chrome-remove-old.png":
        "edd03875ee5a0771665989218babcecc924c972232c96129095adf69abc53e7b",
    });
  });
});
