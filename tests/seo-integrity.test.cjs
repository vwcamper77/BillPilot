const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const seo = read("lib/seo.js");
const home = read("app/page.jsx");
const about = read("app/about-cleartill/page.jsx");
const sitemap = read("app/sitemap.js");
const robots = read("app/robots.js");

test("homepage metadata uses the approved title, description and canonical URL", () => {
  assert.match(seo, /ClearTill — UK Cashflow and Payday Planning App/);
  assert.match(seo, /ClearTill shows what is safe to spend after bills until your next income date\. Plan your cashflow without connecting your bank or using Open Banking\./);
  assert.match(seo, /export const HOME_URL = `\$\{SITE_URL\}\/`/);
  assert.match(home, /<link rel="canonical" href=\{HOME_URL\} \/>/);
  assert.match(home, /<meta property="og:url" content=\{HOME_URL\} \/>/);
});

test("About ClearTill has unique founder metadata and required company identity", () => {
  assert.match(about, /About Gavin Ferns, Founder of ClearTill/);
  assert.match(about, /Meet Gavin Ferns, the founder of ClearTill/);
  assert.match(about, /const PAGE_URL = `\$\{SITE_URL\}\/about-cleartill`/);
  assert.match(about, /alternates: \{ canonical: PAGE_URL \}/);
  assert.match(about, /GMBF Ventures Ltd/);
  assert.match(about, /17286832/);
  assert.match(about, /hello@cleartill\.money/);
});

test("founder story uses verified claims and the homepage links to it", () => {
  assert.match(about, /About ClearTill and its founder Gavin Ferns/);
  assert.match(about, /Executive MBA from Imperial College Business School/);
  assert.match(about, /TalosTV and SetTheDate/);
  assert.match(home, /Created by Gavin Ferns/);
  assert.match(home, /href="\/about-cleartill"/);
  assert.doesNotMatch(about, /successful products|commercially successful/i);
  assert.doesNotMatch(about, /Open Banking is unsafe|unsafe Open Banking/i);
  assert.doesNotMatch(about, /linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com/i);
});

test("Person schema contains only verified founder fields", () => {
  const personMatch = home.match(/\{\s*"@type": "Person",([\s\S]*?)\n\s*\},/);
  assert.ok(personMatch, "missing Gavin Ferns Person schema");
  const person = personMatch[0];
  for (const field of ["name", "jobTitle", "worksFor", "url"]) assert.match(person, new RegExp(`${field}:`));
  for (const forbidden of ["image:", "sameAs", "alumniOf", "award", "nationality", "birthDate", "address", "social"]) {
    assert.ok(!person.includes(forbidden), `unexpected Person field: ${forbidden}`);
  }
});

test("sitemap includes public entity pages and excludes private or utility routes", () => {
  for (const route of ["/about-cleartill", "/pricing", "/security", "/privacy", "/terms", "/blog"]) {
    assert.ok(sitemap.includes(route), `missing ${route}`);
  }
  for (const route of ["/dashboard", "/account", "/signin", "/billing", "/admin", "/api/"]) {
    assert.ok(!sitemap.includes(route), `unexpected ${route}`);
  }
  assert.match(sitemap, /lastModified: "2026-/);
  assert.doesNotMatch(sitemap, /new Date\(\)/);
});

test("robots references the canonical production sitemap and protects private routes", () => {
  assert.match(robots, /`\$\{SITE_URL\}\/sitemap\.xml`/);
  for (const route of ["/api/", "/admin/", "/account/", "/dashboard/"]) {
    assert.ok(robots.includes(route), `missing robots rule for ${route}`);
  }
});

test("homepage schema identifies the legal owner without fabricated reputation fields", () => {
  assert.match(home, /"@type": "Organization"/);
  assert.match(home, /legalName: "GMBF Ventures Ltd"/);
  assert.match(home, /"@type": "WebSite"/);
  assert.match(home, /"@type": "SoftwareApplication"/);
  for (const forbidden of ["AggregateRating", '"@type": "Review"', "ratingValue", "numberOfUsers", "award:"]) {
    assert.ok(!home.includes(forbidden), `unexpected schema field: ${forbidden}`);
  }
});

test("SEO implementation uses only the www production origin", () => {
  const files = [
    "lib/seo.js",
    "app/layout.jsx",
    "app/page.jsx",
    "app/sitemap.js",
    "app/robots.js",
    "app/about-cleartill/page.jsx",
    "app/pricing/page.jsx",
    "app/security/page.jsx",
    "app/privacy/page.jsx",
    "app/terms/page.jsx",
    "app/blog/page.jsx",
    "app/blog/[slug]/page.jsx",
    "app/blog/feed.xml/route.js",
  ];
  const combined = files.map(read).join("\n");
  assert.doesNotMatch(combined, /https:\/\/cleartill\.money/);
  assert.doesNotMatch(combined, /localhost|vercel\.app|firebaseapp\.com/);
  assert.match(combined, /https:\/\/www\.cleartill\.money/);
});
