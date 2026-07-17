import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "About ClearTill",
  description: "Why ClearTill exists, how it works and the limits of its manual cashflow positions.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="marketing-page">
      <header className="acquisition-header">
        <Link href="/" aria-label="ClearTill home"><Logo className="acquisition-logo" height={40} /></Link>
        <nav aria-label="Main navigation"><Link href="/pricing">Pricing</Link><Link href="/signin">Sign in</Link></nav>
      </header>

      <section className="marketing-hero about-hero">
        <p className="acquisition-eyebrow">About ClearTill</p>
        <h1>A clearer answer than your balance alone can give</h1>
        <p>ClearTill is a calm, manual cashflow tool for one practical question: what is left after the costs still due before payday?</p>
        <Link className="marketing-primary-button" href="/start">Check my position free</Link>
      </section>

      <section className="about-sections">
        <article><p className="about-number">01</p><div><h2>Why ClearTill exists</h2><p>A bank balance shows what is in an account now, but not what is already spoken for. ClearTill brings your current balance, next pay and upcoming costs into one position so the subtraction is visible.</p></div></article>
        <article><p className="about-number">02</p><div><h2>How ClearTill works</h2><p>You add a current balance, payday and the bills or one-off costs still ahead. ClearTill estimates what remains and recalculates when you update the figures. The quality of the position depends on the information being complete and current.</p></div></article>
        <article><p className="about-number">03</p><div><h2>Why it does not connect to a bank</h2><p>ClearTill is deliberately manual. It does not ask for online banking credentials and does not use Open Banking. You decide which figures to enter, can see what drives the result and stay in control of updates.</p></div></article>
        <article><p className="about-number">04</p><div><h2>What ClearTill is not</h2><p>ClearTill is not a bank, lender, budgeting account or financial adviser. It does not move money, recommend financial products or guarantee that funds will be available. Its results are estimates based on your entries.</p></div></article>
      </section>

      <section className="company-panel">
        <div><p className="acquisition-eyebrow">Who operates ClearTill</p><h2>GMBF Ventures Ltd</h2></div>
        <div><p>ClearTill is a product from GMBF Ventures Ltd, registered in England and Wales under company number 17286832.</p><p>Registered office: 124 City Road, London, EC1V 2NX, United Kingdom.</p></div>
      </section>

      <section className="about-links" aria-label="ClearTill policies and contact">
        <Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/security">Security</Link><a href="mailto:hello@cleartill.money">Contact</a>
      </section>
    </main>
  );
}
