"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { buildLargeCostDocument, formatCurrency, formatDisplayDate, normaliseLargeCostFundingStatus } from "@/lib/billMath";
import { getLargeCostFundingSourceLimits, resolveLargeCostContributions, roundCurrency } from "@/lib/largeCostPlanner";
import { safeError } from "@/lib/security/safeLog";
import { postDashboardLargeCostAction, runWithTimeout } from "../lib/dashboardApi";
import { friendlySettingsError } from "../lib/friendlyErrors";
import AffordabilityPlan from "./AffordabilityPlan";

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
    label: "Current balance",
    shortLabel: "Current balance",
    note: "Uses this pay cycle or a future pay period. Only the planned amount reduces daily spending room.",
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
  currentBalanceContribution: "0",
  savingsContribution: "0",
  dueDate: "",
  frequency: "one_off",
  category: "other",
  fundingStatus: "current_account",
};

function fundingFieldsForForm(form, amount) {
  const fundingStatus = normaliseLargeCostFundingStatus(form.fundingStatus);
  if (fundingStatus === "savings") {
    return { fundingStatus, currentBalanceContribution: 0, savingsContribution: amount };
  }
  if (fundingStatus === "split") {
    return {
      fundingStatus,
      currentBalanceContribution: roundCurrency(form.currentBalanceContribution),
      savingsContribution: roundCurrency(form.savingsContribution),
    };
  }
  return { fundingStatus: "current_account", currentBalanceContribution: amount, savingsContribution: 0 };
}

function validateFunding(fields, amount, limits) {
  if (fields.currentBalanceContribution < 0 || fields.savingsContribution < 0) return false;
  if (fields.savingsContribution > limits.savings) return false;
  if (fields.fundingStatus === "split" && fields.currentBalanceContribution > limits.currentBalance) return false;
  return roundCurrency(fields.currentBalanceContribution + fields.savingsContribution) === roundCurrency(amount);
}

