"use client";

import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import BalanceEditor from "./BalanceEditor";
import AddBills from "./AddBills";

function getSetupChipState(stepNumber, setupStep) {
  if (setupStep > stepNumber) return "complete";
  if (setupStep === stepNumber) return "current";
  return "waiting";
}

const STEP_META = {
  1: {
    title: "Add your current available money",
    detail: "Start with your current available money so ClearTill can calculate today’s cash runway.",
  },
  2: {
    title: "Add an income schedule",
    detail: "Add at least one active income source. It can be monthly, weekly, fortnightly, four-weekly or irregular.",
  },
  3: {
    title: "Add your bills",
    detail: "Bills are optional, but adding them makes your forecast more useful.",
  },
};

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
  onFinishBillsStep,
}) {
  const meta = STEP_META[setupStep] || STEP_META[3];
  const billCount = bills?.length || 0;

  return (
    <main className="dashboard-shell setup-wizard-shell">
      <section className="setup-wizard">
        <Logo className="eyebrow-logo" />
        <TrustShield className="setup-trust-banner" compact />
        <div className="setup-wizard-progress" aria-label="Setup progress">
          <span className={`setup-chip ${getSetupChipState(1, setupStep)}`}>1</span>
          <span className={`setup-chip ${getSetupChipState(2, setupStep)}`}>2</span>
          <span className={`setup-chip ${getSetupChipState(3, setupStep)}`}>3</span>
        </div>
        <h1>{meta.title}</h1>
        <p className="helper-text">{meta.detail}</p>

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
        ) : (
          <>
            <AddBills
              bills={bills}
              onBillsChange={onBillsChange}
              hasIncome={hasIncome}
              hasBalanceSnapshot={hasBalanceSnapshot}
              hasPayday={hasPayday}
              displayCurrency={displayCurrency}
              autoFocusOnMount
            />
            <div className="setup-wizard-bills-progress">
              {billCount > 0 ? <>
                <p className="helper-text setup-wizard-bills-tally">
                  {billCount} bill{billCount === 1 ? "" : "s"} added
                  {billCount === 1 ? " — add another, or continue when you're ready." : "."}
                </p>
                <ul className="setup-wizard-bills-list">
                  {bills.map((bill) => (
                    <li key={bill.id}>{bill.name}</li>
                  ))}
                </ul>
              </> : <p className="helper-text">You can add bills later from the dashboard.</p>}
              <button className="primary-button" type="button" onClick={onFinishBillsStep}>Continue to dashboard</button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
