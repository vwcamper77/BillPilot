#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { generateInfographics } = require("../lib/marketing/infographics");

generateInfographics().then((manifest) => {
  process.stdout.write(`${JSON.stringify({ ok: true, assets: manifest.assets.length, manifest: path.relative(process.cwd(), require("../lib/marketing/infographics").MANIFEST_PATH), files: manifest.assets.flatMap((asset) => [asset.svgPath, asset.pngPath]) }, null, 2)}\n`);
}).catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
  process.exitCode = 1;
});
