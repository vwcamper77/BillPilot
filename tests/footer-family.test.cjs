const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const footer = read("components/Footer.jsx");
const family = read("lib/productFamily.js");
const css = read("app/globals.css");

test("footer identifies ClearTill ownership and links to the configured corporate site", () => {
  assert.match(footer, /ClearTill is a product of\{" "\}/);
  assert.match(footer, />\s*GMBF Ventures Ltd\s*<\/a>/);
  assert.match(footer, /href=\{GMBF_VENTURES_URL\}/);
  assert.match(footer, /Company No\. 17286832 - Registered in England and Wales/);
  assert.match(family, /NEXT_PUBLIC_GMBF_VENTURES_URL/);
  assert.match(family, /https:\/\/gmbf-ventures\.vercel\.app\//);
});

test("footer lists sibling products with descriptive, same-tab links and no ClearTill self-link", () => {
  assert.match(footer, /aria-label="Also from GMBF Ventures"/);
  assert.match(footer, />SetTheDate<\/a>/);
  assert.match(footer, />TalosTV<\/a>/);
  assert.match(family, /setthedate: "https:\/\/plan\.setthedate\.app\/"/);
  assert.match(family, /talostv: "https:\/\/talostv\.com\/"/);
  assert.doesNotMatch(footer, /PRODUCT_URLS\.cleartill/);
  assert.doesNotMatch(footer, /target=|nofollow|sponsored|ugc/);
});

test("family links have accessible names, focus treatment and wrapping mobile layout", () => {
  assert.match(footer, /GMBF Ventures Ltd/);
  assert.match(footer, /SetTheDate/);
  assert.match(footer, /TalosTV/);
  assert.match(css, /\.site-footer a:focus-visible[\s\S]*outline: 2px solid/);
  assert.match(css, /\.site-footer-family-products[\s\S]*flex-wrap: wrap/);
  assert.match(css, /\.site-footer[\s\S]*overflow-wrap: anywhere/);
});

test("footer family clicks use the established analytics helper and safe metadata", () => {
  assert.match(footer, /trackEvent\("family_footer_click"/);
  assert.match(footer, /source_product: "cleartill"/);
  assert.match(footer, /placement: "footer"/);
  for (const destination of ["gmbf_ventures", "setthedate", "talostv"]) {
    assert.match(footer, new RegExp(`trackFamilyClick\\("${destination}"\\)`));
  }
  assert.match(read("lib/analytics/constants.js"), /"family_footer_click"/);
});
