"use client";

import Link from "next/link";
import { formatCurrency, formatDisplayDate } from "@/lib/billMath";

function signedCurrency(value, currency) {
  const amount = Number(value) || 0;
  return amount < 0 ? `−${formatCurrency(Math.abs(amount), currency)}` : formatCurrency(amount, currency);
}

function commitmentTypeLabel(type) {
  if (type === "bill") return "Bill";
  if (type === "large_cost") return "Protected contribution";
  return "Committed item";
}

function dayCountLabel(days) {
  const count = Math.max(1, Math.floor(Number(days) || 1));
  return `${count} day${count === 1 ? "" : "s"}`;
}

export default function CurrentPositionCard({ cashPosition, displayCurrency, onUpdateBalance, onTestSpend, onAddBill, currentPositionRef, updateBalanceButtonRef }) {
  const nextIncome = cashPosition?.nextConfirmedIncome || null;
  const hasPosition = cashPosition && nextIncome;
  const incomeCountdown = hasPosition ? dayCountLabel(cashPosition.daysUntilNextIncome) : "";
  const committedItems = [...(cashPosition?.outflowsBeforeNextIncome || [])]
    .sort((a, b) => a.date.localeCompare(b.date) || Math.abs(b.amount) - Math.abs(a.amount));

  return (
    <article id="current-position" ref={currentPositionRef} className={`current-position-card${cashPosition?.safeUntilNextIncome < 0 ? " is-warning" : ""}`} aria-labelledby="current-position-title">
      <div className="current-position-main">
        <p className="current-position-eyebrow">Current position</p>
        {hasPosition ? (
          <>
            <h1 id="current-position-title">{signedCurrency(cashPosition.safeUntilNextIncome, displayCurrency)} left until your next income</h1>
            <p className="current-position-daily">{signedCurrency(cashPosition.safePerDayUntilNextIncome, displayCurrency)} safe per day <span>for {incomeCountdown}</span></p>
          </>
        ) : (
          <>
            <h1 id="current-position-title">No upcoming income confirmed</h1>
            <p className="current-position-empty">Add or confirm an income date before relying on a daily spending figure. <Link href="/dashboard/bills-income">Manage income</Link></p>
          </>
        )}
      </div>

      {hasPosition ? (
        <dl className="current-position-facts">
          <div>
            <dt>Next income</dt>
            <dd>{formatCurrency(nextIncome.amount, displayCurrency)} on {formatDisplayDate(nextIncome.date)} <span className="current-position-countdown">(in {incomeCountdown})</span></dd>
          </div>
          <div>
            <dt>Committed before next income</dt>
            <dd>{formatCurrency(cashPosition.outflowBeforeNextIncomeTotal, displayCurrency)}</dd>
            {committedItems.length ? (
              <details className="current-position-commitments">
                <summary>See what makes up {formatCurrency(cashPosition.outflowBeforeNextIncomeTotal, displayCurrency)}</summary>
                <ul>
                  {committedItems.map((item, index) => (
                    <li key={`${item.type}-${item.occurrenceId || item.id}-${item.date}-${index}`}>
                      <span>
                        <small>{commitmentTypeLabel(item.type)}</small>
                        <strong>{item.name || commitmentTypeLabel(item.type)}</strong>
                        <time dateTime={item.date}>{formatDisplayDate(item.date)}</time>
                      </span>
                      <strong>{formatCurrency(Math.abs(item.amount), displayCurrency)}</strong>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </dl>
      ) : null}

      <div className="current-position-actions" aria-label="Current position actions">
        <button ref={updateBalanceButtonRef} className="primary-button" type="button" onClick={onUpdateBalance}>Update balance</button>
        <button className="secondary-button" type="button" onClick={onTestSpend} disabled={!hasPosition}>Test a spend</button>
        <button className="secondary-button" type="button" onClick={onAddBill}>Add bill</button>
      </div>
    </article>
  );
}
