#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "marketing/assets/product-screenshots/source/ct-w01-c01-product-demo-source-v01.mov");
const build = path.join(root, "marketing/assets/product-screenshots/render/v04");
const final = path.join(root, "marketing/assets/product-screenshots/final");
const logoPath = path.join(root, "public/logo/logo-horizontal.png");
const registerPath = path.join(root, "marketing/assets/asset-register.json");
const duration = { intro: 1.5, body: 13.3, outro: 2.0 };
const totalDuration = duration.intro + duration.body + duration.outro;

const esc = (value) => String(value).replace(/[<>&'"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]);
const lines = (items, x, y, lineHeight, attrs, anchor = "start") => `<text x="${x}" y="${y}" text-anchor="${anchor}" ${attrs}>${items.map((item, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${esc(item)}</tspan>`).join("")}</text>`;
const svg = (width, height, body) => Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`);

async function logo(width) {
  return sharp(logoPath).resize({ width }).png().toBuffer();
}

async function card(file, width, height, body, logoSpec = null) {
  const layers = [{ input: svg(width, height, body) }];
  if (logoSpec) layers.push({ input: await logo(logoSpec.width), left: logoSpec.left, top: logoSpec.top });
  await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers).png({ compressionLevel: 9 }).toFile(file);
}

function writeOriginalSoundtrack(destination) {
  const sampleRate = 48000;
  const channels = 2;
  const frames = Math.ceil(totalDuration * sampleRate);
  const pcm = Buffer.alloc(frames * channels * 2);
  const chords = [
    [261.63, 329.63, 392.0, 493.88],
    [220.0, 261.63, 329.63, 440.0],
    [174.61, 220.0, 261.63, 329.63],
    [196.0, 246.94, 293.66, 392.0],
  ];
  const melody = [523.25, 659.25, 783.99, 659.25, 440.0, 523.25, 659.25, 523.25, 349.23, 440.0, 523.25, 659.25, 392.0, 493.88, 587.33, 783.99];
  let random = 0x43a71;
  const noise = () => { random = (1664525 * random + 1013904223) >>> 0; return (random / 0xffffffff) * 2 - 1; };
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / sampleRate;
    const globalFade = Math.min(1, t / 0.45, (totalDuration - t) / 0.85);
    const chordIndex = Math.min(chords.length - 1, Math.floor(t / 4.2));
    const localChord = t % 4.2;
    const padEnvelope = Math.min(1, localChord / 0.25, (4.2 - localChord) / 0.35);
    let value = chords[chordIndex].reduce((sum, frequency, index) => sum + Math.sin(2 * Math.PI * frequency * t + index * 0.3), 0) * 0.026 * padEnvelope;
    const eighth = 60 / 112 / 2;
    const noteIndex = Math.floor(t / eighth);
    const noteTime = t - noteIndex * eighth;
    const pluck = Math.exp(-noteTime * 9.5);
    value += Math.sin(2 * Math.PI * melody[noteIndex % melody.length] * t) * pluck * 0.055;
    const beat = 60 / 112;
    const beatTime = t % beat;
    value += Math.sin(2 * Math.PI * (72 - 30 * Math.min(1, beatTime / 0.12)) * t) * Math.exp(-beatTime * 25) * 0.07;
    const offbeatTime = (t + beat / 2) % beat;
    if (offbeatTime < 0.055) value += noise() * Math.exp(-offbeatTime * 65) * 0.018;
    const chimeTime = t - 6.45;
    if (chimeTime >= 0 && chimeTime < 1.2) value += (Math.sin(2 * Math.PI * 1046.5 * chimeTime) + 0.55 * Math.sin(2 * Math.PI * 1318.5 * chimeTime)) * Math.exp(-chimeTime * 4.8) * 0.05;
    const sample = Math.max(-1, Math.min(1, value * globalFade));
    const integer = Math.round(sample * 32767);
    pcm.writeInt16LE(integer, frame * 4);
    pcm.writeInt16LE(integer, frame * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(destination, Buffer.concat([header, pcm]));
}

async function makeArtwork(spec) {
  const { width: w, height: h, name, vertical } = spec;
  const center = w / 2;
  const font = `font-family="Arial, Helvetica, sans-serif"`;
  await card(path.join(build, `${name}-intro.png`), w, h, `
    <rect width="${w}" height="${h}" fill="#fbf7ef"/>
    <rect x="${vertical ? 64 : 110}" y="${vertical ? 370 : 245}" width="82" height="9" rx="4.5" fill="#37c48e"/>
    ${lines(vertical ? ["Your balance changed.", "What happens next?"] : ["Your balance changed.", "Watch the estimate update."], vertical ? 64 : 110, vertical ? 490 : 365, vertical ? 94 : 86, `fill="#143c3a" ${font} font-size="${vertical ? 78 : 76}" font-weight="800" letter-spacing="-2"`)}
    <text x="${vertical ? 68 : 114}" y="${vertical ? 745 : 585}" fill="#143c3a" ${font} font-size="${vertical ? 32 : 30}" font-weight="500">A 17-second ClearTill walkthrough</text>
    <rect x="${vertical ? 64 : 110}" y="${vertical ? 850 : 700}" width="${vertical ? 952 : 760}" height="${vertical ? 180 : 150}" rx="28" fill="#e2f3ed"/>
    <text x="${vertical ? 112 : 165}" y="${vertical ? 930 : 790}" fill="#143c3a" ${font} font-size="${vertical ? 42 : 38}" font-weight="800">£649 → £149</text>
    <text x="${vertical ? 112 : 165}" y="${vertical ? 985 : 840}" fill="#143c3a" ${font} font-size="${vertical ? 25 : 24}" font-weight="600">after the balance is updated</text>
    <text x="${vertical ? 64 : 110}" y="${h - 85}" fill="#55706d" ${font} font-size="${vertical ? 24 : 22}" font-weight="600">Illustrative fictional test account</text>`,
    { width: vertical ? 230 : 270, left: vertical ? 64 : 110, top: vertical ? 72 : 70 });

  await card(path.join(build, `${name}-main.png`), w, h, `
    <rect x="${vertical ? 34 : 1225}" y="${vertical ? 155 : 42}" width="${vertical ? 1012 : 655}" height="${vertical ? 1645 : 996}" rx="${vertical ? 34 : 28}" fill="none" stroke="#b9d7cc" stroke-width="4"/>
    ${vertical ? `<text x="320" y="88" fill="#143c3a" ${font} font-size="30" font-weight="800">WATCH THE POSITION UPDATE</text>` : `${lines(["One change.", "One clearer position."], 92, 315, 76, `fill="#143c3a" ${font} font-size="66" font-weight="800" letter-spacing="-1.5"`)}<text x="94" y="505" fill="#55706d" ${font} font-size="28" font-weight="600">Balance £3,000 → £2,500</text><text x="94" y="550" fill="#55706d" ${font} font-size="28" font-weight="600">Position £649 → £149</text>`}
    <rect x="${vertical ? 64 : 92}" y="${h - (vertical ? 84 : 75)}" width="${vertical ? 952 : 900}" height="2" fill="#b9d7cc"/>
    <text x="${vertical ? center : 92}" y="${h - (vertical ? 38 : 32)}" text-anchor="${vertical ? "middle" : "start"}" fill="#55706d" ${font} font-size="${vertical ? 20 : 19}" font-weight="600">Illustrative test account • Estimate based on figures entered</text>`,
    { width: vertical ? 220 : 255, left: vertical ? 48 : 90, top: vertical ? 28 : 62 });

  const pillX = vertical ? 90 : 92;
  const pillY = vertical ? 208 : 670;
  const pillW = vertical ? 900 : 930;
  const pillH = vertical ? 112 : 105;
  for (const [key, label, fill, textFill] of [
    ["step1", "1  UPDATE THE BALANCE", "#143c3a", "#ffffff"],
    ["result", "£649  →  £149  ESTIMATED POSITION", "#37c48e", "#143c3a"],
    ["step2", "2  SEE WHAT IS COMMITTED", "#143c3a", "#ffffff"],
  ]) {
    await card(path.join(build, `${name}-${key}.png`), w, h, `
      <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="${fill}" opacity="0.97"/>
      <text x="${pillX + pillW / 2}" y="${pillY + pillH * 0.66}" text-anchor="middle" fill="${textFill}" ${font} font-size="${vertical ? 31 : 30}" font-weight="800" letter-spacing="0.5">${esc(label)}</text>`);
  }

  await card(path.join(build, `${name}-outro.png`), w, h, `
    <rect width="${w}" height="${h}" fill="#143c3a"/>
    <circle cx="${center}" cy="${vertical ? 645 : 360}" r="${vertical ? 250 : 210}" fill="#1a4b48"/>
    <rect x="${center - (vertical ? 180 : 200)}" y="${vertical ? 245 : 100}" width="${vertical ? 360 : 400}" height="110" rx="55" fill="#fbf7ef"/>
    <rect x="${center - (vertical ? 385 : 410)}" y="${vertical ? 530 : 295}" width="${vertical ? 770 : 820}" height="${vertical ? 230 : 180}" rx="38" fill="#37c48e"/>
    ${lines(["Know what may remain", "before payday."], center, vertical ? 615 : 365, vertical ? 64 : 56, `fill="#143c3a" ${font} font-size="${vertical ? 50 : 44}" font-weight="800"`, "middle")}
    <text x="${center}" y="${vertical ? 965 : 620}" text-anchor="middle" fill="#ffffff" ${font} font-size="${vertical ? 42 : 38}" font-weight="800">Check your position free</text>
    <text x="${center}" y="${vertical ? 1025 : 675}" text-anchor="middle" fill="#b9d7cc" ${font} font-size="${vertical ? 29 : 27}" font-weight="600">cleartill.money</text>
    <text x="${center}" y="${h - 75}" text-anchor="middle" fill="#b9d7cc" ${font} font-size="${vertical ? 21 : 19}" font-weight="500">Estimates depend on the figures entered • Not financial advice</text>`,
    { width: vertical ? 300 : 330, left: Math.round(center - (vertical ? 150 : 165)), top: vertical ? 280 : 135 });
}

function render(spec, soundtrack) {
  const { width: w, height: h, name, vertical, output } = spec;
  const prefix = path.join(build, name);
  const scale = vertical
    ? `[0:v]trim=start=0:end=${duration.body},setpts=PTS-STARTPTS,scale=960:1600:force_original_aspect_ratio=decrease[screen];color=c=#fbf7ef:s=${w}x${h}:d=${duration.body}:r=30[base];[base][screen]overlay=(W-w)/2:170[body0]`
    : `[0:v]trim=start=0:end=${duration.body},setpts=PTS-STARTPTS,scale=620:960:force_original_aspect_ratio=decrease[screen];color=c=#fbf7ef:s=${w}x${h}:d=${duration.body}:r=30[base];[base][screen]overlay=1240:60[body0]`;
  const filter = `${scale};
    [2:v]format=rgba[main];[body0][main]overlay=0:0:shortest=1[body1];
    [3:v]format=rgba,fade=t=in:st=0.15:d=0.25:alpha=1,fade=t=out:st=2.85:d=0.25:alpha=1[s1];[body1][s1]overlay=0:0:enable='between(t,0.15,3.1)':shortest=1[body2];
    [4:v]format=rgba,fade=t=in:st=4.65:d=0.22:alpha=1,fade=t=out:st=7.25:d=0.25:alpha=1[result];[body2][result]overlay=0:0:enable='between(t,4.65,7.5)':shortest=1[body3];
    [5:v]format=rgba,fade=t=in:st=8.15:d=0.25:alpha=1,fade=t=out:st=11.75:d=0.25:alpha=1[s2];[body3][s2]overlay=0:0:enable='between(t,8.15,12.0)':shortest=1,fps=30,format=yuv420p[body];
    [1:v]trim=duration=${duration.intro},setpts=PTS-STARTPTS,fps=30,format=yuv420p[intro];
    [6:v]trim=duration=${duration.outro},setpts=PTS-STARTPTS,fps=30,format=yuv420p[outro];
    [intro][body][outro]concat=n=3:v=1:a=0[v]`;
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", source,
    "-loop", "1", "-i", `${prefix}-intro.png`, "-loop", "1", "-i", `${prefix}-main.png`,
    "-loop", "1", "-i", `${prefix}-step1.png`, "-loop", "1", "-i", `${prefix}-result.png`,
    "-loop", "1", "-i", `${prefix}-step2.png`, "-loop", "1", "-i", `${prefix}-outro.png`, "-i", soundtrack,
    "-filter_complex", filter, "-map", "[v]", "-map", "7:a", "-t", String(totalDuration),
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output];
  const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`FFmpeg failed for ${name}.`);
}

