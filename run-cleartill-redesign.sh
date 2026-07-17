#!/usr/bin/env bash
set -euo pipefail

# Run this script from the root of the ClearTill Git repository after placing
# the supplied design-references directory in that root.

command -v codex >/dev/null 2>&1 || {
  echo "Codex CLI is not installed or not on PATH." >&2
  exit 1
}

git rev-parse --show-toplevel >/dev/null 2>&1 || {
  echo "Run this from inside the ClearTill Git repository." >&2
  exit 1
}

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

REFERENCE_DIR="$ROOT/design-references"
REQUIRED_REFERENCES=(
  01-sample-modal.png
  02-current-home-top.png
  03-current-home-forecast-bills.png
  04-current-home-balance-income.png
  05-current-home-bills-large-costs.png
  06-current-home-large-costs-savings.png
  07-current-home-savings-utilities.png
  08-blog-design-language.png
)

for file in "${REQUIRED_REFERENCES[@]}"; do
  if [[ ! -f "$REFERENCE_DIR/$file" ]]; then
    echo "Missing reference image: $REFERENCE_DIR/$file" >&2
    exit 1
  fi
done

mkdir -p "$ROOT/.codex-artifacts"

codex exec \
  -C "$ROOT" \
  --sandbox workspace-write \
  -i "$REFERENCE_DIR/01-sample-modal.png" \
  -i "$REFERENCE_DIR/02-current-home-top.png" \
  -i "$REFERENCE_DIR/03-current-home-forecast-bills.png" \
  -i "$REFERENCE_DIR/04-current-home-balance-income.png" \
  -i "$REFERENCE_DIR/05-current-home-bills-large-costs.png" \
  -i "$REFERENCE_DIR/06-current-home-large-costs-savings.png" \
  -i "$REFERENCE_DIR/07-current-home-savings-utilities.png" \
  -i "$REFERENCE_DIR/08-blog-design-language.png" \
  -o "$ROOT/.codex-artifacts/cleartill-redesign-summary.md" \
  - <<'CODEX_PROMPT'
You are the senior product designer and frontend engineer responsible for implementing a production-quality ClearTill dashboard redesign in this repository. Do not merely review, propose, or write a plan. Inspect the codebase, implement the redesign, exercise it in a browser, run the relevant test suites, inspect screenshots, fix defects, and repeat until every acceptance gate below passes or an external blocker is proven.

## Reference images and how to use them

Eight reference images are attached in this order:

1. Sample modal: use its information hierarchy, plain-language calculation, editable inputs, and calm financial summary.
2. Current home page top: this is the existing product and functionality that must be improved rather than discarded.
3. Current forecast and bills.
4. Current balance and income schedule.
5. Current bill entry and large-cost planning.
6. Current large-cost funding and savings.
7. Current savings and household-utilities tracker.
8. Blog visual: this is the target design language for typography, spacing, colour, borders, cards, icon treatment, and strong amount-first hierarchy.

Use image 8 as the visual-language reference, image 1 as the information-hierarchy reference, and images 2–7 as the functional inventory. The result must look unmistakably like the same ClearTill product shown in the blog visual, but it must remain a real operational dashboard rather than a marketing mock-up. Do not copy screenshots pixel-for-pixel and do not hardcode their demonstration values.

## Product outcome

The returning-user home page must answer this question immediately:

“How much can I safely use before my next reliable payment, and is anything about to cause a problem?”

Apply this hierarchy throughout:

- Simple daily decision above the fold.
- Evidence, explanation, planning, and management below the fold.
- Normal days should look calm.
- Exceptions must rise to the top: stale balance, uncertain income, a missing major bill, an underfunded large cost, or a projected shortfall.

Retain the current feature depth. Reorganise and progressively disclose it; do not remove working functionality.

## First: inspect and establish a baseline

1. Read every relevant AGENTS.md and repository instruction file before editing.
2. Inspect the package manifests, framework, route structure, styling system, design tokens, data layer, state management, calculation code, feature flags, and existing tests.
3. Locate the actual returning-user home/dashboard route and the relevant irregular-income blog post or blog design implementation.
4. Inspect git status. Preserve all unrelated user changes. Do not reset, discard, or overwrite work that is not part of this task.
5. Run the repository’s existing formatter check, lint, typecheck, unit tests, integration tests, and end-to-end tests as applicable. Record any baseline failures before changing code.
6. Identify the existing source of truth for balance, confirmed and estimated income, bills, pay dates, large costs, savings, and currency formatting. Reuse it. Do not create a parallel financial model in the UI.

## Shared ClearTill design language

Create or refine a small, coherent shared design system using the repository’s existing approach. Prefer reusable tokens and primitives over page-specific CSS duplication.

The visual system should mirror the attached blog reference:

