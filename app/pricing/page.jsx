import Link from "next/link";
import Logo from "@/components/Logo";
import PricingAction from "./PricingAction";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "ClearTill Pricing",
  description: "Compare ClearTill's free live preview, monthly plan and annual plan for keeping your cashflow position current.",
  path: "/pricing",
});

const plans = [
  {
    name: "Free live preview",
    plan: "free",
    price: "£0",
    note: "No card required",
    points: ["One complete position", "Seven days of balance updates and recalculation", "Preview reminders", "Read-only result after expiry"],
  },
  {
    name: "Annual",
    plan: "annual",
    badge: "Best value",
    price: "£24.99 per year",
    note: "Paid upfront · approximately £2.08 per month",
    saving: "Saves £22.89 compared with twelve monthly payments",
    points: ["Ongoing live positions", "Recurring costs carried forward", "Ongoing reminders", "Cancel from account"],
  },
  {
    name: "Monthly",
    plan: "monthly",
    price: "£3.99 per month",
    points: ["Ongoing live positions", "Recurring costs carried forward", "Ongoing reminders", "Cancel from account"],
  },
];

export default function PricingPage() {
  const annualConfigured = Boolean(process.env.STRIPE_ANNUAL_PRICE_ID);
  return (
    <main className="marketing-page">
      <header className="acquisition-header">
        <Link href="/" aria-label="ClearTill home"><Logo className="acquisition-logo" height={40} /></Link>
        <nav aria-label="Main navigation"><Link href="/about-cleartill">About</Link><Link href="/signin">Sign in</Link></nav>
      </header>

      <section className="marketing-hero">
        <p className="acquisition-eyebrow">Clear pricing</p>
        <h1>See your position before choosing a plan</h1>
        <p>Build one complete position and keep it live for seven days. No card is needed for the preview, and paid checkout starts only when you choose it later.</p>
      </section>

      <section className="pricing-grid" aria-label="ClearTill plans">
        {plans.map((plan) => (
          <article className={plan.badge ? "pricing-card pricing-card-featured" : "pricing-card"} key={plan.name}>
            {plan.badge ? <span className="pricing-badge">{plan.badge}</span> : null}
            <p className="pricing-name">{plan.name}</p>
            <h2>{plan.price}</h2>
            {plan.note ? <p className="pricing-note">{plan.note}</p> : null}
            {plan.saving ? <p className="pricing-saving">{plan.saving}</p> : null}
            <ul>{plan.points.map((point) => <li key={point}>{point}</li>)}</ul>
            <PricingAction plan={plan.plan} configured={plan.plan !== "annual" || annualConfigured} />
          </article>
        ))}
      </section>

      <section className="marketing-faq">
        <div><p className="acquisition-eyebrow">Questions</p><h2>What to expect</h2></div>
        <div>
          <details open><summary>When does the preview start?</summary><p>Your seven-day preview starts only when you save your first complete position, after adding your balance, payday and upcoming costs.</p></details>
          <details><summary>Do I need a card for the preview?</summary><p>No. Account creation and the free live preview do not ask for payment details.</p></details>
          <details><summary>What happens when the preview expires?</summary><p>Live updates and reminders stop. Your last result remains available as a read-only position so you can decide whether to continue.</p></details>
          <details><summary>How does annual billing work?</summary><p>The annual plan is £24.99 paid upfront for a year. That is approximately £2.08 per month and saves £22.89 against twelve monthly payments.</p></details>
          <details><summary>Can I cancel?</summary><p>Yes. Monthly and annual members can cancel from their account. Cancellation prevents the next renewal; it does not retrospectively refund time already paid for.</p></details>
          <details><summary>Does ClearTill connect to my bank?</summary><p>No. There is no bank connection or Open Banking. ClearTill calculates from the balance, dates and costs you enter.</p></details>
          <details><summary>What information does ClearTill retain?</summary><p>Your account retains the information you enter so you can return and update your position. You can export, reset or delete your data from your account controls. See the <Link href="/privacy">Privacy Notice</Link> for details.</p></details>
          <details><summary>Is ClearTill financial advice?</summary><p>No. ClearTill is a cashflow planning tool that performs arithmetic on information you provide. Its results are estimates, not financial advice or a guarantee of available funds.</p></details>
        </div>
      </section>
    </main>
  );
}
