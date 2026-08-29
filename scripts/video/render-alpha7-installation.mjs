const XML_ENTITIES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
});

export const escapeXml = (value) =>
  String(value).replace(/[&<>"']/gu, (character) => XML_ENTITIES[character]);

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

const visualBody = (scene, captureDataUrl) => {
  if (scene.visual === "chrome-capture" && captureDataUrl) {
    return `<g data-visual="chrome-capture" data-accent="click-target"><rect x="180" y="240" width="1560" height="580" rx="30" fill="#ffffff" stroke="#d9ddec" stroke-width="4"/><image href="${escapeXml(captureDataUrl)}" x="195" y="255" width="1530" height="550" preserveAspectRatio="xMidYMid slice"/><circle cx="1495" cy="715" r="42" fill="none" stroke="#f2b134" stroke-width="12"/></g>`;
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
      .map(
        (line, index) =>
          `<rect x="${260 + (index % 3) * 490}" y="${330 + Math.floor(index / 3) * 180}" width="430" height="120" rx="28" fill="#edf8f4" stroke="#53b48d" stroke-width="3"/><circle cx="${310 + (index % 3) * 490}" cy="${390 + Math.floor(index / 3) * 180}" r="22" fill="#53b48d"/><path d="M300 ${390 + Math.floor(index / 3) * 180}l8 9 15-20" fill="none" stroke="#ffffff" stroke-width="6"/><text x="${350 + (index % 3) * 490}" y="${402 + Math.floor(index / 3) * 180}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="30" font-weight="650" fill="#173d31">${escapeXml(line)}</text>`,
      )
      .join("");
    return `<g data-visual="privacy" data-accent="privacy-badge"><rect x="180" y="250" width="1560" height="560" rx="28" fill="#ffffff" stroke="#d9ddec" stroke-width="3"/>${badges}</g>`;
  }

  return `<g data-visual="${escapeXml(scene.visual)}" data-accent="content-card"><rect x="180" y="250" width="1560" height="560" rx="28" fill="#ffffff" stroke="#d9ddec" stroke-width="3"/>${textLines(lines, { x: 255, y: 350, size: 40, gap: 62 })}</g>`;
};

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
