"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Logo from "@/components/Logo";
import { auth, authPersistenceReady } from "@/lib/firebase";
import { deliveryStage } from "@/lib/emailOperations";
import { formatDateTime, labelizeEventName } from "@/app/admin/analytics/format";

const RANGE_OPTIONS = [[1, "Last 24 hours"], [7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]];
const STAGE_LABELS = {
  fired: "Fired",
  provider_accepted: "Provider accepted",
  delivered: "Delivered",
  delayed: "Delayed",
  bounced: "Bounced",
  complained: "Complained",
  failed: "Failed",
};

export default function EmailOperationsPage() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [rangeDays, setRangeDays] = useState(7);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ loading: true, forbidden: false, error: "" });
  const [filters, setFilters] = useState({ query: "", stage: "all", type: "all" });

  useEffect(() => {
    if (!auth) { setAuthReady(true); return undefined; }
    let mounted = true;
    let unsubscribe = () => undefined;
    authPersistenceReady.finally(() => {
      if (!mounted) return;
      unsubscribe = onAuthStateChanged(auth, (currentUser) => { setUser(currentUser); setAuthReady(true); });
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const loadOperations = useCallback(async () => {
    if (!user) return;
    setStatus({ loading: true, forbidden: false, error: "" });
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/admin/email-operations?rangeDays=${rangeDays}`, { headers: { Authorization: `Bearer ${idToken}` } });
      if ([401, 403].includes(response.status)) { setStatus({ loading: false, forbidden: true, error: "" }); return; }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load email operations.");
      setData(payload);
      setStatus({ loading: false, forbidden: false, error: "" });
    } catch (error) {
      setStatus({ loading: false, forbidden: false, error: error.message || "Could not load email operations." });
    }
  }, [user, rangeDays]);

  useEffect(() => {
    if (!authReady) return;
    if (!user) { setStatus({ loading: false, forbidden: true, error: "" }); return; }
    loadOperations();
  }, [authReady, user, loadOperations]);

  const types = useMemo(() => [...new Set((data?.deliveries || []).map((delivery) => delivery.type))].sort(), [data]);
  const filtered = useMemo(() => (data?.deliveries || []).filter((delivery) => {
    if (filters.stage !== "all" && deliveryStage(delivery.status) !== filters.stage) return false;
    if (filters.type !== "all" && delivery.type !== filters.type) return false;
    const query = filters.query.trim().toLowerCase();
    if (!query) return true;
    return `${delivery.recipient || ""} ${delivery.userId || ""} ${delivery.providerMessageId || ""} ${delivery.type || ""}`.toLowerCase().includes(query);
  }), [data, filters]);

  if (!authReady || (status.loading && !data)) return <main className="dashboard-shell"><p className="helper-text">Loading email operations…</p></main>;
  if (status.forbidden) return <main className="dashboard-shell"><section className="auth-panel"><Logo className="eyebrow-logo" /><h1>Access denied</h1><p>You do not have access to ClearTill email operations.</p><Link className="primary-link" href="/dashboard">Back to dashboard</Link></section></main>;

  return (
    <main className="admin-shell email-ops-shell">
      <div className="admin-header">
        <div><p className="account-section-label">Admin operations</p><h1>Email delivery</h1></div>
        <div className="admin-range-select">
          <label className="field-label" htmlFor="email-range">Range</label>
          <select id="email-range" value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}>{RANGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <button className="secondary-button" type="button" onClick={loadOperations} disabled={status.loading}>{status.loading ? "Refreshing…" : "Refresh"}</button>
          <Link className="account-row" href="/admin/analytics">Analytics</Link>
        </div>
      </div>

      <div className="email-ops-notice" role="note"><strong>Delivered is not read.</strong> ClearTill does not use email-open tracking for reminder decisions. “Activity after send” means an authenticated ClearTill action happened later; it does not prove the email caused it.</div>
      {status.error ? <p className="helper-text billing-error" role="alert">{status.error}</p> : null}
      {data ? <>
        <section className="email-ops-health" aria-label="Email configuration health">
          <HealthFlag label="Provider" ok={data.configuration.providerConfigured} />
          <HealthFlag label="Webhook" ok={data.configuration.webhookConfigured} />
          <HealthFlag label="Scheduler" ok={data.configuration.schedulerConfigured} />
          <HealthFlag label="Lifecycle sends" ok={data.configuration.reminderEmailsEnabled && !data.configuration.emergencyDisabled} />
          <HealthFlag label="Routine sends" ok={data.configuration.routineEmailsEnabled && !data.configuration.emergencyDisabled} />
        </section>
        <section className="email-ops-summary" aria-label="Email status totals">
          <SummaryCard label="Total" value={data.summary.total} />
          {Object.entries(STAGE_LABELS).map(([key, label]) => <SummaryCard key={key} label={label} value={data.summary[key]} tone={["failed", "bounced", "complained"].includes(key) ? "danger" : key === "delayed" ? "warning" : "normal"} />)}
        </section>

        <section className="admin-section">
          <div className="admin-header"><div><h2>Delivery ledger</h2><p className="admin-section-subtitle">Provider and webhook states only; no message bodies or financial values are retained here.</p></div><span className="helper-text">{filtered.length} shown{data.truncated ? " · result limit reached" : ""}</span></div>
          <div className="admin-filter-bar">
            <input type="search" placeholder="Search masked email, UID or provider ID" value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} />
            <select value={filters.stage} onChange={(event) => setFilters((current) => ({ ...current, stage: event.target.value }))}><option value="all">All states</option>{Object.entries(STAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}><option value="all">All email types</option>{types.map((type) => <option key={type} value={type}>{labelizeEventName(type)}</option>)}</select>
          </div>
          <div className="admin-table-wrap"><table className="admin-table email-ops-table"><thead><tr><th>State</th><th>Email type</th><th>User</th><th>Fired</th><th>Delivered / failed</th><th>Attempts</th><th>Activity after send</th><th>Provider ID</th></tr></thead><tbody>
            {filtered.length ? filtered.map((delivery) => <DeliveryRow key={delivery.id} delivery={delivery} />) : <tr><td colSpan={8}>No email records match these filters.</td></tr>}
          </tbody></table></div>
        </section>

        <section className="admin-section"><h2>Active suppressions</h2><p className="admin-section-subtitle">Hard bounces, complaints, provider suppressions and confirmed opt-outs prevent repeat contact.</p><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Reason</th><th>User</th><th>Provider</th><th>Recorded</th></tr></thead><tbody>{data.suppressions.length ? data.suppressions.map((item) => <tr key={item.id}><td>{labelizeEventName(item.reason)}</td><td>{item.recipient || shortId(item.userId || item.id)}</td><td>{item.provider || "ClearTill"}</td><td>{formatDateTime(item.updatedAt || item.createdAt)}</td></tr>) : <tr><td colSpan={4}>No suppression records found.</td></tr>}</tbody></table></div></section>
      </> : null}
    </main>
  );
}

function HealthFlag({ label, ok }) { return <div className={`email-ops-health-flag ${ok ? "is-ok" : "is-off"}`}><span aria-hidden="true">{ok ? "●" : "○"}</span><div><strong>{label}</strong><small>{ok ? "Ready" : "Off / missing"}</small></div></div>; }
function SummaryCard({ label, value, tone = "normal" }) { return <div className={`email-ops-card email-ops-card-${tone}`}><span>{label}</span><strong>{Number(value || 0).toLocaleString("en-GB")}</strong></div>; }
function DeliveryRow({ delivery }) {
  const stage = deliveryStage(delivery.status);
  const outcomeAt = delivery.deliveredAt || delivery.deferredAt || delivery.bouncedAt || delivery.complainedAt || delivery.failedAt || delivery.sentAt;
  return <tr><td><span className={`email-ops-stage email-ops-stage-${stage}`}>{STAGE_LABELS[stage]}</span>{delivery.failureReason ? <small className="email-ops-cell-note">{delivery.failureReason}</small> : null}</td><td>{labelizeEventName(delivery.type)}<small className="email-ops-cell-note">{delivery.commercialEntryPath ? labelizeEventName(delivery.commercialEntryPath) : delivery.transactional ? "transactional" : "routine"}</small></td><td>{delivery.recipient || shortId(delivery.userId)}<small className="email-ops-cell-note">{shortId(delivery.userId)}</small></td><td>{formatDateTime(delivery.firedAt)}</td><td>{formatDateTime(outcomeAt)}</td><td>{delivery.attempts}</td><td>{delivery.activityAfterSend ? <>Yes<small className="email-ops-cell-note">{labelizeEventName(delivery.activityReason)} · {formatDateTime(delivery.activityAt)}</small></> : "—"}</td><td><code>{shortId(delivery.providerMessageId, 12)}</code></td></tr>;
}
function shortId(value, length = 8) { const text = String(value || ""); return text ? `${text.slice(0, length)}${text.length > length ? "…" : ""}` : "—"; }
