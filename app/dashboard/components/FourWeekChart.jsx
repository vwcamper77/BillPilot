"use client";

import { useRef, useState } from "react";
import { buildWeeklySafeSpendingPlan, formatCurrency } from "@/lib/billMath";
import FinancialDisclosure from "./FinancialDisclosure";

export default function FourWeekChart({ dashboard, dueBeforePaydayLargeCosts, spendingRoomUntilPayday = null, hasBalanceSnapshot, todayIso, displayCurrency, incomeAmount = 0, additionalIncomeEvents = [] }) {
  const [activeTab, setActiveTab] = useState("spending");
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [openRow, setOpenRow] = useState(null);
  const sliderRef = useRef(null);
  const { currentBalance, paydayDate, beforePayday, afterPayday } = dashboard;

  if (!paydayDate || !hasBalanceSnapshot) return null;

  const chartBills = [...(beforePayday || []), ...(afterPayday || [])];
  const plan = buildWeeklySafeSpendingPlan(todayIso, paydayDate, currentBalance, chartBills, dueBeforePaydayLargeCosts, incomeAmount, additionalIncomeEvents, 4);
  const safeBeforePayday = Number.isFinite(Number(spendingRoomUntilPayday)) ? Number(spendingRoomUntilPayday) : null;
  const preShortfall = safeBeforePayday !== null && safeBeforePayday < 0;
  const maxAvailable = Math.max(1, ...plan.map((point) => Math.max(0, point.availableToSpend)));

  const selectWeek = (index, openDetails = false) => {
    const next = Math.max(0, Math.min(plan.length - 1, index));
    setSelectedWeek(next);
    setOpenRow(null);
    if (openDetails) setActiveTab("details");
    sliderRef.current?.querySelector(`[data-week-index="${next}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  };

  const point = plan[selectedWeek];
  const bills = point.steps.filter((step) => step.type === "bill").map((step, index) => ({ ...step, id: `bill-${index}`, amount: Math.abs(step.amount) }));
  const costs = point.steps.filter((step) => step.type === "large_cost").map((step, index) => ({ ...step, id: `cost-${index}`, amount: Math.abs(step.amount) }));
  const income = point.steps.filter((step) => step.amount > 0).map((step, index) => ({ ...step, id: `income-${index}`, amount: step.amount }));

  return (
    <section className="spend-curve-card" data-testid="four-week-forecast">
      <div className="forecast-heading-row">
        <div>
          <h2 className="spend-curve-title">Four-week cash forecast</h2>
          <p>Clear to spend after bills and planned costs are set aside.</p>
        </div>
        {preShortfall ? <p className="spend-curve-warning">You may go below £0 before payday.</p> : null}
      </div>

      <div className="forecast-tabs" role="tablist" aria-label="Cash forecast views">
        <button type="button" role="tab" aria-selected={activeTab === "spending"} onClick={() => setActiveTab("spending")}>Weekly spending</button>
        <button type="button" role="tab" aria-selected={activeTab === "details"} onClick={() => setActiveTab("details")}>Cashflow details</button>
      </div>

      {activeTab === "spending" ? (
        <>
          <div className="weekly-spend-grid" data-testid="weekly-spend-grid" ref={sliderRef} aria-label="Weekly clear to spend">
            {plan.map((week, i) => {
              const isSplit = week.preDays > 0 && week.postDays > 0;
              const isShort = week.isShortfall && week.availableToSpend < 0;
              const applicableDays = week.preDays + week.postDays;
              const barHeight = isShort ? 0 : (Math.max(0, week.availableToSpend) / maxAvailable) * 100;
              return (
                <article className={`weekly-spend-card${i === 0 ? " is-current" : ""}${isShort ? " is-short" : ""}`} data-testid="weekly-spend-card" data-week-index={i} key={week.weekStart} onClick={() => selectWeek(i, true)}>
                  <div className="weekly-spend-card-header">
                    <span className="weekly-spend-week-label">{week.weekLabel}</span>
                    {i === 0 ? <span className="weekly-today-badge">Today</span> : null}
                  </div>
                  <div className="weekly-payday-marker-slot">
                    {week.containsPayDate ? <span className="weekly-spend-payday-badge">{week.payDateLabel}</span> : null}
                  </div>
                  <div className="weekly-spend-value" data-testid="available-to-spend" data-week-index={i}>
                    {isShort ? `${formatCurrency(Math.abs(week.availableToSpend), displayCurrency)} short` : `${formatCurrency(week.availableToSpend, displayCurrency)} available`}
                  </div>
                  <div className="weekly-spend-rate">
                    {isShort ? "Nothing clear to spend" : `about ${formatCurrency(Math.round(week.dailyRate ?? (week.availableToSpend / Math.max(1, applicableDays))), displayCurrency)}/day clear`}
                    <span>{applicableDays} spending day{applicableDays === 1 ? "" : "s"}</span>
                  </div>
                  <div className="weekly-bar-area" aria-label={`${formatCurrency(Math.round(week.availableToSpend), displayCurrency)} clear to spend`}>
                    <div className="weekly-bar-scale">
                      {!isShort ? <div className="weekly-cash-bar" data-testid="weekly-spend-bar" data-value={week.availableToSpend} style={{ height: `${barHeight}%` }} /> : <div className="weekly-shortfall-marker">!</div>}
                    </div>
                  </div>
                  {isSplit ? (
                    <div className="weekly-payday-split" data-testid="payday-split">
                      <span>Before payday <strong data-testid="available-before-payday">{formatCurrency(week.preAvailableToSpend, displayCurrency)} available</strong></span>
                      <span>After payday <strong data-testid="available-after-payday">{formatCurrency(week.postAvailableToSpend, displayCurrency)} available</strong></span>
                    </div>
                  ) : null}
                  <p className="weekly-summary-line">{formatCurrency(week.incomeReceived, displayCurrency)} income · {formatCurrency(week.billsDue + week.largeCostAllocations, displayCurrency)} committed</p>
                  <button type="button" className="weekly-view-breakdown" onClick={(event) => { event.stopPropagation(); selectWeek(i, true); }}>View breakdown</button>
                </article>
              );
            })}
          </div>
          <div className="weekly-spend-slider-controls" aria-label="Choose forecast week">
            <button type="button" className="secondary-button" disabled={selectedWeek === 0} onClick={() => selectWeek(selectedWeek - 1)}>← Previous</button>
            <span>Week {selectedWeek + 1} of 4</span>
            <button type="button" className="secondary-button" disabled={selectedWeek === 3} onClick={() => selectWeek(selectedWeek + 1)}>Next →</button>
          </div>
        </>
      ) : (
        <div className="cashflow-details" data-testid="cashflow-details" data-week-index={selectedWeek}>
          <div className="cashflow-details-heading">
            <div><span>Selected week</span><h3>{point.weekLabel}</h3></div>
            {point.containsPayDate ? <span className="weekly-spend-payday-badge">{point.payDateLabel}</span> : null}
          </div>
          <div className="cashflow-detail-list">
            <div className="cashflow-detail-row"><span>Opening balance</span><strong>{formatCurrency(point.openingBalance, displayCurrency)}</strong></div>
            <FinancialDisclosure label="Income arriving" amount={point.incomeReceived} items={income} displayCurrency={displayCurrency} sign="+" testId="detail-income" open={openRow === "income"} onToggle={(open) => setOpenRow(open ? "income" : null)} />
            <FinancialDisclosure label="Bills due" amount={point.billsDue} items={bills} displayCurrency={displayCurrency} testId="detail-bills" open={openRow === "bills"} onToggle={(open) => setOpenRow(open ? "bills" : null)} />
            <FinancialDisclosure label="Large-cost allocations" amount={point.largeCostAllocations} items={costs} displayCurrency={displayCurrency} testId="detail-large-costs" open={openRow === "costs"} onToggle={(open) => setOpenRow(open ? "costs" : null)} />
            <div className="cashflow-detail-row is-primary"><span>Clear to spend</span><strong className={point.availableToSpend < 0 ? "curve-negative" : ""}>{point.availableToSpend < 0 ? `${formatCurrency(Math.round(Math.abs(point.availableToSpend)), displayCurrency)} short` : formatCurrency(Math.round(point.availableToSpend), displayCurrency)}</strong></div>
            <div className="cashflow-detail-row"><span>Projected closing balance</span><strong data-testid="projected-closing-balance">{formatCurrency(point.projectedClosingBalance, displayCurrency)}</strong></div>
          </div>
          <div className="cashflow-details-nav">
            <button type="button" className="secondary-button" disabled={selectedWeek === 0} onClick={() => selectWeek(selectedWeek - 1)}>← Previous week</button>
            <button type="button" className="secondary-button" disabled={selectedWeek === 3} onClick={() => selectWeek(selectedWeek + 1)}>Next week →</button>
          </div>
        </div>
      )}
    </section>
  );
}
