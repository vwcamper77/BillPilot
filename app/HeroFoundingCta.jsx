"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { track } from "@/components/MetaPixel";
import { trackEvent } from "@/lib/analytics/track";

const CAPACITY = 50;

export default function HeroFoundingCta({ foundingCount }) {
  const [waitlist, setWaitlist] = useState({ email: "", busy: false, error: "", success: false });

  useEffect(() => {
    track("ViewContent", { content_name: "ClearTill landing hero" });
  }, []);

  const remaining = typeof foundingCount === "number" ? Math.max(CAPACITY - foundingCount, 0) : null;
  const isFull = remaining === 0;

  function handleCtaClick() {
    track("InitiateCheckout", {
      value: 5,
      currency: "GBP",
      content_name: "ClearTill founding access",
      content_category: "early_access",
    });
    trackEvent("hero_cta_clicked");
  }

  async function handleWaitlistSubmit(event) {
    event.preventDefault();
    const email = waitlist.email.trim();

    if (!email) {
      setWaitlist((current) => ({ ...current, error: "Enter your email to join the waitlist." }));
      return;
    }

    setWaitlist((current) => ({ ...current, busy: true, error: "" }));

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Could not join the waitlist right now.");
      }

      setWaitlist({ email: "", busy: false, error: "", success: true });
    } catch (error) {
      setWaitlist((current) => ({
        ...current,
        busy: false,
        error: error?.message || "Could not join the waitlist right now.",
      }));
    }
  }

  return (
    <>
      <div className="landing-cta-row">
        {isFull ? (
          waitlist.success ? (
            <p className="landing-waitlist-success">
              You are on the list &mdash; we will email you when a place opens.
            </p>
          ) : (
            <form className="landing-waitlist-row" onSubmit={handleWaitlistSubmit}>
              <input
                type="email"
                className="landing-waitlist-input"
                placeholder="you@example.com"
                value={waitlist.email}
                onChange={(event) => setWaitlist((current) => ({ ...current, email: event.target.value }))}
                aria-label="Email address"
              />
              <button className="primary-link landing-primary-cta" type="submit" disabled={waitlist.busy}>
                {waitlist.busy ? "Joining..." : "Join the waitlist"}
              </button>
            </form>
          )
        ) : (
          <Link className="primary-link landing-primary-cta" href="/billing" onClick={handleCtaClick}>
            Get early access for {"£5"}
          </Link>
        )}
        <a className="secondary-button landing-secondary-cta" href="#beta-offer">
          See beta offer
        </a>
      </div>
      {remaining !== null && !isFull ? (
        <p className="landing-scarcity">{remaining} of {CAPACITY} founding member places remaining.</p>
      ) : null}
      {isFull && !waitlist.success ? (
        <p className="landing-scarcity">All {CAPACITY} founding member places are taken.</p>
      ) : null}
      {waitlist.error ? <p className="helper-text billing-error">{waitlist.error}</p> : null}
    </>
  );
}
