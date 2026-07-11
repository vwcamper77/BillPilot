"use client";
import Link from "next/link";
import { trackGa4Event } from "@/lib/analytics/ga4";

export default function OfferCta() {
  return <Link className="primary-link landing-offer-button" href="/billing" onClick={() => trackGa4Event("select_content", { content_type: "cta", content_id: "beta_offer_try_for_5" })}>Try ClearTill for {"\u00A35"}</Link>;
}
