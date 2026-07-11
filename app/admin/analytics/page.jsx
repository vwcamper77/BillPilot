"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Logo from "@/components/Logo";
import { auth, authPersistenceReady } from "@/lib/firebase";
import KpiCardsRow from "./KpiCardsRow";
import FunnelSection from "./FunnelSection";
import AdPerformanceTable from "./AdPerformanceTable";
import CustomerTable from "./CustomerTable";
import CustomerDetailDrawer from "./CustomerDetailDrawer";
import Ga4BrowserDiagnostic from "./Ga4BrowserDiagnostic";

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export default function AdminAnalyticsPage() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [rangeDays, setRangeDays] = useState("30");
  const [status, setStatus] = useState({ loading: true, error: "", forbidden: false });
  const [data, setData] = useState(null);
  const [selectedUid, setSelectedUid] = useState("");

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

  const loadAnalytics = useCallback(async () => {
    if (!user) return;

    setStatus({ loading: true, error: "", forbidden: false });

    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/admin/analytics?rangeDays=${rangeDays}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (response.status === 401 || response.status === 403) {
        setStatus({ loading: false, error: "", forbidden: true });
        return;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Could not load analytics right now.");
      }

      setData(payload);
      setStatus({ loading: false, error: "", forbidden: false });
    } catch (error) {
      setStatus({ loading: false, error: error?.message || "Could not load analytics right now.", forbidden: false });
    }
  }, [user, rangeDays]);

  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      setStatus({ loading: false, error: "", forbidden: true });
      return;
    }

    loadAnalytics();
  }, [authReady, user, loadAnalytics]);

  if (!authReady || (status.loading && !status.forbidden && !data)) {
    return (
      <main className="dashboard-shell">
        <p className="helper-text">Loading analytics…</p>
      </main>
    );
  }

  if (status.forbidden) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Access denied</h1>
          <p>You do not have access to ClearTill analytics.</p>
          <div className="topbar-actions">
            <Link className="primary-link" href="/dashboard">Back to dashboard</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <div className="admin-header">
        <h1>ClearTill analytics</h1>
        <div className="admin-range-select">
          <label className="field-label" htmlFor="admin-range">Range</label>
          <select id="admin-range" value={rangeDays} onChange={(event) => setRangeDays(event.target.value)}>
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Link className="account-row" href="/dashboard">Dashboard</Link>
        </div>
      </div>

      {status.error ? <p className="helper-text billing-error">{status.error}</p> : null}

      <Ga4BrowserDiagnostic user={user} />

      {data ? (
        <>
          <div className="admin-section">
            <h2>Overview</h2>
            <KpiCardsRow kpis={data.kpis} />
          </div>

          <div className="admin-section">
            <h2>Funnel</h2>
            <p className="admin-section-subtitle">Distinct people reaching each stage, in the selected range.</p>
            <FunnelSection funnel={data.funnel} />
          </div>

          <AdPerformanceTable adPerformance={data.adPerformance} onSpendSaved={loadAnalytics} />

          <CustomerTable customers={data.customers} onRowClick={setSelectedUid} />
        </>
      ) : null}

      {selectedUid ? (
        <CustomerDetailDrawer uid={selectedUid} onClose={() => setSelectedUid("")} />
      ) : null}
    </main>
  );
}
