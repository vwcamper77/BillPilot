import { formatDisplayDate } from "@/lib/billMath";

export const STALE_BALANCE_DAYS = 7;

export function isBalanceSnapshotStale({ hasBalanceSnapshot, optimisticBalance, balanceSnapshotDate, staleBalanceDays, threshold = STALE_BALANCE_DAYS }) {
  if (!hasBalanceSnapshot || optimisticBalance !== null) return false;
  if (staleBalanceDays === null || staleBalanceDays === undefined) return !balanceSnapshotDate;
  return staleBalanceDays >= threshold;
}

export default function AttentionStrip({ reminders, billsDueSoon, staleBalanceDays, issues = [], onUpdateBalance, onReviewPosition, onAddCost }) {
  let item = null;

  if (staleBalanceDays !== null && staleBalanceDays !== undefined && staleBalanceDays >= STALE_BALANCE_DAYS) {
    item = {
      text: `Your balance was last updated ${staleBalanceDays} days ago. Update it to keep this position useful.`,
      action: "Update balance",
      onClick: onUpdateBalance,
    };
  } else if (billsDueSoon?.length) {
    const bill = billsDueSoon[0];
    item = {
      text: `${bill.name} is due ${formatDisplayDate(bill.nextDueDate)}. Review what remains before payday.`,
      action: "Review position",
      onClick: onReviewPosition,
    };
  } else if (issues.filter(Boolean).length || reminders?.length) {
    item = {
      text: issues.find(Boolean) || reminders.find((reminder) => reminder?.message)?.message || "Have any new costs appeared? Add them before relying on this estimate.",
      action: "Add a cost",
      onClick: onAddCost,
    };
  }

  if (!item) return null;

  return (
    <div className="attention-strip" role="status" aria-live="polite">
      <div className="attention-strip-item">
        <span>{item.text}</span>
        <button type="button" onClick={item.onClick}>{item.action}</button>
      </div>
    </div>
  );
}
