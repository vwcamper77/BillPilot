"use client";

import { useEffect, useState } from "react";
import { postDashboardStateAction } from "@/app/dashboard/lib/dashboardApi";

export default function AccountFinanceSettings({ user }) {
  const [state, setState] = useState({ loading: true, reminders: [], error: "" });

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    postDashboardStateAction().then((payload) => {
      if (!cancelled) setState({ loading: false, reminders: payload?.reminders || [], error: "" });
    }).catch(() => {
      if (!cancelled) setState({ loading: false, reminders: [], error: "Your reminders could not be loaded right now." });
    });
    return () => { cancelled = true; };
  }, [user]);

  return (
    <section className="account-panel account-finance-settings" aria-labelledby="account-reminders-title">
      <p className="account-section-label">Reminders</p>
      <h2 className="account-heading" id="account-reminders-title">Recent reminders</h2>
      {state.loading ? <p className="helper-text" role="status">Loading reminders…</p> : null}
      {state.error ? <p className="error" role="alert">{state.error}</p> : null}
      {!state.loading && !state.error ? (
        <>
          {state.reminders.length ? (
            <div className="account-reminder-list">
              <h3>Recent reminders</h3>
              <ul>{state.reminders.slice(0, 3).map((reminder) => <li key={reminder.id}>{reminder.message || "Review an upcoming bill."}</li>)}</ul>
            </div>
          ) : <p className="helper-text">No reminders currently need action.</p>}
        </>
      ) : null}
    </section>
  );
}
