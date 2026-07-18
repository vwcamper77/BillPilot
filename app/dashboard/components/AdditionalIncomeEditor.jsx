"use client";

import { useState } from "react";
import DateField from "@/app/components/forms/DateField";
import { formatCurrency, formatDisplayDate } from "@/lib/billMath";
import { expandIncomeEvents } from "@/lib/cashflowTimeline";
import { classifyIncomeSource, upsertIncomeSource } from "@/lib/incomeSchedule";
import { postDashboardIncomeEventAction, runWithTimeout } from "../lib/dashboardApi";
import { friendlySettingsError } from "../lib/friendlyErrors";

const EMPTY_FORM = { name: "", amount: "", firstPaymentDate: "", frequency: "one_off", endDate: "", confidence: "confirmed", active: true };
const FREQUENCY_LABELS = { one_off: "One-off", weekly: "Weekly", fortnightly: "Every two weeks", four_weekly: "Every four weeks", monthly: "Monthly" };

export default function AdditionalIncomeEditor({ incomeEvents = [], onIncomeEventsChange, todayIso, displayCurrency, onNotice, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const sources = [...incomeEvents].sort((a, b) => String(a.firstPaymentDate || a.expectedDate).localeCompare(String(b.firstPaymentDate || b.expectedDate)));
  const firstPaymentDateError = error === "Choose the first payment date." ? error : "";
  const endDateError = error === "The end date must be after the first payment." ? error : "";

  function startAdd(frequency = "one_off") {
    setEditingId("");
    setForm({ ...EMPTY_FORM, firstPaymentDate: todayIso, frequency });
    setExpanded(true);
    setError("");
  }

  function choosePattern(event) {
    const pattern = event.target.value;
    if (!pattern) return;
    startAdd(pattern === "monthly" ? "monthly" : pattern === "regular" ? "weekly" : "one_off");
  }

  function startEdit(source) {
    setEditingId(source.id);
    setForm({
      name: source.name || "",
      amount: String(source.amount ?? ""),
      firstPaymentDate: source.firstPaymentDate || source.expectedDate || todayIso,
      frequency: source.frequency || "one_off",
      endDate: source.endDate || "",
      confidence: source.confidence || "confirmed",
      active: source.active !== false,
    });
    setExpanded(true);
    setError("");
  }

  function closeForm() { setEditingId(""); setForm(EMPTY_FORM); setError(""); }

  async function saveEvent(event) {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!form.name.trim()) return setError("Add a name for this income.");
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter an amount greater than zero.");
    if (!form.firstPaymentDate) return setError("Choose the first payment date.");
    if (form.endDate && form.endDate < form.firstPaymentDate) return setError("The end date must be after the first payment.");
    setSaving(true);
    setError("");
    const fields = { ...form, name: form.name.trim(), amount, endDate: form.endDate || null };
    try {
      const result = await runWithTimeout(postDashboardIncomeEventAction("save_income_event", { eventId: editingId || null, fields }), "Saving that income is taking too long. Check your connection and try again.");
      const saved = { ...fields, ...(result.event || {}), id: result.eventId, expectedDate: fields.firstPaymentDate };
      onIncomeEventsChange?.((current) => upsertIncomeSource(current, saved));
      onNotice?.(editingId ? "Income schedule updated." : "Income schedule added.");
      closeForm();
    } catch (saveError) {
      setError(friendlySettingsError(saveError, "We could not save that income."));
    } finally { setSaving(false); }
  }

  async function setActive(source, active) {
    setError("");
    try {
      await postDashboardIncomeEventAction("set_income_active", { eventId: source.id, active });
      onIncomeEventsChange?.((current) => current.map((item) => item.id === source.id ? { ...item, active } : item));
      onNotice?.(active ? "Income schedule resumed." : "Income schedule paused.");
    } catch (actionError) { setError(friendlySettingsError(actionError, "We could not update that income.")); }
  }

  async function setOccurrenceStatus(source, occurrenceDate, status) {
    setError("");
    try {
      await postDashboardIncomeEventAction("set_income_occurrence_status", { eventId: source.id, occurrenceDate, status });
      onIncomeEventsChange?.((current) => current.map((item) => item.id === source.id ? {
        ...item,
        occurrenceStatuses: { ...(item.occurrenceStatuses || {}), [occurrenceDate]: status },
      } : item));
      onNotice?.(status === "received" ? "Income marked as received. Update your current balance if it now includes this payment." : "Payment skipped.");
    } catch (actionError) { setError(friendlySettingsError(actionError, "We could not update that payment.")); }
  }

  async function removeEvent(source) {
    if (!window.confirm(`Remove ${source.name}?`)) return;
    try {
      await postDashboardIncomeEventAction("delete_income_event", { eventId: source.id });
      onIncomeEventsChange?.((current) => current.filter((item) => item.id !== source.id));
      if (editingId === source.id) closeForm();
      onNotice?.("Income schedule removed.");
    } catch (removeError) { setError(friendlySettingsError(removeError, "We could not remove that income.")); }
  }

  const showingForm = Boolean(editingId || form.firstPaymentDate);
  const activeCount = sources.filter((source) => source.active !== false).length;
  const summary = activeCount ? `${activeCount} active income schedule${activeCount === 1 ? "" : "s"}` : "Add another income";

  return (
    <div className="additional-income-editor" data-testid="additional-income-editor">
      <div className="field-row income-pattern-field">
        <label className="field-label" htmlFor="income-pattern">Income pattern</label>
        <select id="income-pattern" defaultValue="" onChange={choosePattern}>
          <option value="" disabled>Choose how you are paid</option>
          <option value="monthly">Regular monthly salary</option>
          <option value="regular">Regular weekly or fortnightly pay</option>
          <option value="irregular">Irregular income / no fixed payday</option>
        </select>
      </div>
      <button className="additional-income-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
        <span><strong>Add another income</strong><small>{summary}</small></span><span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded ? <div className="additional-income-body">
        <p className="helper-text">Confirmed payments affect safe spending only on their scheduled date. Estimates stay visible but are excluded.</p>
        {sources.length ? <ul className="additional-income-list">{sources.map((source) => {
          const firstDate = source.firstPaymentDate || source.expectedDate;
          const classification = classifyIncomeSource(source);
          const overdueOccurrences = firstDate
            ? expandIncomeEvents([source], firstDate, todayIso, { confirmedOnly: false, includeNonForecast: true, asOfIso: todayIso })
              .filter((occurrence) => occurrence.status === "overdue_unconfirmed")
            : [];
          return <li key={source.id} className={source.active === false ? "is-paused" : ""}>
            <div><strong>{source.name}</strong><span>{formatCurrency(source.amount, displayCurrency)} · {formatDisplayDate(firstDate)} · {FREQUENCY_LABELS[source.frequency] || "One-off"}</span>
              <small className={`income-status income-status-${classification}`}>
                {classification === "confirmed" ? "Confirmed" : classification === "estimated" ? "Estimated — excluded from safe spending" : classification === "paused" ? "Paused" : "Excluded"}
              </small>
              {overdueOccurrences.map((occurrence) => (
                <span className="income-overdue-row" key={occurrence.occurrenceId}>
                  <small className="income-overdue">Payment due {formatDisplayDate(occurrence.date)} is overdue and unconfirmed.</small>
                  <span className="additional-income-actions">
                    <button className="bill-action-button" type="button" onClick={() => setOccurrenceStatus(source, occurrence.date, "received")}>Confirm received</button>
                    <button className="bill-action-button" type="button" onClick={() => setOccurrenceStatus(source, occurrence.date, "skipped")}>Skip payment</button>
                  </span>
                </span>
              ))}
            </div>
            <div className="additional-income-actions">
              <button className="bill-action-button bill-action-edit" type="button" onClick={() => startEdit(source)}>Edit</button>
              <button className="bill-action-button" type="button" onClick={() => setActive(source, source.active === false)}>{source.active === false ? "Resume" : "Pause"}</button>
              <button className="bill-action-button bill-action-remove" type="button" onClick={() => removeEvent(source)}>Remove</button>
            </div>
          </li>;
        })}</ul> : null}
        {!showingForm ? <button className="secondary-button small-button" type="button" onClick={() => startAdd()}>Add income</button> : <form className="additional-income-form" onSubmit={saveEvent}>
          <div className="additional-income-form-head">
            <h3>{editingId ? "Edit income" : "Income details"}</h3>
            <p className="helper-text">Add the first payment date and ClearTill will place later payments in the forecast.</p>
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="additional-income-name">Name</label>
            <input id="additional-income-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Weekly wages or invoice" />
          </div>
          <div className="additional-income-form-grid">
            <div className="field-row"><label className="field-label" htmlFor="additional-income-amount">Amount</label><input id="additional-income-amount" inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" /></div>
            <DateField id="additional-income-date" label="First payment date" required value={form.firstPaymentDate} onChange={(event) => setForm((current) => ({ ...current, firstPaymentDate: event.target.value }))} error={firstPaymentDateError} />
            <div className="field-row"><label className="field-label" htmlFor="additional-income-frequency">Repeats</label><select id="additional-income-frequency" value={form.frequency} onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}>{Object.entries(FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <DateField id="additional-income-end-date" label="End date (optional)" min={form.firstPaymentDate || undefined} value={form.endDate || ""} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} error={endDateError} />
            <div className="field-row"><label className="field-label" htmlFor="additional-income-confidence">Confidence</label><select id="additional-income-confidence" value={form.confidence} onChange={(event) => setForm((current) => ({ ...current, confidence: event.target.value }))}><option value="confirmed">Confirmed</option><option value="estimated">Estimated</option></select></div>
          </div>
          <div className="edit-actions"><button className="primary-button small-button" type="submit" disabled={saving}>{saving ? "Saving..." : editingId ? "Save changes" : "Add income"}</button><button className="secondary-button small-button" type="button" onClick={closeForm}>Cancel</button></div>
        </form>}
        {error && !firstPaymentDateError && !endDateError ? <p className="error" role="alert">{error}</p> : null}
      </div> : null}
    </div>
  );
}
