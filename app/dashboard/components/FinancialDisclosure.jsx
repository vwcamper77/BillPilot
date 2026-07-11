"use client";

import { useState } from "react";
import { formatCurrency, formatShortDisplayDate } from "@/lib/billMath";

export default function FinancialDisclosure({
  label,
  amount,
  items = [],
  displayCurrency,
  sign = "-",
  testId,
  onToggle,
  open: controlledOpen,
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const sortedItems = [...items]
    .filter((item) => Number(item?.amount) > 0 && item?.date)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.name).localeCompare(String(b.name)));
  const canExpand = Number(amount) !== 0 && sortedItems.length > 0;
  const itemWord = sortedItems.length === 1 ? "item" : "items";
  const formattedAmount = `${sign === "+" ? "+" : sign === "-" ? "−" : ""}${formatCurrency(Math.abs(Number(amount) || 0), displayCurrency)}`;

  function toggle() {
    const next = !open;
    if (onToggle) onToggle(next);
    else setLocalOpen(next);
  }

  return (
    <div className="financial-disclosure" data-testid={testId}>
      {canExpand ? (
        <button className="financial-disclosure-button" type="button" aria-expanded={open} onClick={toggle}>
          <span className="financial-disclosure-copy">
            <span className="financial-disclosure-label">{label} · {sortedItems.length} {itemWord}</span>
            <span className="financial-disclosure-action">View {sortedItems.length} {itemWord}</span>
          </span>
          <strong>{formattedAmount}</strong>
          <span className={`financial-chevron${open ? " is-open" : ""}`} aria-hidden="true">⌄</span>
        </button>
      ) : (
        <div className="financial-disclosure-static">
          <span>{label}</span>
          <strong>{formattedAmount}</strong>
        </div>
      )}
      <div className={`financial-disclosure-panel${open && canExpand ? " is-open" : ""}`} aria-hidden={!open || !canExpand}>
        <div className="financial-disclosure-panel-inner">
          {sortedItems.map((item) => (
            <div className="financial-detail-row" key={`${item.type || "item"}-${item.id || item.name}-${item.date}`}>
              <span>{item.name}</span>
              <time dateTime={item.date}>{formatShortDisplayDate(item.date)}</time>
              <strong>{formatCurrency(item.amount, displayCurrency)}</strong>
            </div>
          ))}
          <div className="financial-detail-row total">
            <span>Total</span><span />
            <strong>{formatCurrency(Math.abs(Number(amount) || 0), displayCurrency)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
