"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { MARKETING_ROOT, getContentById } = require("./content");

const OUTPUT_ROOT = path.join(MARKETING_ROOT, "assets/infographics");
const MANIFEST_PATH = path.join(MARKETING_ROOT, "creative/infographic-manifest.json");
const CANVA_RESULTS_PATH = path.join(MARKETING_ROOT, "creative/canva-generated-designs.json");
const ASSET_REGISTER_PATH = path.join(MARKETING_ROOT, "assets/asset-register.json");
const COLORS = { cream: "#fbf7ef", white: "#ffffff", ink: "#143c3a", muted: "#60726f", line: "#d7e8e1", green: "#37c48e", mint: "#e9f8f2", orange: "#f19b52" };

function escapeXml(value) { return String(value).replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]); }
function textBlock(lines, { x, y, size, weight = 700, color = COLORS.ink, gap = 1.08, anchor = "start" }) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? size * gap : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}
function pill(text, x, y, width, { fill = COLORS.mint, color = COLORS.ink } = {}) {
  return `<rect x="${x}" y="${y}" width="${width}" height="52" rx="26" fill="${fill}"/><text x="${x + width / 2}" y="${y + 34}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="${color}">${escapeXml(text)}</text>`;
}
function shell({ width, height, label, titleLines, body, footer = "Estimate based on figures entered", background = COLORS.cream }) {
  const portrait = height > width;
  const pad = Math.round(width * 0.075);
  const titleSize = portrait ? Math.round(width * 0.075) : Math.round(width * 0.052);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${background}"/>
    <circle cx="${width - pad}" cy="${pad}" r="${portrait ? 180 : 130}" fill="${COLORS.green}" opacity=".12"/>
    ${pill("ClearTill", pad, pad, 150, { fill: COLORS.ink, color: COLORS.white })}
    ${textBlock([label.toUpperCase()], { x: pad, y: pad + 100, size: portrait ? 23 : 20, weight: 800, color: COLORS.muted })}
    ${textBlock(titleLines, { x: pad, y: pad + 175, size: titleSize, weight: 800, gap: 1.03 })}
    ${body({ width, height, pad, portrait, titleSize })}
    <line x1="${pad}" y1="${height - pad - 48}" x2="${width - pad}" y2="${height - pad - 48}" stroke="${COLORS.line}" stroke-width="2"/>
    ${textBlock([footer], { x: pad, y: height - pad, size: portrait ? 20 : 18, weight: 600, color: COLORS.muted })}
  </svg>`;
}
function card(x, y, width, height, label, value, { fill = COLORS.white, valueColor = COLORS.ink } = {}) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="28" fill="${fill}" stroke="${COLORS.line}" stroke-width="2"/>
    ${textBlock([label], { x: x + 28, y: y + 48, size: 21, weight: 700, color: COLORS.muted })}
    ${textBlock([value], { x: x + 28, y: y + 116, size: 52, weight: 800, color: valueColor })}`;
}
function arrow(x1, y1, x2, y2) { return `<path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="${COLORS.green}" stroke-width="10" stroke-linecap="round"/><path d="M ${x2 - 24} ${y2 - 20} L ${x2} ${y2} L ${x2 - 24} ${y2 + 20}" fill="none" stroke="${COLORS.green}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`; }

