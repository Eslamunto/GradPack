import { VIDEO_VERSION, formatSrtTime } from "./alpha7-installation-scenes.mjs";

export const QUICK_START_VIDEO_FILENAME = "GradPack-Alpha-7-Quick-Start.mp4";
export const QUICK_START_CAPTION_FILENAME = "GradPack-Alpha-7-Quick-Start.srt";

export const quickStartScenes = Object.freeze([
  {
    id: "quick-welcome",
    section: "Quick start",
    durationSeconds: 4,
    visual: "title",
    title: "GradPack Alpha 7 in 55 seconds",
    screenLines: ["Install", "Choose courses", "Download locally"],
    caption: "Install and download with GradPack\nin under one minute.",
    narration: "Install GradPack and download Canvas courses offline.",
  },
  {
    id: "quick-download",
    section: "Download",
    durationSeconds: 6,
    visual: "files",
    title: "Download and verify",
    screenLines: [
      "Complete shared folder",
      "gradpack-0.1.0-alpha.7.zip",
      "INSTALL.md",
      "Verify before continuing",
    ],
    caption: "Download the complete folder.\nVerify the ZIP with INSTALL.md.",
    narration:
      "Download the complete shared folder. Verify the zip using INSTALL dot M D.",
  },
  {
    id: "quick-extract",
    section: "Extract",
    durationSeconds: 6,
    visual: "folders",
    title: "Extract the extension",
    screenLines: [
      "Documents/GradPack-Alpha-7",
      "Use the extracted folder",
      "Do not choose the ZIP",
    ],
    caption: "Extract to Documents/GradPack-Alpha-7.",
    narration:
      "Extract the zip to Documents slash GradPack Alpha Seven. Chrome needs the folder.",
  },
  {
    id: "quick-developer-mode",
    section: "Chrome setup",
    durationSeconds: 7,
    visual: "chrome-capture",
    capture: "chrome-developer-mode.png",
    title: "Open Chrome extensions",
    screenLines: ["chrome://extensions", "Developer mode", "On"],
    caption: "Open chrome://extensions.\nTurn on Developer mode.",
    narration:
      "Open chrome colon slash slash extensions, then turn on Developer mode.",
  },
  {
    id: "quick-load",
    section: "Chrome setup",
    durationSeconds: 8,
    visual: "chrome-capture",
    capture: "chrome-load-unpacked.png",
    title: "Load GradPack Alpha 7",
    screenLines: [
      "Load unpacked",
      "Documents/GradPack-Alpha-7",
      "0.1.0-alpha.7 enabled",
    ],
    caption: "Click Load unpacked.\nConfirm Alpha 7 is enabled.",
    narration:
      "Click Load unpacked, choose the extracted folder, and confirm Alpha Seven is enabled.",
  },
  {
    id: "quick-canvas",
    section: "Connect",
    durationSeconds: 6,
    visual: "canvas",
    title: "Refresh Canvas once",
    screenLines: [
      "Frankfurt School Canvas",
      "Signed in",
      "Refresh once",
      "Keep the tab open",
    ],
    caption: "Refresh Canvas once.\nKeep the tab open.",
    narration:
      "Sign in to Canvas, refresh once, keep the tab open, and open GradPack.",
  },
  {
    id: "quick-choose",
    section: "Choose",
    durationSeconds: 8,
    visual: "gradpack",
    title: "Choose courses",
    screenLines: [
      "Example Finance Course",
      "Sample Strategy Course",
      "Select all courses",
      "One ZIP per course",
    ],
    caption: "Choose courses or Select all courses.\nThen start discovery.",
    narration:
      "Choose courses or Select all courses. Keep one zip per course, then start discovery.",
  },
  {
    id: "quick-review",
    section: "Review",
    durationSeconds: 7,
    visual: "download",
    title: "Review and confirm",
    screenLines: [
      "Ready courses: 2",
      "Skipped courses: 0",
      "Confirm retrieval",
      "Keep Canvas open",
    ],
    caption: "Review, confirm, and wait for every ZIP.",
    narration:
      "Review ready and skipped courses, confirm retrieval, and wait for every expected zip.",
  },
  {
    id: "quick-trust",
    section: "Responsible use",
    durationSeconds: 3,
    visual: "privacy",
    title: "Your archives stay local",
    screenLines: [
      "No telemetry",
      "No cloud upload",
      "Archives stay local",
      "Personal study only",
    ],
    caption: "Archives stay local.\nPersonal study only.",
    narration: "Keep archives for personal study only.",
  },
]);

export const quickStartTotalDurationSeconds = () =>
  quickStartScenes.reduce((total, scene) => total + scene.durationSeconds, 0);

export const buildQuickStartSrt = () => {
  let elapsed = 0;
  return `${quickStartScenes
    .map((scene, index) => {
      const start = elapsed;
      elapsed += scene.durationSeconds;
      return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(elapsed)}\n${scene.caption}\n`;
    })
    .join("\n")}\n`;
};

export const quickStartContent = Object.freeze({
  version: VIDEO_VERSION,
  videoFilename: QUICK_START_VIDEO_FILENAME,
  captionFilename: QUICK_START_CAPTION_FILENAME,
  scenes: quickStartScenes,
  buildSrt: buildQuickStartSrt,
  expectedDurationSeconds: 55,
  minimumDurationSeconds: 54,
  maximumDurationSeconds: 56,
  maximumVideoBytes: 25 * 1024 * 1024,
  expectedCaptionEndMilliseconds: 55_000,
});
