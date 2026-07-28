#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { DEFAULT_IDS, generateReviewArtifacts } = require("../lib/marketing/review");

function parseArgs(argv) {
  const flags = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...value] = item.slice(2).split("=");
    flags[key] = value.length ? value.join("=") : true;
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const ids = flags.ids ? String(flags.ids).split(",").map((id) => id.trim()).filter(Boolean) : DEFAULT_IDS;
  const format = ["html", "pdf", "both"].includes(flags.format) ? flags.format : "both";
  const result = await generateReviewArtifacts({ ids, format });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    format,
    modelDigest: result.modelDigest,
    html: result.html.map((file) => path.relative(process.cwd(), file)),
    pdf: result.pdf.map((file) => path.relative(process.cwd(), file)),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code: "REVIEW_GENERATION_ERROR", message: error.message } }, null, 2)}\n`);
  process.exitCode = 1;
});
