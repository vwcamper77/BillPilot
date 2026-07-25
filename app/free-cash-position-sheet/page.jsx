import MarketingHeader from "@/components/MarketingHeader";
import { canonicalUrl, createPageMetadata, SITE_URL } from "@/lib/seo";
import { createGmbfOrganizationSchema } from "@/lib/productFamily";
import { isValidGoogleSheetCopyUrl } from "@/lib/leadMagnet";
import styles from "./page.module.css";

const PATH = "/free-cash-position-sheet";
const PAGE_URL = canonicalUrl(PATH);
const TITLE = "Free Cash-Position Spreadsheet and Bank Balance Reset Guide";
const DESCRIPTION = "Use ClearTill's free spreadsheet and guide to subtract the bills and one-off costs your bank balance still has to cover before payday.";

export const metadata = createPageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${PAGE_URL}#webpage`,
      url: PAGE_URL,
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { "@id": "https://www.cleartill.money/#website" },
      about: { "@id": `${PAGE_URL}#worksheet` },
    },
    {
      "@type": "DigitalDocument",
      "@id": `${PAGE_URL}#worksheet`,
      name: "ClearTill free cash-position worksheet",
      description: "A manual one-payday worksheet for subtracting bills, one-off costs and a buffer from a current bank balance.",
      encodingFormat: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      url: `${SITE_URL}/downloads/cleartill-free-cash-position-sheet.xlsx`,
      isAccessibleForFree: true,
      publisher: createGmbfOrganizationSchema(),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://www.cleartill.money/" },
        { "@type": "ListItem", position: 2, name: "Free cash-position sheet", item: PAGE_URL },
      ],
    },
  ],
};

export default function FreeCashPositionSheetPage() {
  const configuredGoogleUrl = process.env.NEXT_PUBLIC_CASH_POSITION_GOOGLE_SHEET_URL || "";
  const googleUrl = isValidGoogleSheetCopyUrl(configuredGoogleUrl) ? configuredGoogleUrl : null;

  return (
    <main className={`live-home ${styles.page}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <MarketingHeader />
      <section className={`live-home-container ${styles.hero}`}>
        <div>
          <p className={styles.eyebrow}>Free cash-position worksheet</p>
          <h1>Work out what your bank balance still has to cover before payday</h1>
          <p className={styles.intro}>Your bank balance shows what is in the account. It does not show what is already spoken for. Use the free ClearTill spreadsheet and Bank Balance Reset guide to subtract the bills and one-off costs still ahead of you.</p>
          <div className={styles.actions}>
            <a className={styles.button} href="/downloads/cleartill-free-cash-position-sheet.xlsx" data-lead-magnet-action="sheet" data-lead-magnet-surface="landing_page">Download Excel worksheet</a>
            <a className={`${styles.button} ${styles.buttonSecondary}`} href="/guides/cleartill-bank-balance-reset-guide.pdf" data-lead-magnet-action="pdf" data-lead-magnet-surface="landing_page">Read the PDF guide</a>
            {googleUrl ? <a className={`${styles.button} ${styles.buttonSecondary}`} href={googleUrl} target="_blank" rel="noopener noreferrer" data-lead-magnet-action="google" data-lead-magnet-surface="landing_page">Make a Google Sheets copy</a> : <span className={`${styles.button} ${styles.buttonUnavailable}`} aria-disabled="true" title="Google Sheets copy link is not configured">Google Sheets copy coming soon</span>}
          </div>
          <ul className={styles.trust}><li>No bank login</li><li>No Open Banking</li><li>You control the numbers</li></ul>
        </div>
        <figure className={styles.previewShell}>
          <div className={styles.spreadsheet} aria-label="Preview of the ClearTill cash-position spreadsheet">
            <div className={styles.sheetTop}><span /><span /><span /></div>
            <div className={styles.sheetTitle}><strong>Cash position before payday</strong><span>One payday cycle</span></div>
            <div className={styles.sheetBody}>
              <div className={styles.sheetRow}><span>Balance in the account</span><strong>Enter yours</strong></div>
              <div className={styles.sheetRow}><span>Bills still due</span><strong>− total</strong></div>
              <div className={styles.sheetRow}><span>One-off costs ahead</span><strong>− total</strong></div>
              <div className={styles.sheetRow}><span>Buffer you want to keep</span><strong>− amount</strong></div>
              <div className={styles.result}><span>What is actually clear</span><strong>Your result</strong></div>
            </div>
          </div>
          <figcaption className={styles.caption}>A clear, manual view of the costs still between today and payday.</figcaption>
        </figure>
      </section>

      <section className={styles.band}>
        <div className={`live-home-container ${styles.section}`}>
          <p className={styles.eyebrow}>The one-payday calculation</p>
          <h2>Start with what is there. Subtract what is still coming.</h2>
          <div className={styles.calculation}>
            <article><span>01</span><h3>Enter today&apos;s balance</h3><p>Use the amount you can see in the account now.</p></article>
            <article><span>02</span><h3>List bills before payday</h3><p>Include regular bills and subscriptions that have not cleared yet.</p></article>
            <article><span>03</span><h3>Add one-off costs and a buffer</h3><p>Make room for known extras and the amount you prefer not to touch.</p></article>
            <article><span>04</span><h3>See what is actually clear</h3><p>The worksheet subtracts those commitments for one payday cycle.</p></article>
          </div>
        </div>
      </section>

      <section className={`live-home-container ${styles.section}`}>
        <p className={styles.eyebrow}>Manual by design</p>
        <h2>You decide what goes into the calculation.</h2>
        <p className={styles.sectionLead}>The worksheet never connects to a bank. That keeps it transparent and under your control, but it also means you need to add every relevant cost and update the figures yourself.</p>
        <div className={styles.manualGrid}>
          <article><h3>The spreadsheet</h3><p>A focused, one-payday check. Download it, enter your numbers and keep the file yourself. It will not carry recurring bills into the next cycle or remind you when a balance becomes stale.</p></article>
          <article><h3>ClearTill</h3><p>Carries recurring bills forward, provides useful reminders and keeps your position live as you update the balance. It uses only the figures you choose to enter and still needs no bank connection.</p></article>
        </div>
      </section>

      <section className={`live-home-container ${styles.comparison}`}>
        <div><p className={styles.eyebrow}>What to include</p><h2>An honest result needs an honest list.</h2></div>
        <ul>
          <li><strong>Regular bills:</strong> rent or mortgage, council tax, energy, insurance and subscriptions still due.</li>
          <li><strong>One-off costs:</strong> travel, school costs, repairs, appointments or anything else you already expect.</li>
          <li><strong>A buffer:</strong> an amount you deliberately choose not to treat as available.</li>
          <li><strong>Nothing automatic:</strong> you remain responsible for keeping every number complete and current.</li>
        </ul>
      </section>

      <section className={`live-home-container ${styles.final}`}>
        <p className={styles.eyebrow}>Keep the position live</p>
        <h2>Ready to move beyond a one-off spreadsheet?</h2>
        <p>Build your first ClearTill position free. Add the costs still ahead, see the result and keep it current for seven days without entering a card.</p>
        <div className={styles.actions}><a className={styles.button} href="/start" data-lead-magnet-action="preview" data-lead-magnet-surface="landing_page">Check my position free</a></div>
      </section>
    </main>
  );
}
