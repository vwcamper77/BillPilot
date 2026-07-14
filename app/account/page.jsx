"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import AdminFoundingAccessForm from "@/components/AdminFoundingAccessForm";
import { auth, authPersistenceReady, isFirebaseClientConfigured } from "@/lib/firebase";
import { trackEvent } from "@/lib/analytics/track";
import ManageSubscriptionButton from "./ManageSubscriptionButton";

const ACCOUNT_DIALOGS = {
  reset_data: {
    title: "Reset ClearTill data?",
    body: [
      "This will clear your bills, balance, paid-date settings, savings and big costs so you can start again.",
      "Your login account will not be deleted.",
      "This permanently removes your ClearTill budgeting data. This cannot be undone.",
    ],
    confirmLabel: "Reset my data",
  },
  delete_data: {
    title: "Delete all ClearTill data?",
    body: [
      "This will permanently delete all ClearTill data linked to your account, including bills, balances, paid-date settings, savings, big costs and imported data.",
      "Your login account will remain active.",
      "This permanently removes your ClearTill budgeting data. This cannot be undone.",
    ],
    confirmLabel: "Delete my ClearTill data",
  },
  delete_account: {
    title: "Delete account?",
    body: [
      "This will permanently delete your ClearTill account and all ClearTill data linked to it.",
      "This action cannot be undone.",
    ],
    confirmLabel: "Delete my account",
    requiresDeleteText: true,
  },
};

