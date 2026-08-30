/** @typedef {{ id: string, section: string, durationSeconds: number, visual: string, title: string, screenLines: string[], caption: string, narration: string, capture?: string }} Scene */

/** @type {Readonly<Record<string, string>>} */
const XML_ENTITIES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
});

/** @param {string | number} value */
export const escapeXml = (value) =>
  String(value).replace(
    /[&<>"']/gu,
    (character) => XML_ENTITIES[character] ?? character,
  );

/**
 * @param {string} value
 * @param {number} limit
 */
export const wrapWords = (value, limit) => {
  const lines = [];
  let current = "";
  for (const word of String(value).split(/\s+/u)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= limit) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
};

/** @param {string} value */
export const privacyBadgeLines = (value) => wrapWords(value, 24);

/** @param {Scene} scene */
const chromeStateBody = (scene) => {
  if (scene.id === "extensions-url") {
    return `<rect x="600" y="430" width="1050" height="360" rx="24" fill="#ffffff" stroke="#dfe3eb" stroke-width="3"/><text x="670" y="520" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="42" font-weight="700" fill="#202124">Manage your extensions</text><text x="670" y="590" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" fill="#5f6368">Turn features on or off and review installed versions.</text><rect x="670" y="660" width="330" height="70" rx="35" fill="#e8f0fe"/><text x="835" y="705" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="28" font-weight="700" fill="#185abc">Chrome Web Store</text>`;
  }
  if (scene.id === "developer-mode") {
    return `<rect x="600" y="410" width="1050" height="260" rx="26" fill="#ffffff" stroke="#dfe3eb" stroke-width="3"/><text x="680" y="505" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="42" font-weight="700" fill="#202124">Turn on Developer mode</text><text x="680" y="575" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" fill="#5f6368">The Load unpacked button will appear.</text><circle cx="1583" cy="257" r="72" fill="none" stroke="#f2b134" stroke-width="10"/>`;
  }
  if (scene.id === "remove-old") {
    return `<rect x="600" y="350" width="1050" height="390" rx="26" fill="#ffffff" stroke="#dfe3eb" stroke-width="3"/><rect x="670" y="425" width="92" height="92" rx="22" fill="#2356d8"/><path d="M700 471h32M716 455v32" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/><text x="805" y="470" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="40" font-weight="700" fill="#202124">GradPack</text><text x="805" y="520" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="28" fill="#5f6368">0.1.0-alpha.6</text><rect x="1325" y="620" width="220" height="72" rx="36" fill="#ffffff" stroke="#1a73e8" stroke-width="3"/><text x="1435" y="666" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" font-weight="700" fill="#1a73e8">Remove</text><circle cx="1435" cy="656" r="72" fill="none" stroke="#f2b134" stroke-width="10"/>`;
  }
  if (scene.id === "load-unpacked") {
    return `<rect x="700" y="340" width="900" height="470" rx="30" fill="#ffffff" stroke="#dfe3eb" stroke-width="4"/><text x="780" y="440" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="42" font-weight="700" fill="#202124">Choose the extension folder</text><rect x="780" y="500" width="740" height="90" rx="20" fill="#f1f3f4"/><text x="830" y="558" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="32" fill="#3c4043">Documents/GradPack-Alpha-7</text><rect x="1245" y="680" width="275" height="76" rx="38" fill="#1a73e8"/><text x="1382" y="729" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" font-weight="700" fill="#ffffff">Select folder</text><circle cx="1382" cy="718" r="78" fill="none" stroke="#f2b134" stroke-width="10"/>`;
  }
  if (scene.id === "quick-load") {
    return `<rect x="600" y="330" width="1050" height="500" rx="26" fill="#ffffff" stroke="#dfe3eb" stroke-width="3"/><rect x="680" y="390" width="310" height="70" rx="35" fill="#1a73e8"/><text x="835" y="435" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="29" font-weight="700" fill="#ffffff">Load unpacked</text><circle cx="835" cy="425" r="75" fill="none" stroke="#f2b134" stroke-width="10"/><rect x="680" y="505" width="890" height="90" rx="20" fill="#f1f3f4"/><text x="730" y="562" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="31" fill="#3c4043">Documents/GradPack-Alpha-7</text><rect x="680" y="635" width="890" height="135" rx="22" fill="#f8f9fa" stroke="#dfe3eb" stroke-width="2"/><rect x="725" y="665" width="68" height="68" rx="17" fill="#2356d8"/><path d="M746 699h26M759 686v26" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/><text x="830" y="690" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="34" font-weight="700" fill="#202124">GradPack 0.1.0-alpha.7</text><text x="830" y="738" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="29" fill="#188038">Enabled</text><rect x="1430" y="673" width="100" height="48" rx="24" fill="#1a73e8"/><circle cx="1503" cy="697" r="19" fill="#ffffff"/>`;
  }
  return `<rect x="600" y="350" width="1050" height="390" rx="26" fill="#ffffff" stroke="#dfe3eb" stroke-width="3"/><rect x="670" y="425" width="92" height="92" rx="22" fill="#2356d8"/><path d="M700 471h32M716 455v32" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/><text x="805" y="470" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="40" font-weight="700" fill="#202124">GradPack</text><text x="805" y="520" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="28" fill="#5f6368">0.1.0-alpha.7</text><rect x="1350" y="435" width="110" height="52" rx="26" fill="#1a73e8"/><circle cx="1428" cy="461" r="21" fill="#ffffff"/><text x="805" y="640" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" fill="#188038">Enabled</text><circle cx="1410" cy="460" r="76" fill="none" stroke="#f2b134" stroke-width="10"/>`;
};

/** @param {Scene} scene */
export const renderSyntheticChromeCaptureSvg = (scene) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <rect width="1920" height="1080" fill="#f1f3f4"/>
    <rect width="1920" height="165" fill="#ffffff"/>
    <circle cx="45" cy="42" r="12" fill="#ff5f57"/>
    <circle cx="82" cy="42" r="12" fill="#ffbd2e"/>
    <circle cx="119" cy="42" r="12" fill="#28c840"/>
    <rect x="190" y="18" width="360" height="58" rx="18" fill="#e8eaed"/>
    <text x="245" y="56" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="28" fill="#3c4043">Extensions</text>
    <rect x="160" y="96" width="1600" height="52" rx="26" fill="#f1f3f4"/>
    <text x="235" y="131" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="26" fill="#3c4043">chrome://extensions</text>
    <rect x="0" y="165" width="430" height="915" fill="#ffffff"/>
    <text x="90" y="275" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="40" font-weight="700" fill="#202124">Extensions</text>
    <text x="90" y="380" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" fill="#1a73e8">My extensions</text>
    <text x="90" y="455" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" fill="#5f6368">Keyboard shortcuts</text>
    <text x="570" y="270" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="48" font-weight="700" fill="#202124">Extensions</text>
    <text x="1270" y="270" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" fill="#3c4043">Developer mode</text>
    <rect x="1540" y="233" width="86" height="48" rx="24" fill="${scene.id === "extensions-url" ? "#bdc1c6" : "#1a73e8"}"/>
    <circle cx="${scene.id === "extensions-url" ? 1566 : 1600}" cy="257" r="20" fill="#ffffff"/>
    ${chromeStateBody(scene)}
  </svg>`;

/**
 * @param {string[]} lines
 * @param {{ x: number, y: number, size?: number, gap?: number, color?: string, anchor?: string }} options
 */
const textLines = (
  lines,
  { x, y, size = 42, gap = 58, color = "#17213b", anchor = "start" },
) =>
  lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * gap}" text-anchor="${anchor}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="${size}" fill="${color}">${escapeXml(line)}</text>`,
    )
    .join("");

