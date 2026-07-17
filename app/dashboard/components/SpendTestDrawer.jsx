"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/billMath";
import { calculateSpendTest } from "../lib/runwayModel";
import Drawer from "./Drawer";

function signed(value, currency) {
  const amount = Number(value) || 0;
  return amount < 0 ? `−${formatCurrency(Math.abs(amount), currency)}` : formatCurrency(amount, currency);
}

export default function SpendTestDrawer({ open, onClose, cashPosition, displayCurrency }) {
  const [amount, setAmount] = useState("");
  const result = useMemo(() => calculateSpendTest({
    safeUntilNextIncome: cashPosition?.safeUntilNextIncome,
    daysUntilNextIncome: cashPosition?.daysUntilNextIncome,
    amount,
  }), [amount, cashPosition?.daysUntilNextIncome, cashPosition?.safeUntilNextIncome]);

  return (
    <Drawer open={open} onClose={onClose} title="Test a spend" description="What if I spent this amount today? Nothing here is saved.">
      <div className="spend-test">
        <label className="field-label" htmlFor="spend-test-amount">Amount to test</label>
        <input
          data-drawer-initial-focus
          id="spend-test-amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
        />
        <dl className="spend-test-results" aria-live="polite">
          <div><dt>Currently left until income</dt><dd>{signed(result.currentAmount, displayCurrency)}</dd></div>
          <div><dt>After this spend</dt><dd>{signed(result.revisedAmount, displayCurrency)}</dd></div>
          <div><dt>Revised safe amount per day</dt><dd>{signed(result.revisedSafePerDay, displayCurrency)}</dd></div>
          <div><dt>Change to your position</dt><dd>{signed(result.difference, displayCurrency)}</dd></div>
        </dl>
        {result.hasShortfall ? (
          <p className="spend-test-warning" role="alert">
            {result.createsShortfall ? "This tested spend creates a shortfall before your next income." : "Your current position is already below zero; this spend increases that shortfall."}
          </p>
        ) : null}
        <button className="secondary-button" type="button" onClick={onClose}>Close without saving</button>
      </div>
    </Drawer>
  );
}
