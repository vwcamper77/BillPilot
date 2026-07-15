"use client";

import { useState } from "react";
import { formatCurrency, formatDisplayDate } from "@/lib/billMath";
import FinancialDisclosure from "./FinancialDisclosure";

export default function HeroCard({
  status,
  hasBalanceSnapshot,
  hasPayday,
  rollingForecast = false,
  spendingRoomUntilPayday,
  dailySpendingRoom,
  daysTillPayday,
  paydayDate,
  displayCurrency,
  onUpdateBalance,
  onEditPaydaySettings,
  breakdownProps,
  nextCommitments = [],
  balanceFreshness,
  balanceIsStale = false,
  estimatedIncome = 0,
}) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const hasResult = hasBalanceSnapshot && hasPayday && spendingRoomUntilPayday !== null;
  const safeAvailable = Number(spendingRoomUntilPayday) || 0;
  const committed = Math.max(0, Number(breakdownProps.totalBeforePayday) || 0)
    + Math.max(0, Number(breakdownProps.bigCostsDueBeforePayday) || 0);
  // Keep the headline and visible equation mathematically identical. The
  // timing-aware safe amount can be lower when bills leave before income lands;
  // that value still drives the per-day guidance below.
  const available = Math.round((
    (Number(breakdownProps.currentBalance) || 0)
    + (Number(breakdownProps.additionalIncomeBeforePayday) || 0)
    - committed
  ) * 100) / 100;
  const allocationTotal = Math.max(0, available) + committed;
  const availableShare = allocationTotal > 0 ? Math.max(0, available) / allocationTotal * 100 : 0;
  const statusLabel = !hasResult ? "Set up your forecast" : status === "negative" || status === "attention" ? "Needs attention" : status === "low" ? "Keep an eye on this" : "On track";
  const horizonLabel = rollingForecast ? "the next four weeks" : paydayDate ? formatDisplayDate(paydayDate) : "your next reliable payment";
  const resultText = !hasBalanceSnapshot
    ? "Add your current balance"
    : !hasPayday
      ? "Add a reliable income date"
      : available < 0
        ? rollingForecast
          ? `${formatCurrency(Math.abs(available), displayCurrency)} needed within the next four weeks`
          : `${formatCurrency(Math.abs(available), displayCurrency)} needed before ${horizonLabel}`
        : rollingForecast
          ? `${formatCurrency(available, displayCurrency)} available for the next four weeks`
          : `${formatCurrency(available, displayCurrency)} available before ${horizonLabel}`;
  const showDaily = hasResult && safeAvailable >= 0 && dailySpendingRoom !== null;
  const hasTimingConstraint = hasResult && available > safeAvailable + 0.005;

  return (
    <article className={`hero-card hero-card-${status || "setup"}`} aria-labelledby="dashboard-result">
      <div className="hero-result-row">
        <div className="hero-result-copy">
          <p className={`status-pill status-${status || "setup"}`}>{statusLabel}</p>
          <h1 className="hero-value" id="dashboard-result">{resultText}</h1>
          {showDaily ? (
            <p className="hero-daily">{formatCurrency(Math.max(0, dailySpendingRoom), displayCurrency)} per day for the next {daysTillPayday} day{daysTillPayday === 1 ? "" : "s"}</p>
          ) : null}
          {hasTimingConstraint ? (
            <p className="hero-confidence-note">Some commitments leave before confirmed income arrives, so the daily guidance stays lower.</p>
          ) : null}
          {estimatedIncome > 0 ? (
            <p className="hero-confidence-note">Estimated income of {formatCurrency(estimatedIncome, displayCurrency)} is visible below but not counted as reliable cash.</p>
          ) : null}
        </div>
        {hasBalanceSnapshot ? (
          <div className={`freshness-card${balanceIsStale ? " is-stale" : ""}`}>
            <span>{balanceIsStale ? "Balance needs checking" : "Balance snapshot"}</span>
            <strong>{balanceFreshness || "Update time unavailable"}</strong>
          </div>
        ) : null}
      </div>

      {hasResult ? (
        <>
          <div className="hero-formula" aria-label="Available money calculation">
            <span><small>Balance</small><strong>{formatCurrency(breakdownProps.currentBalance, displayCurrency)}</strong></span>
            <b aria-hidden="true">+</b>
            <span><small>Confirmed income</small><strong>{formatCurrency(breakdownProps.additionalIncomeBeforePayday, displayCurrency)}</strong></span>
            <b aria-hidden="true">−</b>
            <span><small>Committed</small><strong>{formatCurrency(committed, displayCurrency)}</strong></span>
            <b aria-hidden="true">=</b>
            <span className="is-result"><small>{available < 0 ? "Amount needed" : "Available"}</small><strong>{formatCurrency(Math.abs(available), displayCurrency)}</strong></span>
          </div>

          <div className="allocation-block">
            <div className="allocation-labels">
              <span><i className="allocation-key is-available" />Available <strong>{formatCurrency(Math.max(0, available), displayCurrency)}</strong></span>
              <span><i className="allocation-key is-committed" />Already committed <strong>{formatCurrency(committed, displayCurrency)}</strong></span>
            </div>
            <div className="allocation-track" role="img" aria-label={`${formatCurrency(Math.max(0, available), displayCurrency)} available and ${formatCurrency(committed, displayCurrency)} already committed`}>
              <span className="allocation-available" style={{ width: `${availableShare}%` }} />
            </div>
          </div>
        </>
      ) : null}

      <div className="hero-lower-grid">
        <section className="next-commitments" aria-labelledby="next-commitments-title">
          <div className="hero-section-heading"><h2 id="next-commitments-title">Due next</h2><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("ct:open-section", { detail: { key: "bills" } }))}>View all bills</button></div>
          {nextCommitments.length ? (
            <ul>
              {nextCommitments.slice(0, 3).map((item) => (
                <li key={`${item.type}-${item.id}-${item.date}`}><span title={item.name}>{item.name}</span><strong>{formatCurrency(item.amount, displayCurrency)}</strong><time dateTime={item.date}>{formatDisplayDate(item.date)}</time></li>
              ))}
            </ul>
          ) : <p className="empty-commitments">Nothing else is due before this horizon.</p>}
        </section>

        <div className="hero-actions">
          {balanceIsStale ? (
            <>
              <button className="primary-button hero-action" type="button" onClick={onUpdateBalance}>Update balance</button>
              <button className="secondary-button hero-action" type="button" onClick={() => setBreakdownOpen((open) => !open)} aria-expanded={breakdownOpen} aria-controls="hero-breakdown">See breakdown</button>
            </>
          ) : (
            <>
              <button className="primary-button hero-action" type="button" onClick={() => setBreakdownOpen((open) => !open)} aria-expanded={breakdownOpen} aria-controls="hero-breakdown">See breakdown</button>
              <button className="secondary-button hero-action" type="button" onClick={onUpdateBalance}>Update balance</button>
            </>
          )}
        </div>
      </div>

      {breakdownOpen && hasResult ? (
        <div className="hero-calculation" id="hero-breakdown">
          <div className="financial-disclosure-static"><span>Current balance</span><strong>{formatCurrency(breakdownProps.currentBalance, displayCurrency)}</strong></div>
          <FinancialDisclosure label="Confirmed income before horizon" amount={breakdownProps.additionalIncomeBeforePayday} items={breakdownProps.incomeItems} displayCurrency={displayCurrency} sign="+" testId="hero-income" />
          {estimatedIncome > 0 ? <div className="financial-disclosure-static is-estimated"><span>Estimated income (not counted)</span><strong>{formatCurrency(estimatedIncome, displayCurrency)}</strong></div> : null}
          <FinancialDisclosure label="Bills before horizon" amount={breakdownProps.totalBeforePayday} items={breakdownProps.billItems} displayCurrency={displayCurrency} testId="hero-bills" />
          <FinancialDisclosure label="Protected large costs" amount={breakdownProps.bigCostsDueBeforePayday} items={breakdownProps.largeCostItems} displayCurrency={displayCurrency} testId="hero-large-costs" />
          <button className="text-button" type="button" onClick={onEditPaydaySettings}>Manage pay and income</button>
        </div>
      ) : null}
    </article>
  );
}
