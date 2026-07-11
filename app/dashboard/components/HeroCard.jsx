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
        <p className="hero-daily">{formatCurrency(Math.max(0, dailySpendingRoom), displayCurrency)} per day for the next {daysTillPayday} day{daysTillPayday === 1 ? "" : "s"}</p>
      ) : null}
      {contextLine ? <p className="hero-context">{contextLine}</p> : null}

      {canExplain ? (
        <div className="hero-calculation" aria-label="Today's calculation">
          <div className="financial-disclosure-static"><span>Current bank balance</span><strong>{formatCurrency(breakdownProps.currentBalance, displayCurrency)}</strong></div>
          <FinancialDisclosure label="Income arriving before payday" amount={breakdownProps.additionalIncomeBeforePayday} items={breakdownProps.incomeItems} displayCurrency={displayCurrency} sign="+" testId="hero-income" />
          <FinancialDisclosure label="Reserved for bills before payday" amount={breakdownProps.totalBeforePayday} items={breakdownProps.billItems} displayCurrency={displayCurrency} testId="hero-bills" />
          <FinancialDisclosure label="Large costs before payday" amount={breakdownProps.bigCostsDueBeforePayday} items={breakdownProps.largeCostItems} displayCurrency={displayCurrency} testId="hero-large-costs" />
          <div className="financial-disclosure-static hero-calculation-total"><span>Free cash until payday</span><strong>{formatCurrency(Math.max(0, spendingRoomUntilPayday), displayCurrency)}</strong></div>
        </div>
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
