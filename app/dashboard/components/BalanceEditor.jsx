"use client";

import { useEffect, useRef } from "react";
import { formatCurrency, formatOrdinal, isValidDueDay } from "@/lib/billMath";
import { getScrollBehavior } from "../lib/billHelpers";
import AdditionalIncomeEditor from "./AdditionalIncomeEditor";

const BALANCE_HELPER_TEXT = "This is just the money currently available in your account, so ClearTill can show today’s cash position after bills.";
const BALANCE_MISSING_FORECAST_COPY = "Add your current available money to see today’s exact cash forecast.";

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

        <section className="bill-section">
          <div className="section-head">
            <h3>When do you get paid?</h3>
            <button
              className="secondary-button small-button"
              type="button"
              onClick={() => onSetEditingIncome(!editingIncome)}
            >
              {editingIncome ? "Cancel" : income ? "Edit" : "Set"}
            </button>
          </div>
          {editingIncome ? (
            <form className="edit-form" onSubmit={onSubmitIncome}>
              <label className="field-label" htmlFor="payday-amount">Amount</label>
              <input
                ref={paydayAmountInputRef}
                id="payday-amount"
                inputMode="decimal"
                value={incomeForm.amount}
                onChange={(event) => onIncomeFormChange((current) => ({ ...current, amount: event.target.value }))}
                placeholder="Monthly income"
              />
              <label className="field-label" htmlFor="payday-day">When do you get paid?</label>
              <input
                id="payday-day"
                inputMode="numeric"
                value={incomeForm.payDay}
                onChange={(event) => onIncomeFormChange((current) => ({ ...current, payDay: event.target.value }))}
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
          {hasPayday && hasIncomeAmount ? (
            <AdditionalIncomeEditor
              incomeEvents={incomeEvents}
              onIncomeEventsChange={onIncomeEventsChange}
              todayIso={todayIso}
              displayCurrency={displayCurrency}
              onNotice={onNotice}
            />
          ) : null}
          {editError ? <p className="error">{editError}</p> : null}
        </section>
      </div>
    </div>
  );
}
