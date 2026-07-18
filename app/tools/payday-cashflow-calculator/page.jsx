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
        <p>Divide the cash you have available now across the days until payday. Future wages are not added to the calculation.</p>
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
          <h2>A simple daily amount from the cash you have now</h2>
          <p>The calculator divides the amount you enter by the number of calendar days from today through your selected payday. For example, £300 across 12 days is £25 per day.</p>
          <p>It does not add the pay due on payday—or any other future income—because that money is not available now.</p>
        </section>

        <section>
          <h2>What amount should you enter?</h2>
          <p>Enter the cash you can actually use between now and payday. If part of your current bank balance is already reserved for bills or committed costs, take those amounts off before entering the figure.</p>
          <p>If you need ClearTill to account for individual bills and one-off costs, use the <Link href="/start">full ClearTill preview</Link>. The free calculator deliberately keeps this check simple.</p>
        </section>

        <section>
          <h2>Use the daily figure as a guide</h2>
          <p>Real spending does not happen evenly: a food shop or travel cost may use several days&apos; worth at once. The result is straightforward division, not a guarantee or a personalised spending recommendation.</p>
          <p>For more context, read <Link href="/blog/how-much-can-i-spend-before-payday">How much can I spend before payday?</Link> or the <Link href="/blog/budgeting-irregular-income-no-payday">irregular-income guide</Link>.</p>
        </section>

        <section className="tool-methodology">
          <h2>Methodology and privacy</h2>
          <p><strong>Formula:</strong> cash available now ÷ calendar days through payday = available cash per day.</p>
          <p>Amounts are converted to whole pence before arithmetic and formatted as GBP. The result rounds down to the nearest penny so the daily amounts do not exceed the cash entered. The planning period includes today and the selected payday.</p>
          <p><strong>Privacy:</strong> entries remain in browser memory for the open page. They are not sent to analytics or ClearTill, stored locally, placed in cookies or added to the URL.</p>
          <p><strong>General information:</strong> ClearTill is not a bank, lender, payment processor or financial adviser. This calculator performs simple arithmetic using the figures you enter; it is not financial advice.</p>
        </section>

        <section>
          <h2>Frequently asked questions</h2>
          <div className="tool-faqs">
            <details><summary>Does the calculator include my payday income?</summary><p>No. It divides only the cash you have available now. Pay arriving on payday is not added.</p></details>
            <details><summary>Should I take bills off first?</summary><p>Yes, if those bills must be paid from the cash currently in your account. Enter only the amount left for use between now and payday.</p></details>
            <details><summary>Does ClearTill see the amount?</summary><p>No. The calculation runs locally in your browser and the amount is not sent to ClearTill.</p></details>
            <details><summary>Can I save the result?</summary><p>This free calculator does not save entries. You can run it again, or <Link href="/start">try the full ClearTill preview</Link> to maintain a fuller position.</p></details>
          </div>
        </section>
      </article>
    </main>
  );
}
