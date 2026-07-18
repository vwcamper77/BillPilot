import Link from "next/link";
import Image from "next/image";
import Logo from "@/components/Logo";
import { SOCIAL_IMAGE, SOCIAL_IMAGE_URL, SITE_URL } from "@/lib/seo";

const TITLE = "About Gavin Ferns, Founder of ClearTill";
const DESCRIPTION = "Meet Gavin Ferns, the founder of ClearTill, and learn why he created a simpler way to understand what remains after bills until the next income date.";
const PAGE_URL = `${SITE_URL}/about-cleartill`;

export const metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    type: "website",
    siteName: "ClearTill",
    title: TITLE,
    description: DESCRIPTION,
    url: PAGE_URL,
    locale: "en_GB",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SOCIAL_IMAGE_URL],
  },
};

export default function AboutClearTillPage() {
  return (
    <main className="marketing-page founder-about">
      <header className="acquisition-header">
        <Link href="/" aria-label="ClearTill home"><Logo className="acquisition-logo" height={40} /></Link>
        <nav aria-label="Main navigation"><Link href="/pricing">Pricing</Link><Link href="/signin">Sign in</Link></nav>
      </header>

      <section className="marketing-hero about-hero">
        <p className="acquisition-eyebrow">The founder story</p>
        <h1>About ClearTill and its founder Gavin Ferns</h1>
        <p className="about-question-intro">ClearTill was created around one simple question:</p>
        <blockquote>“How much of the money in my account is actually available after the bills due before my next income date?”</blockquote>
        <p>
          Most people usually know their approximate bank balance. The harder problem is understanding what remains after bills, committed costs and amounts they want to protect.
        </p>
      </section>

      <section className="about-product-summary" aria-labelledby="cleartill-summary-heading">
        <div>
          <p className="acquisition-eyebrow">A clear position</p>
          <h2 id="cleartill-summary-heading">What ClearTill makes simpler</h2>
          <p>
            ClearTill brings the figures that matter into one forward-looking view. It is designed for people who prefer to enter and control their own information rather than connect their financial accounts.
          </p>
          <p>Users do not need to connect a bank account, provide bank-login credentials or use Open Banking.</p>
        </div>
        <ul>
          <li>Update a current balance.</li>
          <li>Maintain a list of bills and committed costs.</li>
          <li>Enter the next income date.</li>
          <li>See what remains before that date.</li>
          <li>View a rough daily pacing figure where appropriate.</li>
        </ul>
      </section>

      <div className="founder-story-sections">
        <section aria-labelledby="about-gavin-heading">
          <p className="about-number">01</p>
          <div className="founder-profile">
            <div>
              <h2 id="about-gavin-heading">About Gavin Ferns</h2>
              <p>
                ClearTill was founded by Gavin Ferns, a project and commercial professional with a background in construction, infrastructure, commercial management and financial management.
              </p>
              <p>
                Gavin has worked across major UK rail and construction programmes, where budgets, commitments, forecasts and changing financial positions form part of everyday decision-making. He also holds an Executive MBA from Imperial College Business School and has a longstanding interest in innovation, technology and practical problem-solving.
              </p>
              <p>
                ClearTill applies that experience to a personal cashflow problem: understanding what is genuinely left after the costs that need to be covered.
              </p>
            </div>
            <figure>
              <Image
                src="/founder/gavin-ferns.jpg"
                alt="Gavin Ferns, founder of ClearTill"
                width={640}
                height={640}
                sizes="(max-width: 560px) calc(100vw - 48px), 260px"
              />
              <figcaption>Gavin Ferns, founder of ClearTill</figcaption>
            </figure>
          </div>
        </section>

        <section aria-labelledby="product-builder-heading">
          <p className="about-number">02</p>
          <div>
            <h2 id="product-builder-heading">From complex projects to simple products</h2>
            <p>Gavin is also an independent product builder who uses modern AI-assisted development tools to turn ideas into working digital products.</p>
            <p>Before ClearTill, he launched TalosTV and SetTheDate. ClearTill is his third independently developed software product.</p>
            <p>The objective is not to create another complicated budgeting system. It is to make one important calculation understandable and useful.</p>
          </div>
        </section>

        <section aria-labelledby="outside-cleartill-heading">
          <p className="about-number">03</p>
          <div>
            <h2 id="outside-cleartill-heading">Outside ClearTill</h2>
            <p>Outside work and product development, Gavin has two degrees, owns a campervan and has a strong interest in adventure travel and motorcycling.</p>
          </div>
        </section>
      </div>

      <section className="about-principles" aria-labelledby="principles-heading">
        <div>
          <p className="acquisition-eyebrow">Product principles</p>
          <h2 id="principles-heading">Why ClearTill is different</h2>
        </div>
        <ol>
          <li><strong>Clarity over complexity.</strong><span>One useful answer without turning everyday cashflow into a complicated budgeting system.</span></li>
          <li><strong>User control over automatic account access.</strong><span>You choose the information to enter and when to update it.</span></li>
          <li><strong>Forward planning.</strong><span>The focus is on costs still to come, rather than only analysing historic transactions.</span></li>
          <li><strong>Clear distinctions.</strong><span>Current balance, protected costs, future income, clear-to-spend amount and possible shortfall are kept separate.</span></li>
        </ol>
      </section>

      <section className="company-panel" aria-labelledby="company-heading">
        <div><p className="acquisition-eyebrow">Company information</p><h2 id="company-heading">ClearTill</h2></div>
        <div>
          <p>ClearTill is operated by GMBF Ventures Ltd.<br />Company number: 17286832.</p>
          <p>Official website: <a href={SITE_URL}>https://www.cleartill.money</a><br />Support email: <a href="mailto:hello@cleartill.money">hello@cleartill.money</a></p>
          <p>ClearTill is not a bank, lender or financial adviser and does not provide personalised financial advice. Its results are estimates based on the information you provide.</p>
        </div>
      </section>

      <section className="about-links" aria-label="ClearTill policies and contact">
        <Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/security">Security</Link><a href="mailto:hello@cleartill.money">Contact</a>
      </section>
    </main>
  );
}
