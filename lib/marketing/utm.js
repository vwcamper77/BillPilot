"use strict";

const DEFAULT_ORIGIN = "https://www.cleartill.money";
const ALLOWED_HOSTS = new Set(["www.cleartill.money", "cleartill.money"]);
const ALLOWED_PATHS = ["/", "/start", "/pricing", "/blog", "/tools/payday-cashflow-calculator", "/free-cash-position-sheet"];
const REQUIRED = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];
const OPTIONAL = ["utm_term", "experiment_id", "creative_id"];
const SNAKE_CASE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CONTENT_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

function cleanParam(name, value, required = false) {
  const result = String(value || "").trim();
  if (!result && required) throw new Error(`Missing required UTM parameter: ${name}.`);
  const pattern = name === "utm_content" || name === "content_id" ? CONTENT_ID : SNAKE_CASE;
  if (result && !pattern.test(result)) {
    const format = pattern === CONTENT_ID ? "a lowercase content ID using hyphens or underscores" : "lowercase snake_case";
    throw new Error(`${name} must use ${format}.`);
  }
  return result;
}

function validateLandingUrl(destination, { origin = DEFAULT_ORIGIN } = {}) {
  const text = String(destination || "").trim();
  if (!text) throw new Error("Missing campaign landing destination.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith("//")) {
    let external;
    try { external = new URL(text, origin); } catch { throw new Error("Invalid campaign landing destination."); }
    if (external.protocol !== "https:" || !ALLOWED_HOSTS.has(external.hostname)) throw new Error("Campaign destination is not an allowlisted ClearTill URL.");
  }
  const url = new URL(text, origin);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) throw new Error("Campaign destination is not an allowlisted ClearTill URL.");
  const allowed = ALLOWED_PATHS.some((path) => url.pathname === path || (path === "/blog" && url.pathname.startsWith("/blog/")));
  if (!allowed) throw new Error(`Campaign path is not allowlisted: ${url.pathname}.`);
  url.hash = "";
  return url;
}

function buildCampaignUrl({ landingPath, utm, origin = DEFAULT_ORIGIN, channel } = {}) {
  const url = validateLandingUrl(landingPath, { origin });
  const params = { ...(utm || {}), ...(channel ? { utm_source: channel } : {}) };
  for (const name of REQUIRED) url.searchParams.set(name, cleanParam(name, params[name], true));
  for (const name of OPTIONAL) {
    const value = cleanParam(name, params[name]);
    if (value) url.searchParams.set(name, value);
  }
  url.searchParams.set("content_id", cleanParam("content_id", params.content_id || params.utm_content, true));
  return url.toString();
}

module.exports = { ALLOWED_HOSTS, ALLOWED_PATHS, CONTENT_ID, DEFAULT_ORIGIN, REQUIRED, OPTIONAL, buildCampaignUrl, validateLandingUrl };
