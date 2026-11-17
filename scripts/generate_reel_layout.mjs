import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const scriptDir = import.meta.dirname;
const root = path.resolve(scriptDir, "..");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");

const reelStart = appSource.indexOf("const REEL_LAYOUTS");
if (reelStart === -1) throw new Error("REEL_LAYOUTS was not found in app.js");

const reelEnd = appSource.indexOf("];", reelStart);
if (reelEnd === -1) throw new Error("REEL_LAYOUTS array was not closed");

const context = {};
vm.createContext(context);
vm.runInContext(`${appSource.slice(reelStart, reelEnd + 2)}; result = REEL_LAYOUTS;`, context);

const reelLayouts = context.result;
if (!Array.isArray(reelLayouts) || reelLayouts.length !== 3 || !reelLayouts.every((reel) => reel.length === 21)) {
  throw new Error("REEL_LAYOUTS must contain three 21-symbol reels");
}

const symbols = ["seven", "clock", "bar", "cherry", "gear", "replay", "bell", "blank"];
const symbolLabels = {
  seven: "7",
  clock: "時計",
  bar: "BAR",
  cherry: "チェリー",
  gear: "歯車",
  replay: "リプレイ",
  bell: "ベル",
  blank: "ブランク",
};

const imageUris = Object.fromEntries(
  symbols.map((symbol) => {
    const filename = symbol === "blank" ? "symbol-blank-light-outline.png" : `symbol-${symbol}.png`;
    const assetPath = path.join(root, "web", "public", "symbols", filename);
    const bytes = fs.readFileSync(assetPath);
    return [symbol, `data:image/png;base64,${bytes.toString("base64")}`];
  }),
);

const width = 820;
const margin = 32;
const titleHeight = 92;
const labelHeight = 58;
const rowHeight = 58;
const bottom = 34;
const height = margin + titleHeight + labelHeight + rowHeight * 21 + bottom;
const indexX = margin + 36;
const colWidth = 178;
const gap = 34;
const colXs = [132, 132 + colWidth + gap, 132 + (colWidth + gap) * 2];
const colNames = ["左", "中", "右"];
const reelTop = margin + titleHeight + labelHeight;
const imageSize = 58;
const symbolScales = { seven: 1.3, bar: 1.5, clock: 1.3 };
const imageSizes = Object.fromEntries(
  symbols.map((symbol) => [symbol, imageSize * (symbolScales[symbol] ?? 1)]),
);

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const symbolDefinitions = symbols
  .map((symbol) => `<image id="symbol-${symbol}" href="${imageUris[symbol]}" width="${imageSizes[symbol]}" height="${imageSizes[symbol]}" preserveAspectRatio="xMidYMid meet" />`)
  .join("\n    ");

const rows = [];
for (let index = 20; index >= 0; index -= 1) {
  const rowNumber = index + 1;
  const y = reelTop + (20 - index) * rowHeight;
  rows.push(`<circle cx="${indexX}" cy="${y + rowHeight / 2}" r="24" class="index-circle" />`);
  rows.push(`<text x="${indexX}" y="${y + rowHeight / 2 + 9}" text-anchor="middle" class="index">${rowNumber}</text>`);

  colXs.forEach((x, reelIndex) => {
    const symbol = reelLayouts[reelIndex][index];
    if (!imageUris[symbol]) throw new Error(`Unknown symbol: ${symbol}`);
    const size = imageSizes[symbol];
    const imageX = x + (colWidth - size) / 2;
    const imageY = y + (rowHeight - size) / 2;
    rows.push(`<g><title>${escapeXml(`${colNames[reelIndex]}リール ${rowNumber}番: ${symbolLabels[symbol]}`)}</title><use href="#symbol-${symbol}" x="${imageX}" y="${imageY}" /></g>`);
  });
}

const columnPanels = colXs
  .map((x) => `<rect x="${x}" y="${reelTop}" width="${colWidth}" height="${rowHeight * 21}" class="reel-panel" />`)
  .join("\n  ");

const columnLabels = colXs
  .map((x, index) => `<text x="${x + colWidth / 2}" y="${margin + titleHeight + 34}" text-anchor="middle" class="col-label">${colNames[index]}</text>`)
  .join("\n  ");

const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="APRO SLOT 21コマリール配列">
  <defs>
    ${symbolDefinitions}
  </defs>
  <style>
    .title { fill: #a95cff; font: 900 54px "Arial Black", "Hiragino Kaku Gothic ProN", sans-serif; }
    .col-label { fill: #a95cff; font: 900 42px "Arial Black", "Hiragino Kaku Gothic ProN", sans-serif; }
    .index { fill: #fff; font: 900 25px "Arial Black", Arial, sans-serif; }
    .index-circle { fill: #7928d6; stroke: #c68cff; stroke-width: 2; }
    .reel-panel { fill: #eeeeef; stroke: #7928d6; stroke-width: 4; }
    .note { fill: #b8b7c8; font: 700 18px Arial, sans-serif; }
  </style>
  <rect width="100%" height="100%" fill="#140d1b" />
  <rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="4" fill="none" stroke="#e8dff0" stroke-width="8" />
  <rect x="${margin + 10}" y="${margin}" width="${width - margin * 2 - 20}" height="${titleHeight - 10}" rx="8" fill="none" stroke="#7928d6" stroke-width="4" />
  <text x="${width / 2}" y="${margin + 58}" text-anchor="middle" class="title">リール配列</text>
  ${columnLabels}
  ${columnPanels}
  ${rows.join("\n  ")}
  <text x="${width / 2}" y="${height - 14}" text-anchor="middle" class="note">1 = REEL_LAYOUTS[n][0] / 21 = REEL_LAYOUTS[n][20]</text>
</svg>
`;

const outputPath = path.join(root, "reel-layout.svg");
fs.writeFileSync(outputPath, svg);
console.log(`Generated ${outputPath}`);
