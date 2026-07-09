"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";

const PLATFORMS = [
  { value: "meta", label: "Meta" },
  { value: "google", label: "Google" },
  { value: "tiktok", label: "TikTok" },
  { value: "other", label: "Other" },
];

const INITIAL_FORM = {
  date: new Date().toISOString().slice(0, 10),
  platform: "meta",
  campaign: "",
  spend: "",
  notes: "",
};

export default function AdSpendForm({ onSaved }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [status, setStatus] = useState({ busy: false, error: "", success: "" });

  async function handleSubmit(event) {
    event.preventDefault();

    if (!auth?.currentUser) {
      setStatus({ busy: false, error: "Sign in first.", success: "" });
      return;
    }

    if (!form.campaign.trim()) {
      setStatus({ busy: false, error: "Enter a campaign name.", success: "" });
      return;
    }

    const spend = Number(form.spend);
    if (!Number.isFinite(spend) || spend < 0) {
      setStatus({ busy: false, error: "Enter a valid spend amount.", success: "" });
      return;
    }

    setStatus({ busy: true, error: "", success: "" });

    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/admin/ad-spend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: "create",
          date: form.date,
          platform: form.platform,
          campaign: form.campaign.trim(),
          spend,
          notes: form.notes.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Could not save that ad spend entry.");
      }

      setStatus({ busy: false, error: "", success: "Ad spend recorded." });
      setForm((current) => ({ ...INITIAL_FORM, platform: current.platform }));
      onSaved?.();
    } catch (error) {
      setStatus({ busy: false, error: error?.message || "Could not save that ad spend entry.", success: "" });
    }
  }

  return (
    <form className="ad-spend-form" onSubmit={handleSubmit}>
      <div className="ad-spend-form-row">
        <label className="field-label" htmlFor="ad-spend-date">Date</label>
        <input
          id="ad-spend-date"
          type="date"
          value={form.date}
          onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
        />
      </div>

      <div className="ad-spend-form-row">
        <label className="field-label" htmlFor="ad-spend-platform">Platform</label>
        <select
          id="ad-spend-platform"
          value={form.platform}
          onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))}
        >
          {PLATFORMS.map((platform) => (
            <option key={platform.value} value={platform.value}>{platform.label}</option>
          ))}
        </select>
      </div>

      <div className="ad-spend-form-row">
        <label className="field-label" htmlFor="ad-spend-campaign">Campaign</label>
        <input
          id="ad-spend-campaign"
          type="text"
          value={form.campaign}
          onChange={(event) => setForm((current) => ({ ...current, campaign: event.target.value }))}
          placeholder="spring_founding_promo"
        />
      </div>

      <div className="ad-spend-form-row">
        <label className="field-label" htmlFor="ad-spend-spend">Spend (£)</label>
        <input
          id="ad-spend-spend"
          type="number"
          min="0"
          step="0.01"
          value={form.spend}
          onChange={(event) => setForm((current) => ({ ...current, spend: event.target.value }))}
          placeholder="50.00"
        />
      </div>

      <div className="ad-spend-form-row">
        <label className="field-label" htmlFor="ad-spend-notes">Notes</label>
        <input
          id="ad-spend-notes"
          type="text"
          value={form.notes}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          placeholder="Optional"
        />
      </div>

      <div className="ad-spend-form-actions">
        <button className="primary-button" type="submit" disabled={status.busy}>
          {status.busy ? "Saving..." : "Add spend"}
        </button>
      </div>
      {status.error ? <p className="helper-text billing-error">{status.error}</p> : null}
      {status.success ? <p className="helper-text billing-success">{status.success}</p> : null}
    </form>
  );
}
