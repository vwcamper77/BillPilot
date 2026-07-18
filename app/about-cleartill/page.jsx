import Link from "next/link";
import Logo from "@/components/Logo";
import { createPageMetadata, HOME_URL } from "@/lib/seo";

const DESCRIPTION = "Learn what ClearTill is, who it is for, and how GMBF Ventures Ltd operates this UK cashflow-planning app without bank login or Open Banking.";

export const metadata = createPageMetadata({
  title: "About ClearTill",
  description: DESCRIPTION,
  path: "/about-cleartill",
});

export default function AboutClearTillPage() {
  return (
    <main className="marketing-page">
      <header className="acquisition-header">
        <Link href="/" aria-label="ClearTill home"><Logo className="acquisition-logo" height={40} /></Link>
        <nav aria-label="Main navigation"><Link href="/pricing">Pricing</Link><Link href="/signin">Sign in</Link></nav>
      </header>

      <section className="marketing-hero about-hero">
        <p className="acquisition-eyebrow">About ClearTill</p>
        <h1>A clearer answer than your balance alone can give</h1>
        <p>ClearTill is a UK consumer cashflow-planning app. It shows what is safe to spend after bills until your next income date.</p>
        <Link className="marketing-primary-button" href="/start">Check my position free</Link>
      </section>

      <section className="about-sections">
        <article><p className="about-number">01</p><div><h2>What ClearTill does</h2><p>A balance shows what is in an account now, but not what is already committed. ClearTill brings your current balance, next income date and upcoming costs into one position so you can see what remains after the bills you have entered.</p></div></article>
        <article><p className="about-number">02</p><div><h2>Who ClearTill is for</h2><p>ClearTill is designed for UK consumers who want a straightforward view of the period between today and their next income date, including people paid monthly, weekly, irregularly or from more than one source.</p></div></article>
        <article><p className="about-number">03</p><div><h2>You control the information</h2><p>ClearTill is deliberately manual. It does not require a bank login or use Open Banking. You decide which balance, income dates, bills and one-off costs to enter, and you control when those figures are updated.</p></div></article>
        <article><p className="about-number">04</p><div><h2>What ClearTill is not</h2><p>ClearTill is not a bank, lender, payment processor or financial adviser. It does not move money or recommend financial products. Its results are estimates based on the information you provide and are not financial advice.</p></div></article>
      </section>

      <section className="company-panel">
        <div><p className="acquisition-eyebrow">Who operates ClearTill</p><h2>GMBF Ventures Ltd</h2></div>
        <div>
          <p>ClearTill is operated by GMBF Ventures Ltd, registered in England and Wales under company number 17286832.</p>
          <p>The official ClearTill website is <a href={HOME_URL}>cleartill.money</a>. For product or support questions, email <a href="mailto:hello@cleartill.money">hello@cleartill.money</a>.</p>
        </div>
      </section>

      <section className="about-links" aria-label="ClearTill policies and contact">
        <Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/security">Security</Link><a href="mailto:hello@cleartill.money">Contact</a>
      </section>
    </main>
  );
}