function assetDefinitions() {
  const a = getContentById("ct-w01-a01");
  const b = getContentById("ct-w01-b01");
  const c = getContentById("ct-w01-c01");
  if (a.illustrativeCalculations[0].start - a.illustrativeCalculations[0].deductions.reduce((sum, value) => sum + value, 0) !== a.illustrativeCalculations[0].result) throw new Error("Campaign-A arithmetic is invalid.");
  const portrait = { width: 1080, height: 1350 };
  const landscape = { width: 1200, height: 627 };
  const hero = { width: 1600, height: 900 };
  const reel = { width: 1080, height: 1920 };
  return [
    {
      key: "a-carousel-01-hook", contentId: a.id, role: "carousel_page", ...portrait,
      altText: "ClearTill carousel cover stating that a bank balance is the start of the calculation, with an illustrative £1,250 balance.",
      svg: shell({ ...portrait, label: "Balance versus what remains · 1 of 5", titleLines: ["Your balance is", "the start — not", "always what remains."], body: ({ width, pad }) => `<circle cx="${width / 2}" cy="900" r="225" fill="${COLORS.white}" stroke="${COLORS.green}" stroke-width="16"/>${textBlock(["£1,250"], { x: width / 2, y: 925, size: 110, weight: 800, anchor: "middle" })}${textBlock(["CURRENT BALANCE"], { x: width / 2, y: 1000, size: 24, weight: 800, color: COLORS.muted, anchor: "middle" })}`, footer: "Illustrative example • Swipe to see what is still due" })
    },
    {
      key: "a-carousel-02-snapshot", contentId: a.id, role: "carousel_page", ...portrait,
      altText: "Diagram explaining that a current balance can still include bills and costs due before payday.",
      svg: shell({ ...portrait, label: "Balance versus what remains · 2 of 5", titleLines: ["A balance is a", "snapshot of now."], body: ({ pad }) => `${card(pad, 610, 864, 205, "CURRENT BALANCE", "£1,250")}${arrow(540, 850, 540, 960)}${card(pad, 990, 864, 205, "STILL INSIDE THAT BALANCE", "Bills due later", { fill: COLORS.mint })}`, footer: "Payments that have not left yet can still change the position" })
    },
    {
      key: "a-carousel-03-calculation", contentId: a.id, role: "carousel_page", ...portrait,
      altText: a.altText,
      svg: shell({ ...portrait, label: "Balance versus what remains · 3 of 5", titleLines: ["Subtract what is", "still due."], body: ({ pad }) => `${card(pad, 570, 864, 170, "CURRENT BALANCE", "£1,250")}${textBlock(["−"], { x: 540, y: 820, size: 78, weight: 500, anchor: "middle" })}${card(pad, 850, 864, 170, "BILLS AND COSTS STILL DUE", "£1,015")}${textBlock(["="], { x: 540, y: 1100, size: 70, weight: 500, anchor: "middle" })}${textBlock(["£235"], { x: 540, y: 1225, size: 105, weight: 800, color: COLORS.green, anchor: "middle" })}`, footer: "Illustrative example • £1,250 − £1,015 = £235" })
    },
    {
      key: "a-carousel-04-method", contentId: a.id, role: "carousel_page", ...portrait,
      altText: "Three ClearTill input cards for current balance, next income date and costs still due, leading to an estimated position.",
      svg: shell({ ...portrait, label: "Balance versus what remains · 4 of 5", titleLines: ["ClearTill uses the", "figures you enter."], body: ({ pad }) => `${card(pad, 575, 864, 150, "1", "Current balance")}${card(pad, 755, 864, 150, "2", "Next income date", { fill: COLORS.mint })}${card(pad, 935, 864, 150, "3", "Bills and costs still due")}${pill("Estimated position", 315, 1135, 450, { fill: COLORS.green, color: COLORS.ink })}`, footer: "No bank login • No Open Banking connection required" })
    },
    {
      key: "a-carousel-05-cta", contentId: a.id, role: "carousel_page", ...portrait,
      altText: "ClearTill call-to-action inviting the reader to check an estimated position before payday.",
      svg: shell({ ...portrait, label: "Balance versus what remains · 5 of 5", titleLines: ["Check your own", "position before", "payday."], body: ({ pad }) => `<rect x="${pad}" y="700" width="864" height="290" rx="44" fill="${COLORS.ink}"/>${textBlock(["Start your 7-day", "live preview"], { x: 540, y: 815, size: 56, weight: 800, color: COLORS.white, anchor: "middle" })}${pill("No card required", 335, 1050, 410, { fill: COLORS.green })}`, footer: "No automatic charge when the preview ends • cleartill.money/start" })
    },
    {
      key: "a-calculation-landscape", contentId: a.id, role: "supporting_infographic", ...landscape,
      altText: a.altText,
      svg: shell({ ...landscape, label: "Illustrative calculation", titleLines: ["Balance is not always what remains."], body: ({ width }) => `${card(90, 340, 280, 170, "BALANCE", "£1,250")}${textBlock(["−"], { x: 420, y: 445, size: 62, weight: 500, anchor: "middle" })}${card(470, 340, 280, 170, "STILL DUE", "£1,015")}${textBlock(["="], { x: 800, y: 445, size: 58, weight: 500, anchor: "middle" })}${card(850, 340, 260, 170, "EST. REMAINING", "£235", { fill: COLORS.mint, valueColor: COLORS.green })}`, footer: "Illustrative example • Estimate based on figures entered" })
    },
    {
      key: "b-no-bank-portrait", contentId: b.id, role: "primary_infographic", ...portrait,
      altText: b.altText,
      svg: shell({ ...portrait, label: "Manual by design", titleLines: ["Know what may", "remain without", "connecting your bank."], body: ({ pad }) => `${card(pad, 600, 864, 145, "YOU ENTER", "Current balance")}${card(pad, 775, 864, 145, "YOU CHOOSE", "Next income date", { fill: COLORS.mint })}${card(pad, 950, 864, 145, "YOU INCLUDE", "Costs still due")}${pill("→ Estimated position", 300, 1140, 480, { fill: COLORS.green })}`, footer: "No bank login • No Open Banking • You control the figures" })
    },
    {
      key: "b-no-bank-landscape", contentId: b.id, role: "supporting_infographic", ...landscape,
      altText: b.altText,
      svg: shell({ ...landscape, label: "Manual by design", titleLines: ["No bank connection required."], body: () => `${card(70, 340, 260, 165, "1", "Balance")}${textBlock(["+"], { x: 365, y: 440, size: 44, anchor: "middle" })}${card(400, 340, 260, 165, "2", "Income date", { fill: COLORS.mint })}${textBlock(["+"], { x: 695, y: 440, size: 44, anchor: "middle" })}${card(730, 340, 260, 165, "3", "Costs due")}${arrow(1010, 422, 1120, 422)}`, footer: "Your figures → ClearTill estimate • No bank login • No Open Banking" })
    },
    {
      key: "c-reel-cover", contentId: c.id, role: "reel_cover", ...reel,
      altText: c.altText,
      svg: shell({ ...reel, label: "Product demonstration", titleLines: ["See how entered", "figures become an", "estimated position."], body: ({ pad }) => `<rect x="${pad}" y="760" width="864" height="640" rx="48" fill="${COLORS.ink}"/>${textBlock(["£780", "− £395", "= £385"], { x: 540, y: 940, size: 105, weight: 800, gap: 1.45, color: COLORS.white, anchor: "middle" })}${pill("Illustrative test data", 300, 1480, 480, { fill: COLORS.green })}`, footer: "20-second ClearTill walkthrough • Estimate based on figures entered" })
    },
    {
      key: "c-product-frame", contentId: c.id, role: "recording_frame", ...landscape,
      altText: "ClearTill branded landscape frame with a reserved area for a current test-account product recording.",
      svg: shell({ ...landscape, label: "Product demonstration", titleLines: ["Watch the estimated position update."], body: () => `<rect x="70" y="315" width="760" height="230" rx="28" fill="${COLORS.white}" stroke="${COLORS.green}" stroke-width="6" stroke-dasharray="16 12"/>${textBlock(["Place current test-account", "recording here"], { x: 450, y: 405, size: 34, weight: 700, color: COLORS.muted, gap: 1.15, anchor: "middle" })}${card(865, 315, 270, 230, "ILLUSTRATIVE", "£385", { fill: COLORS.mint, valueColor: COLORS.green })}`, footer: "£780 balance − £395 entered costs = £385 estimated position" })
    },
    {
      key: "a-journal-hero", contentId: a.id, role: "journal_hero", ...hero,
      altText: "Editorial ClearTill graphic comparing a £1,250 balance with an estimated £235 remaining after £1,015 of costs still due.",
      svg: shell({ ...hero, label: "ClearTill Journal", titleLines: ["Why your bank balance is not", "always what you can spend"], body: () => `${card(110, 540, 390, 200, "CURRENT BALANCE", "£1,250")}${arrow(535, 640, 720, 640)}${card(760, 540, 390, 200, "ESTIMATED REMAINING", "£235", { fill: COLORS.mint, valueColor: COLORS.green })}`, footer: "Illustrative example • Bills and costs still due: £1,015" })
    },
    {
      key: "b-journal-hero", contentId: b.id, role: "journal_hero", ...hero,
      altText: "Editorial ClearTill graphic showing three manually entered inputs and no bank connection required.",
      svg: shell({ ...hero, label: "ClearTill Journal", titleLines: ["Why use a money app without", "connecting your bank?"], body: () => `${pill("Balance", 120, 570, 250)}${pill("Income date", 405, 570, 280, { fill: COLORS.white })}${pill("Costs due", 720, 570, 250)}${arrow(1000, 596, 1190, 596)}${pill("Estimate", 1220, 570, 250, { fill: COLORS.green })}`, footer: "No bank login • No Open Banking • You choose the figures" })
    }
  ];
}

