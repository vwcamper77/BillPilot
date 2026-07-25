"use client";

import Link from "next/link";
import Logo from "@/components/Logo";
import { trackEvent } from "@/lib/analytics/track";
import { GMBF_VENTURES_URL, PRODUCT_URLS } from "@/lib/productFamily";

function trackFamilyClick(destination) {
  trackEvent("family_footer_click", {
    source_product: "cleartill",
    destination,
    placement: "footer",
  });
}

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-brand">
        <Link href="/" aria-label="ClearTill home">
          <Logo className="site-footer-logo" height={32} />
        </Link>
        <div className="site-footer-family">
          <p className="site-footer-company">
            ClearTill is a product of{" "}
            <a href={GMBF_VENTURES_URL} onClick={() => trackFamilyClick("gmbf_ventures")}>
              GMBF Ventures Ltd
            </a>
            .
          </p>
          <nav className="site-footer-family-products" aria-label="Also from GMBF Ventures">
            <span className="site-footer-family-title">Also from GMBF Ventures</span>
            <a href={PRODUCT_URLS.setthedate} onClick={() => trackFamilyClick("setthedate")}>SetTheDate</a>
            <a href={PRODUCT_URLS.talostv} onClick={() => trackFamilyClick("talostv")}>TalosTV</a>
          </nav>
        </div>
        <p className="site-footer-company-detail">
          GMBF Ventures Ltd - Company No. 17286832 - Registered in England and Wales - Registered office: 124 City Road, London, EC1V 2NX, United Kingdom
        </p>
        <p className="helper-text">ClearTill isn't financial advice. It's simple arithmetic on numbers you enter.</p>
        <span className="site-footer-meta">&copy; 2026 ClearTill</span>
      </div>
      <div className="site-footer-links">
        <Link href="/pricing">Pricing</Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/about-cleartill">About ClearTill</Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/signin">Sign in</Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/blog">Journal</Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/privacy">Privacy</Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/terms">Terms</Link>
        <span aria-hidden="true">&middot;</span>
        <Link href="/security">Security</Link>
        <span aria-hidden="true">&middot;</span>
        <a href="mailto:hello@cleartill.money">hello@cleartill.money</a>
      </div>
    </footer>
  );
}
