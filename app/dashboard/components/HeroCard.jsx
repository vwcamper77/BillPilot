"use client";

import { useState } from "react";
import { formatCurrency, formatDisplayDate } from "@/lib/billMath";
import ExplainBreakdown from "./ExplainBreakdown";

export default function HeroCard({
  status,
  hasBalanceSnapshot,
  hasPayday,
  spendingRoomUntilPayday,
  dailySpendingRoom,
  daysTillPayday,
  paydayDate,
  displayCurrency,
  onUpdateBalance,
  onEditPaydaySettings,
  breakdownProps,
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const headline = (() => {
    if (!hasBalanceSnapshot) return "Add your current available money to get started";
    if (!hasPayday || spendingRoomUntilPayday === null) return "Set your payday to get started";
    if (status === "negative") return `You're short: ${formatCurrency(Math.abs(spendingRoomUntilPayday), displayCurrency)} needed before payday`;
    if (status === "low") return `Almost clear: ${formatCurrency(spendingRoomUntilPayday, displayCurrency)} left`;
    return `You're clear: ${formatCurrency(spendingRoomUntilPayday, displayCurrency)} left till payday`;
  })();

  const showDailyLine = hasBalanceSnapshot && hasPayday
    && spendingRoomUntilPayday !== null && spendingRoomUntilPayday >= 0
    && dailySpendingRoom !== null;

  const contextLine = hasPayday && paydayDate
    ? `${daysTillPayday} day${daysTillPayday === 1 ? "" : "s"} · payday ${formatDisplayDate(paydayDate)}`
    : null;

  const canExplain = hasBalanceSnapshot && hasPayday && spendingRoomUntilPayday !== null;
  const colorClass = status ? `hero-card-${status}` : "";
  const amountMatch = String(headline || "").match(/^(.*?)(£[0-9,]+(?:\.\d{1,2})?)(.*)$/);

  return (
    <div className={`hero-card ${colorClass}`.trim()}>
      <p className="hero-value">
        {amountMatch ? (
          <>
            <span className="hero-value-prefix">{amountMatch[1]}</span>
            <span className={`hero-value-amount ${status === "negative" ? "is-negative" : "is-positive"}`}>{amountMatch[2]}</span>
            <span className="hero-value-suffix">{amountMatch[3]}</span>
          </>
        ) : headline}
      </p>
      {showDailyLine ? (
        <p className="hero-daily">{formatCurrency(Math.max(0, dailySpendingRoom), displayCurrency)}/day</p>
      ) : null}
      {contextLine ? <p className="hero-context">{contextLine}</p> : null}

      <div className="hero-actions">
        <button className="secondary-button hero-action" type="button" onClick={onUpdateBalance}>
          Update balance
        </button>
        <button className="secondary-button hero-action" type="button" onClick={onEditPaydaySettings}>
          Update pay or income
        </button>
      </div>

      {canExplain ? (
        <div className="hero-disclosure">
          <button
            className="hero-disclosure-toggle"
            type="button"
            aria-expanded={showBreakdown}
            onClick={() => setShowBreakdown((current) => !current)}
          >
            How it's worked out
          </button>
          {showBreakdown ? (
            <div className="hero-disclosure-body">
              <ExplainBreakdown {...breakdownProps} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
