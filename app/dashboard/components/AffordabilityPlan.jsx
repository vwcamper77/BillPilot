"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/billMath";
import { postDashboardRequest } from "../lib/dashboardApi";

const STATE_LABELS = {
  affordable_this_period: "Affordable this period",
  spread_across_pay_periods: "Spread across pay periods",
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

  return (
    <section className="affordability-plan" data-testid="affordability-plan" data-state={plan.state}>
      <div className="affordability-plan-head">
        <h4>Affordability plan</h4>
        <span className={`affordability-state affordability-state-${plan.state}`}>
          {STATE_LABELS[plan.state] || "Affordability plan"}
        </span>
      </div>
      <p className="affordability-copy">{plan.deterministicExplanation}</p>
      {aiCopy ? <p className="affordability-ai-copy">Why this plan: {aiCopy}</p> : null}
      <div className="affordability-breakdown">
        {plan.periods.map((period) => (
          <div key={`${plan.costId}-${period.periodStart}`} className="affordability-row">
            <span>{period.label}</span>
            <strong>{formatCurrency(period.protectedAmount, displayCurrency)}</strong>
          </div>
        ))}
        <div className="affordability-row">
          <span>From savings</span>
          <strong>{formatCurrency(plan.savingsContribution, displayCurrency)}</strong>
        </div>
        <div className="affordability-row affordability-total">
          <span>Total covered</span>
          <strong>{formatCurrency(totalCovered, displayCurrency)}</strong>
        </div>
        {plan.shortfall > 0 ? (
          <div className="affordability-row affordability-shortfall">
            <span>Shortfall</span>
            <strong>{formatCurrency(plan.shortfall, displayCurrency)}</strong>
          </div>
        ) : null}
      </div>
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
