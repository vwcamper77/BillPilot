"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/billMath";
import { postDashboardRequest } from "../lib/dashboardApi";

const STATE_LABELS = {
  affordable_now: "Affordable now",
  affordable_by_due_date: "Affordable by due date",
  wait_until_payday: "Wait until payday",
  unaffordable_by_due_date: "Not affordable by due date",
};

export default function AffordabilityPlan({ plan, displayCurrency, enableAi = false, onAction }) {
  const [aiCopy, setAiCopy] = useState("");

  useEffect(() => {
    let cancelled = false;
    setAiCopy("");
    if (!enableAi || !plan) return undefined;

    const facts = {
      totalCost: plan.totalCost,
      dueDate: plan.dueDate,
      daysUntilDue: plan.daysUntilDue,
      savingsContribution: plan.savingsContribution,
      currentBalanceContribution: plan.currentBalanceContribution,
      currentPeriodAllocation: plan.currentPeriodAllocation,
      futurePeriodAllocations: plan.futurePeriodAllocations,
      safeDailyAmountBefore: plan.safeDailyAmountBefore,
      safeDailyAmountAfter: plan.safeDailyAmountAfter,
      shortfall: plan.shortfall,
      affordabilityState: plan.state,
    };

    postDashboardRequest("/api/dashboard/large-cost-explanation", "explain_large_cost", { facts })
      .then((payload) => {
        if (!cancelled && payload?.explanation) setAiCopy(payload.explanation);
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, [enableAi, plan]);

  if (!plan) return null;
  const totalCovered = Math.max(0, plan.totalCost - plan.shortfall);
  const stateLabel = plan.state === "unaffordable_by_due_date"
    ? `${STATE_LABELS[plan.state]} — short by ${formatCurrency(plan.shortfall, displayCurrency)}`
    : STATE_LABELS[plan.state] || "Affordability plan";

  return (
    <section className="affordability-plan" data-testid="affordability-plan" data-state={plan.state}>
      <div className="affordability-plan-head">
        <span className={`affordability-state affordability-state-${plan.state}`}>
          {stateLabel}
        </span>
      </div>
      <p className="affordability-copy">{plan.deterministicExplanation}</p>
      {aiCopy ? <p className="affordability-ai-copy">Why this plan: {aiCopy}</p> : null}
      <div className="affordability-breakdown" aria-label="Funding allocation">
        {plan.periods.filter((period) => period.index === 0 || period.protectedAmount > 0).map((period) => (
          <div key={`${plan.costId}-${period.periodStart}`} className="affordability-row">
            <span>{period.index === 0
              ? period.label
              : `From ${period.sourceType === "additional_income" ? period.sourceLabel : "pay"} on ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${period.payDate}T12:00:00Z`))}`}</span>
            <strong>{formatCurrency(period.protectedAmount, displayCurrency)}</strong>
          </div>
        ))}
        <div className="affordability-row">
          <span>From savings</span>
          <strong>{formatCurrency(plan.savingsContribution, displayCurrency)}</strong>
        </div>
        <div className={`affordability-row${plan.shortfall > 0 ? " affordability-shortfall" : " affordability-funded"}`}>
          <span>Still to fund</span>
          <strong>{formatCurrency(plan.shortfall, displayCurrency)}</strong>
        </div>
      </div>
      <details className="affordability-calculation">
        <summary>View calculation</summary>
        <div className="affordability-calculation-body">
          <div className="affordability-row">
            <span>Total cost</span>
            <strong>{formatCurrency(plan.totalCost, displayCurrency)}</strong>
          </div>
          <div className="affordability-row">
            <span>Total funded</span>
            <strong>{formatCurrency(totalCovered, displayCurrency)}</strong>
          </div>
          <div className="affordability-row">
            <span>Safe daily amount after allocation</span>
            <strong>{formatCurrency(plan.safeDailyAmountAfter, displayCurrency)}</strong>
          </div>
          {plan.periods.map((period) => (
            <div key={`math-${plan.costId}-${period.periodStart}`} className="affordability-row">
              <span>{period.label} capacity after bills and planned costs</span>
              <strong>{formatCurrency(period.resultingSafeSpendingRoom, displayCurrency)}</strong>
            </div>
          ))}
        </div>
      </details>
      {plan.actions.length ? (
        <div className="affordability-actions">
          {plan.actions.map((action) => (
            <button key={action} className="affordability-action" type="button" onClick={() => onAction?.(action)}>
              {action}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
