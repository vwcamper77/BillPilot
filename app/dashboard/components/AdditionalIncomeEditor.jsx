"use client";

import { useState } from "react";
import { formatCurrency, formatDisplayDate } from "@/lib/billMath";
import { postDashboardIncomeEventAction, runWithTimeout } from "../lib/dashboardApi";
import { friendlySettingsError } from "../lib/friendlyErrors";

const EMPTY_FORM = {
  name: "",
  amount: "",
  expectedDate: "",
  frequency: "one_off",
  confidence: "confirmed",
};

const FREQUENCY_LABELS = {
  one_off: "One-off",
  weekly: "Weekly",
  fortnightly: "Every two weeks",
  monthly: "Monthly",
};

export default function AdditionalIncomeEditor({ incomeEvents = [], onIncomeEventsChange, todayIso, displayCurrency, onNotice }) {
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeEvents = [...incomeEvents]
    .filter((event) => event?.active !== false && event?.status !== "cancelled")
    .sort((a, b) => String(a.expectedDate).localeCompare(String(b.expectedDate)));

  function startAdd() {
    setEditingId("");
    setForm({ ...EMPTY_FORM, expectedDate: todayIso });
    setError("");
  }

  function startEdit(event) {
    setEditingId(event.id);
    setForm({
      name: event.name || "",
      amount: String(event.amount ?? ""),
      expectedDate: event.expectedDate || todayIso,
      frequency: event.frequency || "one_off",
      confidence: event.confidence || "confirmed",
    });
    setError("");
  }

  function closeForm() {
    setEditingId("");
    setForm(EMPTY_FORM);
    setError("");
  }

  async function saveEvent(event) {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!form.name.trim()) return setError("Add a name for this income.");
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter an amount greater than zero.");
    if (!form.expectedDate) return setError("Choose the date this money is expected.");
    setSaving(true);
    setError("");
    const fields = { ...form, name: form.name.trim(), amount };
    try {
      const result = await runWithTimeout(
        postDashboardIncomeEventAction("save_income_event", { eventId: editingId || null, fields }),
        "Saving that income is taking too long. Check your connection and try again.",
      );
      const saved = { ...fields, id: result.eventId, status: "scheduled", active: true, currency: "GBP" };
      onIncomeEventsChange?.((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => item.id === saved.id ? { ...item, ...saved } : item) : [...current, saved];
      });
      onNotice?.(editingId ? "Additional income updated." : "Additional income added.");
      closeForm();
    } catch (saveError) {
      setError(friendlySettingsError(saveError, "We could not save that income."));
    } finally {
      setSaving(false);
    }
  }

  async function removeEvent(event) {
    if (!window.confirm(`Remove ${event.name}?`)) return;
    setError("");
    try {
      await postDashboardIncomeEventAction("delete_income_event", { eventId: event.id });
      onIncomeEventsChange?.((current) => current.filter((item) => item.id !== event.id));
      if (editingId === event.id) closeForm();
      onNotice?.("Additional income removed.");
    } catch (removeError) {
      setError(friendlySettingsError(removeError, "We could not remove that income."));
    }
  }

  const showingForm = Boolean(editingId || form.expectedDate);
  const summary = activeEvents.length
    ? `${activeEvents.length} additional payment${activeEvents.length === 1 ? "" : "s"} scheduled`
    : "Other money coming in (optional)";

  return (
    <div className="additional-income-editor" data-testid="additional-income-editor">
      <button
        className="additional-income-toggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{summary}</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded ? (
        <div className="additional-income-body">
          <p className="helper-text">Confirmed payments affect safe spending, the forecast and Large Cost plans only from the date they arrive.</p>
          {activeEvents.length ? (
            <ul className="additional-income-list">
              {activeEvents.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>{event.name}</strong>
                    <span>{formatCurrency(event.amount, displayCurrency)} · {formatDisplayDate(event.expectedDate)} · {FREQUENCY_LABELS[event.frequency] || "One-off"}</span>
                    {event.confidence === "estimated" ? <small>Estimated — not included in safe spending</small> : null}
                  </div>
                  <div className="additional-income-actions">
                    <button className="bill-action-button bill-action-edit" type="button" onClick={() => startEdit(event)}>Edit</button>
                    <button className="bill-action-button bill-action-remove" type="button" onClick={() => removeEvent(event)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {!showingForm ? (
            <button className="secondary-button small-button" type="button" onClick={startAdd}>Add another payment</button>
          ) : (
            <form className="additional-income-form" onSubmit={saveEvent}>
              <label className="field-label" htmlFor="additional-income-name">Name</label>
              <input id="additional-income-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Freelance payment" />
              <div className="additional-income-form-grid">
                <div className="field-row">
                  <label className="field-label" htmlFor="additional-income-amount">Amount</label>
                  <input id="additional-income-amount" inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="300" />
                </div>
                <div className="field-row">
                  <label className="field-label" htmlFor="additional-income-date">Expected date</label>
                  <input id="additional-income-date" type="date" min={todayIso} value={form.expectedDate} onChange={(event) => setForm((current) => ({ ...current, expectedDate: event.target.value }))} />
                </div>
                <div className="field-row">
                  <label className="field-label" htmlFor="additional-income-frequency">Repeats</label>
                  <select id="additional-income-frequency" value={form.frequency} onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}>
                    {Object.entries(FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div className="field-row">
                  <label className="field-label" htmlFor="additional-income-confidence">How certain is it?</label>
                  <select id="additional-income-confidence" value={form.confidence} onChange={(event) => setForm((current) => ({ ...current, confidence: event.target.value }))}>
                    <option value="confirmed">Confirmed</option>
                    <option value="estimated">Estimated</option>
                  </select>
                </div>
              </div>
              {form.confidence === "estimated" ? <p className="helper-text">Estimated income appears in this list but is not included in affordability calculations.</p> : null}
              <div className="edit-actions">
                <button className="primary-button small-button" type="submit" disabled={saving}>{saving ? "Saving..." : editingId ? "Save changes" : "Add payment"}</button>
                <button className="secondary-button small-button" type="button" onClick={closeForm}>Cancel</button>
              </div>
            </form>
          )}
          {error ? <p className="error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
