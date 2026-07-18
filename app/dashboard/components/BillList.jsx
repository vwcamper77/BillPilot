"use client";

import { useMemo, useState } from "react";
import DayOfMonthField from "@/app/components/forms/DayOfMonthField";
import {
  buildBillDocument,
  calculateBillSchedule,
  composeBillDisplayName,
  formatCurrency,
  formatDisplayDate,
  isValidDueDay,
  sanitiseBillDisplayName,
  splitBillDisplayName,
} from "@/lib/billMath";
import { logSecurityEventClient } from "@/lib/security/clientSecurity";
import { postDashboardBillAction, runWithTimeout } from "../lib/dashboardApi";
import { friendlyBillSaveError } from "../lib/friendlyErrors";
import { CATEGORY_META, classifyBill, isPaidBill, isRecentlyAdded } from "../lib/billHelpers";
import { buildBillListView } from "../lib/billListModel";
import Drawer from "./Drawer";

const INITIAL_VISIBLE_BILLS = 20;

function BillCategoryPill({ bill }) {
  const category = bill.category || classifyBill(bill).category || "other";
  if (category === "other") return null;
  const meta = CATEGORY_META[category] || CATEGORY_META.other;
  return <span className="bill-category-pill">{meta.icon} {meta.label}</span>;
}

function recurrenceLabel(bill) {
  return {
    weekly: "Weekly",
    fortnightly: "Every two weeks",
    four_weekly: "Every four weeks",
    yearly: "Yearly",
  }[bill?.frequency] || "Monthly";
}

function BillCard({ bill, displayCurrency, importLocked, selectMode, selected, onToggleSelect, onEdit, onDelete, onMarkPaid }) {
  const paid = isPaidBill(bill);
  return (
    <li id={`bill-row-${bill.id}`} className={`compact-bill-row${isRecentlyAdded(bill) ? " is-recent" : ""}${paid ? " is-paid" : ""}`}>
      {selectMode ? <input type="checkbox" className="bill-checkbox" checked={selected} onChange={() => onToggleSelect(bill.id)} aria-label={`Select ${bill.name}`} /> : null}
      <div className="compact-bill-copy">
        <div className="compact-bill-title-row">
          <strong className="compact-bill-name" title={bill.name}>{bill.name || "Unnamed bill"}</strong>
          {paid ? <span className="bill-paid-tag">Paid</span> : null}
          {isRecentlyAdded(bill) ? <span className="bill-new-tag">New</span> : null}
        </div>
        <span className="compact-bill-meta">
          {recurrenceLabel(bill)} · {bill.nextDueDate ? `Due ${formatDisplayDate(bill.nextDueDate)}` : "Due date not set"}
        </span>
        <BillCategoryPill bill={bill} />
      </div>
      <strong className="compact-bill-amount">{formatCurrency(bill.amount, displayCurrency)}</strong>
      {!selectMode ? (
        <div className="compact-bill-actions">
          <button className="bill-action-button bill-action-paid" type="button" disabled={importLocked || (!bill.nextDueDate && !paid)} onClick={() => onMarkPaid(bill)}>{paid ? "Undo paid" : "Mark paid"}</button>
          <button className="bill-action-button bill-action-edit" type="button" disabled={importLocked} onClick={() => onEdit(bill)}>Edit</button>
          <details className="bill-overflow">
            <summary aria-label={`More actions for ${bill.name}`} title="More actions"><span aria-hidden="true">•••</span></summary>
            <div className="bill-overflow-menu">
              <button type="button" disabled={importLocked} onClick={() => onDelete(bill.id)}>Remove bill</button>
            </div>
          </details>
        </div>
      ) : null}
    </li>
  );
}

function BillSection({ title, description, bills, variant, selectedBillIds, ...cardProps }) {
  if (!bills.length) return null;
  return (
    <section className={`compact-bill-section compact-bill-section-${variant}`} aria-labelledby={`bill-section-${variant}`}>
      <div className="compact-bill-section-heading">
        <h3 id={`bill-section-${variant}`}>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <ul className={`compact-bill-grid${variant === "urgent" ? " compact-bill-grid-urgent" : ""}`}>
        {bills.map((bill) => <BillCard key={bill.id} bill={bill} selected={selectedBillIds?.has(bill.id) || false} {...cardProps} />)}
      </ul>
    </section>
  );
}

