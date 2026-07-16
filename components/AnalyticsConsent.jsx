"use client";

/**
 * Consent gate for Mixpanel. Mixpanel is initialised opted out, so it sends
 * nothing and writes no storage until someone chooses "Allow" here.
 *
 * Scope note: this gates Mixpanel only. GA4 and the Meta Pixel in app/layout.jsx
 * still load unconditionally and are not covered by this choice.
 */

import { useEffect, useState } from "react";
import {
  getAnalyticsConsent,
  grantAnalyticsConsent,
  initMixpanel,
  revokeAnalyticsConsent,
} from "@/lib/analytics/mixpanel";
import { trackEvent } from "@/lib/analytics/track";

export default function AnalyticsConsent() {
  const [needsChoice, setNeedsChoice] = useState(false);
  const configured = Boolean(process.env.NEXT_PUBLIC_MIXPANEL_TOKEN);

  useEffect(() => {
    if (!configured) return;
    // Loads the library opted out, and re-opts-in if consent was already given.
    initMixpanel();
    setNeedsChoice(getAnalyticsConsent() === null);
  }, [configured]);

  if (!configured || !needsChoice) {
    return null;
  }

  return (
    <div className="consent-bar" role="dialog" aria-label="Analytics consent">
      <p className="consent-copy">
        ClearTill uses analytics to see which parts of the app get used. Your balance
        and bill amounts are never sent.
      </p>
      <div className="consent-actions">
        <button
          type="button"
          className="consent-btn consent-btn-quiet"
          onClick={() => {
            revokeAnalyticsConsent();
            setNeedsChoice(false);
          }}
        >
          No thanks
        </button>
        <button
          type="button"
          className="consent-btn consent-btn-primary"
          onClick={() => {
            grantAnalyticsConsent();
            // The initial landing event occurs before consent and is therefore
            // intentionally suppressed by Mixpanel. Emit the first product
            // event only after opt-in so a consenting visitor is observable
            // even if their next action is an untracked navigation.
            trackEvent("analytics_consent_granted");
            setNeedsChoice(false);
          }}
        >
          Allow
        </button>
      </div>
    </div>
  );
}
