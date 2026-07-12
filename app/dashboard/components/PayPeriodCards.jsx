import { formatCurrency, formatShortDisplayDate } from "@/lib/billMath";
import FinancialDisclosure from "./FinancialDisclosure";

function SummaryRow({ label, value, displayCurrency, sign = "", emphasis = false }) {
  return <div className={`pay-period-row${emphasis ? " is-emphasis" : ""}`}><span>{label}</span><strong>{sign}{formatCurrency(Math.round(Math.abs(value || 0)), displayCurrency)}</strong></div>;
}

export default function PayPeriodCards({ current, next, displayCurrency }) {
  return (
    <section className="pay-period-grid" aria-label="Pay period summaries">
      <article className="pay-period-card is-current" data-testid="current-pay-period">
        <header className="pay-period-card-header">
          <span className="pay-period-kicker">Right now</span>
          <h2>Current period</h2>
          <p>Today → {formatShortDisplayDate(current.endDate)}</p>
        </header>
        <SummaryRow label="Starting balance" value={current.startingBalance} displayCurrency={displayCurrency} />
        <FinancialDisclosure label="Income arriving" amount={current.incomeTotal} items={current.income} displayCurrency={displayCurrency} sign="+" testId="current-period-income" />
        <FinancialDisclosure label="Bills and commitments" amount={current.billTotal} items={current.bills} displayCurrency={displayCurrency} testId="current-period-bills" />
        <FinancialDisclosure label="Large-cost funding" amount={current.largeCostTotal} items={current.largeCosts} displayCurrency={displayCurrency} testId="current-period-large-costs" />
        <SummaryRow label="Clear to spend" value={current.freeCash} displayCurrency={displayCurrency} emphasis />
        <SummaryRow label="Clear per day" value={current.dailyAllowance} displayCurrency={displayCurrency} />
      </article>
      <article className="pay-period-card is-next" data-testid="next-pay-period">
        <header className="pay-period-card-header">
          <span className="pay-period-kicker">Coming up</span>
          <h2>Next period</h2>
          <p>{formatShortDisplayDate(next.startDate)} → {formatShortDisplayDate(next.endDate)}</p>
        </header>
        <FinancialDisclosure label="Income arriving" amount={next.incomeTotal} items={next.income} displayCurrency={displayCurrency} sign="+" testId="next-period-income" />
        <FinancialDisclosure label="Bills and commitments" amount={next.billTotal} items={next.bills} displayCurrency={displayCurrency} testId="next-period-bills" />
        <FinancialDisclosure label="Large-cost funding" amount={next.largeCostTotal} items={next.largeCosts} displayCurrency={displayCurrency} testId="next-period-large-costs" />
        <SummaryRow label="Expected clear to spend" value={next.freeCash} displayCurrency={displayCurrency} emphasis />
        <SummaryRow label="Clear per day" value={next.dailyAllowance} displayCurrency={displayCurrency} />
      </article>
    </section>
  );
}
