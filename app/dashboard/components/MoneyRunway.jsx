"use client";

import { formatCurrency, formatShortDisplayDate } from "@/lib/billMath";

function dateRange(row) {
  return `${formatShortDisplayDate(row.weekStart)}–${formatShortDisplayDate(row.weekEnd)}`;
}

function dailyRateText(row, currency) {
  if (!row.dailyRates.length) return "Not available";
  if (row.dailyRates.length === 1) return `${formatCurrency(row.dailyRates[0], currency)}/day`;
  return `${formatCurrency(row.dailyRates[0], currency)}/day before · ${formatCurrency(row.dailyRates[1], currency)}/day after income`;
}

export default function MoneyRunway({ rows, displayCurrency, onSelectWeek }) {
  if (!rows?.length) return null;

  return (
    <section className="money-runway" aria-labelledby="money-runway-title">
      <div className="overview-section-heading">
        <div>
          <p className="overview-kicker">Plan ahead</p>
          <h2 id="money-runway-title">Your six-week money runway</h2>
        </div>
        <p>Fixed commitments, confirmed income and safe daily spending.</p>
      </div>
      <div className="money-runway-list">
        {rows.map((row) => (
          <button
            type="button"
            className={`money-runway-row status-${row.status.toLowerCase()}`}
            key={row.id}
            onClick={(event) => onSelectWeek(row, event.currentTarget)}
            aria-label={`${row.label}, ${dateRange(row)}, ${row.status}. View breakdown`}
          >
            <span className="runway-week"><strong>{row.label}</strong><time dateTime={row.weekStart}>{dateRange(row)}</time></span>
            <span className="runway-events">
              <span className="runway-total">{formatCurrency(row.fixedOutgoings, displayCurrency)} fixed outgoings</span>
              <span className="runway-chips">
                {row.significantOutgoings.map((outgoing, index) => (
                  <span className="runway-chip" key={`${outgoing.type}-${outgoing.date}-${index}`}>{outgoing.name || "Outgoing"}</span>
                ))}
                {row.additionalOutgoingCount ? <span className="runway-chip runway-chip-more">+{row.additionalOutgoingCount} more</span> : null}
                {row.incomeTotal > 0 ? <span className="runway-chip runway-chip-income">+{formatCurrency(row.incomeTotal, displayCurrency)} income</span> : null}
              </span>
            </span>
            <span className="runway-daily"><small>Safe spending</small><strong>{dailyRateText(row, displayCurrency)}</strong></span>
            <span className="runway-close"><small>Projected closing position</small><strong>{formatCurrency(row.projectedClosingBalance, displayCurrency)}</strong></span>
            <span className={`runway-status status-${row.status.toLowerCase()}`}><i aria-hidden="true" />{row.status}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
