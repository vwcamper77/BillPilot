#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  CANDIDATES_PATH,
  buildPhotoCandidates,
  decorateCandidates,
  downloadCandidate,
  reusableCandidates,
  writeJson
} = require("../lib/marketing/stockPhotos");

function flags(argv) {
  return Object.fromEntries(argv.filter((arg) => arg.startsWith("--")).map((arg) => {
    const [key, ...value] = arg.slice(2).split("=");
    return [key, value.length ? value.join("=") : true];
  }));
}
function output(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

async function main() {
  const values = flags(process.argv.slice(2));
  const command = process.argv.slice(2).find((arg) => !arg.startsWith("--")) || "search";
  if (command === "search") {
    const ids = String(values.ids || "ct-w01-a01,ct-w01-b01,ct-w01-c01").split(",").map((id) => id.trim()).filter(Boolean);
    const cached = values.refresh !== true && reusableCandidates(ids);
    const result = decorateCandidates(cached || await buildPhotoCandidates({ ids }));
    writeJson(CANDIDATES_PATH, result);
    output({ ok: true, cached: Boolean(cached), status: result.status, expiresAt: result.expiresAt, destination: path.relative(process.cwd(), CANDIDATES_PATH), campaigns: Object.fromEntries(Object.entries(result.campaigns).map(([id, item]) => [id, { status: item.status, candidates: item.candidates.length }])) });
    return;
  }
  if (command === "download") {
    if (!values.id || !values.asset) throw new Error("Use download --id=<content-id> --asset=<Pixabay asset id>.");
    const result = await downloadCandidate({ contentId: String(values.id), providerAssetId: String(values.asset) });
    output({ ok: true, assetId: result.assetId, destination: path.relative(process.cwd(), result.destination), approval: "blocked_pending_rights_and_human_review" });
    return;
  }
  throw new Error("Unknown command. Use search or download.");
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code: error.code || "STOCK_PHOTO_ERROR", message: error.message } }, null, 2)}\n`);
  process.exitCode = 1;
});