function SplitFundingFields({ idPrefix, amount, values, onChange, limits, displayCurrency }) {
  const currentAmount = Number(values.currentBalanceContribution) || 0;
  const savingsAmount = Number(values.savingsContribution) || 0;
  const allocated = roundCurrency(currentAmount + savingsAmount);
  const remaining = roundCurrency(amount - allocated);

  function useRemaining(field, available) {
    const currentValue = field === "currentBalanceContribution" ? currentAmount : savingsAmount;
    if (remaining <= 0 || roundCurrency(currentValue + remaining) > roundCurrency(available)) return;
    onChange(field, String(roundCurrency(currentValue + remaining)));
  }

  return (
    <div className="split-funding-fields" data-testid="split-funding-fields">
      <div className="split-funding-inputs">
        <div className="field-row">
          <label className="field-label" htmlFor={`${idPrefix}-current`}>From current balance</label>
          <input
            id={`${idPrefix}-current`}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            max={limits.currentBalance}
            value={values.currentBalanceContribution}
            onChange={(event) => onChange("currentBalanceContribution", event.target.value)}
          />
          <button className="funding-use-remaining" type="button" onClick={() => useRemaining("currentBalanceContribution", limits.currentBalance)}>
            Use remaining
          </button>
          <span className="helper-text">Available through due date: {formatCurrency(limits.currentBalance, displayCurrency)}</span>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${idPrefix}-savings`}>From savings</label>
          <input
            id={`${idPrefix}-savings`}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            max={limits.savings}
            value={values.savingsContribution}
            onChange={(event) => onChange("savingsContribution", event.target.value)}
          />
          <button className="funding-use-remaining" type="button" onClick={() => useRemaining("savingsContribution", limits.savings)}>
            Use remaining
          </button>
          <span className="helper-text">Available savings: {formatCurrency(limits.savings, displayCurrency)}</span>
        </div>
      </div>
      <div className="split-funding-totals" aria-live="polite">
        <span>Total cost <strong>{formatCurrency(amount, displayCurrency)}</strong></span>
        <span>Amount allocated <strong>{formatCurrency(allocated, displayCurrency)}</strong></span>
        <span>Remaining to allocate <strong>{formatCurrency(remaining, displayCurrency)}</strong></span>
      </div>
    </div>
  );
}

export default function LargeCostForm({
  onLargeCostsChange,
  displayCurrency,
  hasPayday,
  todayIso,
  costsWithStatus,
  plannedCosts,
  unassignedAmount,
  planSummary,
  planningContext,
  onSavingsChange,
  onNotice,
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [fundingEditorCostId, setFundingEditorCostId] = useState("");
  const [fundingEditorForm, setFundingEditorForm] = useState({
    fundingStatus: "current_account",
    currentBalanceContribution: "0",
    savingsContribution: "0",
  });
  const [confirmationCostId, setConfirmationCostId] = useState("");
  const wrapperRef = useRef(null);

  const formAmount = Math.max(0, Number(form.amount) || 0);
  const editingOriginalSavings = editingId
    ? resolveLargeCostContributions(plannedCosts.find((cost) => cost.id === editingId) || {}).savingsContribution
    : 0;
  const formLimits = useMemo(() => getLargeCostFundingSourceLimits({
    todayIso,
    paydayDate: planningContext?.paydayDate,
    dueDate: form.dueDate || todayIso,
    currentBalance: planningContext?.currentBalance,
    incomeAmount: planningContext?.incomeAmount,
    savingsAvailable: (planningContext?.savingsAvailable || 0) + editingOriginalSavings,
  }), [editingOriginalSavings, form.dueDate, planningContext, todayIso]);
  const formFundingFields = fundingFieldsForForm(form, formAmount);
  const formAllocationValid = validateFunding(formFundingFields, formAmount, formLimits);
  const confirmationCost = costsWithStatus.find((cost) => cost.id === confirmationCostId);

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
    const contributions = resolveLargeCostContributions(cost);
    setError("");
    setEditingId(cost.id);
    setForm({
      name: cost.name || "",
      amount: cost.amount?.toString() || "",
      currentBalanceContribution: String(contributions.currentBalanceContribution),
      savingsContribution: String(contributions.savingsContribution),
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

    if (!form.name.trim() || !Number.isFinite(amount) || amount <= 0 || !form.dueDate) {
      setError("Add a name, amount, and due date before saving.");
      return;
    }
    if (!formAllocationValid) {
      setError("Allocate the full cost without exceeding the available current balance or savings.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        ...buildLargeCostDocument({
          name: form.name.trim(),
          amount,
          amountAlreadySaved: formFundingFields.savingsContribution,
          currentBalanceContribution: formFundingFields.currentBalanceContribution,
          savingsContribution: formFundingFields.savingsContribution,
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
      if (Number.isFinite(Number(result?.savingsTotalSetAside))) {
        onSavingsChange?.((current) => ({ ...(current || {}), totalSetAside: Number(result.savingsTotalSetAside) }));
      }
      onLargeCostsChange?.((current) => {
        const savedCost = { ...payload, id: resolvedCostId || `${Date.now()}` };
        const existingIndex = current.findIndex((cost) => cost.id === savedCost.id);

        if (existingIndex >= 0) {
          return current.map((cost) => (cost.id === savedCost.id ? { ...cost, ...savedCost } : cost));
        }

        return [...current, savedCost];
      });
      if (!editingId && resolvedCostId) setConfirmationCostId(resolvedCostId);
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
      const result = await postDashboardLargeCostAction("delete_large_cost", { costId });
      if (Number.isFinite(Number(result?.savingsTotalSetAside))) {
        onSavingsChange?.((current) => ({ ...(current || {}), totalSetAside: Number(result.savingsTotalSetAside) }));
      }
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
    const contributions = resolveLargeCostContributions(cost);
    setFundingEditorCostId(cost.id);
    setFundingEditorForm({
      fundingStatus: normaliseLargeCostFundingStatus(cost.fundingStatus),
      currentBalanceContribution: String(contributions.currentBalanceContribution),
      savingsContribution: String(contributions.savingsContribution),
    });
  }

  function closeFundingEditor() {
    setFundingEditorCostId("");
    setFundingEditorForm({ fundingStatus: "current_account", currentBalanceContribution: "0", savingsContribution: "0" });
  }

  async function saveFundingEditor(cost) {
    const amount = Number(cost.amount) || 0;
    const fundingStatus = normaliseLargeCostFundingStatus(fundingEditorForm.fundingStatus);
    const fields = fundingFieldsForForm({ ...fundingEditorForm, fundingStatus }, amount);
    const limits = getLargeCostFundingSourceLimits({
      todayIso,
      paydayDate: planningContext?.paydayDate,
      dueDate: cost.nextDueDate || cost.dueDate || todayIso,
      currentBalance: planningContext?.currentBalance,
      incomeAmount: planningContext?.incomeAmount,
      savingsAvailable: (planningContext?.savingsAvailable || 0) + resolveLargeCostContributions(cost).savingsContribution,
    });
    if (!validateFunding(fields, amount, limits)) {
      setError("Allocate the full cost without exceeding the available current balance or savings.");
      return;
    }

    setError("");

    try {
      const result = await postDashboardLargeCostAction("save_large_cost", {
        costId: cost.id,
        fields: {
          fundingStatus,
          amountAlreadySaved: fields.savingsContribution,
          currentBalanceContribution: fields.currentBalanceContribution,
          savingsContribution: fields.savingsContribution,
        },
      });
      if (Number.isFinite(Number(result?.savingsTotalSetAside))) {
        onSavingsChange?.((current) => ({ ...(current || {}), totalSetAside: Number(result.savingsTotalSetAside) }));
      }
      onLargeCostsChange?.((current) => current.map((entry) => (
        entry.id === cost.id ? {
          ...entry,
          fundingStatus,
          amountAlreadySaved: fields.savingsContribution,
          currentBalanceContribution: fields.currentBalanceContribution,
          savingsContribution: fields.savingsContribution,
        } : entry
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
          <h3 style={{ margin: 0 }}>Large Costs and affordability</h3>
          <p className="helper-text">Plan what to protect now and what can wait for a future pay period.</p>
        </div>
        <button className="secondary-button small-button" type="button" onClick={showForm ? resetForm : startCreate}>
          {showForm ? "Cancel" : "Add large cost"}
        </button>
      </div>

      {costsWithStatus.length ? (
        <div className="large-cost-dashboard-summary" data-testid="large-cost-dashboard-summary">
          <span><small>Protected this period</small><strong>{formatCurrency(planSummary?.currentPeriodProtected || 0, displayCurrency)}</strong></span>
          <span><small>Planned from future pay</small><strong>{formatCurrency(planSummary?.futurePeriodsPlanned || 0, displayCurrency)}</strong></span>
          <span><small>Savings being used</small><strong>{formatCurrency(planSummary?.savingsBeingUsed || 0, displayCurrency)}</strong></span>
          <span><small>Closest due date</small><strong>{planSummary?.closestDueDate ? formatDisplayDate(planSummary.closestDueDate) : "Not set"}</strong></span>
          <span><small>Overall state</small><strong>{String(planSummary?.affordabilityState || "Not calculated").replaceAll("_", " ")}</strong></span>
        </div>
      ) : null}

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
              {Object.entries(LARGE_COST_FUNDING_META).filter(([value]) => value !== "unassigned").map(([value, meta]) => (
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
            {form.fundingStatus === "split" ? (
              <SplitFundingFields
                idPrefix="large-cost-split"
                amount={formAmount}
                values={form}
                onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
                limits={formLimits}
                displayCurrency={displayCurrency}
              />
            ) : null}
          </div>
          <div className="edit-actions">
            <button className="primary-button small-button" type="submit" disabled={saving || !formAllocationValid}>
              {saving ? "Saving..." : editingId ? "Save changes" : "Add cost"}
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </form>
      ) : null}

      {confirmationCost?.affordabilityPlan ? (
        <div className="large-cost-confirmation" aria-live="polite">
          <strong>{confirmationCost.name} was added.</strong>
          <AffordabilityPlan plan={confirmationCost.affordabilityPlan} displayCurrency={displayCurrency} enableAi />
        </div>
      ) : null}

      {hasPayday ? (
        <>
          {unassignedAmount > 0 ? (
            <p className="forecast-unassigned-warning">
              You have {formatCurrency(unassignedAmount, displayCurrency)} of upcoming costs not assigned to a funding source. Your daily spending room may change.
            </p>
          ) : null}
          {plannedCosts.length ? (
          <ul className="forecast-compact-list">
            {plannedCosts.map((cost) => {
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
                      {formatCurrency(cost.currentBalanceContribution || cost.currentAccountAmount || 0, displayCurrency)} from current balance · {formatCurrency(cost.savingsContribution || 0, displayCurrency)} from savings
                    </span>
                  ) : null}
                  <AffordabilityPlan
                    plan={cost.affordabilityPlan}
                    displayCurrency={displayCurrency}
                    onAction={(action) => {
                      if (action === "Use more savings") openFundingEditor(cost);
                      else if (action === "Review bills") window.dispatchEvent(new CustomEvent("ct:focus-quick-action", { detail: { target: "bills" } }));
                      else if (action === "Review other Large Costs") wrapperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      else startEdit(cost);
                    }}
                  />
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
                          ["current_account", "Current balance"],
                          ["savings", "Savings"],
                          ["split", "Split"],
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
                        <SplitFundingFields
                          idPrefix={`funding-split-${cost.id}`}
                          amount={Number(cost.amount) || 0}
                          values={fundingEditorForm}
                          onChange={(field, value) => setFundingEditorForm((current) => ({ ...current, [field]: value }))}
                          limits={getLargeCostFundingSourceLimits({
                            todayIso,
                            paydayDate: planningContext?.paydayDate,
                            dueDate: cost.nextDueDate || cost.dueDate || todayIso,
                            currentBalance: planningContext?.currentBalance,
                            incomeAmount: planningContext?.incomeAmount,
                            savingsAvailable: (planningContext?.savingsAvailable || 0) + resolveLargeCostContributions(cost).savingsContribution,
                          })}
                          displayCurrency={displayCurrency}
                        />
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
            <p className="empty large-costs-empty">No Large Costs planned yet.</p>
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
