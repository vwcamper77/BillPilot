"use client";

import { formatCurrency, formatDisplayDate } from "@/lib/billMath";

function eventTypeLabel(event) {
  if (event.amount > 0) return "Income";
  if (event.type === "bill") return "Bill";
  if (event.type === "large_cost") return "Protected contribution";
  return "Planned cost";
}

export default function AfterNextIncome({
  confirmedIncome = 0,
  displayCurrency,
  events = [],
  forecastAtHorizon = 0,
  horizonDate,
  nextIncome = null,
  sameDayDependencies = [],
  onEditPaydaySettings,
}) {
  if (!nextIncome || confirmedIncome <= 0) return null;

  const nextIncomeIndex = events.findIndex((event) => (
    event.occurrenceId === nextIncome.occurrenceId && event.type === nextIncome.type
  ));
  const futureEvents = nextIncomeIndex >= 0 ? events.slice(nextIncomeIndex) : events.filter((event) => event.date >= nextIncome.date);

  return (
    <details className="after-income-disclosure">
      <summary>
        <span>
          <strong>After your next income</strong>
          <small>{formatCurrency(confirmedIncome, displayCurrency)} confirmed income is scheduled</small>
        </span>
        <span className="after-income-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="after-income-content">
        {sameDayDependencies.length ? (
          <div className="after-income-warning" role="note">
            Costs and income share {sameDayDependencies.length === 1 ? "a date" : "dates"}: {sameDayDependencies.map(formatDisplayDate).join(", ")}. Costs are applied first.
          </div>
        ) : null}
        <ol className="after-income-ledger" aria-label="Chronological forecast after your next income">
          {futureEvents.map((event) => (
            <li key={`${event.type}-${event.occurrenceId}`}>
              <span className={`commitment-type commitment-type-${event.type}`}>{eventTypeLabel(event)}</span>
              <span className="after-income-event-copy"><strong>{event.name}</strong><time dateTime={event.date}>{formatDisplayDate(event.date)}</time></span>
              <strong className={event.amount < 0 ? "is-outflow" : "is-income"}>{event.amount < 0 ? "−" : "+"} {formatCurrency(Math.abs(event.amount), displayCurrency)}</strong>
              <span className="after-income-running">Running balance {formatCurrency(event.balanceAfter, displayCurrency)}</span>
            </li>
          ))}
        </ol>
        <div className="after-income-closing" data-testid="projected-balance">
          <span>Projected balance on {formatDisplayDate(horizonDate)}</span>
          <strong>{forecastAtHorizon < 0 ? `− ${formatCurrency(Math.abs(forecastAtHorizon), displayCurrency)}` : formatCurrency(forecastAtHorizon, displayCurrency)}</strong>
        </div>
        <button className="text-button" type="button" onClick={onEditPaydaySettings}>Manage pay and income</button>
      </div>
    </details>
  );
}
