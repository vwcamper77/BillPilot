"use client";

import { useEffect, useRef, useState } from "react";
import { formatCurrency, formatOrdinal, isValidDueDay } from "@/lib/billMath";
import { logSecurityEventClient } from "@/lib/security/clientSecurity";
import { safeError } from "@/lib/security/safeLog";
import { trackEvent } from "@/lib/analytics/track";
import { postDashboardSettingsAction, saveIncome as saveIncomeRequest } from "../lib/dashboardApi";
import { friendlySettingsError } from "../lib/friendlyErrors";
import { getScrollBehavior } from "../lib/billHelpers";

const BALANCE_HELPER_TEXT = "This is just the money currently available in your account, so ClearTill can show today’s cash position after bills.";
const BALANCE_MISSING_FORECAST_COPY = "Add your current available money to see today’s exact cash forecast.";

function isValidIncomeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0;
}

function getIncomeStatusText(income, hasIncomeAmount, hasPayday, currency = "GBP") {
  if (hasIncomeAmount && hasPayday) {
    return `${formatCurrency(income.amount, currency)} on the ${formatOrdinal(income.payDay)} of each month.`;
  }
  if (hasIncomeAmount) {
    return "Add payday";
  }
  if (hasPayday) {
    return `Payday: ${formatOrdinal(income.payDay)} of each month`;
  }
  return "No payday set yet.";
}

