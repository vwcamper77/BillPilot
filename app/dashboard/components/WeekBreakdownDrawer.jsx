"use client";

import Drawer from "./Drawer";
import { formatCurrency, formatDisplayDate, formatShortDisplayDate } from "@/lib/billMath";

function signed(value, currency) {
  const amount = Number(value) || 0;
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${formatCurrency(Math.abs(amount), currency)}`;
}

export default function WeekBreakdownDrawer({ row, displayCurrency, onClose }) {
  const week = row?.source;
  const steps = [...(week?.steps || [])].sort((a, b) => a.date.localeCompare(b.date) || (a.rank || 0) - (b.rank || 0));

  return (
    <Drawer
      open={Boolean(row)}
      onClose={onClose}
      title={row ? `${row.label}: ${formatShortDisplayDate(row.weekStart)}–${formatShortDisplayDate(row.weekEnd)}` : "Week breakdown"}
      description="The dated movements already used in your runway calculation."
    >
      {row && week ? (
        <div className="week-breakdown">
          <dl className="week-breakdown-summary">
            <div><dt>Opening position</dt><dd>{formatCurrency(week.openingBalance, displayCurrency)}</dd></div>
            <div><dt>Safe-spending allocation</dt><dd>{signed(week.availableToSpend, displayCurrency)}</dd></div>
            <div><dt>Minimum projected balance</dt><dd>{signed(week.weeklyMinimumBalance, displayCurrency)}</dd></div>
            <div><dt>Projected closing position</dt><dd>{signed(week.projectedClosingBalance, displayCurrency)}</dd></div>
          </dl>

          <section aria-labelledby="week-ledger-title">
            <h3 id="week-ledger-title">Dated ledger</h3>
            {steps.length ? (
              <ol className="week-ledger">
                {steps.map((step, index) => (
                  <li key={`${step.type}-${step.date}-${index}`}>
                    <time dateTime={step.date}>{formatDisplayDate(step.date)}</time>
                    <span><strong>{step.name || (step.amount > 0 ? "Income" : step.type === "large_cost" ? "Large-cost allocation" : "Bill")}</strong><small>{step.amount > 0 ? "Income" : step.type === "large_cost" ? "Large-cost allocation" : "Outgoing"}</small></span>
                    <strong className={step.amount < 0 ? "is-outgoing" : "is-income"}>{signed(step.amount, displayCurrency)}</strong>
                  </li>
                ))}
              </ol>
            ) : <p className="helper-text">No dated movements in this week.</p>}
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