export default function BillList({ bills, dashboard, displayCurrency, hasBalanceSnapshot, importLocked, todayIso, onBillsChange, onNotice }) {
  const [editingBillId, setEditingBillId] = useState("");
  const [editingBillForm, setEditingBillForm] = useState({ supplierName: "", billName: "", name: "", amount: "", dueDay: "", category: "" });
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedBillIds, setSelectedBillIds] = useState(new Set());
  const [billListFilter, setBillListFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("due_asc");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_BILLS);

  const normalisedBills = useMemo(() => (
    dashboard.paydayDate ? [...dashboard.beforePayday, ...dashboard.afterPayday] : dashboard.afterPayday
  ), [dashboard.afterPayday, dashboard.beforePayday, dashboard.paydayDate]);
  const beforePaydayIds = useMemo(() => new Set(dashboard.beforePayday.map((bill) => bill.id)), [dashboard.beforePayday]);
  const view = useMemo(() => buildBillListView({
    bills: normalisedBills,
    beforePaydayIds,
    filter: billListFilter,
    search,
    sort,
    isPaid: isPaidBill,
    isRecent: isRecentlyAdded,
  }), [beforePaydayIds, billListFilter, normalisedBills, search, sort]);
  const visibleUrgent = view.urgent.slice(0, visibleCount);
  const remainingCapacity = Math.max(0, visibleCount - visibleUrgent.length);
  const visibleUpcoming = view.upcoming.slice(0, remainingCapacity);
  const hasMore = visibleUrgent.length + visibleUpcoming.length < view.all.length;

  const filterCounts = useMemo(() => ({
    all: normalisedBills.length,
    before: normalisedBills.filter((bill) => beforePaydayIds.has(bill.id)).length,
    after: normalisedBills.filter((bill) => !beforePaydayIds.has(bill.id)).length,
    paid: normalisedBills.filter(isPaidBill).length,
    recent: normalisedBills.filter(isRecentlyAdded).length,
  }), [beforePaydayIds, normalisedBills]);

  function resetDisclosure() {
    setVisibleCount(INITIAL_VISIBLE_BILLS);
  }

  function startBillEdit(bill) {
    const splitName = splitBillDisplayName(bill.name || "");
    setEditingBillId(bill.id);
    setEditingBillForm({
      supplierName: bill.supplierName || splitName.supplierName || "",
      billName: bill.billName || splitName.billName || bill.name || "",
      name: bill.name || "",
      amount: bill.amount?.toString() || "",
      dueDay: bill.dueDay?.toString() || "",
      category: bill.category || "",
    });
    setEditError("");
  }

  function cancelBillEdit() {
    if (savingEdit) return;
    setEditingBillId("");
    setEditingBillForm({ supplierName: "", billName: "", name: "", amount: "", dueDay: "", category: "" });
    setEditError("");
  }

  async function handleBillEditSave(event) {
    event.preventDefault();
    const billId = editingBillId;
    const amount = Number(editingBillForm.amount);
    const dueDay = Number(editingBillForm.dueDay);
    const displayName = sanitiseBillDisplayName(composeBillDisplayName({ supplierName: editingBillForm.supplierName, billName: editingBillForm.billName, fallbackName: editingBillForm.name }));
    if (!displayName.trim() || !Number.isFinite(amount) || amount < 0 || !isValidDueDay(dueDay)) {
      setEditError("Add a bill name, amount, and usual due day before saving.");
      return;
    }

    setSavingEdit(true);
    setEditError("");
    try {
      const existingBill = bills.find((bill) => bill.id === billId);
      const updatedBill = buildBillDocument({
        name: displayName.trim(),
        supplierName: editingBillForm.supplierName || null,
        billName: editingBillForm.billName || null,
        amount,
        dueDay,
        currency: "GBP",
        reminderOffsetDays: 1,
        paidThroughDate: existingBill?.paidThroughDate || null,
      });
      const payload = { ...updatedBill, category: editingBillForm.category || null, lastPaidAt: existingBill?.lastPaidAt || null };
      await runWithTimeout(postDashboardBillAction("update_bill", { billId, fields: payload }), "Saving that bill is taking too long. Check your connection and try again.");
      onBillsChange?.((current) => current.map((bill) => bill.id === billId ? { ...bill, ...payload, id: billId } : bill));
      logSecurityEventClient("bill_updated", { source: "edit" });
      setEditingBillId("");
      onNotice?.("Bill updated.");
    } catch (saveError) {
      setEditError(friendlyBillSaveError(saveError, "Could not save that bill."));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleBillDelete(billId) {
    if (!window.confirm("Remove this bill?")) return;
    const previousBills = bills;
    onBillsChange?.((current) => current.filter((bill) => bill.id !== billId));
    try {
      await postDashboardBillAction("delete_bill", { billId });
      logSecurityEventClient("bill_deleted");
      onNotice?.("Bill removed.");
    } catch (saveError) {
      onBillsChange?.(() => previousBills);
      setEditError(friendlyBillSaveError(saveError, "Could not delete that bill. Try again."));
    }
  }

  async function handleBillPaidToggle(bill) {
    if (isPaidBill(bill)) {
      const previousPaidThroughDate = bill.paidThroughDate || null;
      const previousLastPaidAt = bill.lastPaidAt || null;
      setEditError("");
      onBillsChange?.((current) => current.map((entry) => entry.id === bill.id ? { ...entry, paidThroughDate: null, lastPaidAt: null } : entry));
      try {
        await runWithTimeout(postDashboardBillAction("update_bill", { billId: bill.id, fields: { paidThroughDate: null, lastPaidAt: null } }), "Saving the paid status is taking too long. Check your connection and try again.");
        onNotice?.(`${bill.name} reactivated.`);
      } catch (saveError) {
        onBillsChange?.((current) => current.map((entry) => entry.id === bill.id ? { ...entry, paidThroughDate: previousPaidThroughDate, lastPaidAt: previousLastPaidAt } : entry));
        setEditError(friendlyBillSaveError(saveError, "Could not reactivate that bill."));
      }
      return;
    }

    const cycleDate = bill.nextDueDate || calculateBillSchedule(bill.dueDay, bill.reminderOffsetDays, bill.paidThroughDate || null, todayIso).nextDueDate;
    if (!cycleDate) {
      setEditError("Add a due day before marking this bill as paid.");
      return;
    }
    const previousPaidThroughDate = bill.paidThroughDate || null;
    setEditError("");
    onBillsChange?.((current) => current.map((entry) => entry.id === bill.id ? { ...entry, paidThroughDate: cycleDate } : entry));
    try {
      await runWithTimeout(postDashboardBillAction("update_bill", { billId: bill.id, fields: { paidThroughDate: cycleDate, lastPaidAt: "__SERVER_TIMESTAMP__" } }), "Saving the paid status is taking too long. Check your connection and try again.");
      onNotice?.(`${bill.name} marked as paid.`);
    } catch (saveError) {
      onBillsChange?.((current) => current.map((entry) => entry.id === bill.id ? { ...entry, paidThroughDate: previousPaidThroughDate } : entry));
      setEditError(friendlyBillSaveError(saveError, "Could not mark that bill as paid."));
    }
  }

  async function handleBulkDelete() {
    if (!selectedBillIds.size || !window.confirm(`Delete ${selectedBillIds.size} selected bill${selectedBillIds.size === 1 ? "" : "s"}?`)) return;
    const previousBills = bills;
    const ids = [...selectedBillIds];
    onBillsChange?.((current) => current.filter((bill) => !selectedBillIds.has(bill.id)));
    try {
      await postDashboardBillAction("bulk_delete_bills", { billIds: ids });
      logSecurityEventClient("bill_deleted", { count: ids.length });
      setSelectedBillIds(new Set());
      setSelectMode(false);
    } catch (saveError) {
      onBillsChange?.(() => previousBills);
      setEditError(friendlyBillSaveError(saveError, "Could not delete the selected bills. Try again."));
    }
  }

  const cardProps = {
    displayCurrency,
    importLocked,
    selectMode,
    onToggleSelect: (id) => setSelectedBillIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
    onEdit: startBillEdit,
    onDelete: handleBillDelete,
    onMarkPaid: handleBillPaidToggle,
  };

  return (
    <section className={`list-panel compact-bill-manager${!hasBalanceSnapshot && !bills.length ? " is-disabled-soft" : ""}`}>
      <div className="compact-bill-toolbar">
        <div className="bill-search-field">
          <label className="sr-only" htmlFor="bill-search">Search bills</label>
          <input id="bill-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); resetDisclosure(); }} placeholder="Search bills" />
        </div>
        <div className="bill-filter-tabs" aria-label="Filter bills">
          {[
            { key: "all", label: "All" },
            ...(dashboard.paydayDate ? [{ key: "before", label: "Before payday" }, { key: "after", label: "After payday" }] : []),
            { key: "paid", label: "Paid" },
            { key: "recent", label: "Recently added" },
          ].map((item) => (
            <button key={item.key} type="button" className={`bill-filter-tab${billListFilter === item.key ? " is-active" : ""}`} aria-pressed={billListFilter === item.key} onClick={() => { setBillListFilter(item.key); resetDisclosure(); }}>
              {item.label}{filterCounts[item.key] ? ` (${filterCounts[item.key]})` : ""}
            </button>
          ))}
        </div>
        <label className="bill-sort-field">Sort <select value={sort} onChange={(event) => { setSort(event.target.value); resetDisclosure(); }}><option value="due_asc">Due soonest</option><option value="amount_desc">Amount: high to low</option><option value="name_asc">Name</option></select></label>
        {bills.length ? <button className="secondary-button small-button" type="button" onClick={() => { setSelectMode((value) => !value); setSelectedBillIds(new Set()); }}>{selectMode ? "Done" : "Select"}</button> : null}
      </div>

      {selectMode ? (
        <div className="compact-selection-toolbar">
          <button type="button" onClick={() => setSelectedBillIds(new Set(view.all.map((bill) => bill.id)))}>Select filtered</button>
          <button type="button" onClick={() => setSelectedBillIds(new Set())}>Clear</button>
          {selectedBillIds.size ? <button className="delete-button" type="button" onClick={handleBulkDelete}>Delete {selectedBillIds.size}</button> : null}
        </div>
      ) : null}

      {!dashboard.paydayDate && bills.length ? <p className="compact-bill-note">No upcoming income is confirmed, so bills are shown together by next due date.</p> : null}
      {!bills.length ? <div className="compact-bill-empty"><h3>No bills yet</h3><p>Add your regular commitments to include them in your runway.</p></div> : null}
      {bills.length && !view.all.length ? <div className="compact-bill-empty"><h3>No matching bills</h3><p>Try another search or filter.</p></div> : null}

      <BillSection title="Due before payday" description="These leave your account before the next confirmed income." bills={visibleUrgent} variant="urgent" {...cardProps} selectedBillIds={selectedBillIds} />
      <BillSection title={billListFilter === "paid" ? "Paid bills" : billListFilter === "recent" ? "Recently added" : "Upcoming regular bills"} bills={visibleUpcoming} variant="upcoming" {...cardProps} selectedBillIds={selectedBillIds} />
      {hasMore ? <button className="secondary-button compact-bill-show-more" type="button" onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE_BILLS)}>Show more ({view.all.length - visibleUrgent.length - visibleUpcoming.length})</button> : null}
      {editError && !editingBillId ? <p className="error" role="alert">{editError}</p> : null}

      <Drawer open={Boolean(editingBillId)} onClose={cancelBillEdit} closeDisabled={savingEdit} title="Edit bill" description="Changes update this bill without leaving the page.">
        <form className="compact-bill-edit-form" onSubmit={handleBillEditSave}>
          <div className="field-row"><label className="field-label" htmlFor="edit-bill-supplier">Supplier name</label><input data-drawer-initial-focus id="edit-bill-supplier" value={editingBillForm.supplierName} onChange={(event) => setEditingBillForm((current) => ({ ...current, supplierName: event.target.value }))} /></div>
          <div className="field-row"><label className="field-label" htmlFor="edit-bill-name">Bill name</label><input id="edit-bill-name" value={editingBillForm.billName || editingBillForm.name} onChange={(event) => setEditingBillForm((current) => ({ ...current, billName: event.target.value, name: event.target.value }))} required /></div>
          <div className="compact-bill-edit-grid">
            <div className="field-row"><label className="field-label" htmlFor="edit-bill-amount">Amount</label><input id="edit-bill-amount" inputMode="decimal" value={editingBillForm.amount} onChange={(event) => setEditingBillForm((current) => ({ ...current, amount: event.target.value }))} required /></div>
            <DayOfMonthField id="edit-bill-due-day" label="Usual due day" value={editingBillForm.dueDay} onChange={(event) => setEditingBillForm((current) => ({ ...current, dueDay: event.target.value }))} required />
          </div>
          <div className="field-row"><label className="field-label" htmlFor="edit-bill-category">Category</label><select id="edit-bill-category" value={editingBillForm.category} onChange={(event) => setEditingBillForm((current) => ({ ...current, category: event.target.value }))}><option value="">Auto-detect</option>{Object.entries(CATEGORY_META).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select></div>
          <p className="helper-text">Recurs monthly. The next absolute due date is recalculated from the usual due day.</p>
          {editError ? <p className="error" role="alert">{editError}</p> : null}
          <div className="edit-actions"><button className="secondary-button" type="button" onClick={cancelBillEdit} disabled={savingEdit}>Cancel</button><button className="primary-button" type="submit" disabled={savingEdit || importLocked}>{savingEdit ? "Saving…" : "Save changes"}</button></div>
        </form>
      </Drawer>
    </section>
  );
}
