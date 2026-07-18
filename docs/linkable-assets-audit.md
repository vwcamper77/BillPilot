# ClearTill linkable-assets audit

Audit completed: 18 July 2026

Audited deployment: `https://www.cleartill.money`
Integrated base: `origin/main` at `d0c3eeb` plus the current uncommitted linkable-assets work

## Current architecture

- ClearTill uses Next.js 15 with the App Router and React 19. Routes are JavaScript/JSX files under `app/`.
- npm is the package manager (`package-lock.json`).
- The Journal is not MDX, Markdown or CMS-backed. Approved article and tool records are held as structured JavaScript in `app/blog/posts.js` and validated when the module loads.
- `/blog` is a server page which passes article records into the client-side `BlogExplorer`; `/blog/[slug]` is statically parameterised from the same data.
- The Journal header is duplicated in the Journal page templates. The site footer is shared through `components/Footer.jsx`. Journal cards are private to `BlogExplorer.jsx`.
- Categories are defined beside the posts. Topic cards and filter pills use real `?topic=` links, the selected category is resolved on the server, and `aria-current` communicates the active topic without requiring JavaScript.
- Metadata uses the Next.js metadata API. The working tree centralises the canonical `www` origin, social image and metadata helpers in `lib/seo.js`.
- Article pages emit one `Article`, one `BreadcrumbList`, and, where applicable, one `FAQPage` JSON-LD object. The Journal emits one `CollectionPage`. The objects inspected were parseable and were not duplicated by type.
- `app/sitemap.js` and `app/robots.js` generate the public sitemap and crawler rules. The working tree uses stable source dates rather than build-time dates.
- Open Graph and Twitter cards use the existing 1200×630 approved image at `/social/cleartill-og-v2.png`.
- Analytics includes internal funnel events, GA4/GTM, Meta Pixel and consent-gated Mixpanel. Existing sanitisation rejects metadata keys associated with balances, income, costs, bills and free text. The calculator should not introduce analytics unless an empty, allow-listed event contract is demonstrably safe.
- Automated checks comprise Node's test runner plus Playwright unit and end-to-end suites. There are no lint or TypeScript/type-check scripts, and this is a JavaScript repository.
- Design tokens live in `app/globals.css` (`--bg`, `--panel`, `--ink`, `--muted`, `--line`, `--accent`, `--soft`, shared radii and shadow). Journal breakpoints are 860px and 560px; the audited 375px layout had no page-level horizontal overflow.

## Integration status

- The canonical SEO/entity migration is already part of `main`: `/about` permanently redirects to `/about-cleartill`, metadata uses the `www` origin, the sitemap excludes `/billing`, and private application routes retain noindex and crawler protections.
- The integrated upstream About page contains the approved Gavin Ferns founder story and image. The homepage links to that canonical About page.
- The uncommitted linkable-assets work adds a third Journal guide, server-rendered topic URLs, a distinct Free tools block and the public calculator route.
- Existing editorial price figures have been replaced with links to `/pricing`, reducing future staleness risk without changing pricing.
- The calculator and guide are included in the generated sitemap. The future research route remains absent from routes, cards, feeds and the sitemap.

## Audit findings and implementation status

1. Topic tiles previously pointed to one anchor; they now select their stated topic through real `?topic=` links.
2. Category filtering was JavaScript-only; it is now resolved on the server and exposes `aria-current` semantics.
3. The content model assumed every item was an article; article and tool records now have separate discriminators and validation.
4. The Journal lacked tool discovery and cross-linking; it now has a Free tools section and contextual related links.
5. The canonical About migration is integrated. Internal links use `/about-cleartill`, while `/about` remains a permanent redirect.
6. The sitemap excludes utility routes and includes only the public calculator and approved Journal content.
7. Editorial pricing references now point to the pricing source of truth rather than embedding figures.
8. Structured data remains parseable and contains no fabricated ratings, reviews, user counts or awards.
9. Responsive and keyboard coverage exists for the new public routes at 375px, 768px and 1440px; it must pass before commit.
10. Search intent remains separated between explanation, calculation, irregular-income guidance and manual/Open Banking comparison.

## Search-intent overlap

- `/blog/how-much-can-i-spend-before-payday`: informational explanation of the basic “balance minus bills” method and why a bank balance alone is incomplete.
- `/blog/budgeting-irregular-income-no-payday`: informational method for choosing a cautious next reliable income horizon when pay dates or amounts vary.
- `/tools/payday-cashflow-calculator`: transactional intent; privately subtracts dated bills from cash available now, calculates the net daily amount and plots a runway through payday.
- `/blog/budgeting-without-open-banking`: comparative/practical intent; explains how to run a manual cashflow system, the trade-offs against connected automation and the maintenance needed.

The new guide must not become another “how much can I spend before payday” article, and the calculator's supporting copy must link to—rather than reproduce—the two specialist guides.

## Recommended routes

- Public calculator: `/tools/payday-cashflow-calculator`
- Public guide: `/blog/budgeting-without-open-banking`
- Future report route, reserved but not created: `/research/uk-payday-pressure-report-2026`
- Internal report specification only: `docs/uk-payday-pressure-report-spec.md`

The Journal remains the discovery hub. It should list guides normally and feature the calculator in a distinct “Free tools” block. No report or coming-soon record should be exposed.

## Implemented locally

1. Add explicit content types to Journal records and a small typed tool record without introducing a CMS or duplicating article copy.
2. Replace category-only buttons/topic anchors with real `?topic=` links while preserving server-rendered cards and the existing visual language.
3. Add the design-consistent Free tools section before the ordinary guide listing.
4. Implement pure pence-based division and calendar-date functions in an unauthenticated local module with focused unit tests.
5. Build an accessible client form that holds entries only in React memory, sends no values, persists nothing and never places entries in the URL.
6. Add server-rendered calculator content, metadata, breadcrumb and `WebApplication` JSON-LD. Use a free offer but no rating or review; Google requires a rating/review for Software App rich-result eligibility, so the markup is for accurate entity description rather than a promised rich result.
7. Add the balanced UK guide to `app/blog/posts.js`, including publication data, related internal links and authoritative UK sources.
8. Add one contextual calculator link to the existing payday article without materially rewriting it.
9. Add the calculator and guide to the stable sitemap; keep the future research route absent from routes, sitemap, feeds and cards.
10. Write the governed internal research specification.
11. Extend focused SEO/privacy tests, run all available unit/integration checks and production build, inspect server HTML, then verify keyboard/accessibility and layouts at 375px, 768px and 1440px.

## Remaining validation and assumptions

- The linkable-assets work has been integrated on top of the latest `origin/main`, preserving the founder/About page, Firestore quota handling and production-Firebase test safeguards.
- The local `/about-cleartill` migration is assumed intentional. New links should use that canonical route even though the task brief names the legacy `/about` route; `/about` remains a resolving permanent redirect.
- Dates use Europe/London calendar semantics in the user interface, but date arithmetic must operate on parsed calendar parts so UTC conversion cannot shift a selected day.
- Same-day calculations use a one-day planning period. Future income is never added: the free calculator uses only cash available now and subtracts bills entered for the period.
- Users can add up to eight dated bills. The browser-only runway shows the remaining cash after bills on each day; recurring bill management remains part of the fuller ClearTill app.
- No calculator analytics will be added initially. This is safer than extending two existing event pipelines and still satisfies the product requirements.
- The task cannot guarantee backlinks, rankings, rich results or press coverage.
