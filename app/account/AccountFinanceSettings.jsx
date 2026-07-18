"use client";

import { useEffect, useState } from "react";
import { postDashboardStateAction } from "@/app/dashboard/lib/dashboardApi";

const MODES = [
  ["GUIDED", "Guided (recommended)"],
  ["DAILY", "Daily while out of date"],
  ["WEEKDAYS", "Weekdays while out of date"],
  ["THREE_PER_WEEK", "Three times per week"],
  ["WEEKLY", "Weekly"],
  ["BILLS_ONLY", "Bills only"],
  ["OFF", "Off"],
];

export default function AccountFinanceSettings({ user }) {
  const [state, setState] = useState({ loading: true, reminders: [], preferences: null, error: "" });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    Promise.all([postDashboardStateAction(), authenticatedRequest(user, "/api/reminder-preferences")]).then(([dashboard, preferences]) => {
      if (!cancelled) setState({ loading: false, reminders: dashboard?.reminders || [], preferences: preferences.preferences, error: "" });
    }).catch(() => {
      if (!cancelled) setState({ loading: false, reminders: [], preferences: null, error: "Your reminder settings could not be loaded right now." });
    });
    return () => { cancelled = true; };
  }, [user]);

  function update(key, value) {
    setFeedback("");
    setState((current) => ({ ...current, preferences: { ...current.preferences, [key]: value } }));
  }

  async function savePreferences(event) {
    event.preventDefault();
    if (!state.preferences) return;
    setSaving(true);
    setFeedback("");
    try {
      const payload = await authenticatedRequest(user, "/api/reminder-preferences", {
        method: "POST",
        body: JSON.stringify({ preferences: {
          timezone: state.preferences.timezone,
          balanceReminderMode: state.preferences.balanceReminderMode,
          preferredReminderTime: state.preferences.preferredReminderTime,
          staleThresholdHours: Number(state.preferences.staleThresholdHours),
          billRemindersEnabled: state.preferences.billRemindersEnabled,
          quietHoursStart: state.preferences.quietHoursStart,
          quietHoursEnd: state.preferences.quietHoursEnd,
          privacyMode: state.preferences.privacyMode,
          guidedAutoTaper: state.preferences.guidedAutoTaper,
        } }),
      });
      setState((current) => ({ ...current, preferences: payload.preferences }));
      setFeedback("Reminder settings saved.");
    } catch (error) {
      setFeedback(error?.message || "Reminder settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function snooze(days) {
    setSaving(true);
    setFeedback("");
    try {
      const payload = await authenticatedRequest(user, "/api/reminder-preferences", { method: "POST", body: JSON.stringify({ preferences: { snoozeDays: days } }) });
      setState((current) => ({ ...current, preferences: payload.preferences }));
      setFeedback(days ? `Balance reminders snoozed for ${days} day${days === 1 ? "" : "s"}.` : "Reminder snooze cleared.");
    } catch (error) {
      setFeedback(error?.message || "The reminder snooze could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-panel account-finance-settings" id="reminders" aria-labelledby="account-reminders-title">
      <p className="account-section-label">Reminders</p>
      <h2 className="account-heading" id="account-reminders-title">Balance and bill reminders</h2>
      {state.loading ? <p className="helper-text" role="status">Loading reminder settings…</p> : null}
      {state.error ? <p className="error" role="alert">{state.error}</p> : null}
      {!state.loading && !state.error && state.preferences ? (
        <form className="reminder-preference-form" onSubmit={savePreferences}>
          <label>
            <span>Balance reminder frequency</span>
            <select value={state.preferences.balanceReminderMode} onChange={(event) => update("balanceReminderMode", event.target.value)}>
              {MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="reminder-preference-grid">
            <label><span>Reminder time</span><input type="time" value={state.preferences.preferredReminderTime} onChange={(event) => update("preferredReminderTime", event.target.value)} /></label>
            <label><span>Timezone</span><input value={state.preferences.timezone} onChange={(event) => update("timezone", event.target.value)} spellCheck="false" /></label>
            <label><span>Balance is out of date after</span><select value={state.preferences.staleThresholdHours} onChange={(event) => update("staleThresholdHours", Number(event.target.value))}><option value={24}>24 hours</option><option value={36}>36 hours</option><option value={48}>48 hours</option><option value={72}>3 days</option></select></label>
            <label><span>Email financial detail</span><select value={state.preferences.privacyMode} onChange={(event) => update("privacyMode", event.target.value)}><option value="PRIVATE">Private — hide names and amounts</option><option value="DETAILED">Detailed — show bill names and amounts</option></select></label>
            <label><span>Quiet hours start</span><input type="time" value={state.preferences.quietHoursStart} onChange={(event) => update("quietHoursStart", event.target.value)} /></label>
            <label><span>Quiet hours end</span><input type="time" value={state.preferences.quietHoursEnd} onChange={(event) => update("quietHoursEnd", event.target.value)} /></label>
          </div>
          <label className="reminder-check"><input type="checkbox" checked={state.preferences.billRemindersEnabled} onChange={(event) => update("billRemindersEnabled", event.target.checked)} /><span>Email me once when one or more bills are scheduled for tomorrow</span></label>
          <label className="reminder-check"><input type="checkbox" checked={state.preferences.guidedAutoTaper} onChange={(event) => update("guidedAutoTaper", event.target.checked)} /><span>Let Guided reminders become less frequent when they are not prompting useful activity</span></label>
          {state.preferences.privacyMode === "DETAILED" ? <p className="page-notice">Detailed emails may reveal bill names and amounts in inbox previews, on shared devices, when forwarded, or if an email account is compromised.</p> : <p className="helper-text">Private mode hides balances, bill names and amounts from reminder emails.</p>}
          <div className="reminder-actions">
            <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save reminder settings"}</button>
            <div className="reminder-snooze" aria-label="Snooze balance reminders">
              <span>Snooze balance reminders:</span>
              {[1, 3, 7].map((days) => <button key={days} type="button" onClick={() => snooze(days)} disabled={saving}>{days} day{days === 1 ? "" : "s"}</button>)}
              {state.preferences.snoozeUntil ? <button type="button" onClick={() => snooze(0)} disabled={saving}>Clear snooze</button> : null}
            </div>
          </div>
          {feedback ? <p className="helper-text" role="status">{feedback}</p> : null}
        </form>
      ) : null}
      {!state.loading && !state.error ? (
        state.reminders.length ? <div className="account-reminder-list"><h3>Recent in-app reminders</h3><ul>{state.reminders.slice(0, 3).map((reminder) => <li key={reminder.id}>{reminder.message || "Review an upcoming bill."}</li>)}</ul></div> : <p className="helper-text">No in-app reminders currently need action.</p>
      ) : null}
    </section>
  );
}
async function authenticatedRequest(user, url, options = {}) {
  const idToken = await user.getIdToken();
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}`, ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Request failed.");
  return payload;
}