async function generateInfographics({ outputRoot = OUTPUT_ROOT, manifestPath = MANIFEST_PATH, assetRegisterPath = ASSET_REGISTER_PATH, generatedAt = new Date().toISOString() } = {}) {
  fs.mkdirSync(outputRoot, { recursive: true });
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { assets: [] };
  const prior = new Map((previous.assets || []).map((asset) => [asset.key, asset]));
  const canvaResults = fs.existsSync(CANVA_RESULTS_PATH) ? JSON.parse(fs.readFileSync(CANVA_RESULTS_PATH, "utf8")) : { designs: [] };
  const canvaByKey = new Map((canvaResults.designs || []).map((design) => [design.key, design]));
  const assets = [];
  for (const definition of assetDefinitions()) {
    const basename = `${definition.contentId}_${definition.key}_v01`;
    const svgPath = path.join(outputRoot, `${basename}.svg`);
    const pngPath = path.join(outputRoot, `${basename}.png`);
    fs.writeFileSync(svgPath, definition.svg);
    await sharp(Buffer.from(definition.svg)).png({ compressionLevel: 9 }).toFile(pngPath);
    const existing = prior.get(definition.key) || {};
    const canva = canvaByKey.get(definition.key) || {};
    assets.push({
      key: definition.key,
      contentId: definition.contentId,
      role: definition.role,
      width: definition.width,
      height: definition.height,
      mediaType: "image/png",
      svgPath: path.relative(path.resolve(MARKETING_ROOT, ".."), svgPath),
      pngPath: path.relative(path.resolve(MARKETING_ROOT, ".."), pngPath),
      altText: definition.altText,
      status: definition.role === "recording_frame" ? "needs_product_recording" : "generated_for_review",
      canvaAssetId: canva.assetId || existing.canvaAssetId || null,
      canvaDesignId: canva.designId || existing.canvaDesignId || null,
      canvaDesignUrl: canva.designId ? `https://www.canva.com/design/${canva.designId}/edit` : existing.canvaDesignUrl || null,
      canvaViewUrl: existing.canvaViewUrl || null,
      canvaFolderId: canva.designId ? "FAHP8Xz8OL4" : existing.canvaFolderId || null,
      exportJobId: canva.exportJobId || existing.exportJobId || null,
      exportStatus: canva.exportJobId ? "success" : existing.exportStatus || "not_started",
      exportFormat: canva.exportJobId ? "png" : existing.exportFormat || null,
      exportUrl: null,
      exportRegisteredAt: canva.exportJobId ? canvaResults.generatedAt : existing.exportRegisteredAt || null,
      humanApproved: false,
      visualChecked: false,
      licenceChecked: true
    });
  }
  const manifest = {
    schemaVersion: "cleartill-infographic-manifest-v1",
    generatedAt,
    source: "marketing/calendar/content-calendar.json",
    brandSource: "app/globals.css",
    canvaFolderId: "FAHP8Xz8OL4",
    canvaFolderUrl: "https://www.canva.com/folder/FAHP8Xz8OL4",
    workflow: "Generate complete flattened artwork locally, upload PNG to Canva, create a custom-dimension Canva design seeded with that asset, move it to the canonical folder, then export.",
    assets
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const register = fs.existsSync(assetRegisterPath) ? JSON.parse(fs.readFileSync(assetRegisterPath, "utf8")) : { schemaVersion: "marketing-asset-register-v1", assets: [] };
  const generatedIds = new Set(assets.map((asset) => `cleartill-infographic-${asset.key}`));
  register.assets = (register.assets || []).filter((asset) => !generatedIds.has(asset.assetId));
  register.assets.push(...assets.map((asset) => ({
    assetId: `cleartill-infographic-${asset.key}`,
    contentId: asset.contentId,
    type: "original_infographic",
    sourceProvider: "cleartill",
    sourceUrl: null,
    creator: "ClearTill",
    licence: "ClearTill-owned original artwork",
    generatedAt,
    localPath: asset.pngPath,
    editableSourcePath: asset.svgPath,
    canvaDesignUrl: asset.canvaDesignUrl,
    modifications: "Generated from approved structured campaign data and the application brand palette.",
    attributionRequired: false,
    publicAttribution: null,
    modelOrPropertyReleaseChecked: true,
    trademarkRiskChecked: true,
    sensitiveContextChecked: true,
    licenceChecked: true,
    visualChecked: false,
    humanApproved: false,
    approvedBy: null,
    approvedAt: null
  })));
  fs.mkdirSync(path.dirname(assetRegisterPath), { recursive: true });
  fs.writeFileSync(assetRegisterPath, `${JSON.stringify(register, null, 2)}\n`);
  return manifest;
}

module.exports = { ASSET_REGISTER_PATH, CANVA_RESULTS_PATH, COLORS, MANIFEST_PATH, OUTPUT_ROOT, assetDefinitions, generateInfographics };
