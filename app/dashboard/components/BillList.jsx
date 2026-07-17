"use client";

import { useMemo, useState } from "react";
import DayOfMonthField from "@/app/components/forms/DayOfMonthField";
import {
  buildBillDocument,
  calculateBillSchedule,
  composeBillDisplayName,
  formatCurrency,
  formatDisplayDate,
  formatOrdinal,
  isValidDueDay,
  sanitiseBillDisplayName,
  splitBillDisplayName,
} from "@/lib/billMath";
import { logSecurityEventClient } from "@/lib/security/clientSecurity";
import { postDashboardBillAction, runWithTimeout } from "../lib/dashboardApi";
import { friendlyBillSaveError } from "../lib/friendlyErrors";
import { CATEGORY_META, classifyBill, isPaidBill, isRecentlyAdded } from "../lib/billHelpers";

const BILLS_PER_PAGE = 6;

function BillCategoryPill({ bill }) {
  const category = bill.category || classifyBill(bill).category || "other";
  const meta = CATEGORY_META[category] || CATEGORY_META.other;
  return (
    <span className="bill-category-pill">
      {meta.icon} {meta.label}
    </span>
  );
}

function BillPagination({ page, total, onPrev, onNext }) {
  return (
    <div className="bill-pagination">
      <button className="secondary-button" type="button" disabled={page === 0} onClick={onPrev}>← Previous</button>
      <span className="bill-pagination-label">Page {page + 1} of {total}</span>
      <button className="secondary-button" type="button" disabled={page >= total - 1} onClick={onNext}>Next →</button>
    </div>
  );
}

function BillGroup({
  title,
  bills,
  editingBillId,
  editingBillForm,
  onBillFormChange,
  onEditStart,
  onEditCancel,
  onEditSave,
  savingEdit,
  importLocked,
  onDelete,
  onMarkPaid,
  selectMode,
  selectedBillIds,
  onToggleSelect,
  displayCurrency,
}) {
  return (
    <div className="bill-section">
      <h3>{title}</h3>
      {bills.length ? (
        <ul className="bill-list">
          {bills.map((bill) => (
            <li key={bill.id} className={isRecentlyAdded(bill) ? "bill-row-new" : undefined}>
              {editingBillId === bill.id ? (
                <form className="edit-form bill-edit-form" onSubmit={(event) => onEditSave(event, bill.id)}>
                  <label className="field-label" htmlFor={`bill-supplier-${bill.id}`}>Supplier name</label>
                  <input
                    id={`bill-supplier-${bill.id}`}
                    list="supplier-name-options"
                    value={editingBillForm.supplierName}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, supplierName: event.target.value }))}
                    placeholder="Supplier name"
                  />
                  <label className="field-label" htmlFor={`bill-name-${bill.id}`}>Bill name</label>
                  <input
                    id={`bill-name-${bill.id}`}
                    value={editingBillForm.billName || editingBillForm.name}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, billName: event.target.value, name: event.target.value }))}
                    placeholder="Bill name"
                  />
                  <label className="field-label" htmlFor={`bill-amount-${bill.id}`}>Amount</label>
                  <input
                    id={`bill-amount-${bill.id}`}
                    inputMode="decimal"
                    value={editingBillForm.amount}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, amount: event.target.value }))}
                    placeholder="Amount"
                  />
                  <DayOfMonthField
                    id={`bill-due-day-${bill.id}`}
                    label="Day of month"
                    value={editingBillForm.dueDay}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, dueDay: event.target.value }))}
                  />
                  <label className="field-label" htmlFor={`bill-category-${bill.id}`}>Category</label>
                  <select
                    id={`bill-category-${bill.id}`}
                    className="category-select"
                    value={editingBillForm.category}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, category: event.target.value }))}
                  >
                    <option value="">Auto-detect</option>
                    <option value="household">🏠 Household</option>
                    <option value="subscription">🔁 Subscription</option>
                    <option value="work_side_project">💼 Work / side project</option>
                    <option value="vehicle">🚗 Vehicle</option>
                    <option value="debt">💳 Debt / repayment</option>
                    <option value="family">🧒 Children / family</option>
                    <option value="other">📌 Other</option>
                  </select>
                  <div className="edit-actions">
                    <button className="primary-button small-button" type="submit" disabled={savingEdit || importLocked}>
                      {savingEdit ? "Saving..." : "Save"}
                    </button>
                    <button className="secondary-button small-button" type="button" disabled={importLocked} onClick={onEditCancel}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {selectMode ? (
                    <input
                      type="checkbox"
                      className="bill-checkbox"
                      checked={selectedBillIds?.has(bill.id) ?? false}
                      onChange={() => onToggleSelect?.(bill.id)}
                      aria-label={`Select ${bill.name}`}
                    />
                  ) : null}
                  <div className="bill-row-main">
                    <div className="bill-row-head">
                      <span className="bill-row-title">{bill.name}</span>
                      {isRecentlyAdded(bill) ? <span className="bill-new-tag">Recently added</span> : null}
                      {isPaidBill(bill) ? <span className="bill-paid-tag">Paid</span> : null}
                    </div>
                    <div className="bill-row-details">
                      <span className="bill-meta-pair">
                        <strong>{formatCurrency(bill.amount, displayCurrency)}</strong>
                        <span className="bill-meta">per month</span>
                      </span>
                      <span className="bill-meta-pair">
                        <strong>{isValidDueDay(bill.dueDay) ? formatOrdinal(bill.dueDay) : "Date not set"}</strong>
                        <span className="bill-meta">due date</span>
                      </span>
                      {isPaidBill(bill) ? (
                        <span className="bill-meta-pair">
                          <strong>{formatDisplayDate(bill.paidThroughDate)}</strong>
                          <span className="bill-meta">paid through</span>
                        </span>
                      ) : null}
                    </div>
                    <BillCategoryPill bill={bill} />
                  </div>
                  {!selectMode ? (
                    <div className="bill-actions">
                      <button
                        className="bill-action-button bill-action-paid"
                        type="button"
                        disabled={importLocked || (!bill.nextDueDate && !isPaidBill(bill))}
                        onClick={() => onMarkPaid?.(bill)}
                      >
                        {isPaidBill(bill) ? "Undo paid" : "Paid"}
                      </button>
                      <button className="bill-action-button bill-action-edit" type="button" disabled={importLocked} onClick={() => onEditStart(bill)}>
                        Edit
                      </button>
                      <button className="bill-action-button bill-action-remove" type="button" disabled={importLocked} onClick={() => onDelete?.(bill.id)}>
                        Remove
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Nothing here yet.</p>
      )}
    </div>
  );
}

