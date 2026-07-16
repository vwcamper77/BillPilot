"use client";

import { useState } from "react";
import { formatCurrency, formatDisplayDate } from "@/lib/billMath";
import FinancialDisclosure from "./FinancialDisclosure";

export default function HeroCard({
  status,
  hasBalanceSnapshot,
  spendingRoomUntilPayday,
  dailySpendingRoom,
  daysTillPayday,
  displayCurrency,
  onUpdateBalance,
  breakdownProps,
  nextCommitments = [],
  balanceFreshness,
  balanceIsStale = false,
  estimatedIncome = 0,
  timingConstrained = false,
}) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const hasResult = hasBalanceSnapshot && spendingRoomUntilPayday !== null;
  const availableNow = Number(breakdownProps.currentBalance) || 0;
  const safeUntilNextIncome = Number(spendingRoomUntilPayday) || 0;
  const billsBeforeIncome = Math.max(0, Number(breakdownProps.totalBeforePayday) || 0);
  const protectedBeforeIncome = Math.max(0, Number(breakdownProps.bigCostsDueBeforePayday) || 0);
  const committedBeforeIncome = Math.max(0, Number(breakdownProps.totalCommittedBeforeIncome) || 0);
  const nextIncomeDate = breakdownProps.nextIncome?.date || null;
  const immediateBoundary = nextIncomeDate ? formatDisplayDate(nextIncomeDate) : formatDisplayDate(breakdownProps.horizonDate);
  const safeShare = availableNow > 0 ? Math.max(0, Math.min(100, safeUntilNextIncome / availableNow * 100)) : 0;
  const showDaily = hasResult && dailySpendingRoom !== null;
  const resultText = !hasBalanceSnapshot
    ? "Add your current balance"
    : safeUntilNextIncome < 0
      ? `You’re ${formatCurrency(Math.abs(safeUntilNextIncome), displayCurrency)} short before your next income.`
      : committedBeforeIncome === 0
        ? `You have ${formatCurrency(availableNow, displayCurrency)} available until your next income.`
        : `You’re clear: ${formatCurrency(safeUntilNextIncome, displayCurrency)} available until your next income.`;

  function openBills(focusAdd = false, focusHeading = false) {
    window.dispatchEvent(new CustomEvent("ct:open-section", {
      detail: {
        key: "bills",
        focusHeading,
        highlight: focusHeading,
        announcement: focusHeading ? "Bills and regular income opened." : undefined,
      },
    }));
    if (focusAdd) window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("ct:focus-quick-action", { detail: { target: "add-bills" } })));
  }

  function commitmentTypeLabel(type) {
    if (type === "bill") return "Bill";
    if (type === "large_cost") return "Protected contribution";
    return "Planned cost";
  }

  return (
    <article className={`hero-card hero-card-${status || "setup"}`} aria-labelledby="dashboard-result">
      <div className="hero-result-row">
        <div className="hero-result-copy">
          <p className="hero-eyebrow">{hasResult ? `How much of my ${formatCurrency(availableNow, displayCurrency)} is safe before more money arrives?` : "Complete your position"}</p>
          <h1 className="hero-value" id="dashboard-result">{resultText}</h1>
          {showDaily ? <p className="hero-daily">{formatCurrency(Math.max(0, dailySpendingRoom), displayCurrency)} per day until {immediateBoundary}</p> : null}
          {safeUntilNextIncome < 0 ? <p className="hero-confidence-note">Your safe daily amount is £0 until the shortfall is covered.</p> : null}
          {hasResult ? <p className="hero-evidence">Based on your {formatCurrency(availableNow, displayCurrency)} balance and {formatCurrency(committedBeforeIncome, displayCurrency)} committed before then.</p> : null}
          {timingConstrained ? <p className="hero-confidence-note">A cost and income share a date. ClearTill has conservatively counted the cost first.</p> : null}
          {estimatedIncome > 0 ? <p className="hero-confidence-note">Estimated income of {formatCurrency(estimatedIncome, displayCurrency)} is visible below but is not counted.</p> : null}
        </div>
        {hasBalanceSnapshot ? (
          <div className={`freshness-card${balanceIsStale ? " is-stale" : ""}`}>
            <span>{balanceIsStale ? "Balance needs checking" : "Balance up to date"}</span>
            <strong>{balanceFreshness || "Update time unavailable"}</strong>
          </div>
        ) : null}
      </div>

      {hasResult ? (
        <>
          <div className="hero-formula" aria-label="Cash available before the next income">
            <span data-testid="hero-available-now"><small>Available now</small><strong>{formatCurrency(availableNow, displayCurrency)}</strong></span>
            <span data-testid="hero-committed"><small>Committed before next income</small><strong>{formatCurrency(committedBeforeIncome, displayCurrency)}</strong></span>
            <span className="is-result" data-testid="hero-safe"><small>Safe until your next income</small><strong>{safeUntilNextIncome < 0 ? `− ${formatCurrency(Math.abs(safeUntilNextIncome), displayCurrency)}` : formatCurrency(safeUntilNextIncome, displayCurrency)}</strong></span>
          </div>
          <div className="allocation-block">
            <div className="allocation-labels"><span><i className="allocation-key is-available" />{formatCurrency(Math.max(0, safeUntilNextIncome), displayCurrency)} safe before income</span><span><i className="allocation-key is-committed" />{formatCurrency(committedBeforeIncome, displayCurrency)} allocated before income</span></div>
            <div className="allocation-track" role="img" aria-label={`${formatCurrency(Math.max(0, safeUntilNextIncome), displayCurrency)} safe and ${formatCurrency(committedBeforeIncome, displayCurrency)} allocated before the next income`}><span className="allocation-available" style={{ width: `${safeShare}%` }} /></div>
          </div>
          <button className="text-button hero-breakdown-toggle" type="button" onClick={() => setBreakdownOpen((open) => !open)} aria-expanded={breakdownOpen} aria-controls="hero-breakdown">See full calculation</button>
        </>
      ) : null}

      <div className="hero-lower-grid">
        <section className="next-commitments" aria-labelledby="next-commitments-title">
          <div className="hero-section-heading"><h2 id="next-commitments-title">Committed before your next income</h2></div>
          {nextCommitments.length ? <ul>{nextCommitments.map((item) => <li key={`${item.type}-${item.id}-${item.date}`}><span className={`commitment-type commitment-type-${item.type}`}>{commitmentTypeLabel(item.type)}</span><span title={item.name}>{item.name}</span><strong>{formatCurrency(item.amount, displayCurrency)}</strong><time dateTime={item.date}>{formatDisplayDate(item.date)}</time></li>)}</ul> : <p className="empty-commitments">Nothing is committed before your next income.</p>}
        </section>
        <div className="hero-actions">
          <button className="primary-button hero-action" type="button" onClick={onUpdateBalance}>Update balance</button>
          <button className="secondary-button hero-action" type="button" onClick={() => openBills(true)}>Add a cost</button>
          <button className="text-button hero-action hero-review-bills" type="button" onClick={() => openBills(false, true)}>Review bills</button>
        </div>
      </div>

      {breakdownOpen && hasResult ? (
        <div className="hero-calculation" id="hero-breakdown">
          <div className="financial-disclosure-static"><span>Available now</span><strong>{formatCurrency(availableNow, displayCurrency)}</strong></div>
          <FinancialDisclosure label="Bills before next income" amount={billsBeforeIncome} items={breakdownProps.billItems} displayCurrency={displayCurrency} testId="hero-bills" />
          <FinancialDisclosure label="Protected commitments" amount={protectedBeforeIncome} items={breakdownProps.largeCostItems} displayCurrency={displayCurrency} testId="hero-large-costs" />
          <div className="financial-disclosure-static" data-testid="hero-total-committed"><span>Total committed</span><strong>{formatCurrency(committedBeforeIncome, displayCurrency)}</strong></div>
          <div className="financial-disclosure-static"><span>Safe until next income</span><strong>{safeUntilNextIncome < 0 ? `− ${formatCurrency(Math.abs(safeUntilNextIncome), displayCurrency)}` : formatCurrency(safeUntilNextIncome, displayCurrency)}</strong></div>
          {estimatedIncome > 0 ? <div className="financial-disclosure-static is-estimated"><span>Estimated income (not counted)</span><strong>{formatCurrency(estimatedIncome, displayCurrency)}</strong></div> : null}
        </div>
      ) : null}
    </article>
  );
}
