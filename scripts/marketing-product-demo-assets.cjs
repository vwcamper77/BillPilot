#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const assetRoot = path.join(root, "marketing/assets/product-screenshots");
const renderRoot = path.join(assetRoot, "render");
const finalRoot = path.join(assetRoot, "final");
const logoPath = path.join(root, "public/logo/logo-horizontal.png");
const resultFramePath = path.join(assetRoot, "source/ct-w01-c01-result-frame-v01.png");
const registerPath = path.join(root, "marketing/assets/asset-register.json");

const xml = (value) => String(value).replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[char]);
const text = (lines, x, y, lineHeight, attrs) => `<text x="${x}" y="${y}" ${attrs}>${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${xml(line)}</tspan>`).join("")}</text>`;

async function resizedLogo(width) {
  return sharp(logoPath).resize({ width }).png().toBuffer();
}

async function transparentOverlay(width, height, svg, logo, logoPosition, destination) {
  await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(svg) }, { input: logo, ...logoPosition }])
    .png({ compressionLevel: 9 })
    .toFile(destination);
}

async function main() {
  fs.mkdirSync(renderRoot, { recursive: true });
  fs.mkdirSync(finalRoot, { recursive: true });
  if (!fs.existsSync(resultFramePath)) throw new Error(`Missing approved result frame: ${resultFramePath}`);

  const verticalLogo = await resizedLogo(215);
  const verticalSvg = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    ${text(["See what changes when", "your balance changes."], 294, 58, 40, `fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800"`)}
    <rect x="112" y="1780" width="856" height="68" rx="34" fill="#143c3a"/>
    <text x="540" y="1825" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">ClearTill recalculates the estimate</text>
    <text x="540" y="1885" text-anchor="middle" fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="600">Illustrative test account • Estimate based on figures entered</text>
  </svg>`;
  await transparentOverlay(1080, 1920, verticalSvg, verticalLogo, { left: 44, top: 36 }, path.join(renderRoot, "ct-w01-c01-vertical-overlay-v01.png"));

  const landscapeLogo = await resizedLogo(260);
  const landscapeSvg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
    <rect x="80" y="265" width="86" height="9" rx="4.5" fill="#37c48e"/>
    ${text(["When your balance changes,", "your position changes too."], 80, 355, 84, `fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="800" letter-spacing="-1.8"`)}
    ${text(["£3,000 → £2,500", "£649 → £149"], 80, 590, 68, `fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="700"`)}
    ${text(["Illustrative test account.", "Estimate based on the figures entered."], 80, 765, 40, `fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="500"`)}
    <text x="80" y="945" fill="#37c48e" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="800">Check my position free</text>
  </svg>`;
  await transparentOverlay(1920, 1080, landscapeSvg, landscapeLogo, { left: 76, top: 64 }, path.join(renderRoot, "ct-w01-c01-landscape-overlay-v01.png"));

  const coverLogo = await resizedLogo(250);
  const screenshot = await sharp(resultFramePath).resize(1080, 1150, { fit: "cover", position: "top" }).png().toBuffer();
  const coverSvg = Buffer.from(`<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="820" fill="#fbf7ef"/>
    <rect x="64" y="190" width="76" height="8" rx="4" fill="#37c48e"/>
    ${text(["When your balance", "changes, your position", "changes too."], 64, 285, 82, `fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="800" letter-spacing="-2"`)}
    ${text(["£3,000 → £2,500", "£649 → £149"], 68, 590, 52, `fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700"`)}
    <text x="68" y="735" fill="#143c3a" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="500">Illustrative test account • 14-second walkthrough</text>
    <rect x="0" y="790" width="1080" height="90" fill="url(#fade)"/>
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf7ef"/><stop offset="1" stop-color="#fbf7ef" stop-opacity="0"/></linearGradient></defs>
  </svg>`);
  await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#fbf7ef" } })
    .composite([{ input: screenshot, left: 0, top: 770 }, { input: coverSvg }, { input: coverLogo, left: 64, top: 56 }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(finalRoot, "2026-07-31_ct-w01-c01_instagram_reel-cover_v02.png"));

  const relative = (file) => path.relative(root, file);
  const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const generatedAt = new Date().toISOString();
  const sourceFile = path.join(assetRoot, "source/ct-w01-c01-product-demo-source-v01.mov");
  const finalFiles = [
    { assetId: "cleartill-ct-w01-c01-instagram-reel-v03", role: "instagram_reel", file: path.join(finalRoot, "2026-07-31_ct-w01-c01_instagram_reel_v03.mp4"), width: 1080, height: 1920 },
    { assetId: "cleartill-ct-w01-c01-linkedin-video-v03", role: "linkedin_video", file: path.join(finalRoot, "2026-07-31_ct-w01-c01_linkedin_product-demo_v03.mp4"), width: 1920, height: 1080 },
    { assetId: "cleartill-ct-w01-c01-facebook-video-v03", role: "facebook_video", file: path.join(finalRoot, "2026-07-31_ct-w01-c01_facebook_product-demo_v03.mp4"), width: 1920, height: 1080 }
  ];
  for (const item of finalFiles) if (!fs.existsSync(item.file)) throw new Error(`Missing rendered product demo: ${item.file}`);
  const records = [
    {
      assetId: "cleartill-ct-w01-c01-source-recording-v01", contentId: "ct-w01-c01", role: "source_recording", type: "original_product_recording", sourceProvider: "ClearTill test account", sourceUrl: null, creator: "ClearTill", licence: "ClearTill-owned original recording", generatedAt, localPath: relative(sourceFile), editableSourcePath: null, canvaDesignUrl: null, sha256: digest(sourceFile), durationSeconds: 15.3, width: 884, height: 1460, audioPresent: true, modifications: "Original fictional test-account recording supplied by the owner; retained as the private production source.", attributionRequired: false, publicAttribution: null, fictionalTestDataConfirmed: true, privacyChecked: true, trademarkRiskChecked: true, sensitiveContextChecked: true, licenceChecked: true, visualChecked: false, humanApproved: false, approvedBy: null, approvedAt: null
    },
    ...finalFiles.map((item) => ({
      assetId: item.assetId, contentId: "ct-w01-c01", role: item.role, type: "product_demo_video", sourceProvider: "ClearTill", sourceUrl: null, creator: "ClearTill", licence: "ClearTill-owned derivative of original test-account recording", generatedAt, localPath: relative(item.file), editableSourcePath: "scripts/marketing-product-demo-render.swift", canvaDesignUrl: null, sha256: digest(item.file), durationSeconds: 13.8, width: item.width, height: item.height, audioPresent: false, modifications: "Trimmed, muted and composed with deterministic ClearTill branding, verified calculation text and an illustrative-test-account disclosure.", attributionRequired: false, publicAttribution: null, fictionalTestDataConfirmed: true, privacyChecked: true, trademarkRiskChecked: true, sensitiveContextChecked: true, licenceChecked: true, visualChecked: false, humanApproved: false, approvedBy: null, approvedAt: null
    })),
    {
      assetId: "cleartill-ct-w01-c01-instagram-cover-v02", contentId: "ct-w01-c01", role: "instagram_reel_cover", type: "product_demo_cover", sourceProvider: "ClearTill", sourceUrl: null, creator: "ClearTill", licence: "ClearTill-owned derivative of original test-account recording", generatedAt, localPath: relative(path.join(finalRoot, "2026-07-31_ct-w01-c01_instagram_reel-cover_v02.png")), editableSourcePath: "scripts/marketing-product-demo-assets.cjs", canvaDesignUrl: null, sha256: digest(path.join(finalRoot, "2026-07-31_ct-w01-c01_instagram_reel-cover_v02.png")), width: 1080, height: 1920, modifications: "Real product result frame with deterministic ClearTill branding, validated figures and illustrative-test-account disclosure.", attributionRequired: false, publicAttribution: null, fictionalTestDataConfirmed: true, privacyChecked: true, trademarkRiskChecked: true, sensitiveContextChecked: true, licenceChecked: true, visualChecked: false, humanApproved: false, approvedBy: null, approvedAt: null
    }
  ];
  const register = JSON.parse(fs.readFileSync(registerPath, "utf8"));
  const ids = new Set(records.map((record) => record.assetId));
  register.assets = [...register.assets.filter((record) => !ids.has(record.assetId)), ...records];
  fs.writeFileSync(registerPath, `${JSON.stringify(register, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify({ ok: true, overlays: ["ct-w01-c01-vertical-overlay-v01.png", "ct-w01-c01-landscape-overlay-v01.png"], cover: "2026-07-31_ct-w01-c01_instagram_reel-cover_v02.png", registeredAssets: records.length }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