export default function BillList({
  bills,
  dashboard,
  displayCurrency,
  hasBalanceSnapshot,
  importLocked,
  todayIso,
  onBillsChange,
  onNotice,
}) {
  const [editingBillId, setEditingBillId] = useState("");
  const [editingBillForm, setEditingBillForm] = useState({ supplierName: "", billName: "", name: "", amount: "", dueDay: "", category: "" });
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedBillIds, setSelectedBillIds] = useState(new Set());
  const [billListPage, setBillListPage] = useState(0);
  const [billListFilter, setBillListFilter] = useState("all");

  const hasBills = bills.length > 0;

  const allBillsForList = useMemo(() => {
    const combined = dashboard.paydayDate
      ? [...dashboard.beforePayday, ...dashboard.afterPayday]
      : dashboard.upcomingBills;
    if (billListFilter === "before" && dashboard.paydayDate) return dashboard.beforePayday;
    if (billListFilter === "after" && dashboard.paydayDate) return dashboard.afterPayday;
    if (billListFilter === "recent") return combined.filter(isRecentlyAdded);
    if (billListFilter === "paid") return combined.filter(isPaidBill);
    return combined;
  }, [dashboard, billListFilter]);
  const billListTotalPages = Math.max(1, Math.ceil(allBillsForList.length / BILLS_PER_PAGE));
  const safeBillPage = Math.min(billListPage, Math.max(0, billListTotalPages - 1));
  const pagedBills = allBillsForList.slice(safeBillPage * BILLS_PER_PAGE, (safeBillPage + 1) * BILLS_PER_PAGE);
  const beforePaydayIdSet = useMemo(() => new Set(dashboard.beforePayday.map((b) => b.id)), [dashboard.beforePayday]);
  const pagedBeforeGroup = pagedBills.filter((b) => beforePaydayIdSet.has(b.id));
  const pagedAfterGroup = pagedBills.filter((b) => !beforePaydayIdSet.has(b.id));
  const billListSummary = useMemo(() => {
    if (!hasBills) {
      return null;
    }

    const total = allBillsForList.reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);
    const label = billListFilter === "before"
      ? "bills before payday"
      : billListFilter === "after"
        ? "bills after payday"
        : billListFilter === "recent"
          ? "recently added bills"
          : billListFilter === "paid"
            ? "paid bills"
            : "total monthly bills";

    return { amount: formatCurrency(total, displayCurrency), label };
  }, [allBillsForList, billListFilter, displayCurrency, hasBills]);

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
    setEditingBillId("");
    setEditingBillForm({ supplierName: "", billName: "", name: "", amount: "", dueDay: "", category: "" });
  }

  async function handleBillEditSave(event, billId) {
    event.preventDefault();

    const amount = Number(editingBillForm.amount);
    const dueDay = Number(editingBillForm.dueDay);

    const displayName = sanitiseBillDisplayName(composeBillDisplayName({
      supplierName: editingBillForm.supplierName,
      billName: editingBillForm.billName,
      fallbackName: editingBillForm.name,
    }));

    if (!displayName.trim() || !Number.isFinite(amount) || !Number.isFinite(dueDay)) {
      setEditError("Add a bill name, amount, and due day before saving.");
      return;
    }

    setSavingEdit(true);
    setEditError("");

    try {
      const existingBill = bills.find((bill) => bill.id === billId);
      const updatedBill = buildBillDocument({
        name: sanitiseBillDisplayName(displayName.trim()),
        supplierName: editingBillForm.supplierName || null,
        billName: editingBillForm.billName || null,
        amount,
        dueDay,
        currency: "GBP",
        reminderOffsetDays: 1,
        paidThroughDate: existingBill?.paidThroughDate || null,
      });
      const payload = {
        ...updatedBill,
        category: editingBillForm.category || null,
        lastPaidAt: existingBill?.lastPaidAt || null,
      };

      await runWithTimeout(
        postDashboardBillAction("update_bill", { billId, fields: payload }),
        "Saving that bill is taking too long. Check your connection and try again.",
      );

      onBillsChange?.((current) => current.map((bill) => (
        bill.id === billId ? { ...bill, ...payload, id: billId } : bill
      )));
      logSecurityEventClient("bill_updated", { source: "edit" });
      cancelBillEdit();
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
      onBillsChange?.((current) => current.map((entry) => (
        entry.id === bill.id ? { ...entry, paidThroughDate: null, lastPaidAt: null } : entry
      )));

      try {
        await runWithTimeout(
          postDashboardBillAction("update_bill", { billId: bill.id, fields: { paidThroughDate: null, lastPaidAt: null } }),
          "Saving the paid status is taking too long. Check your connection and try again.",
        );
        onNotice?.(`${bill.name} reactivated.`);
      } catch (saveError) {
        onBillsChange?.((current) => current.map((entry) => (
          entry.id === bill.id ? { ...entry, paidThroughDate: previousPaidThroughDate, lastPaidAt: previousLastPaidAt } : entry
        )));
        setEditError(friendlyBillSaveError(saveError, "Could not reactivate that bill."));
      }
      return;
    }

    const cycleDate = bill.nextDueDate || calculateBillSchedule(
      bill.dueDay,
      bill.reminderOffsetDays,
      bill.paidThroughDate || null,
      todayIso,
    ).nextDueDate;

    if (!cycleDate) {
      setEditError("Add a due day before marking this bill as paid.");
      return;
    }

    const previousPaidThroughDate = bill.paidThroughDate || null;

    setEditError("");
    onBillsChange?.((current) => current.map((entry) => (
      entry.id === bill.id ? { ...entry, paidThroughDate: cycleDate } : entry
    )));

    try {
      await runWithTimeout(
        postDashboardBillAction("update_bill", { billId: bill.id, fields: { paidThroughDate: cycleDate, lastPaidAt: "__SERVER_TIMESTAMP__" } }),
        "Saving the paid status is taking too long. Check your connection and try again.",
      );
      onNotice?.(`${bill.name} marked as paid.`);
    } catch (saveError) {
      onBillsChange?.((current) => current.map((entry) => (
        entry.id === bill.id ? { ...entry, paidThroughDate: previousPaidThroughDate } : entry
      )));
      setEditError(friendlyBillSaveError(saveError, "Could not mark that bill as paid."));
    }
  }

  async function handleBulkDelete() {
    if (selectedBillIds.size === 0) return;
    const count = selectedBillIds.size;
    if (!window.confirm(`Delete ${count} selected bill${count === 1 ? "" : "s"}?`)) return;
    const previousBills = bills;
    onBillsChange?.((current) => current.filter((bill) => !selectedBillIds.has(bill.id)));
    try {
      await postDashboardBillAction("bulk_delete_bills", { billIds: Array.from(selectedBillIds) });
      logSecurityEventClient("bill_deleted", { count });
      setSelectedBillIds(new Set());
      setSelectMode(false);
    } catch (saveError) {
      onBillsChange?.(() => previousBills);
      setEditError(friendlyBillSaveError(saveError, "Could not delete the selected bills. Try again."));
    }
  }

  const sharedGroupProps = {
    editingBillId,
    editingBillForm,
    onBillFormChange: setEditingBillForm,
    onEditStart: startBillEdit,
    onEditCancel: cancelBillEdit,
    onEditSave: handleBillEditSave,
    savingEdit,
    importLocked,
    onDelete: handleBillDelete,
    onMarkPaid: handleBillPaidToggle,
    selectMode,
    selectedBillIds,
    onToggleSelect: (id) => setSelectedBillIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
    displayCurrency,
  };

  return (
    <section className={`list-panel ${!hasBalanceSnapshot && !hasBills ? "is-disabled-soft" : ""}`}>
      <div className="section-head">
        <h2 style={{ margin: 0 }}>Bill list</h2>
        {bills.length > 0 ? (
          <div className="select-mode-controls">
            <button className="secondary-button small-button" type="button" onClick={() => { setSelectMode((s) => !s); setSelectedBillIds(new Set()); }}>
              {selectMode ? "Done" : "Select bills"}
            </button>
            {selectMode ? (
              <>
                <button className="secondary-button small-button" type="button" onClick={() => setSelectedBillIds(new Set(bills.map((b) => b.id)))}>
                  Select all
                </button>
                <button className="secondary-button small-button" type="button" onClick={() => setSelectedBillIds(new Set())}>
                  Clear
                </button>
                {selectedBillIds.size > 0 ? (
                  <button className="secondary-button small-button delete-button" type="button" onClick={handleBulkDelete}>
                    Delete {selectedBillIds.size} selected
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {billListSummary ? (
        <div className="bill-list-summary-row" aria-live="polite">
          <span className="stat-chip bill-list-summary-chip">
            <strong>{billListSummary.amount}</strong>
            {` ${billListSummary.label}`}
          </span>
        </div>
      ) : null}

      {hasBills ? (
        <div className="bill-filter-tabs">
          {[
            { key: "all", label: "All" },
            ...(dashboard.paydayDate ? [{ key: "before", label: "Before you're paid" }, { key: "after", label: "After you're paid" }] : []),
            { key: "paid", label: "Paid" },
            { key: "recent", label: "Recently added" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`bill-filter-tab${billListFilter === tab.key ? " is-active" : ""}`}
              onClick={() => { setBillListFilter(tab.key); setBillListPage(0); }}
            >{tab.label}</button>
          ))}
        </div>
      ) : null}

      {billListTotalPages > 1 ? (
        <BillPagination
          page={safeBillPage}
          total={billListTotalPages}
          onPrev={() => setBillListPage((p) => Math.max(0, p - 1))}
          onNext={() => setBillListPage((p) => Math.min(billListTotalPages - 1, p + 1))}
        />
      ) : null}

      {dashboard.paydayDate && billListFilter === "all" ? (
        <>
          {pagedBeforeGroup.length > 0 ? <BillGroup title="Before you're paid" bills={pagedBeforeGroup} {...sharedGroupProps} /> : null}
          {pagedAfterGroup.length > 0 ? <BillGroup title="After you're paid" bills={pagedAfterGroup} {...sharedGroupProps} /> : null}
          {pagedBills.length === 0 ? <p className="empty">No bills on this page.</p> : null}
        </>
      ) : (
        <BillGroup
          title={
            billListFilter === "before" ? "Before you're paid"
            : billListFilter === "after" ? "After you're paid"
            : billListFilter === "recent" ? "Recently added"
            : billListFilter === "paid" ? "Paid bills"
            : "All bills"
          }
          bills={pagedBills}
          {...sharedGroupProps}
        />
      )}

      {billListTotalPages > 1 ? (
        <BillPagination
          page={safeBillPage}
          total={billListTotalPages}
          onPrev={() => setBillListPage((p) => Math.max(0, p - 1))}
          onNext={() => setBillListPage((p) => Math.min(billListTotalPages - 1, p + 1))}
        />
      ) : null}

      {editError ? <p className="error">{editError}</p> : null}
    </section>
  );
}
