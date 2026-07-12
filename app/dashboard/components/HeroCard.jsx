"use client";

import { useState } from "react";
import { formatCurrency, formatDisplayDate } from "@/lib/billMath";
import FinancialDisclosure from "./FinancialDisclosure";

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
  const formatWholeCurrency = (amount) => formatCurrency(Math.round(Number(amount) || 0), displayCurrency);

  const headline = (() => {
    if (!hasBalanceSnapshot) return "Add your current available money to get started";
    if (!hasPayday || spendingRoomUntilPayday === null) return "Set your payday to get started";
    if (status === "negative") return `You're short: ${formatWholeCurrency(Math.abs(spendingRoomUntilPayday))} needed before payday`;
    return `Clear to spend before you're paid: ${formatWholeCurrency(spendingRoomUntilPayday)}`;
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
        <p className="hero-daily">about {formatWholeCurrency(Math.max(0, dailySpendingRoom))}/day clear</p>
      ) : null}
      {contextLine ? <p className="hero-context">{contextLine}</p> : null}

      {canExplain ? (
        <>
          <div className="forecast-breakdown-list" aria-label="Paid-date summary">
            {Number(breakdownProps.currentBalance) !== 0 ? (
              <div className="forecast-breakdown-row"><span>In your account now</span><strong>{formatWholeCurrency(breakdownProps.currentBalance)}</strong></div>
            ) : null}
            {Number(breakdownProps.totalBeforePayday) !== 0 ? (
              <div className="forecast-breakdown-row"><span>Bills due before you're paid</span><strong>{formatWholeCurrency(breakdownProps.totalBeforePayday)}</strong></div>
            ) : null}
            {Number(daysTillPayday) !== 0 ? (
              <div className="forecast-breakdown-row"><span>Days to stretch it</span><strong>{daysTillPayday}</strong></div>
            ) : null}
          </div>
          <div className="hero-disclosure">
            <button className="hero-disclosure-toggle" type="button" aria-expanded={showBreakdown} onClick={() => setShowBreakdown((current) => !current)}>
              How it's worked out
            </button>
            {showBreakdown ? (
              <div className="hero-calculation hero-disclosure-body" aria-label="Today's calculation">
                <div className="financial-disclosure-static"><span>In your account now</span><strong>{formatWholeCurrency(breakdownProps.currentBalance)}</strong></div>
                <FinancialDisclosure label="Income arriving before you're paid" amount={breakdownProps.additionalIncomeBeforePayday} items={breakdownProps.incomeItems} displayCurrency={displayCurrency} sign="+" testId="hero-income" />
                <FinancialDisclosure label="Bills due before you're paid" amount={breakdownProps.totalBeforePayday} items={breakdownProps.billItems} displayCurrency={displayCurrency} testId="hero-bills" />
                <FinancialDisclosure label="Large costs due before you're paid" amount={breakdownProps.bigCostsDueBeforePayday} items={breakdownProps.largeCostItems} displayCurrency={displayCurrency} testId="hero-large-costs" />
                <div className="financial-disclosure-static hero-calculation-total"><span>Clear to spend before you're paid</span><strong>{formatWholeCurrency(Math.max(0, spendingRoomUntilPayday))}</strong></div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="hero-actions">
        <button className="secondary-button hero-action" type="button" onClick={onUpdateBalance}>
          Update balance
        </button>
        <button className="secondary-button hero-action" type="button" onClick={onEditPaydaySettings}>
          Update pay or income
        </button>
      </div>

    </div>
  );
}