- Warm off-white page background.
- Near-black/navy display text with strong, compact headings.
- ClearTill teal as the principal action and positive-data colour.
- Pale mint surfaces for reassurance and included/complete states.
- Warm cream surfaces for planning and supporting information.
- Fine neutral borders, restrained shadows, and medium corner radii.
- High numerical emphasis with tabular numerals where appropriate.
- Generous but disciplined spacing.
- Compact controls with clear hover, active, focus, disabled, loading, success, warning, and error states.
- Icons must support comprehension, not decorate every label.

The blog and app should share the same token vocabulary for colour, type scale, radii, border treatment, spacing rhythm, buttons, pills, and cards. Share code where the repository architecture makes that sensible. Otherwise use one canonical token source. Do not force the marketing page to import application business logic, and do not turn the operational dashboard into a marketing landing page.

## Rebuild the dashboard above the fold

Create a focused first screen with this order and hierarchy. Use live product data and computed labels rather than the example values below.

### 1. Compact header

Keep the ClearTill brand and essential account/navigation controls. Reduce visual competition with the financial answer.

### 2. Status and primary result

Use a small computed status such as “On track”, “Needs attention”, or the product’s existing equivalent.

Make the amount the dominant element, using a structure such as:

“£823 available before 20 July”

Support it with:

“£137 per day for the next 6 days”

The exact copy must be generated from the product’s real calculation and locale. Prefer “available” or the product’s validated plain-language term. Use “You’re clear” only as secondary reassurance, not as a substitute for the amount and date.

### 3. Plain-language calculation

Show a concise formula using the actual components, for example:

current balance + confirmed income before the horizon − committed bills − protected large costs = available amount

Keep it readable and compact. Put the full transaction-level calculation behind a “See what’s included” or “See breakdown” disclosure. Estimated or unconfirmed income must be visibly distinguished and must follow existing calculation rules; do not silently count it as reliable cash.

### 4. Allocation communication

Replace the current four similar weekly bars as the primary communication. Above the fold, use one understandable allocation treatment that shows available versus committed money. It may be a horizontal allocation bar or another accessible equivalent, but it must answer “what is left and what is already spoken for?” without requiring chart interpretation.

The visual must include text labels and values; colour alone is insufficient.

### 5. Next commitments

Show the next two or three relevant commitments before the horizon with name, amount, and date. Prioritise items that explain the result or require attention. Provide a clear route to the full bill list.

### 6. Data freshness

Show when the balance was last updated. Treat stale data as a confidence issue. If it is stale according to existing or newly centralised product rules, surface a concise warning and make “Update balance” the primary action.

### 7. Actions

Allow no more than two competing actions in the hero:

- Contextual primary action: normally “See breakdown”, but “Update balance” when data freshness requires it.
- One secondary action for the other of those two tasks.

Move “Add bill”, “Add large cost”, “Update savings”, and similar management actions into their relevant sections below.

## Detailed content below the fold

Keep the product’s full capability and organise it in this sequence, using compact summary rows and progressive disclosure where appropriate:

1. Current pay cycle: full calculation, included income, included bills, current free cash, and daily allowance.
2. Next pay cycle: expected income, commitments, protected large costs, expected free cash, and suggested allowance.
3. Four-week outlook: replace isolated weekly magnitude cards with a continuous cash-runway timeline or event sequence. Mark today, reliable-pay events, major bills, large costs, and period boundaries. The user must be able to understand why the amount changes. Put detailed values and a table/list alternative behind the visual.
4. Bills and income: retain selection, filters, add/edit/remove/paid controls, natural-language bill entry, upload/speech entry where currently supported, and income scheduling.
5. Large costs and savings: retain affordability status, funding source calculations, reassignment, shortfalls, and savings allocation.
6. Household completeness: retain the utility tracker and missing-category actions.

Collapsed sections must still communicate the key status, amount, item count, and next relevant date. Do not hide an urgent problem inside a collapsed panel.

## Blog consistency

Locate the implementation for the irregular-income blog post represented by the attached blog reference. Align it with the same design system used by the redesigned home page:

- Brand/header treatment.
- Display typography and amount emphasis.
- Cream, mint, teal, border, radius, and shadow tokens.
- Card and button construction.
- Responsive spacing.
- The product mock-up shown in the article must reflect the real redesigned dashboard’s hierarchy and terminology, not an obsolete or contradictory UI.

Keep the article’s marketing hierarchy and editorial readability. The blog may be more spacious and illustrative; the app must be denser and operational. They should look like two surfaces of one product, not identical pages.

If the repository does not contain this blog source, do not invent an unrelated public route. Instead, centralise the application design tokens, add a concise implementation note at the repository’s normal documentation location describing how the blog should consume them, and clearly report the missing source as a blocker in the final summary.

## Financial and behavioural constraints

- Never hardcode the screenshot amounts, dates, names, or item counts into production UI.
- Preserve the existing calculation semantics unless a defect is demonstrated by tests.
- Base the working horizon on the next reliable/confirmed payment according to current domain rules.
- Preserve locale-aware currency and date formatting.
- Handle zero, negative, very large, decimal, and missing values deliberately.
- Handle singular/plural day and item labels correctly.
- Long bill names and translated copy must not break the layout.
- Loading, empty, partial-data, error, stale-data, negative-runway, and no-upcoming-pay states must be intentional.
- Do not change authentication, payment/subscription behaviour, database migrations, or unrelated APIs unless the existing implementation makes a narrowly scoped change essential. Explain any such change.