export default function AccountPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [dialogAction, setDialogAction] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [subscription, setSubscription] = useState(null);
  const [entitlement, setEntitlement] = useState(null);
  const [claim, setClaim] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingResolvedUid, setBillingResolvedUid] = useState("");
  const [billingError, setBillingError] = useState("");
  const [secureLinkResend, setSecureLinkResend] = useState({ busy: false, sent: false, error: "" });
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAnalyticsAdmin, setIsAnalyticsAdmin] = useState(false);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }

    let isMounted = true;
    let unsubscribe = () => undefined;

    authPersistenceReady.finally(() => {
      if (!isMounted) return;

      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
        setAuthReady(true);
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setSubscription(null);
      setEntitlement(null);
      setClaim(null);
      setBillingLoading(false);
      setBillingResolvedUid("");
      setBillingError("");
      return undefined;
    }

    let cancelled = false;
    setBillingLoading(true);
    setBillingResolvedUid("");
    setBillingError("");
    user.getIdToken().then((idToken) => fetch("/api/billing/status", {
      headers: { Authorization: `Bearer ${idToken}` },
    })).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Billing status could not be loaded.");
      if (!cancelled) {
        setSubscription(payload.subscription || null);
        setEntitlement(payload.entitlement || null);
        setClaim(payload.claim || null);
      }
    }).catch((error) => {
      if (!cancelled) setBillingError(error?.message || "Billing status could not be loaded.");
    }).finally(() => {
      if (!cancelled) {
        setBillingLoading(false);
        setBillingResolvedUid(user.uid);
      }
    });

    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }

    let cancelled = false;

    user.getIdToken().then((idToken) =>
      fetch("/api/admin/founding-access", {
        headers: { Authorization: `Bearer ${idToken}` },
      }),
    ).then((response) => response.json())
      .then((payload) => {
        if (!cancelled) setIsAdmin(Boolean(payload?.isAdmin));
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setIsAnalyticsAdmin(false);
      return;
    }

    let cancelled = false;

    user.getIdToken().then((idToken) =>
      fetch("/api/admin/analytics/access", {
        headers: { Authorization: `Bearer ${idToken}` },
      }),
    ).then((response) => response.json())
      .then((payload) => {
        if (!cancelled) setIsAnalyticsAdmin(Boolean(payload?.isAdmin));
      })
      .catch(() => {
        if (!cancelled) setIsAnalyticsAdmin(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const dialogConfig = dialogAction ? ACCOUNT_DIALOGS[dialogAction] : null;
  const subscriptionStatus = subscription?.subscriptionStatus || entitlement?.subscriptionStatus || "";
  const billingReady = Boolean(user && billingResolvedUid === user.uid);
  const hasCurrentBillingAccess = ["trialing", "active"].includes(subscriptionStatus) || Boolean(entitlement?.hasFullAccess);
  const hasPendingClaim = Boolean(user?.isAnonymous && claim?.claimStatus === "pending");
  const isAccountSecured = Boolean(!user?.isAnonymous || claim?.claimStatus === "claimed");
  const secureAccessEmail = claim?.maskedEmail || subscription?.customerEmail || user?.email || "your billing email";

  async function handleResendSecureLink() {
    if (!auth?.currentUser || !claim?.checkoutIntentId) return;
    setSecureLinkResend({ busy: true, sent: false, error: "" });
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/trial-claim/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ checkoutIntentId: claim.checkoutIntentId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not resend the secure link.");
      setSecureLinkResend({ busy: false, sent: true, error: "" });
    } catch (error) {
      setSecureLinkResend({ busy: false, sent: false, error: error?.message || "Could not resend the secure link." });
    }
  }

  async function handleExportData() {
    if (!auth?.currentUser) {
      return;
    }

    setBusyAction("export_data");
    setFeedback({ type: "", message: "" });

    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action: "export_data" }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Could not export your data right now.");
      }

      const blob = new Blob([JSON.stringify(payload.export, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cleartill-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setFeedback({ type: "success", message: "Your ClearTill data has been downloaded." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error?.message || "Could not export your data right now.",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function handleSignOut() {
    if (!auth) return;

    setBusyAction("sign_out");
    setFeedback({ type: "", message: "" });

    try {
      trackEvent("logout");
      await signOut(auth);
      router.replace("/");
    } catch (error) {
      setFeedback({
        type: "error",
        message: error?.message || "Could not sign you out right now.",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function handleConfirmedAction() {
    if (!dialogAction || !auth?.currentUser) {
      return;
    }

    setBusyAction(dialogAction);
    setFeedback({ type: "", message: "" });

    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action: dialogAction }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Could not complete that account action.");
      }

      if (dialogAction === "delete_account") {
        await signOut(auth).catch(() => undefined);
        router.replace("/");
        return;
      }

      setFeedback({
        type: "success",
        message: payload?.message || "Account action complete.",
      });
      setDialogAction("");
      setDeleteConfirmText("");
    } catch (error) {
      setFeedback({
        type: "error",
        message: error?.message || "Could not complete that account action.",
      });
    } finally {
      setBusyAction("");
    }
  }

  function openDialog(action) {
    setFeedback({ type: "", message: "" });
    setDeleteConfirmText("");
    setDialogAction(action);
  }

  function closeDialog() {
    if (busyAction) return;
    setDialogAction("");
    setDeleteConfirmText("");
  }

  if (!authReady) {
    return (
      <main className="account-shell">
        <section className="account-panel">
          <Logo className="eyebrow-logo" />
          <h1>Loading your account…</h1>
        </section>
      </main>
    );
  }

  if (!isFirebaseClientConfigured) {
    return (
      <main className="account-shell">
        <section className="account-panel">
          <Logo className="eyebrow-logo" />
          <h1>ClearTill account services are not configured.</h1>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="account-shell">
        <section className="account-panel">
          <Logo className="eyebrow-logo" />
          <h1>Sign in to manage your account.</h1>
          <p className="helper-text">Open your dashboard to sign in or continue setting up.</p>
          <div className="topbar-actions">
            <Link className="secondary-button" href="/dashboard">Go to dashboard</Link>
            <Link className="secondary-button" href="/">Back to home</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="account-shell">
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand" style={{ fontSize: "2rem" }}>Account</h1>
        </div>
        <div className="topbar-actions">
          <Link className="secondary-button" href="/dashboard">Back to dashboard</Link>
        </div>
      </header>

      {feedback.message ? (
        <section className={`page-notice${feedback.type === "error" ? " is-error" : ""}`} aria-live="polite">
          {feedback.message}
        </section>
      ) : null}

      <TrustShield className="page-trust-banner" />

      <div className="account-stack">
        <section className="account-panel">
          <p className="account-section-label">Your account</p>
          {!billingReady ? <p className="helper-text" role="status">Loading your account…</p> : null}
          {billingReady && hasPendingClaim ? (
            <div style={{ display: "grid", gap: "10px" }}>
              <h2 className="account-heading">Secure access link sent</h2>
              <p className="helper-text">
                Your ClearTill trial is active and your information is available on this device.
              </p>
              <div>
                <p className="helper-text">We sent a secure sign-in link to:</p>
                <p className="account-identity" style={{ marginTop: "4px" }}>{secureAccessEmail}</p>
              </div>
              <p className="helper-text">Use the link to access ClearTill on another device.</p>
              <div>
                <button
                  type="button"
                  onClick={handleResendSecureLink}
                  disabled={secureLinkResend.busy}
                  style={{ border: 0, background: "none", color: "var(--accent-dark)", cursor: secureLinkResend.busy ? "wait" : "pointer", padding: "4px 0", textDecoration: "underline" }}
                >
                  {secureLinkResend.busy ? "Resending…" : "Resend secure link"}
                </button>
              </div>
              {secureLinkResend.sent ? <p className="helper-text billing-success">Secure link sent.</p> : null}
              {secureLinkResend.error ? <p className="error" role="alert">{secureLinkResend.error}</p> : null}
            </div>
          ) : null}
          {billingReady && isAccountSecured ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <h2 className="account-heading">Account secured</h2>
              <p className="helper-text">Signed in with {user.email || subscription?.customerEmail || "your email"}</p>
            </div>
          ) : null}
          {billingReady && !hasPendingClaim && !isAccountSecured ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <h2 className="account-heading">Your information is available on this device</h2>
              <p className="helper-text">Return to your dashboard whenever you&apos;re ready to continue.</p>
            </div>
          ) : null}
          <p className="legal-company-note">ClearTill is a product from GMBF Ventures Ltd.</p>
        </section>

        <section className="account-panel">
          <p className="account-section-label">Your subscription</p>
          {!billingReady || billingLoading ? <p className="helper-text" role="status">Loading billing status…</p> : null}
          {billingReady && !billingLoading && billingError ? <p className="error" role="alert">{billingError}</p> : null}
          {billingReady && !billingLoading && !billingError && subscriptionStatus === "trialing" ? (
            <div style={{ display: "grid", gap: "12px" }}>
              <h2 className="account-heading">7-day free trial</h2>
              <div className="helper-text" style={{ display: "grid", gap: "6px" }}>
                <span>£0 charged today</span>
                <span>£1.99 on {formatDate(subscription?.trialEnd)}</span>
                <span>Then £1.99 monthly</span>
                <span>Billing email: {subscription?.customerEmail || user.email || "—"}</span>
              </div>
              {entitlement?.canManageSubscription ? <div><ManageSubscriptionButton /></div> : null}
            </div>
          ) : null}
          {billingReady && !billingLoading && !billingError && subscriptionStatus === "active" ? (
            <div style={{ display: "grid", gap: "12px" }}>
              <h2 className="account-heading">ClearTill monthly</h2>
              <div className="helper-text" style={{ display: "grid", gap: "6px" }}>
                <span>£1.99 per month</span>
                <span>{subscription?.cancelAtPeriodEnd ? "Access ends" : "Next payment"}: {formatDate(subscription?.currentPeriodEnd)}</span>
                <span>Billing email: {subscription?.customerEmail || user.email || "—"}</span>
              </div>
              {entitlement?.canManageSubscription ? <div><ManageSubscriptionButton /></div> : null}
            </div>
          ) : null}
          {billingReady && !billingLoading && !billingError && !["trialing", "active"].includes(subscriptionStatus) ? (
            <div style={{ display: "grid", gap: "10px" }}>
              <h2 className="account-heading">{hasCurrentBillingAccess ? "ClearTill access" : "No active subscription"}</h2>
              {hasCurrentBillingAccess ? <p className="helper-text">Your ClearTill access is active.</p> : null}
              {entitlement?.canManageSubscription ? <div><ManageSubscriptionButton /></div> : null}
            </div>
          ) : null}
        </section>

        <section className="account-panel">
          <p className="account-section-label">Manage account</p>
          <div className="account-action-list">
            <Link className="account-row" href="/billing">
              <div>
                <strong>Billing &amp; payments</strong>
                <span>Manage your subscription, payment method, invoices and cancellation in Stripe.</span>
              </div>
              <span aria-hidden="true">→</span>
            </Link>

            <button className="account-row" type="button" onClick={handleExportData} disabled={Boolean(busyAction) || Boolean(dialogAction)}>
              <div>
                <strong>Export my data</strong>
                <span>Download a copy of your ClearTill data as a JSON file.</span>
              </div>
              <span aria-hidden="true">{busyAction === "export_data" ? "…" : "↓"}</span>
            </button>

            <button className="account-row" type="button" onClick={() => openDialog("reset_data")} disabled={Boolean(busyAction)}>
              <div>
                <strong>Reset ClearTill data</strong>
                <span>Clear your balance, paid-date setup, bills, savings and big costs so you can start again.</span>
              </div>
              <span aria-hidden="true">→</span>
            </button>

            <button className="account-row account-row-danger" type="button" onClick={() => openDialog("delete_data")} disabled={Boolean(busyAction)}>
              <div>
                <strong>Delete all ClearTill data</strong>
                <span>Permanently remove your ClearTill data while keeping your login account active.</span>
              </div>
              <span aria-hidden="true">→</span>
            </button>

            <button className="account-row account-row-danger" type="button" onClick={() => openDialog("delete_account")} disabled={Boolean(busyAction)}>
              <div>
                <strong>Delete account</strong>
                <span>Permanently remove your ClearTill account and all ClearTill data linked to it.</span>
              </div>
              <span aria-hidden="true">→</span>
            </button>

            <button className="account-row" type="button" onClick={handleSignOut} disabled={busyAction === "sign_out" || Boolean(dialogAction)}>
              <div>
                <strong>Sign out</strong>
                <span>Sign out and return to the ClearTill home page.</span>
              </div>
              <span aria-hidden="true">{busyAction === "sign_out" ? "…" : "→"}</span>
            </button>
          </div>
        </section>

        <section className="account-panel">
          <p className="account-section-label">Legal</p>
          <div className="account-action-list">
            <Link className="account-row" href="/terms">
              <div>
                <strong>Terms of Service</strong>
                <span>Read the current ClearTill terms placeholder.</span>
              </div>
              <span aria-hidden="true">→</span>
            </Link>

            <Link className="account-row" href="/privacy">
              <div>
                <strong>Privacy Policy</strong>
                <span>See what you enter, how it is used, and how to manage it.</span>
              </div>
              <span aria-hidden="true">→</span>
            </Link>

            <Link className="account-row" href="/security">
              <div>
                <strong>Security</strong>
                <span>Read the plain-English summary of how ClearTill handles imported data and privacy controls.</span>
              </div>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        {isAdmin ? (
          <section className="account-panel">
            <p className="account-section-label">Admin fallback</p>
            <p className="helper-text">
              Manual override for founding access by email.
            </p>
            <AdminFoundingAccessForm />
          </section>
        ) : null}

        {isAnalyticsAdmin ? (
          <section className="account-panel">
            <p className="account-section-label">Admin</p>
            <Link href="/admin/analytics" className="account-row">
              <div>
                <strong>Analytics</strong>
                <span>Signups, funnel drop-off, ad performance and customer detail.</span>
              </div>
              <span aria-hidden="true">→</span>
            </Link>
          </section>
        ) : null}
      </div>

      {dialogConfig ? (
        <div className="dialog-overlay" role="presentation" onClick={closeDialog}>
          <section
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="account-dialog-title">{dialogConfig.title}</h2>
            <div className="dialog-copy">
              {dialogConfig.body.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>

            {dialogConfig.requiresDeleteText ? (
              <div className="field-row" style={{ marginTop: "14px" }}>
                <label className="field-label" htmlFor="delete-account-confirm">Type DELETE to continue</label>
                <input
                  id="delete-account-confirm"
                  value={deleteConfirmText}
                  onChange={(event) => setDeleteConfirmText(event.target.value)}
                  placeholder="DELETE"
                />
              </div>
            ) : null}

            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={closeDialog} disabled={Boolean(busyAction)}>
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={handleConfirmedAction}
                disabled={busyAction === dialogAction || (dialogConfig.requiresDeleteText && deleteConfirmText !== "DELETE")}
              >
                {busyAction === dialogAction ? "Working..." : dialogConfig.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(date);
}
