"use client";

import { useState } from "react";
import { buildWeeklySafeSpendingPlan, formatCurrency } from "@/lib/billMath";
import FinancialDisclosure from "./FinancialDisclosure";

export default function FourWeekChart({ dashboard, dueBeforePaydayLargeCosts, dailySpendingRoom, spendingRoomUntilPayday = null, minimumProjectedBalance = null, hasBalanceSnapshot, todayIso, displayCurrency, incomeAmount = 0, additionalIncomeEvents = [] }) {
  const [openWeek, setOpenWeek] = useState(null);
  const { currentBalance, paydayDate, beforePayday, afterPayday } = dashboard;

  if (!paydayDate || !hasBalanceSnapshot) return null;

  // Bills due after payday must remain in the plan (including bills later in
  // the same week as payday), even though the dashboard groups them
  // separately in the bill list.
  const chartBills = [...(beforePayday || []), ...(afterPayday || [])];
  const plan = buildWeeklySafeSpendingPlan(todayIso, paydayDate, currentBalance, chartBills, dueBeforePaydayLargeCosts, incomeAmount, additionalIncomeEvents);

  // "Safe to spend before payday" must reflect every bill due before payday,
  // never a balance already boosted by income that hasn't arrived yet — reuse
  // the same figure the hero card shows so the two can never disagree.
  const safeBeforePayday = Number.isFinite(Number(spendingRoomUntilPayday)) ? Number(spendingRoomUntilPayday) : null;
  const preShortfall = safeBeforePayday !== null && safeBeforePayday < 0;

  const maxAvailable = Math.max(1, ...plan.map((point) => point.availableToSpend));
  const sym = displayCurrency === "EUR" ? "€" : displayCurrency === "USD" ? "$" : "£";

  return (
    <section className="spend-curve-card">
      <h2 className="spend-curve-title">Your cash forecast</h2>
      {preShortfall ? (
        <p className="spend-curve-warning">You may go below £0 before payday.</p>
      ) : null}

      <div className="weekly-spend-grid" data-testid="weekly-spend-grid">
        {plan.map((point, i) => {
          const isSplit = point.preDays > 0 && point.postDays > 0;
          const isShortWeek = point.isShortfall && point.availableToSpend < 0;
          const renderRate = (rate, days, negative) => negative
            ? "May go below £0"
            : `${formatCurrency(rate, displayCurrency)}/day · ${days} day${days === 1 ? "" : "s"}`;
          const bills = point.steps.filter((step) => step.type === "bill").map((step, index) => ({ ...step, id: `bill-${index}`, amount: Math.abs(step.amount) }));
          const costs = point.steps.filter((step) => step.type === "large_cost").map((step, index) => ({ ...step, id: `cost-${index}`, amount: Math.abs(step.amount) }));
          const income = point.steps.filter((step) => step.amount > 0).map((step, index) => ({ ...step, id: `income-${index}`, amount: step.amount }));
          const billsAndCosts = [...bills, ...costs];
          return (
            <div className="weekly-spend-card" data-testid="weekly-spend-card" data-week-index={i} key={point.weekStart}>
              <div className="weekly-spend-card-header">
                <span className="weekly-spend-week-label">{point.weekLabel}</span>
                {point.containsPayDate ? <span className="weekly-spend-payday-badge">{point.payDateLabel}</span> : null}
              </div>

              <div className="weekly-spend-bar-track" data-testid="weekly-spend-bar-track">
                {isSplit ? (
                  <>
                    <div
                      className={`weekly-spend-bar-segment${point.preAvailableToSpend < 0 ? " is-negative" : ""}`}
                      data-testid="weekly-spend-bar-pre"
                      data-value={point.preAvailableToSpend}
                      style={{ width: `${Math.max(2, (Math.max(0, point.preAvailableToSpend) / maxAvailable) * 100)}%` }}
                    />
                    <div
                      className={`weekly-spend-bar-segment is-post${point.postAvailableToSpend < 0 ? " is-negative" : ""}`}
                      data-testid="weekly-spend-bar-post"
                      data-value={point.postAvailableToSpend}
                      style={{ width: `${Math.max(2, (Math.max(0, point.postAvailableToSpend) / maxAvailable) * 100)}%` }}
                    />
                  </>
                ) : (
                  <div
                    className={`weekly-spend-bar-segment${isShortWeek ? " is-negative" : ""}`}
                    data-testid="weekly-spend-bar"
                    data-value={point.availableToSpend}
                    style={{ width: `${Math.max(2, (Math.max(0, point.availableToSpend) / maxAvailable) * 100)}%` }}
                  />
                )}
              </div>

              <div className="weekly-spend-rows">
                {isSplit ? (
                  <>
                    <div className="weekly-spend-row">
                      <span>Before payday</span>
                      <strong className={point.preAvailableToSpend < 0 ? "curve-negative" : ""} data-testid="available-to-spend" data-segment="pre" data-week-index={i}>
                        {formatCurrency(point.preAvailableToSpend, displayCurrency)}
                      </strong>
                    </div>
                    <div className="weekly-spend-row muted">
                      <span data-testid="weekly-daily-rate" data-segment="pre" data-week-index={i}>
                        {renderRate(point.preDailyRate, point.preDays, point.preAvailableToSpend < 0)}
                      </span>
                    </div>
                    <div className="weekly-spend-row">
                      <span>After payday</span>
                      <strong className={point.postAvailableToSpend < 0 ? "curve-negative" : ""} data-testid="available-to-spend" data-segment="post" data-week-index={i}>
                        {formatCurrency(point.postAvailableToSpend, displayCurrency)}
                      </strong>
                    </div>
                    <div className="weekly-spend-row muted">
                      <span data-testid="weekly-daily-rate" data-segment="post" data-week-index={i}>
                        {renderRate(point.postDailyRate, point.postDays, point.postAvailableToSpend < 0)}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="weekly-spend-row">
                      <span>Safe spending this week</span>
                      <strong className={isShortWeek ? "curve-negative" : ""} data-testid="available-to-spend" data-week-index={i}>
                        {formatCurrency(point.availableToSpend, displayCurrency)}
                      </strong>
                    </div>
                    <div className="weekly-spend-row muted">
                      <span data-testid="weekly-daily-rate" data-week-index={i}>
                        {renderRate(point.dailyRate, point.preDays || point.postDays, isShortWeek)}
                      </span>
                    </div>
                  </>
                )}
                <FinancialDisclosure
                  label="Income arriving"
                  amount={point.incomeReceived}
                  items={income}
                  displayCurrency={displayCurrency}
                  sign="+"
                  testId={`weekly-income-${i}`}
                  open={openWeek === `${i}-income`}
                  onToggle={(open) => setOpenWeek(open ? `${i}-income` : null)}
                />
                <FinancialDisclosure
                  label="Bills and costs due"
                  amount={point.billsDue}
                  items={billsAndCosts}
                  displayCurrency={displayCurrency}
                  testId={`weekly-costs-${i}`}
                  open={openWeek === `${i}-costs`}
                  onToggle={(open) => setOpenWeek(open ? `${i}-costs` : null)}
                />
                {costs.length ? (
                  <FinancialDisclosure
                    label="Large-cost allocations"
                    amount={costs.reduce((sum, item) => sum + item.amount, 0)}
                    items={costs}
                    displayCurrency={displayCurrency}
                    testId={`weekly-large-costs-${i}`}
                    open={openWeek === `${i}-large-costs`}
                    onToggle={(open) => setOpenWeek(open ? `${i}-large-costs` : null)}
                  />
                ) : null}
                <details className="weekly-balance-details">
                  <summary>View details</summary>
                  <div className="weekly-spend-row muted secondary">
                    <span>Expected balance after this week</span>
                    <strong data-testid="projected-closing-balance" data-week-index={i}>{formatCurrency(point.projectedClosingBalance, displayCurrency)}</strong>
                  </div>
                </details>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
