"use client";

import { useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/billMath";
import { safeError } from "@/lib/security/safeLog";
import { postDashboardSettingsAction } from "../lib/dashboardApi";
import { friendlySettingsError } from "../lib/friendlyErrors";

export default function SavingsEditor({
  savings,
  onSavingsChange,
  displayCurrency,
  protectedTotal,
  generalSavings = 0,
  assignedSavings = 0,
  assignedSavingsByCost = [],
  bigCostsCoveredBySavings = 0,
  fallbackCopy = "Not counted as daily spending money.",
}) {
  const [value, setValue] = useState(
    savings?.totalSetAside === undefined || savings?.totalSetAside === null ? "" : String(savings.totalSetAside),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setValue(savings?.totalSetAside === undefined || savings?.totalSetAside === null ? "" : String(savings.totalSetAside));
  }, [savings?.totalSetAside]);

  useEffect(() => {
    function handleFocusRequest(event) {
      if (event.detail?.target !== "savings") return;
      window.requestAnimationFrame(() => {
        wrapperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        inputRef.current?.focus();
        inputRef.current?.select?.();
      });
    }

    window.addEventListener("ct:focus-quick-action", handleFocusRequest);
    return () => window.removeEventListener("ct:focus-quick-action", handleFocusRequest);
  }, []);

  const costsWithSavings = assignedSavingsByCost.filter((cost) => (cost.amountAlreadySaved || 0) > 0);
  const underfundedCosts = costsWithSavings
    .map((cost) => ({
      ...cost,
      stillNeededAmount: Math.max(0, (Number(cost.amount) || 0) - (Number(cost.amountAlreadySaved) || 0)),
    }))
    .filter((cost) => cost.stillNeededAmount > 0);
  const savingsLeftAfterCosts = protectedTotal - bigCostsCoveredBySavings;

  async function handleSave(event) {
    event.preventDefault();

    const totalSetAside = Number(value || 0);

    if (!Number.isFinite(totalSetAside) || totalSetAside < 0) {
      setError("Savings not assigned to a big cost must be zero or more.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await postDashboardSettingsAction("save_savings", { totalSetAside });
      onSavingsChange?.({ ...(savings || {}), totalSetAside });
    } catch (saveError) {
      safeError("[firestore-settings-savings-save] failed", { code: saveError?.code });
      setError(friendlySettingsError(saveError, "We could not save your extra savings."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={wrapperRef} className="forecast-support-block">
      <h3 className="savings-section-label">Savings</h3>
      <p className="helper-text forecast-support-copy">Savings now means your total available savings.</p>
      <div className="savings-main-total">
        <span>Savings now</span>
        <strong>{formatCurrency(protectedTotal, displayCurrency)}</strong>
      </div>
      <div className="savings-breakdown-list">
        <div className="savings-breakdown-row">
          <span>Savings not assigned to a big cost</span>
          <strong>{formatCurrency(generalSavings, displayCurrency)}</strong>
        </div>
        {costsWithSavings.map((cost) => (
          <div key={cost.id} className="savings-breakdown-row">
            <span>Saved for {cost.name}</span>
            <strong>{formatCurrency(cost.amountAlreadySaved || 0, displayCurrency)}</strong>
          </div>
        ))}
        {bigCostsCoveredBySavings > 0 ? (
          <>
            <div className="savings-breakdown-row savings-deduction">
              <span>Planned big costs paid from savings</span>
              <strong>-{formatCurrency(bigCostsCoveredBySavings, displayCurrency)}</strong>
            </div>
            <div className="savings-breakdown-row savings-total">
              <span>Savings left after planned costs</span>
              <strong>{formatCurrency(savingsLeftAfterCosts, displayCurrency)}</strong>
            </div>
          </>
        ) : null}
        {underfundedCosts.map((cost) => (
          <div key={`needed-${cost.id}`} className="savings-breakdown-row savings-needed">
            <span>Still needed for {cost.name}</span>
            <strong>{formatCurrency(cost.stillNeededAmount || 0, displayCurrency)}</strong>
          </div>
        ))}
      </div>
      <p className="helper-text forecast-support-copy">
        Savings not assigned to a big cost means money you have saved but have not linked to a specific planned cost.
      </p>
      <p className="helper-text forecast-support-copy">{fallbackCopy}</p>
      <form className="chat-form forecast-inline-form" onSubmit={handleSave}>
        <div className="field-row">
          <label className="field-label" htmlFor="savings-set-aside">Savings not assigned to a big cost</label>
          <div className="chat-input-row">
            <input
              ref={inputRef}
              id="savings-set-aside"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="2000"
            />
            <button className="secondary-button" type="submit" disabled={saving}>
              {saving ? "Updating..." : "Update savings"}
            </button>
          </div>
        </div>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
