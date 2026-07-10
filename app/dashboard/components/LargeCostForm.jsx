"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buildLargeCostDocument, formatCurrency, formatDisplayDate, normaliseLargeCostFundingStatus } from "@/lib/billMath";
import { safeError } from "@/lib/security/safeLog";
import { postDashboardLargeCostAction, runWithTimeout } from "../lib/dashboardApi";
import { friendlySettingsError } from "../lib/friendlyErrors";

const LARGE_COST_CATEGORY_META = {
  holiday: { icon: "✈️", label: "Holiday" },
  car: { icon: "🚗", label: "Car" },
  home: { icon: "🏠", label: "Home" },
  kids: { icon: "🧒", label: "Kids" },
  emergency: { icon: "🛠", label: "Emergency" },
  other: { icon: "📌", label: "Other" },
};

const LARGE_COST_FREQUENCY_LABELS = {
  one_off: "One-off",
  every_2_months: "Every 2 months",
  quarterly: "Quarterly",
  every_6_months: "Every 6 months",
  yearly: "Yearly",
};

const LARGE_COST_FUNDING_META = {
  unassigned: {
    label: "Unassigned",
    shortLabel: "Unassigned",
    note: "Choose how this will be paid.",
  },
  current_account: {
    label: "Current account",
    shortLabel: "Current account",
    note: "Hits current account. Reduces daily spending room.",
  },
  savings: {
    label: "Savings",
    shortLabel: "Savings",
    note: "Covered by savings. Not counted as daily spending money.",
  },
  split: {
    label: "Split",
    shortLabel: "Split",
    note: "Partly covered by savings. Only the remaining amount affects daily spending room.",
  },
};

const EMPTY_FORM = {
  name: "",
  amount: "",
  amountAlreadySaved: "",
  dueDate: "",
  frequency: "one_off",
  category: "other",
  fundingStatus: "unassigned",
};

