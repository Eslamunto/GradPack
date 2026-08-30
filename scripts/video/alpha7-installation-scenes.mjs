export const VIDEO_VERSION = "0.1.0-alpha.7";
export const VIDEO_FILENAME = "GradPack-Alpha-7-Installation-Guide.mp4";
export const CAPTION_FILENAME = "GradPack-Alpha-7-Installation-Guide.srt";

export const APPROVED_CAPTURE_SHA256 = Object.freeze({
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

export const PROHIBITED_TEXT_PATTERNS = Object.freeze([
  /\/courses\/\d+/iu,
  /instructure\.com\/courses/iu,
  /capital markets/iu,
  /authorization/iu,
  /bearer\s+[a-z0-9._-]+/iu,
  /cookie\s*:/iu,
  /token\s*[:=]/iu,
  /\/Users\//u,
  /C:\\Users\\/iu,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/iu,
]);

export const scenes = Object.freeze([
  {
    id: "welcome",
    section: "Welcome and trust",
    durationSeconds: 24,
    visual: "title",
    title: "Pack your courses. Keep your knowledge.",
    screenLines: [
      "GradPack 0.1.0-alpha.7",
      "Frankfurt School Canvas",
      "Local archives",
    ],
    caption: "GradPack saves accessible Canvas materials\nto your computer.",
    narration:
      "Welcome to GradPack Alpha 7. GradPack works only with Frankfurt School Canvas and uses the session already open in Chrome. Everything is processed locally, with no telemetry, backend, or cloud upload. Keep downloaded materials for personal study and do not redistribute them.",
  },
  {
    id: "complete-folder",
    section: "Download",
    durationSeconds: 18,
    visual: "files",
    title: "Download the complete shared folder",
    screenLines: [
      "gradpack-0.1.0-alpha.7.zip",
      "gradpack-0.1.0-alpha.7.zip.sha256",
      "INSTALL.md",
      "TEST_CHECKLIST.md",
      "Installation video",
    ],
    caption: "Download every file in the shared folder.",
    narration:
      "First, download the complete shared folder. Keep the extension zip, its checksum, the installation guide, the test checklist, and this video together. Do not download only the zip file.",
  },
  {
    id: "checksum-mac",
    section: "Verify",
    durationSeconds: 18,
    visual: "terminal",
    title: "macOS: verify the checksum",
    screenLines: [
      "shasum -a 256 -c",
      "gradpack-0.1.0-alpha.7.zip.sha256",
      "gradpack-0.1.0-alpha.7.zip: OK",
    ],
    caption: "On Mac, paste the checksum command\nand look for OK.",
    narration:
      "On a Mac, open Terminal in the shared folder. Copy the S H A two fifty-six command from INSTALL dot M D, paste it, and press Return. Continue only when the zip reports O K.",
  },
  {
    id: "checksum-windows",
    section: "Verify",
    durationSeconds: 18,
    visual: "powershell",
    title: "Windows: compare the checksum",
    screenLines: [
      "Get-FileHash .\\gradpack-0.1.0-alpha.7.zip",
      "Get-Content .\\gradpack-0.1.0-alpha.7.zip.sha256",
      "The two values match",
    ],
    caption: "On Windows, compare the two values.\nThey must match exactly.",
    narration:
      "On Windows, open PowerShell in the shared folder. Run the two commands from INSTALL dot M D. Compare the hexadecimal values. They must match exactly. Stop and contact the maintainer if either check fails.",
  },
  {
    id: "extract",
    section: "Extract",
    durationSeconds: 22,
    visual: "folders",
    title: "Extract into a permanent folder",
    screenLines: [
      "Documents",
      "GradPack-Alpha-7",
      "manifest.json",
      "sidepanel.html",
    ],
    caption: "Extract the zip to\nDocuments/GradPack-Alpha-7.",
    narration:
      "Extract the zip into a permanent folder, such as Documents slash GradPack Alpha 7. Chrome needs the extracted folder, not the zip. Do not move or delete this folder while GradPack is installed.",
  },
  {
    id: "extensions-url",
    section: "Chrome setup",
    durationSeconds: 12,
    visual: "chrome-capture",
    capture: "chrome-extensions.png",
    title: "Open Chrome extensions",
    screenLines: ["chrome://extensions"],
    caption: "Open chrome://extensions in Chrome.",
    narration:
      "In Chrome, enter chrome colon slash slash extensions in the address bar. This opens Chrome's extension management page.",
  },
  {
    id: "developer-mode",
    section: "Chrome setup",
    durationSeconds: 10,
    visual: "chrome-capture",
    capture: "chrome-developer-mode.png",
    title: "Enable Developer mode",
    screenLines: ["Developer mode", "On"],
    caption: "Turn on Developer mode.",
    narration:
      "Turn on Developer mode in the top right. This makes the Load unpacked button visible.",
  },
  {
    id: "remove-old",
    section: "Chrome setup",
    durationSeconds: 10,
    visual: "chrome-capture",
    capture: "chrome-remove-old.png",
    title: "Remove an older GradPack pilot",
    screenLines: ["GradPack", "Remove"],
    caption: "Remove an older GradPack version first.",
    narration:
      "If an older GradPack pilot is installed, select Remove and confirm. Previously downloaded course archives stay on your computer.",
  },
  {
    id: "load-unpacked",
    section: "Chrome setup",
    durationSeconds: 14,
    visual: "chrome-capture",
    capture: "chrome-load-unpacked.png",
    title: "Load the extracted folder",
    screenLines: ["Load unpacked", "Documents/GradPack-Alpha-7", "Select"],
    caption: "Click Load unpacked and choose\nthe extracted folder.",
    narration:
      "Click Load unpacked. Choose the extracted GradPack Alpha 7 folder, then select Open or Select Folder. Do not choose the zip file.",
  },
  {
    id: "verify-version",
    section: "Chrome setup",
    durationSeconds: 14,
    visual: "chrome-capture",
    capture: "chrome-installed.png",
    title: "Confirm Alpha 7 is installed",
    screenLines: ["GradPack", "0.1.0-alpha.7", "Enabled"],
    caption: "Confirm GradPack 0.1.0-alpha.7\nis enabled.",
    narration:
      "Chrome should now show GradPack version zero point one point zero Alpha 7 as enabled. If the version differs, remove it and load the correct extracted folder.",
  },
  {
    id: "canvas-refresh",
    section: "Connect",
    durationSeconds: 18,
    visual: "canvas",
    title: "Open and refresh Canvas",
    screenLines: [
      "Frankfurt School Canvas",
      "Signed in",
      "Refresh once",
      "Keep this tab open",
    ],
    caption: "Sign in to Canvas, refresh once,\nand keep the tab open.",
    narration:
      "Open Frankfurt School Canvas and sign in normally. Refresh the Canvas tab once after GradPack loads. Keep this tab open, signed in, and on Canvas until every download finishes.",
  },
  {
    id: "trust-card",
    section: "Connect",
    durationSeconds: 12,
    visual: "gradpack",
    title: "Your courses stay with you",
    screenLines: [
      "No telemetry",
      "No backend",
      "No cloud upload",
      "Personal study only",
    ],
    caption:
      "GradPack uses your existing Canvas session.\nArchives stay on your computer.",
    narration:
      "Open GradPack from Chrome's toolbar. The trust card confirms that GradPack uses your existing Canvas session and saves archives only to your computer.",
  },
  {
    id: "choose-courses",
    section: "Choose",
    durationSeconds: 30,
    visual: "gradpack",
    title: "Choose courses",
    screenLines: [
      "Example Finance Course",
      "Sample Strategy Course",
      "Select all courses",
      "One ZIP per course",
    ],
    caption: "Choose individual courses or\nSelect all courses.",
    narration:
      "Choose individual courses, or use Select all courses for every displayed active, completed, and concluded course. For the simplest first run, choose One zip per course. Then select Discover selected courses.",
  },
  {
    id: "review-plan",
    section: "Review",
    durationSeconds: 28,
    visual: "gradpack",
    title: "Review before downloading",
    screenLines: [
      "Ready courses: 2",
      "Skipped courses: 0",
      "Expected downloads: 2",
      "Discovery downloads nothing",
    ],
    caption: "Review ready and skipped courses\nbefore retrieval begins.",
    narration:
      "Discovery checks each course but downloads nothing. Review the ready and skipped sections, packaging choice, and expected zip count. Large courses may create numbered parts. A skipped course does not stop safe courses.",
  },
  {
    id: "download",
    section: "Download",
    durationSeconds: 26,
    visual: "download",
    title: "Confirm and keep Canvas open",
    screenLines: [
      "Confirm retrieval",
      "Course 1 of 2",
      "Part 1 of 1",
      "2 archives downloaded",
    ],
    caption: "Confirm retrieval and wait for\nevery expected zip.",
    narration:
      "Confirm retrieval only after you understand the review. Keep Canvas open while GradPack downloads each archive. Wait until the downloaded zip count matches the expected count before closing the tab.",
  },
  {
    id: "offline-archive",
    section: "Offline archive",
    durationSeconds: 28,
    visual: "archive",
    title: "Open the archive offline",
    screenLines: [
      "Extract the course zip",
      "Open index.html",
      "Home",
      "Modules",
      "Pages",
      "Files",
      "Archive Status",
    ],
    caption: "Extract a course zip and\nopen index.html.",
    narration:
      "Extract a downloaded course zip, then open index dot H T M L. Use Home, Modules, Pages, Files, and Archive Status. The generated archive works locally without GradPack or an internet connection.",
  },
  {
    id: "troubleshooting",
    section: "Help",
    durationSeconds: 20,
    visual: "troubleshooting",
    title: "If something is unfinished",
    screenLines: [
      "Keep Canvas open",
      "Retry unfinished courses",
      "Keep every numbered part",
      "Reload future versions",
    ],
    caption:
      "Use Retry unfinished courses\nwithout repeating completed downloads.",
    narration:
      "If some courses remain unfinished, use Retry unfinished courses. Keep every numbered multipart zip. For a future GradPack version, remove the old extension before loading the new folder.",
  },
  {
    id: "safe-feedback",
    section: "Privacy-safe feedback",
    durationSeconds: 18,
    visual: "privacy",
    title: "Report problems safely",
    screenLines: [
      "Use TEST_CHECKLIST.md",
      "No screenshots",
      "No course data",
      "No archives",
      "No personal information",
    ],
    caption: "Use TEST_CHECKLIST.md and\nkeep course information private.",
    narration:
      "Report problems with TEST CHECKLIST dot M D. Never send course names, files, links, screenshots, archives, course contents, credentials, browser data, or personal information. You are ready to use GradPack.",
  },
]);

export const totalDurationSeconds = () =>
  scenes.reduce((total, scene) => total + scene.durationSeconds, 0);

export const formatSrtTime = (seconds) => {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};

export const buildSrt = () => {
  let elapsed = 0;
  return `${scenes
    .map((scene, index) => {
      const start = elapsed;
      elapsed += scene.durationSeconds;
      return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(elapsed)}\n${scene.caption}\n`;
    })
    .join("\n")}\n`;
};
