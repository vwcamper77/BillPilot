import Link from "next/link";
import Logo from "@/components/Logo";
import {
  HOME_DESCRIPTION,
  HOME_TITLE,
  HOME_URL,
  LOGO_URL,
  SOCIAL_IMAGE,
  SOCIAL_IMAGE_URL,
} from "@/lib/seo";
import {
  createGmbfOrganizationSchema,
  GMBF_ORGANIZATION_ID,
} from "@/lib/productFamily";

const PREVIEW_HREF = "/start";

export const metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "ClearTill",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    locale: "en_GB",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: [SOCIAL_IMAGE_URL],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      ...createGmbfOrganizationSchema(),
    },
    {
      "@type": "Brand",
      "@id": `${HOME_URL}#brand`,
      name: "ClearTill",
      url: HOME_URL,
      logo: LOGO_URL,
      description: "ClearTill is a UK consumer cashflow-planning app that shows what is safe to spend after bills until the next income date.",
    },
    {
      "@type": "WebSite",
      "@id": `${HOME_URL}#website`,
      name: "ClearTill",
      url: HOME_URL,
      publisher: { "@id": GMBF_ORGANIZATION_ID },
      about: { "@id": `${HOME_URL}#brand` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${HOME_URL}#application`,
      name: "ClearTill",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      url: HOME_URL,
      description: "A UK consumer cashflow-planning web app that shows what is safe to spend after bills until the next income date, without bank login or Open Banking.",
      brand: { "@id": `${HOME_URL}#brand` },
      publisher: { "@id": GMBF_ORGANIZATION_ID },
      provider: { "@id": GMBF_ORGANIZATION_ID },
    },
    {
      "@type": "Person",
      name: "Gavin Ferns",
      jobTitle: "Founder of ClearTill",
      worksFor: { "@id": GMBF_ORGANIZATION_ID },
      url: "https://www.cleartill.money/about-cleartill",
    },
  ],
};

const CTA = ({ className = "" }) => (
  <Link className={`live-home-button live-home-button-primary ${className}`.trim()} href={PREVIEW_HREF}>
    Check my position free
  </Link>
);