## Responsive and accessibility requirements

Implement and verify at least these viewports:

- 390 × 844 mobile.
- 768 × 1024 tablet.
- 1024 × 768 compact desktop/tablet landscape.
- 1440 × 900 desktop.

Requirements:

- No horizontal overflow.
- Primary amount, horizon, daily allowance, allocation explanation, and at least the first commitment remain quickly visible on mobile.
- On a 1440 × 900 desktop, the primary result, calculation, allocation, upcoming commitments, freshness, and two actions should fit in the first viewport without feeling cramped.
- Use semantic HTML and a logical heading order.
- All interactions work with keyboard only.
- Visible focus states are not clipped.
- Controls have accessible names and states.
- Expanded/collapsed regions expose state to assistive technology.
- Do not rely on colour alone.
- Meet WCAG AA contrast for normal text and interactive controls.
- Respect reduced-motion preferences.

## Automated tests to add or update

Use the repository’s existing testing stack. Add narrowly scoped tests for the new behaviour and regression risk. At minimum cover:

1. On-track state with confirmed income and bills before payday.
2. Stale balance state and contextual primary action.
3. Projected shortfall/negative available amount.
4. Confirmed versus estimated irregular income.
5. No upcoming bills or empty-state data.
6. A large cost funded partly or wholly from savings.
7. Long labels and large currency values.
8. Mobile disclosure and navigation behaviour.
9. Allocation values and labels agree with the underlying calculation.
10. Existing add/edit/remove/update flows remain reachable and functional.

Do not replace meaningful assertions with broad snapshots. Use snapshots only where they add value.

## Browser and visual validation loop

Use the project’s existing browser/e2e tooling. If Playwright or an equivalent is already present, use it. If no browser test tooling exists, prefer the smallest repository-appropriate setup and avoid adding a large dependency solely for screenshots unless necessary.

Perform this loop, not just once:

1. Start the application with a deterministic test/demo data state.
2. Open the redesigned home page and relevant blog page in a real browser.
3. Capture full-page and first-viewport screenshots at all four required viewports.
4. Inspect the screenshots for hierarchy, clipping, wrapping, density, alignment, token consistency, and visual noise.
5. Exercise disclosures, navigation, balance update, bill/income management entry points, and relevant status states.
6. Check the browser console for errors and warnings caused by the change.
7. Run an automated accessibility scan if the repository already has axe or an equivalent; otherwise perform semantic and keyboard assertions using the available browser tooling.
8. Fix every discovered defect.
9. Repeat the browser screenshots and affected tests after fixes.

Save final screenshots and any visual-test output under `.codex-artifacts/cleartill-redesign/`. Do not commit generated artefacts unless that is already repository convention.

## Quality gates: all must pass before declaring completion

- The amount available before the next reliable payment is visually dominant and understandable without expanding anything.
- The first viewport answers what is available, until when, per-day guidance, what is committed, what is due next, and whether the data is fresh.
- The former four-week cards are no longer the primary above-fold communication.
- The detailed four-week view explains change over time through events, not merely four similar bar heights.
- Existing dashboard features are preserved and discoverable.
- The blog and dashboard use one coherent ClearTill design language while retaining their different jobs.
- No financial example values are hardcoded into production code.
- No horizontal overflow occurs at the required viewports.
- No new uncaught console errors, hydration errors, or accessibility violations are introduced.
- Formatter, lint, typecheck, unit, integration, and e2e checks relevant to the changed code pass.
- Any pre-existing failures are clearly distinguished from new failures and are not hidden or disabled.
- No unrelated files are modified.

## Working rules

- Make conservative, production-ready decisions from repository evidence instead of stopping for minor clarification.
- Do not stop after producing a plan.
- Do not declare success after the first render.
- Do not use destructive git commands.
- Do not commit, push, open a pull request, or change secrets.
- Do not silence tests, lint rules, type errors, or accessibility checks to obtain a green result.
- Keep implementation scope focused on the dashboard hierarchy, supporting forecast communication, and shared blog/app design language.

## Final response

When the implementation and validation loop are complete, provide a precise final report containing:

1. What changed in the dashboard above the fold.
2. What moved or changed below the fold.
3. How the forecast communication now works.
4. How the blog and app design systems were aligned.
5. Files changed.
6. Tests and browser scenarios run, with exact commands and outcomes.
7. Screenshot/artifact paths.
8. Any genuine residual risk or external blocker.
9. A concise `git diff --stat` summary.

Do not claim perfection. State that the defined quality gates passed, or identify exactly which gate did not pass and why.
CODEX_PROMPT

printf '\nCodex summary written to:\n  %s\n' "$ROOT/.codex-artifacts/cleartill-redesign-summary.md"
