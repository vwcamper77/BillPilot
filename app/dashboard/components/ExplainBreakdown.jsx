import { formatCurrency } from "@/lib/billMath";

export default function ExplainBreakdown({
  hasBalanceSnapshot,
  currentBalance,
  hasPayday,
  totalBeforePayday,
  bigCostsDueBeforePayday,
  spendingRoomValue,
  displayCurrency,
}) {
  return (
    <div className="forecast-breakdown-list">
      <div className="forecast-breakdown-row">
        <span>Current Balance</span>
        <strong>{hasBalanceSnapshot ? formatCurrency(currentBalance, displayCurrency) : "—"}</strong>
      </div>
      <div className="forecast-breakdown-row">
        <span>Less bills before payday</span>
        <strong>-{hasPayday ? formatCurrency(totalBeforePayday, displayCurrency) : "—"}</strong>
      </div>
      <div className="forecast-breakdown-row">
        <span>Big costs hitting current account</span>
        <strong>-{hasPayday ? formatCurrency(bigCostsDueBeforePayday, displayCurrency) : "—"}</strong>
      </div>
      <div className="forecast-breakdown-row total">
        <span>Spending room till payday</span>
        <strong>{spendingRoomValue}</strong>
      </div>
    </div>
  );
}
