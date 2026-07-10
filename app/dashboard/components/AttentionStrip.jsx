import { formatDisplayDate } from "@/lib/billMath";

export const STALE_BALANCE_DAYS = 7;

export default function AttentionStrip({ reminders, billsDueSoon, staleBalanceDays }) {
  const items = [];

  (reminders || []).forEach((reminder) => {
    if (!reminder?.message) return;
    items.push({ key: `reminder-${reminder.id}`, text: reminder.message });
  });

  (billsDueSoon || []).forEach((bill) => {
    items.push({
      key: `due-${bill.id}`,
      text: `${bill.name} due ${formatDisplayDate(bill.nextDueDate)}`,
    });
  });

  if (staleBalanceDays !== null && staleBalanceDays !== undefined && staleBalanceDays >= STALE_BALANCE_DAYS) {
    items.push({
      key: "stale-balance",
      text: `Balance last updated ${staleBalanceDays} days ago — update it for an accurate forecast.`,
    });
  }

  if (!items.length) {
    return null;
  }

  return (
    <div className="attention-strip" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.key} className="attention-strip-item">{item.text}</div>
      ))}
    </div>
  );
}
