"use client";

export function triggerQuickAction(sectionKey, target, extra = {}) {
  window.dispatchEvent(new CustomEvent("ct:open-section", { detail: { key: sectionKey } }));
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent("ct:focus-quick-action", { detail: { target, ...extra } }));
  });
}

export default function QuickActions() {
  return (
    <div className="quick-actions-row">
      <button className="quick-action-button" type="button" onClick={() => triggerQuickAction("bills", "add-bills")}>
        Add bill
      </button>
      <button className="quick-action-button" type="button" onClick={() => triggerQuickAction("largecosts", "large-cost-form")}>
        Add large cost
      </button>
      <button className="quick-action-button" type="button" onClick={() => triggerQuickAction("savings", "savings")}>
        Update savings
      </button>
    </div>
  );
}
