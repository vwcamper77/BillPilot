import { formatCurrency } from "@/lib/billMath";

export default function ExplainBreakdown({
  hasBalanceSnapshot,
  currentBalance,
  hasPayday,
  totalBeforePayday,
  bigCostsDueBeforePayday,
  additionalIncomeBeforePayday = 0,
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
      {additionalIncomeBeforePayday > 0 ? (
        <div className="forecast-breakdown-row">
          <span>Confirmed other income before payday</span>
          <strong>+{formatCurrency(additionalIncomeBeforePayday, displayCurrency)}</strong>
        </div>
      ) : null}
      <div className="forecast-breakdown-row">
        <span>Big costs due before you're paid</span>
        <strong>-{hasPayday ? formatWholeCurrency(bigCostsDueBeforePayday) : "—"}</strong>
      </div>
      <div className="forecast-breakdown-row total">
        <span>Clear to spend before you're paid</span>
        <strong>{spendingRoomValue}</strong>
      </div>
      {additionalIncomeBeforePayday > 0 ? <p className="helper-text">Clear-to-spend calculations also check that money is not used before it arrives.</p> : null}
    </div>
  );
}