export default function LargeCostForm({
  onLargeCostsChange,
  displayCurrency,
  hasPayday,
  todayIso,
  costsWithStatus,
  dueBeforePaydayCosts,
  unassignedAmount,
  onNotice,
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [fundingEditorCostId, setFundingEditorCostId] = useState("");
  const [fundingEditorForm, setFundingEditorForm] = useState({ fundingStatus: "unassigned", savingsAmount: "" });
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleFocusRequest(event) {
      if (event.detail?.target !== "large-cost-form") return;
      startCreate();
      window.requestAnimationFrame(() => {
        wrapperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    window.addEventListener("ct:focus-quick-action", handleFocusRequest);
    return () => window.removeEventListener("ct:focus-quick-action", handleFocusRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId("");
    setError("");
    setShowForm(false);
  }

  function startCreate() {
    setError("");
    setEditingId("");
    setForm({ ...EMPTY_FORM, dueDate: todayIso });
    setShowForm(true);
  }

  function startEdit(cost) {
    setError("");
    setEditingId(cost.id);
    setForm({
      name: cost.name || "",
      amount: cost.amount?.toString() || "",
      amountAlreadySaved: cost.amountAlreadySaved?.toString() || "",
      dueDate: cost.dueDate || todayIso,
      frequency: cost.frequency || "one_off",
      category: cost.category || "other",
      fundingStatus: normaliseLargeCostFundingStatus(cost.fundingStatus),
    });
    setShowForm(true);
  }

  async function handleSave(event) {
    event.preventDefault();

    const amount = Number(form.amount);
    const amountAlreadySaved = Number(form.amountAlreadySaved || 0);

    if (!form.name.trim() || !Number.isFinite(amount) || amount <= 0 || !form.dueDate) {
      setError("Add a name, amount, and due date before saving.");
      return;
    }
    if (!Number.isFinite(amountAlreadySaved) || amountAlreadySaved < 0) {
      setError("Amount already saved must be zero or more.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        ...buildLargeCostDocument({
          name: form.name.trim(),
          amount,
          amountAlreadySaved,
          dueDate: form.dueDate,
          frequency: form.frequency,
          category: form.category,
          fundingStatus: form.fundingStatus,
          currency: "GBP",
        }, todayIso),
      };

      const result = await runWithTimeout(
        postDashboardLargeCostAction("save_large_cost", {
          costId: editingId || null,
          fields: payload,
        }),
        "Saving that large cost is taking too long. Check your connection and try again.",
      );
      const resolvedCostId = editingId || result?.costId || null;
      onLargeCostsChange?.((current) => {
        const savedCost = { ...payload, id: resolvedCostId || `${Date.now()}` };
        const existingIndex = current.findIndex((cost) => cost.id === savedCost.id);

        if (existingIndex >= 0) {
          return current.map((cost) => (cost.id === savedCost.id ? { ...cost, ...savedCost } : cost));
        }

        return [...current, savedCost];
      });
      onNotice?.(editingId ? "Large cost updated." : "Large cost added.");
      resetForm();
    } catch (saveError) {
      safeError("[firestore-large-cost-save] failed", { code: saveError?.code });
      setError(friendlySettingsError(saveError, "We could not save that large cost."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(costId) {
    if (!window.confirm("Remove this large cost?")) return;
    try {
      await postDashboardLargeCostAction("delete_large_cost", { costId });
      onLargeCostsChange?.((current) => current.filter((cost) => cost.id !== costId));
      if (editingId === costId) {
        resetForm();
      }
      onNotice?.("Large cost removed.");
    } catch (saveError) {
      setError(friendlySettingsError(saveError, "We could not delete that large cost."));
    }
  }

  function openFundingEditor(cost) {
    setFundingEditorCostId(cost.id);
    setFundingEditorForm({
      fundingStatus: normaliseLargeCostFundingStatus(cost.fundingStatus),
      savingsAmount: String(cost.amountAlreadySaved ?? ""),
    });
  }

  function closeFundingEditor() {
    setFundingEditorCostId("");
    setFundingEditorForm({ fundingStatus: "unassigned", savingsAmount: "" });
  }

  async function saveFundingEditor(cost) {
    const amount = Number(cost.amount) || 0;
    const fundingStatus = normaliseLargeCostFundingStatus(fundingEditorForm.fundingStatus);
    let amountAlreadySaved = 0;

    if (fundingStatus === "savings") {
      amountAlreadySaved = amount;
    } else if (fundingStatus === "split") {
      amountAlreadySaved = Number(fundingEditorForm.savingsAmount || 0);
      if (!Number.isFinite(amountAlreadySaved) || amountAlreadySaved < 0 || amountAlreadySaved > amount) {
        setError("Savings amount must be between 0 and the total cost.");
        return;
      }
    }

    setError("");

    try {
      await postDashboardLargeCostAction("save_large_cost", {
        costId: cost.id,
        fields: { fundingStatus, amountAlreadySaved },
      });
      onLargeCostsChange?.((current) => current.map((entry) => (
        entry.id === cost.id ? { ...entry, fundingStatus, amountAlreadySaved } : entry
      )));
      closeFundingEditor();
      onNotice?.("Large cost funding updated.");
    } catch (saveError) {
      setError(friendlySettingsError(saveError, "We could not update how that cost is funded."));
    }
  }

  return (
    <section ref={wrapperRef} className="forecast-large-costs">
      <div className="section-head">
        <div>
          <h3 style={{ margin: 0 }}>Large costs before payday</h3>
          <p className="helper-text">Only costs hitting the current account change daily spending room.</p>
        </div>
        <button className="secondary-button small-button" type="button" onClick={showForm ? resetForm : startCreate}>
          {showForm ? "Cancel" : "Add large cost"}
        </button>
      </div>

      {showForm ? (
        <form className="edit-form large-cost-form forecast-inline-form" onSubmit={handleSave}>
          <label className="field-label" htmlFor="large-cost-name">Name</label>
          <input
            id="large-cost-name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Holiday"
          />
          <label className="field-label" htmlFor="large-cost-amount">Amount</label>
          <input
            id="large-cost-amount"
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
            placeholder="5000"
          />
          <label className="field-label" htmlFor="large-cost-saved">Amount already saved</label>
          <input
            id="large-cost-saved"
            inputMode="decimal"
            value={form.amountAlreadySaved}
            onChange={(event) => setForm((current) => ({ ...current, amountAlreadySaved: event.target.value }))}
            placeholder="0"
          />
          <label className="field-label" htmlFor="large-cost-due-date">Due date</label>
          <input
            id="large-cost-due-date"
            type="date"
            value={form.dueDate}
            onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
          />
          <label className="field-label" htmlFor="large-cost-frequency">Frequency</label>
          <select
            id="large-cost-frequency"
            className="category-select"
            value={form.frequency}
            onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}
          >
            {Object.entries(LARGE_COST_FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <label className="field-label" htmlFor="large-cost-category">Category</label>
          <select
            id="large-cost-category"
            className="category-select"
            value={form.category}
            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
          >
            {Object.entries(LARGE_COST_CATEGORY_META).map(([value, meta]) => (
              <option key={value} value={value}>{meta.icon} {meta.label}</option>
            ))}
          </select>
          <div className="field-row">
            <label className="field-label">Funding source</label>
            <div className="funding-toggle-row">
              {Object.entries(LARGE_COST_FUNDING_META).map(([value, meta]) => (
                <button
                  key={value}
                  className={`funding-toggle${form.fundingStatus === value ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, fundingStatus: value }))}
                >
                  {meta.shortLabel}
                </button>
              ))}
            </div>
            <p className="helper-text">{(LARGE_COST_FUNDING_META[form.fundingStatus] || LARGE_COST_FUNDING_META.unassigned).note}</p>
          </div>
          <div className="edit-actions">
            <button className="primary-button small-button" type="submit" disabled={saving}>
              {saving ? "Saving..." : editingId ? "Save changes" : "Save"}
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </form>
      ) : null}

      {hasPayday ? (
        <>
          {unassignedAmount > 0 ? (
            <p className="forecast-unassigned-warning">
              You have {formatCurrency(unassignedAmount, displayCurrency)} of upcoming costs not assigned to a funding source. Your daily spending room may change.
            </p>
          ) : null}
          {dueBeforePaydayCosts.length ? (
          <ul className="forecast-compact-list">
            {dueBeforePaydayCosts.map((cost) => {
              const isEditingFunding = fundingEditorCostId === cost.id;
              const fundingLabel = cost.fundingMeta?.label || "Unassigned";
              const primaryLabel = cost.fundingStatus === "unassigned" ? "Choose funding" : "Change funding";

              return (
              <li key={cost.id} className="forecast-compact-row">
                <div className="forecast-compact-main">
                  <div className="forecast-cost-summary-row">
                    <span className="forecast-compact-name">{cost.name}</span>
                    <strong className="forecast-cost-amount">{formatCurrency(cost.amount, displayCurrency)}</strong>
                  </div>
                  <div className="forecast-cost-summary-row forecast-cost-summary-row-secondary">
                    <span className="forecast-compact-meta">Due {cost.nextDueDate ? formatDisplayDate(cost.nextDueDate) : cost.dueLabel}</span>
                    <span className="forecast-funding-status">{fundingLabel}</span>
                  </div>
                  <span className="forecast-compact-note">{cost.fundingMeta.note}</span>
                  {cost.fundingStatus === "split" ? (
                    <span className="forecast-compact-meta">
                      {formatCurrency(cost.currentAccountAmount || 0, displayCurrency)} hits current account
                    </span>
                  ) : null}
                  <div className="forecast-cost-actions">
                    <button className="secondary-button small-button forecast-funding-button" type="button" onClick={() => openFundingEditor(cost)}>
                      {primaryLabel}
                    </button>
                    <div className="forecast-secondary-actions">
                      <button className="bill-action-button bill-action-edit" type="button" onClick={() => startEdit(cost)}>
                        Edit
                      </button>
                      <button className="bill-action-button bill-action-remove" type="button" onClick={() => handleDelete(cost.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                  {isEditingFunding ? (
                    <div className="forecast-funding-editor">
                      <h4>How will you pay for {cost.name}?</h4>
                      <div className="funding-toggle-row">
                        {[
                          ["current_account", "Current account"],
                          ["savings", "Savings"],
                          ["split", "Split"],
                          ["unassigned", "Not sure yet"],
                        ].map(([value, label]) => (
                          <button
                            key={`${cost.id}-${value}-editor`}
                            className={`funding-toggle${fundingEditorForm.fundingStatus === value ? " is-active" : ""}`}
                            type="button"
                            onClick={() => setFundingEditorForm((current) => ({ ...current, fundingStatus: value }))}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {fundingEditorForm.fundingStatus === "split" ? (
                        <div className="field-row" style={{ marginTop: "12px" }}>
                          <label className="field-label" htmlFor={`funding-savings-${cost.id}`}>Amount from savings</label>
                          <input
                            id={`funding-savings-${cost.id}`}
                            inputMode="decimal"
                            value={fundingEditorForm.savingsAmount}
                            onChange={(event) => setFundingEditorForm((current) => ({ ...current, savingsAmount: event.target.value }))}
                            placeholder="0"
                          />
                          <p className="helper-text">
                            Amount from current account: {formatCurrency(Math.max(0, (Number(cost.amount) || 0) - (Number(fundingEditorForm.savingsAmount || 0) || 0)), displayCurrency)}
                          </p>
                        </div>
                      ) : null}
                      <div className="edit-actions">
                        <button className="primary-button small-button" type="button" onClick={() => saveFundingEditor(cost)}>
                          Save
                        </button>
                        <button className="secondary-button small-button" type="button" onClick={closeFundingEditor}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            )})}
          </ul>
          ) : (
            <p className="empty large-costs-empty">None due before payday.</p>
          )}
        </>
      ) : (
        <p className="empty large-costs-empty">
          Set your payday first, then ClearTill will show which large costs land before it.
        </p>
      )}

      {costsWithStatus.length ? (
        <Link className="summary-card-link" href="/big-costs">
          View big cost plan →
        </Link>
      ) : null}
    </section>
  );
}

export { LARGE_COST_CATEGORY_META, LARGE_COST_FREQUENCY_LABELS, LARGE_COST_FUNDING_META };
