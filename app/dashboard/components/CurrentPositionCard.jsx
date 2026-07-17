"use client";

import Link from "next/link";
import { formatCurrency, formatDisplayDate } from "@/lib/billMath";

function signedCurrency(value, currency) {
  const amount = Number(value) || 0;
  return amount < 0 ? `−${formatCurrency(Math.abs(amount), currency)}` : formatCurrency(amount, currency);
}

export default function CurrentPositionCard({ cashPosition, displayCurrency, onUpdateBalance, onTestSpend, onAddBill }) {
  const nextIncome = cashPosition?.nextConfirmedIncome || null;
  const hasPosition = cashPosition && nextIncome;

  return (
    <article className={`current-position-card${cashPosition?.safeUntilNextIncome < 0 ? " is-warning" : ""}`} aria-labelledby="current-position-title">
      <div className="current-position-main">
        <p className="current-position-eyebrow">Current position</p>
        {hasPosition ? (
          <>
            <h1 id="current-position-title">{signedCurrency(cashPosition.safeUntilNextIncome, displayCurrency)} left until your next income</h1>
            <p className="current-position-daily">{signedCurrency(cashPosition.safePerDayUntilNextIncome, displayCurrency)} safe per day</p>
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
            <dd>{formatCurrency(nextIncome.amount, displayCurrency)} on {formatDisplayDate(nextIncome.date)}</dd>
          </div>
          <div>
            <dt>Fixed outgoings still due</dt>
            <dd>{formatCurrency(cashPosition.outflowBeforeNextIncomeTotal, displayCurrency)}</dd>
          </div>
        </dl>
      ) : null}

      <div className="current-position-actions" aria-label="Current position actions">
        <button className="primary-button" type="button" onClick={onUpdateBalance}>Update balance</button>
        <button className="secondary-button" type="button" onClick={onTestSpend} disabled={!hasPosition}>Test a spend</button>
        <button className="secondary-button" type="button" onClick={onAddBill}>Add bill</button>
      </div>
    </article>
  );
}
