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
  const formatWholeCurrency = (amount) => formatCurrency(Math.round(Number(amount) || 0), displayCurrency);

  return (
    <div className="forecast-breakdown-list">
      <div className="forecast-breakdown-row">
        <span>In your account now</span>
        <strong>{hasBalanceSnapshot ? formatWholeCurrency(currentBalance) : "—"}</strong>
      </div>
      <div className="forecast-breakdown-row">
        <span>Bills due before you're paid</span>
        <strong>-{hasPayday ? formatWholeCurrency(totalBeforePayday) : "—"}</strong>
      </div>
      <div className="forecast-breakdown-row">
        <span>Big costs due before you're paid</span>
        <strong>-{hasPayday ? formatWholeCurrency(bigCostsDueBeforePayday) : "—"}</strong>
      </div>
      <div className="forecast-breakdown-row total">
        <span>Clear to spend before you're paid</span>
        <strong>{spendingRoomValue}</strong>
      </div>
    </div>
  );
}