export default function HomePage() {
  return (
    <main className="live-home">
      <link rel="canonical" href={HOME_URL} />
      <meta property="og:url" content={HOME_URL} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <header className="live-home-container live-home-header">
        <Logo className="live-home-logo" height={42} />
        <nav className="live-home-nav" aria-label="Main navigation">
          <Link href="/pricing">Pricing</Link>
          <Link href="/about-cleartill">About</Link>
          <Link className="live-home-signin" href="/signin">Sign in</Link>
        </nav>
      </header>

      <section className="live-home-container live-home-hero">
        <div>
          <p className="live-home-eyebrow">No bank connection. No card required.</p>
          <h1>Know what&apos;s really left before payday</h1>
          <p className="live-home-hero-copy">
            Add your current balance, next payday and the bills still to come. ClearTill shows what
            remains after those costs — and an estimated daily spending amount.
          </p>
          <div className="live-home-cta-row"><CTA /></div>
          <p className="live-home-microcopy">
            <strong>Your live preview starts when your first position is saved.</strong> It pauses
            automatically after seven days. Nothing is charged and no card is requested.
          </p>
          <div className="live-home-trust-row">
            <span>No bank login</span><span>No Open Banking</span><span>You control the numbers</span>
          </div>
        </div>

        <div className="live-home-product-shell" aria-label="Example ClearTill result">
          <div className="live-home-product-card">
            <div className="live-home-product-head">
              <div><p className="live-home-eyebrow">Example position</p><strong>12 days until payday</strong></div>
              <span className="live-home-status">Updated today</span>
            </div>
            <div className="live-home-result">
              <p>Clear after your listed bills</p><strong>£148</strong>
              <span>Estimated £12 per day</span>
            </div>
            <div className="live-home-metrics">
              <div><span>Current balance</span><strong>£521</strong></div>
              <div><span>Bills before payday</span><strong>£373</strong></div>
            </div>
            <p className="live-home-product-foot">
              Based on four listed bills. ClearTill uses the figures you enter and does not connect to your bank.
            </p>
          </div>
        </div>
      </section>

      <section className="live-home-container live-home-proof" aria-label="ClearTill preview summary">
        <article><strong>See a complete first position</strong><p>Add every bill and one-off cost needed for an honest result.</p></article>
        <article><strong>Keep it live for seven days</strong><p>Update your balance as real life changes and watch the position recalculate.</p></article>
        <article><strong>Receive useful check-ins</strong><p>Get prompts to update stale figures or add a cost you may have missed.</p></article>
      </section>

      <section className="live-home-band live-home-dark">
        <div className="live-home-container">
          <p className="live-home-eyebrow">The problem</p>
          <h2>Your balance shows what is there. Not what is already spoken for.</h2>
          <p className="live-home-section-copy">A bank balance can look healthy while rent, council tax, energy and subscriptions are still waiting to land. ClearTill makes the subtraction visible.</p>
          <p><Link className="live-home-dark-link" href="/tools/payday-cashflow-calculator">Use the free payday cashflow calculator</Link></p>
          <div className="live-home-three-grid live-home-problem-grid">
            <article><span>In the account</span><strong>£521</strong><p>The number you can see today.</p></article>
            <article><span>Still due before payday</span><strong>− £373</strong><p>The bills and one-off costs you have listed.</p></article>
            <article><span>Actually clear</span><strong className="live-home-green">£148</strong><p>An estimated £12 per day for the next 12 days.</p></article>
          </div>
        </div>
      </section>

      <section className="live-home-band" id="how-it-works">
        <div className="live-home-container">
          <p className="live-home-eyebrow">How ClearTill works</p>
          <h2>Three steps. No bank login.</h2>
          <p className="live-home-section-copy">ClearTill is deliberately manual: you decide what goes in, and you can see exactly how the result was calculated.</p>
          <div className="live-home-three-grid live-home-steps">
            <article><span>01</span><h3>Add the basics</h3><p>Enter your current balance and the date you are next paid.</p></article>
            <article><span>02</span><h3>Add what is still coming</h3><p>Include regular bills, subscriptions and any one-off costs before payday.</p></article>
            <article><span>03</span><h3>Keep the position current</h3><p>Update your balance when you spend or a bill clears. ClearTill recalculates the result.</p></article>
          </div>
        </div>
      </section>

      <section className="live-home-container live-home-founder" aria-labelledby="home-founder-heading">
        <p className="live-home-eyebrow">Created by Gavin Ferns</p>
        <h2 id="home-founder-heading">Built from practical financial planning experience.</h2>
        <p>
          Gavin is a project and commercial professional with a background in construction finance and an Executive MBA from Imperial College Business School. He created ClearTill to simplify one everyday question: what is actually left after bills until the next income date?
        </p>
        <Link href="/about-cleartill">Read about Gavin and ClearTill</Link>
      </section>

      <section className="live-home-band live-home-reminders">
        <div className="live-home-container">
          <p className="live-home-eyebrow">More than a one-off calculator</p>
          <h2>Reminders help the number stay useful.</h2>
          <p className="live-home-section-copy">The preview gives ClearTill time to prove its value: not only with the first calculation, but by helping you keep it accurate as the week changes.</p>
          <div className="live-home-three-grid live-home-reminder-grid">
            <article><div><span>● ClearTill</span><span>Day 2</span></div><h3>Has your balance changed?</h3><p>Your position was last updated two days ago. Refresh it and add any new costs.</p></article>
            <article><div><span>● ClearTill</span><span>Day 4</span></div><h3>Anything still to add?</h3><p>Check for one-off costs, subscriptions or bills you did not include the first time.</p></article>
            <article><div><span>● ClearTill</span><span>Day 6</span></div><h3>Your live preview ends tomorrow</h3><p>Your result stays visible, but live updates and reminders pause unless you continue.</p></article>
          </div>
        </div>
      </section>

      <section className="live-home-band">
        <div className="live-home-container live-home-privacy">
          <div>
            <p className="live-home-eyebrow">Privacy by design</p>
            <h2>You stay in control.</h2>
            <p className="live-home-section-copy">ClearTill does not need your online banking password or an Open Banking connection. Its estimate is based only on the figures you choose to enter.</p>
            <p className="live-home-entity-copy">ClearTill is a UK cashflow-planning app from GMBF Ventures Ltd. It helps you see what is safe to spend after bills until your next income date.</p>
            <Link className="live-home-company-link" href="/about-cleartill">About ClearTill and the company behind it</Link>
          </div>
          <div className="live-home-privacy-list">
            <article><span>✓</span><p><strong>No bank login</strong><br />ClearTill does not ask for online banking credentials.</p></article>
            <article><span>✓</span><p><strong>No automatic charges in the preview</strong><br />There is no card entry and nothing renews automatically.</p></article>
            <article><span>✓</span><p><strong>Amounts can stay out of email previews</strong><br />Exact figures appear in the app unless you explicitly choose otherwise.</p></article>
          </div>
        </div>
      </section>

      <section className="live-home-band live-home-preview">
        <div className="live-home-container">
          <p className="live-home-eyebrow">See value before choosing a plan</p>
          <h2>A seven-day live preview. No card required.</h2>
          <p className="live-home-section-copy">The first result is not artificially limited. Add the bills needed for an accurate position, update it throughout the week and receive the reminder sequence. After day seven, the result becomes read-only unless you subscribe.</p>
          <div className="live-home-pricing">
            <article>
              <p className="live-home-eyebrow">Live preview</p><div className="live-home-price">£0</div><p>No card. No automatic charge.</p>
              <ul><li>One complete cash position</li><li>All bills and one-off costs</li><li>Unlimited balance updates for seven days</li><li>Useful preview reminders</li><li>Read-only result after expiry</li></ul>
            </article>
            <article className="live-home-featured">
              <span className="live-home-recommended">Best value</span><p className="live-home-eyebrow">Keep ClearTill live</p><div className="live-home-price">£24.99 <small>/ year</small></div><p>Or £3.99 monthly. The annual plan is equivalent to about £2.08 per month.</p>
              <ul><li>Continuous balance updates and recalculation</li><li>Recurring bills carried into future payday cycles</li><li>Ongoing reminders and bill check-ins</li><li>Position history as it is developed</li><li>Cancel from your account</li></ul>
              <CTA className="live-home-card-cta" />
            </article>
          </div>
        </div>
      </section>

      <section className="live-home-band">
        <div className="live-home-container live-home-faq">
          <div><p className="live-home-eyebrow">Questions</p><h2>Clear terms before you begin.</h2></div>
          <div>
            <details open><summary>Will ClearTill connect to my bank?</summary><p>No. You enter the balance, payday and costs that ClearTill uses. That keeps the calculation transparent, but it also means you need to keep the figures current.</p></details>
            <details><summary>When does the seven-day preview begin?</summary><p>When you save your first complete position — not when you first land on the site.</p></details>
            <details><summary>What happens after seven days?</summary><p>Live updates and reminders pause. Your last result remains visible as read-only and is clearly marked as out of date. Nothing is charged.</p></details>
            <details><summary>Is the result guaranteed?</summary><p>No. It is an estimate based on the amounts and dates you enter. Missing or outdated costs will change the result.</p></details>
            <details><summary>Is ClearTill financial advice?</summary><p>No. ClearTill performs straightforward arithmetic on the information you provide. It does not recommend financial products or make decisions for you.</p></details>
          </div>
        </div>
      </section>

      <section className="live-home-container live-home-final">
        <p className="live-home-eyebrow">Your first position costs nothing</p><h2>Stop guessing what your balance has to cover.</h2>
        <p>See the bills still in front of you, the money left afterwards and an estimated amount per day — without connecting your bank or entering a card.</p><CTA />
      </section>

    </main>
  );
}
