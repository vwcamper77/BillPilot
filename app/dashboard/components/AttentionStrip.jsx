import { formatDisplayDate } from "@/lib/billMath";

export const STALE_BALANCE_DAYS = 7;

export function isBalanceSnapshotStale({ hasBalanceSnapshot, optimisticBalance, balanceSnapshotDate, staleBalanceDays, threshold = STALE_BALANCE_DAYS }) {
  if (!hasBalanceSnapshot || optimisticBalance !== null) return false;
  if (staleBalanceDays === null || staleBalanceDays === undefined) return !balanceSnapshotDate;
  return staleBalanceDays >= threshold;
}

export function deriveAttentionItems({ reminders = [], billsDueSoon = [], staleBalanceDays = null, issues = [], onUpdateBalance, onReviewPosition, onAddCost }) {
  const items = [];

  if (staleBalanceDays !== null && staleBalanceDays !== undefined && staleBalanceDays >= STALE_BALANCE_DAYS) {
    items.push({
      text: `Your balance was last updated ${staleBalanceDays} days ago. Update it to keep this position useful.`,
      action: "Update balance",
      onClick: onUpdateBalance,
    });
  }
  if (billsDueSoon?.length) {
    const bill = billsDueSoon[0];
    items.push({
      text: `${bill.name} is due ${formatDisplayDate(bill.nextDueDate)}. Review what remains before payday.`,
      action: "Review position",
      onClick: onReviewPosition,
    });
  }
  issues.filter(Boolean).forEach((issue) => items.push({
    text: issue,
    action: "Add a cost",
    onClick: onAddCost,
  }));
  reminders.filter((reminder) => reminder?.message).forEach((reminder) => items.push({
      text: reminder.message,
      action: "Add a cost",
      onClick: onAddCost,
  }));

  return items.slice(0, 3);
}

export default function AttentionStrip({ reminders, billsDueSoon, staleBalanceDays, issues = [], onUpdateBalance, onReviewPosition, onAddCost, compact = false }) {
  const items = deriveAttentionItems({ reminders, billsDueSoon, staleBalanceDays, issues, onUpdateBalance, onReviewPosition, onAddCost });

  if (!items.length) return null;

  return (
    <section className={`attention-strip${compact ? " attention-strip-compact" : ""}`} aria-labelledby={compact ? "attention-title" : undefined}>
      {compact ? <h2 id="attention-title">Needs attention</h2> : null}
      {items.map((item, index) => (
        <div className="attention-strip-item" key={`${item.text}-${index}`}>
          <span>{item.text}</span>
          <button type="button" onClick={item.onClick}>{item.action}</button>
        </div>
      ))}
    </section>
  );
}
