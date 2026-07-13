import Link from "next/link";
import Logo from "@/components/Logo";
import HomeAuthLink from "@/components/HomeAuthLink";
import HomeTryNow from "@/app/HomeTryNow";

const TRIAL_SIGNUP_HREF = "/dashboard?auth=signup&intent=trial";

const SIMPLE_VIEW_ITEMS = [
  "what is in your account now",
  "what bills are due before you're paid",
  "how many days you need to stretch it",
  "what money is actually clear to spend",
];

const REAL_LIFE_ITEMS = [
  "feel fine when you're paid but tight before the next one",
  "forget which bills are still due",
  "have rent, utilities, council tax and subscriptions",
  "are separated parents or managing child costs",
  "do not want another complicated finance app",
  "want clarity without handing over bank access",
];

const INPUT_METHODS = [
  "typing them in",
  "pasting messy notes",
  "uploading a screenshot",
  "importing a CSV statement",
];

const FOUNDING_ITEMS = [
  "7 days free to try ClearTill properly",
  "founding member pricing at £1.99/month while subscribed",
  "direct input into what gets built next",
  "early supporter status before wider launch",
];

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-panel">
        <HomeAuthLink />

        <div className="home-hero">
          <div className="home-hero-copy">
            <Logo className="home-brand-logo" height={64} />
            <p className="eyebrow home-hero-eyebrow">Clarity before you&apos;re paid without bank access</p>
            <h1>Will your money last until you&apos;re paid?</h1>
            <p className="home-hero-copy-text">
              ClearTill shows what&apos;s actually clear to spend after bills before
              the next time you&apos;re paid, without connecting your bank.
            </p>
            <div className="home-trust-stack" aria-label="ClearTill trust">
              <span className="trust-pill">No bank login</span>
              <span className="trust-pill">No Open Banking</span>
              <span className="trust-pill">No complicated budget spreadsheets</span>
            </div>
            <div className="home-simple-view">
              <p className="home-simple-view-title">Just a simple view of:</p>
              <ul className="home-bullet-list">
                {SIMPLE_VIEW_ITEMS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="home-cta-row">
              <HomeTryNow />
              <Link className="secondary-button home-price-button" href={TRIAL_SIGNUP_HREF}>
                7 days free, then £1.99*
              </Link>
            </div>
            <p className="home-price-note">
              * Founding member monthly price. Early supporters keep this rate while subscribed.
            </p>
            <p className="home-founder-line">
              <strong>29</strong> of <strong>50</strong> founding member places remaining.
            </p>
            <p className="home-signin-line">
              Already joined? <Link href="/dashboard?auth=signin">Sign in</Link>
            </p>
          </div>

          <div className="home-feature-panel" aria-label="Paid-date view preview">
            <div className="home-paid-view">
              <div className="home-paid-view-top">
                <p className="eyebrow">Paid-date view</p>
                <span className="home-paid-badge">12 days until you&apos;re paid</span>
              </div>
              <h2>What is actually clear to spend?</h2>
              <div className="home-paid-hero-card">
                <p>Clear to spend before you&apos;re paid</p>
                <strong>£148</strong>
                <span>After bills due before 31 Jul, that leaves about £12 per day.</span>
              </div>
              <div className="home-paid-metrics">
                <article className="home-paid-metric">
                  <span>In your account now</span>
                  <strong>£521</strong>
                </article>
                <article className="home-paid-metric">
                  <span>Due before you&apos;re paid</span>
                  <strong>£373</strong>
                </article>
              </div>
              <div className="home-paid-list">
                <div className="home-paid-list-head">Bills still to land before you&apos;re paid</div>
                <article className="home-paid-list-item">
                  <div>
                    <strong>Council tax</strong>
                    <span>11 Jul</span>
                  </div>
                  <strong>£186</strong>
                </article>
                <article className="home-paid-list-item">
                  <div>
                    <strong>Broadband</strong>
                    <span>14 Jul</span>
                  </div>
                  <strong>£32</strong>
                </article>
                <article className="home-paid-list-item">
                  <div>
                    <strong>Energy</strong>
                    <span>18 Jul</span>
                  </div>
                  <strong>£94</strong>
                </article>
                <article className="home-paid-list-item">
                  <div>
                    <strong>Car insurance</strong>
                    <span>22 Jul</span>
                  </div>
                  <strong>£61</strong>
                </article>
              </div>
            </div>
          </div>
        </div>

        <section className="home-story-section">
          <p className="eyebrow">The problem</p>
          <h2>Your bank balance lies.</h2>
          <div className="home-story-grid">
            <article className="home-story-card">
              <p>You get paid.</p>
              <p>For a few days, everything feels okay.</p>
              <p>Then the bills keep landing.</p>
              <p>
                Council tax. Energy. Phone. Broadband. Subscriptions. Rent. Car
                insurance. School costs. Random direct debits you forgot about.
              </p>
            </article>
            <article className="home-story-card">
              <p>The problem is not always that you are bad with money.</p>
              <p>The problem is that your bank balance lies.</p>
              <p>It shows what is there today.</p>
              <p>It does not clearly show what is already spoken for before you&apos;re paid.</p>
            </article>
          </div>
        </section>

        <section className="home-story-section">
          <p className="eyebrow">ClearTill fixes that</p>
          <h2>One simple question: am I clear to spend this before you&apos;re paid?</h2>
          <p className="home-section-copy">
            You add when you get paid, your current balance and regular bills.
            ClearTill then shows bills due before you&apos;re paid, money left after
            those bills, daily spending room until you&apos;re paid, upcoming large
            costs and a simple paid-date forecast.
          </p>
          <div className="home-steps-grid">
            <article className="home-step-card">
              <span className="home-step-badge">01</span>
              <h3>Add the basics</h3>
              <p>Current balance, when you get paid, and regular bills without linking your bank.</p>
            </article>
            <article className="home-step-card">
              <span className="home-step-badge">02</span>
              <h3>See what is spoken for</h3>
              <p>Spot the bills that land before you&apos;re paid instead of guessing from your balance.</p>
            </article>
            <article className="home-step-card">
              <span className="home-step-badge">03</span>
              <h3>Know your real runway</h3>
              <p>See what is left, what that means per day and whether a big cost still fits.</p>
            </article>
          </div>
        </section>

        <section className="home-control-panel">
          <p className="eyebrow">No bank login</p>
          <h2>You stay in control.</h2>
          <p className="home-section-copy">
            ClearTill is designed for people who do not want to connect their bank.
            You can add bills by:
          </p>
          <div className="home-methods-row">
            {INPUT_METHODS.map((item) => (
              <span className="home-method-pill" key={item}>{item}</span>
            ))}
          </div>
          <p className="home-section-copy home-control-note">
            ClearTill helps clean it up and turn it into a simple paid-date view.
          </p>
        </section>

        <section className="home-story-section">
          <p className="eyebrow">Built for real life</p>
          <h2>For people who want clarity, not another finance app.</h2>
          <div className="home-real-life-grid">
            {REAL_LIFE_ITEMS.map((item) => (
              <article className="home-real-life-item" key={item}>
                <span aria-hidden="true">•</span>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-offer-panel" id="beta-offer">
          <div className="home-offer-copy">
            <p className="eyebrow">Founding member offer</p>
            <h2>7 days free, then £1.99* to keep your paid-date view up to date.</h2>
            <p className="home-section-copy">
              This is an early version, so founding users get the free trial, early
              founder pricing if ClearTill launches fully, direct input into what
              gets built next, and early access before the wider launch.
            </p>
            <ul className="home-bullet-list home-bullet-list-wide">
              {FOUNDING_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <aside className="home-offer-card">
            <strong className="home-offer-price">£1.99*</strong>
            <p className="eyebrow home-offer-subhead">Founding member monthly price</p>
            <p>
              Try ClearTill free for 7 days. See what bills are due before you&apos;re
              paid and know what money is really clear to spend.
            </p>
            <Link className="primary-button home-offer-button" href={TRIAL_SIGNUP_HREF}>
              Start 7-day free trial
            </Link>
          </aside>
        </section>

        <p className="home-disclaimer">
          * Founding member price while subscribed. ClearTill isn&apos;t financial advice.
          It&apos;s simple arithmetic on numbers you enter.
        </p>
      </section>
    </main>
  );
}
