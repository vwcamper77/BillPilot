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
    detail: "ClearTill works best when you start with your current available money, even if you want to skip it for now.",
  },
  2: {
    title: "When do you get paid?",
    detail: "Once your payday is set, ClearTill can show what lands before payday.",
  },
  3: {
    title: "Add your bills",
    detail: "Add your bills to build the forecast and runway.",
  },
};

export default function SetupWizard({
  setupStep,
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
  bills,
  onBillsChange,
  hasIncome,
}) {
  const meta = STEP_META[setupStep] || STEP_META[3];

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
            account={account}
            onBalanceChange={onBalanceChange}
            hasBalanceSnapshot={hasBalanceSnapshot}
            currentBalance={currentBalance}
            balanceSnapshotLabel={balanceSnapshotLabel}
            income={income}
            onIncomeChange={onIncomeChange}
            hasPayday={hasPayday}
            hasIncomeAmount={hasIncomeAmount}
            hasBills={hasBills}
            totalMonthlyBills={totalMonthlyBills}
            monthlySpendingRoomValue={monthlySpendingRoomValue}
            displayCurrency={displayCurrency}
            onCurrencyChange={onCurrencyChange}
          />
        ) : (
          <AddBills
            bills={bills}
            onBillsChange={onBillsChange}
            hasIncome={hasIncome}
            hasBalanceSnapshot={hasBalanceSnapshot}
            hasPayday={hasPayday}
            displayCurrency={displayCurrency}
            autoFocusOnMount
          />
        )}
      </section>
    </main>
  );
}