export default function BalanceEditor({
  open,
  focusPayday,
  onConsumeFocusPayday,
  onRequestClose,

  account,
  onBalanceChange,
  hasBalanceSnapshot,
  currentBalance,
  balanceSnapshotLabel,

  income,
  onIncomeChange,
  hasPayday,
  hasIncomeAmount,
  hasBills,
  totalMonthlyBills,
  monthlySpendingRoomValue,

  displayCurrency,
  onCurrencyChange,

  onBalanceSaved,
  onIncomeSaved,
}) {
  const [balanceInput, setBalanceInput] = useState(
    account?.currentBalance === undefined || account?.currentBalance === null
      ? ""
      : String(account.currentBalance),
  );
  const [balanceError, setBalanceError] = useState("");
  const [savingBalance, setSavingBalance] = useState(false);

  const [editingIncome, setEditingIncome] = useState(false);
  const [incomeForm, setIncomeForm] = useState({
    amount: income?.amount === null || income?.amount === undefined ? "" : String(income.amount),
    payDay: income?.payDay === null || income?.payDay === undefined ? "" : String(income.payDay),
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  const balanceInputRef = useRef(null);
  const paydayAmountInputRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setBalanceInput(
      account?.currentBalance === undefined || account?.currentBalance === null
        ? ""
        : String(account.currentBalance),
    );
  }, [account?.currentBalance]);

  useEffect(() => {
    setIncomeForm({
      amount: income?.amount === null || income?.amount === undefined ? "" : String(income.amount),
      payDay: income?.payDay === null || income?.payDay === undefined ? "" : String(income.payDay),
    });
  }, [income?.amount, income?.payDay]);

  useEffect(() => {
    if (!open) return;

    window.requestAnimationFrame(() => {
      if (focusPayday) {
        setEditingIncome(true);
        wrapperRef.current?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" });
        window.setTimeout(() => {
          paydayAmountInputRef.current?.focus();
          paydayAmountInputRef.current?.select?.();
        }, 180);
        onConsumeFocusPayday?.();
      } else {
        wrapperRef.current?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" });
        window.setTimeout(() => {
          balanceInputRef.current?.focus();
          balanceInputRef.current?.select?.();
        }, 180);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusPayday]);

  function handleBalanceInputFocus(event) {
    event.currentTarget.select();
  }

  async function handleSkipBalance() {
    setBalanceError("");
    const previousBalance = account?.currentBalance ?? null;
    onBalanceChange?.({ currentBalance: null });
    setBalanceInput("");

    try {
      await postDashboardSettingsAction("save_balance", {
        currentBalance: null,
        currency: "GBP",
        snapshotEntered: false,
      });
    } catch (saveError) {
      safeError("[dashboard-settings-balance-skip] failed", { code: saveError?.code });
      onBalanceChange?.({ currentBalance: previousBalance });
    }
  }

  async function handleBalanceSave(event) {
    event.preventDefault();

    const trimmedBalanceInput = balanceInput.trim();

    if (!trimmedBalanceInput) {
      await handleSkipBalance();
      return;
    }

    const parsedBalance = Number(trimmedBalanceInput);

    if (!Number.isFinite(parsedBalance)) {
      setBalanceError("Add your current available money as a number.");
      return;
    }

    const previousBalance = account?.currentBalance ?? null;

    setBalanceError("");
    setBalanceInput(parsedBalance.toString());
    setSavingBalance(true);
    onBalanceChange?.({ currentBalance: parsedBalance });

    try {
      await postDashboardSettingsAction("save_balance", {
        currentBalance: parsedBalance,
        currency: "GBP",
        snapshotEntered: true,
      });
      logSecurityEventClient("balance_updated");
      onBalanceSaved?.();
    } catch (saveError) {
      safeError("[dashboard-settings-balance-save] failed", { code: saveError?.code });
      onBalanceChange?.({ currentBalance: previousBalance });
      setBalanceError(friendlySettingsError(saveError, "Current available money could not be saved."));
    } finally {
      setSavingBalance(false);
    }
  }

  async function handleCurrencySave(currency) {
    onCurrencyChange?.(currency);
    setBalanceError("");
    try {
      await postDashboardSettingsAction("save_preferences", { currency });
    } catch (saveError) {
      safeError("[dashboard-settings-preferences-save] failed", { code: saveError?.code });
      setBalanceError(friendlySettingsError(saveError, "Display currency could not be saved."));
    }
  }

  async function handleIncomeSave(event) {
    event.preventDefault();

    const amount = Number(incomeForm.amount);
    const payDay = Number(incomeForm.payDay);

    if (!Number.isFinite(amount) || amount < 0) {
      setEditError("Enter your monthly income amount.");
      return;
    }

    if (!Number.isInteger(payDay) || payDay < 1 || payDay > 31) {
      setEditError("Enter a payday between 1 and 31.");
      return;
    }

    const previousIncome = income;
    const nextIncome = { name: income?.name || "Payday", amount, payDay, currency: "GBP" };

    setSavingEdit(true);
    setEditError("");
    setIncomeForm({ amount: amount.toString(), payDay: payDay.toString() });
    onIncomeChange?.(nextIncome);
    setEditingIncome(false);

    try {
      await saveIncomeRequest(nextIncome, Boolean(income));
      trackEvent("payday_added");
      onIncomeSaved?.();
    } catch (saveError) {
      safeError("[firestore-payday-save] failed", { code: saveError?.code });
      onIncomeChange?.(previousIncome);
      setEditingIncome(true);
      setEditError(friendlySettingsError(saveError, "We could not save your forecast settings."));
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div ref={wrapperRef} className={`balance-editor${open ? "" : " is-collapsed"}`} inert={!open}>
      <div className="balance-editor-inner">
        <section className="chat-panel balance-action-card">
          <div className="section-head">
            <div>
              <h2 style={{ margin: 0 }}>Current Balance</h2>
              <p className="helper-text balance-copy">Update this when your cash position changes. ClearTill uses it to work out what is still clear to spend till payday.</p>
            </div>
            {onRequestClose ? (
              <button className="secondary-button small-button" type="button" onClick={onRequestClose}>
                Close
              </button>
            ) : null}
          </div>
          <p className="balance-action-value">
            {hasBalanceSnapshot ? formatCurrency(currentBalance, displayCurrency) : BALANCE_MISSING_FORECAST_COPY}
          </p>
          <form className="chat-form" onSubmit={handleBalanceSave}>
            <div className="field-row">
              <label className="field-label" htmlFor="account-balance">
                Current Balance
              </label>
              <div className="chat-input-row">
                <input
                  ref={balanceInputRef}
                  id="account-balance"
                  inputMode="decimal"
                  value={balanceInput}
                  onChange={(event) => setBalanceInput(event.target.value)}
                  onFocus={handleBalanceInputFocus}
                  onClick={handleBalanceInputFocus}
                  placeholder="Current Balance"
                />
                <button className="secondary-button" type="submit" disabled={savingBalance}>
                  {savingBalance ? "Saving..." : "Update"}
                </button>
              </div>
            </div>
          </form>
          <p className="helper-text balance-copy" style={{ marginTop: "8px" }}>{BALANCE_HELPER_TEXT}</p>
          <button className="secondary-button small-button" type="button" onClick={handleSkipBalance} style={{ marginTop: "8px" }}>
            Skip for now
          </button>
          {hasBalanceSnapshot ? (
            <div className="helper-text balance-copy">
              <p>{balanceSnapshotLabel}</p>
              <p>Still around {formatCurrency(currentBalance, displayCurrency)}? Update it whenever that changes.</p>
            </div>
          ) : null}
          <div className="field-row" style={{ marginTop: "14px" }}>
            <label className="field-label" htmlFor="display-currency">Display currency</label>
            <select
              id="display-currency"
              className="currency-select"
              value={displayCurrency}
              onChange={(e) => handleCurrencySave(e.target.value)}
            >
              <option value="GBP">GBP £</option>
              <option value="EUR">EUR €</option>
              <option value="USD">USD $</option>
            </select>
          </div>
          {balanceError ? <p className="error">{balanceError}</p> : null}
        </section>

        <section className="bill-section">
          <div className="section-head">
            <h3>When do you get paid?</h3>
            <button
              className="secondary-button small-button"
              type="button"
              onClick={() => setEditingIncome((current) => !current)}
            >
              {editingIncome ? "Cancel" : income ? "Edit" : "Set"}
            </button>
          </div>
          {editingIncome ? (
            <form className="edit-form" onSubmit={handleIncomeSave}>
              <label className="field-label" htmlFor="payday-amount">Amount</label>
              <input
                ref={paydayAmountInputRef}
                id="payday-amount"
                inputMode="decimal"
                value={incomeForm.amount}
                onChange={(event) => setIncomeForm((current) => ({ ...current, amount: event.target.value }))}
                placeholder="Monthly income"
              />
              <label className="field-label" htmlFor="payday-day">When do you get paid?</label>
              <input
                id="payday-day"
                inputMode="numeric"
                value={incomeForm.payDay}
                onChange={(event) => setIncomeForm((current) => ({ ...current, payDay: event.target.value }))}
                placeholder="Day of month"
              />
              <div className="edit-actions">
                <button className="primary-button" type="submit" disabled={savingEdit}>
                  {savingEdit ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="helper-text">{getIncomeStatusText(income, hasIncomeAmount, isValidDueDay(income?.payDay), displayCurrency)}</p>
              {income && hasIncomeAmount ? (
                <div className="helper-text helper-tooltip">
                  <p>Expected monthly income: {formatCurrency(Number(income.amount), displayCurrency)}</p>
                  {hasBills ? (
                    <>
                      <p>Monthly bills: {formatCurrency(totalMonthlyBills, displayCurrency)}</p>
                      <p>Monthly spending room: {monthlySpendingRoomValue}</p>
                    </>
                  ) : null}
                </div>
              ) : null}
              {income && hasIncomeAmount && !hasPayday ? (
                <p className="helper-text helper-tooltip">Add payday</p>
              ) : null}
              {income && hasPayday && !hasIncomeAmount ? (
                <p className="helper-text helper-tooltip">Add income amount if you want ClearTill to show monthly spending room.</p>
              ) : null}
            </>
          )}
          {!hasBalanceSnapshot ? (
            <p className="helper-text helper-tooltip">
              Add your current available money first so ClearTill can forecast what may be left.
            </p>
          ) : null}
          {editError ? <p className="error">{editError}</p> : null}
        </section>
      </div>
    </div>
  );
}
