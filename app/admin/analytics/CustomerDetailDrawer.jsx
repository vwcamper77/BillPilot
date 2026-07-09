"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { formatDateTime, formatGbpFromPence, labelizeEventName } from "./format";

export default function CustomerDetailDrawer({ uid, onClose }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    if (!uid) return undefined;

    let cancelled = false;
    setState({ loading: true, error: "", data: null });

    (async () => {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`/api/admin/analytics/customer?uid=${encodeURIComponent(uid)}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Could not load that customer.");
        }

        if (!cancelled) setState({ loading: false, error: "", data: payload });
      } catch (error) {
        if (!cancelled) setState({ loading: false, error: error?.message || "Could not load that customer.", data: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (!uid) return null;

  const { customer, billing, timeline } = state.data || {};

  return (
    <div className="admin-drawer-overlay" role="presentation" onClick={onClose}>
      <section
        className="admin-drawer"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="admin-drawer-close" type="button" onClick={onClose}>Close</button>

        {state.loading ? <p className="helper-text">Loading customer…</p> : null}
        {state.error ? <p className="helper-text billing-error">{state.error}</p> : null}

        {customer ? (
          <>
            <div>
              <h2>{customer.name || customer.email || customer.uid}</h2>
              <p className="helper-text">{customer.email || "No email on file"}</p>
              <p className="helper-text">Signed up {formatDateTime(customer.createdAt)}</p>
              {customer.dropOffStage ? (
                <p className="admin-funnel-dropoff">
                  Currently at: {labelizeEventName(customer.dropOffStage)}
                  {customer.paymentStatus !== "paid" ? " (has not completed payment)" : ""}
                </p>
              ) : null}
            </div>

            <div>
              <p className="account-section-label">Attribution</p>
              <p className="helper-text">Source: {customer.attribution?.utm_source || "—"}</p>
              <p className="helper-text">Medium: {customer.attribution?.utm_medium || "—"}</p>
              <p className="helper-text">Campaign: {customer.attribution?.utm_campaign || "—"}</p>
              <p className="helper-text">Content: {customer.attribution?.utm_content || "—"}</p>
              <p className="helper-text">Term: {customer.attribution?.utm_term || "—"}</p>
              <p className="helper-text">Referrer: {customer.attribution?.referrer || "direct"}</p>
              <p className="helper-text">Landing page: {customer.attribution?.landingPage || "—"}</p>
            </div>

            <div>
              <p className="account-section-label">Payment</p>
              <p className="helper-text">Status: {customer.paymentStatus}</p>
              <p className="helper-text">Total paid: {formatGbpFromPence(customer.totalPaid)}</p>
              <p className="helper-text">Subscription: {customer.subscriptionStatus}</p>
              <p className="helper-text">Stripe customer: {customer.stripeCustomerId || "—"}</p>
              {billing ? (
                <p className="helper-text">
                  Billing plan: {billing.plan || "—"} · {billing.accessStatus || "—"}
                </p>
              ) : null}
            </div>

            <div>
              <p className="account-section-label">Product</p>
              <p className="helper-text">Bills added: {customer.billsCount}</p>
              <p className="helper-text">Onboarding: {customer.onboardingStatus}</p>
              <p className="helper-text">Last active: {formatDateTime(customer.lastActiveAt)}</p>
            </div>

            <div>
              <p className="account-section-label">Event timeline</p>
              <div className="admin-timeline">
                {!timeline?.length ? (
                  <p className="helper-text">No events recorded yet.</p>
                ) : timeline.map((event) => (
                  <div className="admin-timeline-item" key={event.id}>
                    <span>{labelizeEventName(event.eventName)}</span>
                    <span>{formatDateTime(event.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