function digest(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

async function main() {
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(final, { recursive: true });
  if (!fs.existsSync(source)) throw new Error(`Missing source recording: ${source}`);
  const soundtrack = path.join(build, "ct-w01-c01-original-soundtrack-v01.wav");
  writeOriginalSoundtrack(soundtrack);
  const verticalOutput = path.join(final, "2026-07-31_ct-w01-c01_portrait_reel_v05.mp4");
  const landscapeOutput = path.join(final, "2026-07-31_ct-w01-c01_landscape_product-demo_v05.mp4");
  const specs = [
    { name: "vertical", width: 1080, height: 1920, vertical: true, output: verticalOutput },
    { name: "landscape", width: 1920, height: 1080, vertical: false, output: landscapeOutput },
  ];
  for (const spec of specs) await makeArtwork(spec);
  for (const spec of specs) render(spec, soundtrack);

  const register = JSON.parse(fs.readFileSync(registerPath, "utf8"));
  const generatedAt = new Date().toISOString();
  const records = [
    { assetId: "cleartill-ct-w01-c01-original-score-v01", contentId: "ct-w01-c01", role: "original_soundtrack", type: "original_audio", sourceProvider: "ClearTill", sourceUrl: null, creator: "ClearTill", licence: "ClearTill-owned original procedural composition", generatedAt, localPath: path.relative(root, soundtrack), editableSourcePath: "scripts/marketing-product-demo-v04.cjs", sha256: digest(soundtrack), durationSeconds: totalDuration, audioPresent: true, attributionRequired: false, licenceChecked: true, humanApproved: false },
    { assetId: "cleartill-ct-w01-c01-portrait-reel-v05", contentId: "ct-w01-c01", role: "facebook_instagram_reel", type: "product_demo_video", sourceProvider: "ClearTill", sourceUrl: null, creator: "ClearTill", licence: "ClearTill-owned derivative with original ClearTill score", generatedAt, localPath: path.relative(root, verticalOutput), editableSourcePath: "scripts/marketing-product-demo-v04.cjs", sha256: digest(verticalOutput), durationSeconds: totalDuration, width: 1080, height: 1920, audioPresent: true, modifications: "True portrait Reel with a complete branded frame at time zero, timed hook, original music, animated callouts, disclosure and CTA outro.", attributionRequired: false, fictionalTestDataConfirmed: true, privacyChecked: true, licenceChecked: true, visualChecked: false, humanApproved: false },
    { assetId: "cleartill-ct-w01-c01-landscape-video-v05", contentId: "ct-w01-c01", role: "landscape_video", type: "product_demo_video", sourceProvider: "ClearTill", sourceUrl: null, creator: "ClearTill", licence: "ClearTill-owned derivative with original ClearTill score", generatedAt, localPath: path.relative(root, landscapeOutput), editableSourcePath: "scripts/marketing-product-demo-v04.cjs", sha256: digest(landscapeOutput), durationSeconds: totalDuration, width: 1920, height: 1080, audioPresent: true, modifications: "Landscape-only master with a complete branded frame at time zero; must not be supplied to Reel or Story channels.", attributionRequired: false, fictionalTestDataConfirmed: true, privacyChecked: true, licenceChecked: true, visualChecked: false, humanApproved: false },
  ];
  const ids = new Set(records.map((record) => record.assetId));
  register.assets = [...register.assets.filter((record) => !ids.has(record.assetId)), ...records];
  fs.writeFileSync(registerPath, `${JSON.stringify(register, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, totalDuration, soundtrack: path.relative(root, soundtrack), outputs: specs.map((spec) => path.relative(root, spec.output)) }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
