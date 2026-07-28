#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "marketing/assets/generated/v02");
const outputDir = path.join(root, "marketing/assets/generated/v02/final");
const registerPath = path.join(root, "marketing/assets/asset-register.json");
const logoPath = path.join(root, "public/logo/logo-horizontal.png");
const generatedAt = new Date().toISOString();

const campaigns = {
  "ct-w01-a01": {
    portraitSource: "ct-w01-a01-editorial-portrait-v02.png",
    landscapeSource: "ct-w01-a01-editorial-landscape-v02.png",
    headline: ["Your balance", "is only the", "starting point."],
    body: ["Bills and costs can still be due", "before payday."],
    qualifier: "ClearTill estimates from the figures you enter.",
    altText: "An adult calmly organising plain household bill envelopes beside a calendar and phone at a kitchen table."
  },
  "ct-w01-b01": {
    portraitSource: "ct-w01-b01-editorial-portrait-v02.png",
    landscapeSource: "ct-w01-b01-editorial-landscape-v02.png",
    headline: ["Know what may", "remain. No bank", "connection."],
    body: ["You choose the balance, dates", "and costs."],
    qualifier: "No bank login • No Open Banking",
    altText: "An adult calmly entering their own figures on a phone at a private home workspace without a bank card in view."
  }
};

const escapeXml = (value) => String(value).replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[char]);

function textLines(lines, x, y, lineHeight, attrs) {
  return `<text x="${x}" y="${y}" ${attrs}>${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function portraitOverlay(campaign) {
  return Buffer.from(`<svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf7ef" stop-opacity="0.98"/><stop offset="0.76" stop-color="#fbf7ef" stop-opacity="0.88"/><stop offset="1" stop-color="#fbf7ef" stop-opacity="0"/></linearGradient></defs>
    <rect width="1080" height="690" fill="url(#fade)"/>
    <rect x="64" y="162" width="72" height="8" rx="4" fill="#37c48e"/>
    ${textLines(campaign.headline, 64, 248, 82, `fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="76" font-weight="800" letter-spacing="-2.2"`)}
    ${textLines(campaign.body, 68, 520, 38, `fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="500"`)}
    <text x="68" y="625" fill="#143c3a" opacity="0.76" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="600">${escapeXml(campaign.qualifier)}</text>
  </svg>`);
}

function landscapeOverlay(campaign) {
  return Buffer.from(`<svg width="1200" height="627" viewBox="0 0 1200 627" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fbf7ef" stop-opacity="0.99"/><stop offset="0.7" stop-color="#fbf7ef" stop-opacity="0.9"/><stop offset="1" stop-color="#fbf7ef" stop-opacity="0"/></linearGradient></defs>
    <rect width="720" height="627" fill="url(#fade)"/>
    <rect x="62" y="145" width="68" height="7" rx="4" fill="#37c48e"/>
    ${textLines(campaign.headline, 62, 218, 61, `fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="57" font-weight="800" letter-spacing="-1.8"`)}
    ${textLines(campaign.body, 64, 422, 33, `fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="500"`)}
    <text x="64" y="526" fill="#143c3a" opacity="0.76" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">${escapeXml(campaign.qualifier)}</text>
  </svg>`);
}

async function logo(width) {
  return sharp(logoPath).resize({ width }).png().toBuffer();
}

async function render() {
  fs.mkdirSync(outputDir, { recursive: true });
  const records = [];
  const portraitLogo = await logo(196);
  const landscapeLogo = await logo(174);

  for (const [contentId, campaign] of Object.entries(campaigns)) {
    const outputs = [
      {
        role: "social_portrait",
        source: campaign.portraitSource,
        filename: `${contentId}-social-portrait-v02.png`,
        width: 1080,
        height: 1350,
        overlay: portraitOverlay(campaign),
        logo: portraitLogo,
        logoLeft: 64,
        logoTop: 58
      },
      {
        role: "social_landscape",
        source: campaign.landscapeSource,
        filename: `${contentId}-social-landscape-v02.png`,
        width: 1200,
        height: 627,
        overlay: landscapeOverlay(campaign),
        logo: landscapeLogo,
        logoLeft: 62,
        logoTop: 46
      },
      {
        role: "journal_hero",
        source: campaign.landscapeSource,
        filename: `${contentId}-journal-hero-v02.png`,
        width: 1600,
        height: 900
      }
    ];

    for (const output of outputs) {
      const outputPath = path.join(outputDir, output.filename);
      const pipeline = sharp(path.join(sourceDir, output.source)).resize(output.width, output.height, { fit: "cover", position: "centre" });
      const composites = output.overlay ? [{ input: output.overlay }, { input: output.logo, left: output.logoLeft, top: output.logoTop }] : [];
      await pipeline.composite(composites).png({ compressionLevel: 9 }).toFile(outputPath);
      records.push({
        assetId: `cleartill-generated-${contentId}-${output.role}-v02`,
        contentId,
        role: output.role,
        type: "ai_generated_editorial",
        sourceProvider: "OpenAI image generation",
        sourceUrl: null,
        creator: "ClearTill with OpenAI image generation",
        licence: "ClearTill-generated original asset",
        generatedAt,
        localPath: path.relative(root, outputPath),
        altText: campaign.altText,
        editableSourcePath: null,
        canvaDesignUrl: null,
        modifications: output.overlay ? "AI-generated editorial source with deterministic ClearTill logo and verified copy overlay." : "AI-generated editorial source cropped for the Journal hero treatment; no generated text or invented product UI.",
        attributionRequired: false,
        publicAttribution: null,
        modelOrPropertyReleaseChecked: false,
        trademarkRiskChecked: true,
        sensitiveContextChecked: true,
        licenceChecked: true,
        visualChecked: false,
        humanApproved: false,
        approvedBy: null,
        approvedAt: null
      });
    }
  }

  const register = JSON.parse(fs.readFileSync(registerPath, "utf8"));
  const ids = new Set(records.map((record) => record.assetId));
  register.assets = [...register.assets.filter((record) => !ids.has(record.assetId)), ...records];
  fs.writeFileSync(registerPath, `${JSON.stringify(register, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, assets: records.map((record) => record.localPath) }, null, 2)}\n`);
}

render().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
