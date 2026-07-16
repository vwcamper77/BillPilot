"use client";

import Link from "next/link";
import { useState } from "react";
import Logo from "@/components/Logo";
import { formatCurrency, formatDisplayDate } from "@/lib/billMath";
import BalanceEditor from "./BalanceEditor";
import AddBills from "./AddBills";

const STEPS = ["Balance", "Payday", "Upcoming costs", "Your position"];

export default function SetupWizard({
  setupStep,
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
  bills,
  onBillsChange,
  hasIncome,
  paydayDate,
  nextIncomeDate,
  spendingRoomUntilPayday,
  dailySpendingRoom,
  daysTillPayday,
  confirmedIncomeThroughHorizon,
  forecastAtHorizon,
  onComplete,
}) {
  const [reviewingCosts, setReviewingCosts] = useState(false);
  const billCount = bills?.length || 0;
  const committed = Math.max(0, Number(currentBalance) - Number(spendingRoomUntilPayday));
  const title = setupStep === 1
    ? "What money is available right now?"
    : setupStep === 2
      ? "When are you next paid?"
      : setupStep === 3
        ? "What still needs to come out before then?"
        : "Your first ClearTill position";

  return (
    <main className={`dashboard-shell setup-wizard-shell setup-step-${setupStep}`}>
      <header className="setup-header">
        <Link href="/" aria-label="ClearTill home"><Logo className="eyebrow-logo" /></Link>
        <Link className="setup-sign-in" href="/dashboard?auth=signin">Sign in</Link>
      </header>

      <nav className="setup-progress" aria-label="Setup progress">
        {STEPS.map((label, index) => {
          const number = index + 1;
          return (
            <div className={`setup-progress-step${number === setupStep ? " is-current" : ""}${number < setupStep ? " is-complete" : ""}`} key={label} aria-current={number === setupStep ? "step" : undefined}>
              <span>{number < setupStep ? "✓" : number}</span><strong>{label}</strong>
            </div>
          );
        })}
      </nav>

      <section className="setup-wizard">
        {setupStep < 4 ? <p className="setup-eyebrow">Step {setupStep} of 3</p> : <p className="setup-eyebrow">Your first ClearTill position</p>}
        <h1>{title}</h1>
        {setupStep === 1 ? <p className="helper-text">Enter the amount currently available to use. You can update this whenever it changes.</p> : null}
        {setupStep === 2 ? <p className="helper-text">Add your next pay date and the amount you expect, where known.</p> : null}
        {setupStep === 3 ? <p className="helper-text">Add regular bills and one-off costs that will leave your account before payday.</p> : null}

        {setupStep <= 2 ? (
          <BalanceEditor
            open
            focusPayday={setupStep === 2}
            hasBalanceSnapshot={hasBalanceSnapshot}
            currentBalance={currentBalance}
            balanceInput={balanceInput}
            onBalanceInputChange={onBalanceInputChange}
            balanceError={balanceError}
            savingBalance={savingBalance}
            onSubmitBalance={onSubmitBalance}
            income={income}
            hasPayday={hasPayday}
            hasIncomeAmount={hasIncomeAmount}
            hasBills={hasBills}
            totalMonthlyBills={totalMonthlyBills}
            monthlySpendingRoomValue={monthlySpendingRoomValue}
            editingIncome={editingIncome}
            onSetEditingIncome={onSetEditingIncome}
            incomeForm={incomeForm}
            onIncomeFormChange={onIncomeFormChange}
            savingEdit={savingEdit}
            editError={editError}
            onSubmitIncome={onSubmitIncome}
            incomeEvents={incomeEvents}
            onIncomeEventsChange={onIncomeEventsChange}
            todayIso={todayIso}
            onNotice={onNotice}
            displayCurrency={displayCurrency}
            onCurrencySelect={onCurrencySelect}
          />
        ) : setupStep === 3 ? (
          <>
            <div className="setup-cost-groups"><span>Regular bills</span><span>One-off costs</span></div>
            <AddBills
              bills={bills}
              onBillsChange={onBillsChange}
              hasIncome={hasIncome}
              hasBalanceSnapshot={hasBalanceSnapshot}
              hasPayday={hasPayday}
              displayCurrency={displayCurrency}
              autoFocusOnMount
            />
            <p className="setup-completeness-prompt">Have you included subscriptions, travel, childcare, school costs and anything unusual this month?</p>
            {!billCount ? <p className="helper-text">Add at least one cost to see your first position.</p> : null}
          </>
        ) : reviewingCosts ? (
          <div className="first-position-review">
            <AddBills bills={bills} onBillsChange={onBillsChange} hasIncome={hasIncome} hasBalanceSnapshot={hasBalanceSnapshot} hasPayday={hasPayday} displayCurrency={displayCurrency} autoFocusOnMount />
            <button className="primary-button" type="button" onClick={() => setReviewingCosts(false)}>Return to my position</button>
          </div>
        ) : (
          <div className="first-position">
            <div className="first-position-result">
              <small>Available now</small>
              <strong>{formatCurrency(currentBalance, displayCurrency)}</strong>
              <span>{spendingRoomUntilPayday < 0 ? `You’re ${formatCurrency(Math.abs(spendingRoomUntilPayday), displayCurrency)} short before your next income.` : `${formatCurrency(spendingRoomUntilPayday, displayCurrency)} is safe until your next income.`}</span>
              <span>{formatCurrency(Math.max(0, dailySpendingRoom), displayCurrency)} per day until {formatDisplayDate(nextIncomeDate)}</span>
            </div>
            <div className="first-position-calculation" aria-label="Your first position calculation">
              <span><small>Available now</small><strong>{formatCurrency(currentBalance, displayCurrency)}</strong></span>
              <span><small>Bills and planned costs</small><strong>− {formatCurrency(committed, displayCurrency)}</strong></span>
              <span><small>Safe until next income</small><strong>{spendingRoomUntilPayday < 0 ? `− ${formatCurrency(Math.abs(spendingRoomUntilPayday), displayCurrency)}` : formatCurrency(spendingRoomUntilPayday, displayCurrency)}</strong></span>
            </div>
            <div className="forecast-summary"><span><small>Confirmed income coming</small><strong>{formatCurrency(confirmedIncomeThroughHorizon, displayCurrency)}</strong></span><span><small>Forecast left by {formatDisplayDate(paydayDate)}</small><strong>{forecastAtHorizon < 0 ? `− ${formatCurrency(Math.abs(forecastAtHorizon), displayCurrency)}` : formatCurrency(forecastAtHorizon, displayCurrency)}</strong></span></div>
            <div className="first-position-check">
              <strong>Based on:</strong>
              <span>✓ Balance updated today</span>
              <span>✓ Payday on {formatDisplayDate(paydayDate)}</span>
              <span>✓ {billCount} listed cost{billCount === 1 ? "" : "s"}</span>
              <p>Is anything missing?</p>
              <button className="text-button" type="button" onClick={() => setReviewingCosts(true)}>Review my costs</button>
            </div>
            <button className="primary-button setup-complete-button" type="button" onClick={onComplete}>Save this position and start my 7-day live preview</button>
            <p className="setup-supporting-copy">No bank connection. No card required. Nothing is charged when the preview ends.</p>
          </div>
        )}
      </section>
    </main>
  );
}
