"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import { auth, authPersistenceReady, isFirebaseClientConfigured } from "@/lib/firebase";

const ACCOUNT_DIALOGS = {
  reset_data: {
    title: "Reset ClearTill data?",
    body: [
      "This will clear your bills, balance, payday settings, savings and big costs so you can start again.",
      "Your login account will not be deleted.",
      "This permanently removes your ClearTill budgeting data. This cannot be undone.",
    ],
    confirmLabel: "Reset my data",
  },
  delete_data: {
    title: "Delete all ClearTill data?",
    body: [
      "This will permanently delete all ClearTill data linked to your account, including bills, balances, payday settings, savings, big costs and imported data.",
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

  const dialogConfig = dialogAction ? ACCOUNT_DIALOGS[dialogAction] : null;
  const signedInLabel = useMemo(() => {
    if (!user) return "";
    if (user.isAnonymous) return "Guest session";
    return user.email || user.displayName || "Signed in";
  }, [user]);

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
          <h1>Firebase is not configured.</h1>
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
          <p className="helper-text">Open your dashboard to sign in or continue as a guest first.</p>
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
          <Link className="secondary-button" href="/big-costs">Big costs</Link>
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
          <p className="account-section-label">Account</p>
          <h2 className="account-heading">Signed in as</h2>
          <p className="account-identity">{signedInLabel}</p>
          <p className="helper-text">
            Manage your ClearTill data, account access, and privacy controls here.
          </p>
        </section>

        <section className="account-panel">
          <p className="account-section-label">Manage account</p>
          <div className="account-action-list">
            <Link className="account-row" href="/billing">
              <div>
                <strong>Billing &amp; payments</strong>
                <span>Future subscription and payment history will appear here.</span>
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
                <span>Clear your balance, payday setup, bills, savings and big costs so you can start again.</span>
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