/**
 * @param {Scene} scene
 * @param {string | undefined} captureDataUrl
 */
const visualBody = (scene, captureDataUrl) => {
  if (scene.visual === "chrome-capture" && captureDataUrl) {
    return `<g data-visual="chrome-capture" data-accent="click-target"><rect x="180" y="240" width="1560" height="580" rx="30" fill="#ffffff" stroke="#d9ddec" stroke-width="4"/><image href="${escapeXml(captureDataUrl)}" x="195" y="255" width="1530" height="550" preserveAspectRatio="xMidYMid slice"/></g>`;
  }

  const lines = scene.screenLines.flatMap((line) => wrapWords(line, 42));
  if (scene.visual === "terminal" || scene.visual === "powershell") {
    return `<g data-visual="${escapeXml(scene.visual)}" data-accent="prompt-marker"><rect x="180" y="250" width="1560" height="560" rx="28" fill="#10172a"/><circle cx="230" cy="295" r="10" fill="#ff6b6b"/><circle cx="265" cy="295" r="10" fill="#ffd166"/><circle cx="300" cy="295" r="10" fill="#5ad69f"/><text x="250" y="390" font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="42" fill="#64e6c3">&gt;</text>${textLines(lines, { x: 310, y: 390, size: 38, gap: 82, color: "#f5f7ff" })}</g>`;
  }

  if (scene.visual === "gradpack" || scene.visual === "download") {
    const rows = lines
      .map(
        (line, index) =>
          `<rect x="540" y="${310 + index * 96}" width="1070" height="72" rx="18" fill="#f7f8fd" stroke="#d9ddec" stroke-width="2"/><rect x="575" y="${329 + index * 96}" width="34" height="34" rx="8" fill="${index < 2 ? "#2356d8" : "#ffffff"}" stroke="#2356d8" stroke-width="3"/>${index < 2 ? `<path d="M584 ${346 + index * 96}l8 8 16-19" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>` : ""}<text x="640" y="${358 + index * 96}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="35" fill="#17213b">${escapeXml(line)}</text>`,
      )
      .join("");
    return `<g data-visual="${escapeXml(scene.visual)}" data-accent="selection-control"><rect x="180" y="250" width="1560" height="560" rx="28" fill="#ffffff" stroke="#d9ddec" stroke-width="3"/><rect x="180" y="250" width="285" height="560" rx="28" fill="#edf1ff"/><circle cx="322" cy="350" r="62" fill="#2356d8"/><path d="M288 350h68M322 316v68" stroke="#ffffff" stroke-width="13" stroke-linecap="round"/><text x="322" y="455" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="38" font-weight="700" fill="#172b82">GradPack</text>${rows}</g>`;
  }

  if (scene.visual === "archive") {
    const pills = lines
      .slice(2)
      .map(
        (line, index) =>
          `<rect x="${250 + index * 225}" y="350" width="195" height="68" rx="34" fill="${index === 0 ? "#2356d8" : "#edf1ff"}"/><text x="${347 + index * 225}" y="394" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="29" font-weight="700" fill="${index === 0 ? "#ffffff" : "#172b82"}">${escapeXml(line)}</text>`,
      );
    return `<g data-visual="archive" data-accent="navigation-pill"><rect x="180" y="250" width="1560" height="560" rx="28" fill="#ffffff" stroke="#d9ddec" stroke-width="3"/>${pills.join("")}<rect x="250" y="485" width="1420" height="220" rx="24" fill="#f7f8fd"/>${textLines(lines.slice(0, 2), { x: 310, y: 570, size: 42, gap: 70 })}</g>`;
  }

  if (scene.visual === "privacy") {
    const badges = lines
      .map((line, index) => {
        const x = 260 + (index % 3) * 490;
        const y = 330 + Math.floor(index / 3) * 180;
        const labelLines = privacyBadgeLines(line);
        const labelStartY = labelLines.length === 1 ? y + 72 : y + 53;
        const label = labelLines
          .map(
            (labelLine, labelIndex) =>
              `<text x="${x + 90}" y="${labelStartY + labelIndex * 34}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="24" font-weight="650" fill="#173d31">${escapeXml(labelLine)}</text>`,
          )
          .join("");
        return `<rect x="${x}" y="${y}" width="430" height="120" rx="28" fill="#edf8f4" stroke="#53b48d" stroke-width="3"/><circle cx="${x + 50}" cy="${y + 60}" r="22" fill="#53b48d"/><path d="M${x + 40} ${y + 60}l8 9 15-20" fill="none" stroke="#ffffff" stroke-width="6"/>${label}`;
      })
      .join("");
    return `<g data-visual="privacy" data-accent="privacy-badge"><rect x="180" y="250" width="1560" height="560" rx="28" fill="#ffffff" stroke="#d9ddec" stroke-width="3"/>${badges}</g>`;
  }

  return `<g data-visual="${escapeXml(scene.visual)}" data-accent="content-card"><rect x="180" y="250" width="1560" height="560" rx="28" fill="#ffffff" stroke="#d9ddec" stroke-width="3"/>${textLines(lines, { x: 255, y: 350, size: 40, gap: 62 })}</g>`;
};

/**
 * @param {Scene} scene
 * @param {{ captureDataUrl?: string }} [options]
 */
export const renderSceneSvg = (scene, { captureDataUrl } = {}) => {
  const captions = scene.caption.split("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <rect width="1920" height="1080" fill="#f5f6fb"/>
    <rect width="1920" height="170" fill="#172b82"/>
    <text x="110" y="78" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" font-weight="700" fill="#dbe2ff">${escapeXml(scene.section.toUpperCase())}</text>
    <text x="110" y="138" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="52" font-weight="800" fill="#ffffff">${escapeXml(scene.title)}</text>
    ${visualBody(scene, captureDataUrl)}
    <rect y="865" width="1920" height="215" fill="#17213b"/>
    ${textLines(captions, { x: 960, y: captions.length === 1 ? 985 : 945, size: 48, gap: 62, color: "#ffffff", anchor: "middle" })}
  </svg>`;
};
