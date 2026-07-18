import Link from "next/link";
import Logo from "@/components/Logo";
import PaydayCashflowCalculator from "./PaydayCashflowCalculator";
import { createPageMetadata } from "@/lib/seo";
import {
  PAYDAY_CALCULATOR_DESCRIPTION,
  PAYDAY_CALCULATOR_PATH,
  createPaydayCalculatorSchemas,
} from "@/lib/linkableAssetsSchema";

const TITLE = "Payday Cashflow Calculator";

export const metadata = createPageMetadata({
  title: TITLE,
  description: PAYDAY_CALCULATOR_DESCRIPTION,
  path: PAYDAY_CALCULATOR_PATH,
});

export default function PaydayCashflowCalculatorPage() {
  const { breadcrumb: breadcrumbSchema, application: applicationSchema } = createPaydayCalculatorSchemas();

  return (
    <main className="tool-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema).replace(/</g, "\\u003c") }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(applicationSchema).replace(/</g, "\\u003c") }} />

      <header className="blog-header">
        <Link className="blog-logo" href="/" aria-label="ClearTill home"><Logo height={38} /></Link>
        <nav className="blog-nav" aria-label="Main navigation">
          <Link href="/">Home</Link>
          <Link href="/blog">Journal</Link>
          <Link className="blog-nav-cta" href="/start">Try ClearTill</Link>
        </nav>
      </header>

      <section className="tool-hero">
        <nav className="article-breadcrumb" aria-label="Breadcrumb"><Link href="/blog">Journal</Link><span aria-hidden="true">/</span><span>Free tools</span></nav>
        <p className="eyebrow">Free tool · no sign-up</p>
        <h1>Payday cashflow calculator</h1>
        <p>See what remains after bills and committed costs before your next income date. No bank connection, account or sign-up required.</p>
        <ul aria-label="Calculator privacy and access summary">
          <li>Calculated in your browser</li>
          <li>No entries saved</li>
          <li>No Open Banking</li>
        </ul>
      </section>

      <PaydayCashflowCalculator />

      <article className="tool-content">
        <section>
          <p className="eyebrow">What the answer means</p>
          <h2>A short-horizon cashflow check</h2>
          <p>The calculator starts with your current balance, adds only income confirmed to arrive before the selected date, then subtracts bills and one-off commitments due on or before that date plus any buffer you choose. The result is an estimate based on the figures entered.</p>
          <p>It is not a monthly budget, a bank-balance forecast or a guarantee that funds will be available. It can only account for the figures you enter.</p>
        </section>

        <section>
          <h2>What to include</h2>
          <div className="tool-content-grid">
            <div><h3>Include</h3><ul><li>Your usable balance now</li><li>Income certain to arrive before—not on—the selected date</li><li>Known bills due in the period</li><li>One-off costs already committed</li><li>An optional amount you want to leave untouched</li></ul></div>
            <div><h3>Leave out or handle separately</h3><ul><li>Income that is only hoped for</li><li>The payday amount arriving on the selected date</li><li>Unknown future spending</li><li>Pending card payments unless your starting balance excludes them</li><li>Tax or other ring-fenced money unless you subtract it as a commitment</li></ul></div>
          </div>
        </section>

        <section>
          <h2>Why your bank balance can be misleading</h2>
          <p>A balance shows what is present at one moment. It does not label the part already spoken for by rent, utilities, insurance or a cost you have committed to but not yet paid. The calculator makes that subtraction explicit.</p>
          <p>For a simpler explanation of the core method, read <Link href="/blog/how-much-can-i-spend-before-payday">How much can I spend before payday?</Link></p>
        </section>

        <section>
          <h2>How to treat uncertain income</h2>
          <p>Use income only when you have good reason to expect both the amount and arrival date. A possible refund, unapproved invoice or extra shift is not the same as confirmed money. Leaving uncertain income out produces a more cautious result; recalculate if it becomes reliable.</p>
          <p>If your pay dates or amounts change, the method in <Link href="/blog/budgeting-irregular-income-no-payday">our irregular-income guide</Link> explains how to choose the next reliable income horizon.</p>
        </section>

        <section>
          <h2>Why a buffer is optional but useful</h2>
          <p>A buffer is an amount you decide not to count as available. It can allow for a small bill you missed, a price that changes or an ordinary surprise. There is no single correct buffer: use zero if you want to see the result before one, or enter an amount that suits the purpose of your check.</p>
        </section>

        <section>
          <h2>Use daily and weekly figures cautiously</h2>
          <p>Spending rarely happens evenly. A food shop, fuel purchase or school cost can use several notional days at once. That is why the calculator keeps the total result prominent and treats pacing figures as rough context. It does not show a weekly figure when fewer than seven days remain.</p>
        </section>

        <section>
          <h2>If the result shows a shortfall</h2>
          <p>A shortfall means the balance and confirmed income entered are less than the commitments and buffer entered. Check first for a duplicated amount or the wrong date. If the gap is real, focus on essential and priority commitments and contact providers early where appropriate.</p>
          <p>If you are worried about missing priority payments, have already missed payments or debt is becoming difficult, use <a href="https://www.moneyhelper.org.uk/en/money-troubles/dealing-with-debt/help-if-youre-struggling-with-debt" rel="noopener noreferrer">MoneyHelper's free debt guidance</a> rather than relying on this calculator alone.</p>
        </section>

        <section>
          <h2>When to recalculate</h2>
          <p>Recalculate when your balance changes materially, a bill is paid or added, confirmed income changes, or you choose a different reliable income date. The calculator stores nothing, so each calculation is a fresh snapshot.</p>
          <p>If you prefer to maintain the same manual view over time, read <Link href="/blog/budgeting-without-open-banking">Budgeting without Open Banking</Link>, learn more <Link href="/about-cleartill">about ClearTill</Link>, or check <Link href="/pricing">current ClearTill pricing</Link>.</p>
        </section>

        <section className="tool-methodology">
          <h2>Methodology and privacy</h2>
          <p><strong>Formula:</strong> current balance + confirmed income before the selected date − bills due on or before the date − one-off committed costs due on or before the date − safety buffer.</p>
          <p>Amounts are converted to whole pence before arithmetic and formatted as GBP. Each field accepts at most £1,000,000.00. Calendar dates are parsed as calendar parts rather than UTC timestamps, avoiding a one-day shift. A selected date before today is rejected. The planning period includes today and the selected end date. If today is selected, costs due today count and the result uses one day for rough pacing; income arriving today is not entered as earlier confirmed income. Pacing figures round down to the nearest penny so they do not exceed the estimated total.</p>
          <p><strong>Privacy:</strong> entries remain in browser memory for the open page. They are not sent to analytics or ClearTill, stored in local or session storage, written to cookies, placed in the URL or reused for research.</p>
          <p><strong>General information:</strong> ClearTill is not a bank, lender, payment processor or financial adviser. This calculator provides general information using the figures you enter, not personalised financial advice.</p>
        </section>

        <section>
          <h2>Frequently asked questions</h2>
          <div className="tool-faqs">
            <details><summary>Does the calculator include my payday income?</summary><p>No. The selected date is the end of the period, so do not put income arriving on that date into the “confirmed income before that date” field.</p></details>
            <details><summary>Can my current balance be negative?</summary><p>Yes. A negative, zero or positive current balance is accepted. All other money fields must be zero or positive.</p></details>
            <details><summary>Should I include food and travel?</summary><p>Include them as one-off committed costs if you have already decided that amount is needed before the selected date. Do not add them again elsewhere.</p></details>
            <details><summary>Does ClearTill see the amounts?</summary><p>No. The calculation runs locally in your browser and no entered financial values or descriptions are sent to ClearTill.</p></details>
            <details><summary>Why is there no weekly figure?</summary><p>The weekly figure appears only when at least seven calendar days remain and the result is not a shortfall.</p></details>
            <details><summary>Can I save the result?</summary><p>This free calculator deliberately does not save entries. You can run it again, or <Link href="/start">try the full ClearTill preview</Link> if you want to maintain a fuller position.</p></details>
          </div>
        </section>
      </article>
    </main>
  );
}
