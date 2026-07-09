import Link from "next/link";
import Logo from "@/components/Logo";
import HeroFoundingCta from "./HeroFoundingCta";
import { getFoundingMemberCount } from "@/lib/billingAccess.server";

export const revalidate = 30;

const SAFE_POINTS = [
  "what is in your account now",
  "what bills are due before payday",
  "how many days you need to stretch it",
  "what money is actually safe to spend",
];

const INPUT_OPTIONS = [
  "typing them in",
  "pasting messy notes",
  "uploading a screenshot",
  "importing a CSV statement",
];

const REAL_LIFE_POINTS = [
  "feel fine on payday but tight before the next one",
  "forget which bills are still due",
  "have rent, utilities, council tax and subscriptions",
  "are separated parents or managing child costs",
  "do not want another complicated finance app",
  "want clarity without handing over bank access",
];

const FOUNDING_POINTS = [
  "30 days access",
  "direct input into what gets built next",
  "early founder pricing if ClearTill launches fully",
  "your \u00A35 credited against your first paid plan",
];

const DUE_BILLS = [
  { name: "Council tax", due: "11 Jul", amount: "\u00A3186" },
  { name: "Broadband", due: "14 Jul", amount: "\u00A332" },
  { name: "Energy", due: "18 Jul", amount: "\u00A394" },
  { name: "Car insurance", due: "22 Jul", amount: "\u00A361" },
];

export default async function HomePage() {
  const foundingCount = await getFoundingMemberCount();

  return (
    <main className="landing-shell">
      <header className="landing-header">
        <Logo className="landing-logo" height={56} />
        <Link className="landing-signin-link" href="/dashboard?auth=signin">
          Sign in
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="landing-kicker">Payday clarity without bank access</p>
          <h1>Will your money last until payday?</h1>
          <p className="landing-lead">
            ClearTill shows what&rsquo;s actually safe to spend after bills before your
            next payday &mdash; without connecting your bank.
          </p>
          <div className="landing-pill-row" aria-label="No bank login required">
            <span className="trust-pill">No bank login</span>
            <span className="trust-pill">No Open Banking</span>
            <span className="trust-pill">No complicated budget spreadsheets</span>
          </div>
          <p className="landing-support">Just a simple view of:</p>
          <ul className="landing-checklist">
            {SAFE_POINTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <HeroFoundingCta foundingCount={foundingCount} />
          <p className="landing-signin-note">
            Already joined?{" "}
            <Link href="/dashboard?auth=signin">
              Sign in
            </Link>
          </p>
        </div>

        <aside className="landing-hero-card" aria-label="Sample ClearTill payday view">
          <div className="landing-hero-card-top">
            <div>
              <p className="landing-card-label">Payday view</p>
              <h2>What is actually safe to spend?</h2>
            </div>
            <span className="landing-card-chip">12 days to payday</span>
          </div>

          <div className="landing-amount-panel">
            <span>Safe to spend before payday</span>
            <strong>{"\u00A3148"}</strong>
            <p>After bills due before 31 Jul, that leaves about {"\u00A312"} per day.</p>
          </div>

          <div className="landing-metric-grid">
            <article>
              <span>In your account now</span>
              <strong>{"\u00A3521"}</strong>
            </article>
            <article>
              <span>Due before payday</span>
              <strong>{"\u00A3373"}</strong>
            </article>
          </div>

          <div className="landing-bills-preview">
            <div className="landing-bills-preview-head">
              <span>Bills still to land before payday</span>
            </div>
            <ul>
              {DUE_BILLS.map((bill) => (
                <li key={bill.name}>
                  <div>
                    <strong>{bill.name}</strong>
                    <span>{bill.due}</span>
                  </div>
                  <strong>{bill.amount}</strong>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </section>

      <section className="landing-section">
        <div className="landing-section-heading">
          <p className="eyebrow">The problem</p>
          <h2>Your bank balance lies.</h2>
        </div>
        <div className="landing-problem-grid">
          <div className="landing-panel">
            <p>You get paid.</p>
            <p>For a few days, everything feels okay.</p>
            <p>Then the bills keep landing.</p>
            <p>
              Council tax. Energy. Phone. Broadband. Subscriptions. Rent. Car insurance.
              School costs. Random direct debits you forgot about.
            </p>
          </div>
          <div className="landing-panel">
            <p>The problem is not always that you are bad with money.</p>
            <p>The problem is that your bank balance lies.</p>
            <p>It shows what is there today.</p>
            <p>It does not clearly show what is already spoken for before payday.</p>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-heading">
          <p className="eyebrow">ClearTill fixes that</p>
          <h2>One simple question: can I safely spend this before payday?</h2>
          <p className="landing-section-copy">
            You add your payday, current balance and regular bills. ClearTill then shows
            bills due before payday, money left after those bills, daily spending room
            until payday, upcoming large costs and a simple payday forecast.
          </p>
        </div>
        <div className="landing-feature-grid">
          <article className="landing-feature-card">
            <span>01</span>
            <h3>Add the basics</h3>
            <p>Current balance, payday and regular bills without linking your bank.</p>
          </article>
          <article className="landing-feature-card">
            <span>02</span>
            <h3>See what is spoken for</h3>
            <p>Spot the bills that land before payday instead of guessing from your balance.</p>
          </article>
          <article className="landing-feature-card">
            <span>03</span>
            <h3>Know your real runway</h3>
            <p>See what is left, what that means per day and whether a big cost still fits.</p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-section-alt">
        <div className="landing-section-heading">
          <p className="eyebrow">No bank login</p>
          <h2>You stay in control.</h2>
          <p className="landing-section-copy">
            ClearTill is designed for people who do not want to connect their bank. You can
            add bills by:
          </p>
        </div>
        <div className="landing-input-grid">
          {INPUT_OPTIONS.map((item) => (
            <div className="landing-input-card" key={item}>
              {item}
            </div>
          ))}
        </div>
        <p className="landing-section-note">
          ClearTill helps clean it up and turn it into a simple payday view.
        </p>
      </section>

      <section className="landing-section">
        <div className="landing-section-heading">
          <p className="eyebrow">Built for real life</p>
          <h2>For people who want clarity, not another finance app.</h2>
        </div>
        <ul className="landing-audience-list">
          {REAL_LIFE_POINTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="landing-section" id="beta-offer">
        <div className="landing-offer-card">
          <div className="landing-offer-copy">
            <p className="eyebrow">Founding beta offer</p>
            <h2>Get 30 days of ClearTill beta access for {"\u00A35"}.</h2>
            <p>
              This is an early version, so founding users get 30 days access, direct input
              into what gets built next, early founder pricing if ClearTill launches fully,
              and their {"\u00A35"} credited against their first paid plan.
            </p>
            <ul className="landing-offer-list">
              {FOUNDING_POINTS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="landing-offer-cta">
            <p className="landing-offer-price">{"\u00A35"}</p>
            <p className="landing-offer-caption">30 days early access</p>
            <p className="landing-offer-body">
              See what bills are due before payday. Know what money is really safe to spend.
              No bank login.
            </p>
            <Link className="primary-link landing-offer-button" href="/billing">
              Try ClearTill for {"\u00A35"}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
