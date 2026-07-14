"use client";

import { useEffect, useRef } from "react";
import { calculateIncomeSchedule, formatCurrency, formatOrdinal, isValidDueDay } from "@/lib/billMath";
import { getScrollBehavior } from "../lib/billHelpers";
import AdditionalIncomeEditor from "./AdditionalIncomeEditor";

const BALANCE_HELPER_TEXT = "This is just the money currently available in your account, so ClearTill can show today’s cash position after bills.";
const BALANCE_MISSING_FORECAST_COPY = "Add your current available money to see today’s exact cash forecast.";

export default function BalanceEditor({
  open,
  focusPayday,
  onConsumeFocusPayday,
  onRequestClose,

  hasBalanceSnapshot,
  currentBalance,
  balanceInput,
  onBalanceInputChange,
  balanceError,
  savingBalance,
  onSubmitBalance,

  income,
  hasPayday,
  hasIncomeAmount,
  hasBills,
  totalMonthlyBills,
  monthlySpendingRoomValue,
  editingIncome,
  onSetEditingIncome,
  incomeForm,
  onIncomeFormChange,
  savingEdit,
  editError,
  onSubmitIncome,

  incomeEvents,
  onIncomeEventsChange,
  todayIso,
  onNotice,

  displayCurrency,
  onCurrencySelect,
}) {
  const balanceInputRef = useRef(null);
  const paydayAmountInputRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    window.requestAnimationFrame(() => {
      if (focusPayday) {
        onSetEditingIncome?.(true);
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

  const selectedPaydayDate = isValidDueDay(incomeForm.payDay)
    ? calculateIncomeSchedule(incomeForm.payDay, todayIso).nextPayDate
    : "";

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
          <form className="chat-form" onSubmit={onSubmitBalance}>
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
                  onChange={(event) => onBalanceInputChange(event.target.value)}
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
          <div className="field-row" style={{ marginTop: "14px" }}>
            <label className="field-label" htmlFor="display-currency">Display currency</label>
            <select
              id="display-currency"
              className="currency-select"
              value={displayCurrency}
              onChange={(e) => onCurrencySelect(e.target.value)}
            >
              <option value="GBP">GBP £</option>
              <option value="EUR">EUR €</option>
              <option value="USD">USD $</option>
            </select>
          </div>
          {balanceError ? <p className="error">{balanceError}</p> : null}
        </section>

        <section className="income-schedule-card" data-testid="income-schedule-card">
          <div className="income-schedule-header">
            <div>
              <span className="income-schedule-kicker">Income schedule</span>
              <h2>Income schedule</h2>
              <p>Add every source of income you rely on. A monthly salary is the common starting point, but it is not required.</p>
            </div>
          </div>
          {!hasBalanceSnapshot ? (
            <p className="helper-text helper-tooltip">
              Add your current available money first so ClearTill can forecast what may be left.
            </p>
          ) : null}
          <AdditionalIncomeEditor
            incomeEvents={incomeEvents}
            onIncomeEventsChange={onIncomeEventsChange}
            todayIso={todayIso}
            displayCurrency={displayCurrency}
            onNotice={onNotice}
            defaultExpanded={!incomeEvents?.some((source) => source?.active !== false)}
          />
          {editError ? <p className="error">{editError}</p> : null}
        </section>
      </div>
    </div>
  );
}
