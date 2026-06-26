"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously, signOut } from "firebase/auth";
import {
  auth,
  db,
  isFirebaseClientConfigured,
  missingFirebaseClientEnv,
} from "@/lib/firebase";
import {
  buildBillDocument,
  buildIncomeDocument,
  calculateDashboard,
  formatDisplayDate,
  formatDueLabel,
  formatGBP,
  formatOrdinal,
} from "@/lib/billMath";

export default function DashboardPage() {
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [bills, setBills] = useState([]);
  const [income, setIncome] = useState(null);
  const [account, setAccount] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [message, setMessage] = useState("");
  const [balanceInput, setBalanceInput] = useState("");
  const [editingBillId, setEditingBillId] = useState("");
  const [editingBillForm, setEditingBillForm] = useState({ name: "", amount: "", dueDay: "" });
  const [editingIncome, setEditingIncome] = useState(false);
  const [incomeForm, setIncomeForm] = useState({ amount: "", payDay: "" });
  const [assistantMessage, setAssistantMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingBalance, setSavingBalance] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }

    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceMessage("Voice input is not supported in this browser. You can still type your bill.");
      return undefined;
    }

    setVoiceSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = "en-GB";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setVoiceMessage("Listening...");
      setError("");
      transcriptRef.current = "";
    };

    recognition.onresult = (event) => {
      let finalTranscript = transcriptRef.current;
      let interimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim() || "";

        if (!text) {
          continue;
        }

        if (result.isFinal) {
          finalTranscript = `${finalTranscript} ${text}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }

      transcriptRef.current = finalTranscript;
      setMessage(`${finalTranscript} ${interimTranscript}`.trim());
    };

    recognition.onerror = (event) => {
      setListening(false);

      if (event.error === "not-allowed") {
        setVoiceMessage("Microphone access was blocked. You can still type your bill.");
        return;
      }

      if (event.error === "no-speech") {
        setVoiceMessage("I did not catch that. Try again, or type your bill.");
        return;
      }

      setVoiceMessage("Voice input is not supported in this browser. You can still type your bill.");
    };

    recognition.onend = () => {
      setListening(false);
      setVoiceMessage((current) =>
        current === "Listening..."
          ? "Voice captured. Review it, then log it."
          : current,
      );
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setBills([]);
      setIncome(null);
      setAccount(null);
      setReminders([]);
      return undefined;
    }

    const billsQuery = query(
      collection(db, "users", user.uid, "bills"),
      where("active", "==", true),
    );
    const remindersQuery = query(
      collection(db, "users", user.uid, "reminders"),
      orderBy("createdAt", "desc"),
      limit(5),
    );

    const unsubscribeBills = onSnapshot(billsQuery, (snapshot) => {
      setBills(snapshot.docs.map((billDoc) => ({ id: billDoc.id, ...billDoc.data() })));
    });
    const unsubscribeIncome = onSnapshot(doc(db, "users", user.uid, "income", "main"), (snapshot) => {
      const nextIncome = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      setIncome(nextIncome);
      setIncomeForm({
        amount: nextIncome?.amount?.toString() || "",
        payDay: nextIncome?.payDay?.toString() || "",
      });
    });
    const unsubscribeAccount = onSnapshot(doc(db, "users", user.uid, "profile", "main"), (snapshot) => {
      const nextAccount = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      setAccount(nextAccount);
      setBalanceInput(nextAccount?.currentBalance?.toString() || "");
    });
    const unsubscribeReminders = onSnapshot(remindersQuery, (snapshot) => {
      setReminders(snapshot.docs.map((reminderDoc) => ({ id: reminderDoc.id, ...reminderDoc.data() })));
    });

    return () => {
      unsubscribeBills();
      unsubscribeIncome();
      unsubscribeAccount();
      unsubscribeReminders();
    };
  }, [user]);

  const dashboard = useMemo(() => calculateDashboard(bills, income, account), [account, bills, income]);

  async function handleSignIn() {
    if (!auth) {
      setError("Firebase is not configured yet.");
      return;
    }

    setError("");
    await signInAnonymously(auth).catch((signInError) => {
      setError(signInError.message);
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!message.trim() || !user) {
      return;
    }

    setSubmitting(true);
    setError("");
    setAssistantMessage("");

    try {
      const response = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const parsed = await response.json();

      if (!response.ok) {
        throw new Error(parsed.responseMessage || "I could not read that yet.");
      }

      await applyParsedActions(user.uid, parsed, Boolean(income));
      setAssistantMessage(parsed.responseMessage);

      if (parsed.action === "unknown") {
        return;
      }

      setMessage("");
      setVoiceMessage("");
      transcriptRef.current = "";
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBalanceSave(event) {
    event.preventDefault();

    if (!user) {
      return;
    }

    const parsedBalance = Number(balanceInput);

    if (!Number.isFinite(parsedBalance)) {
      setError("Add your current account balance as a number.");
      return;
    }

    setSavingBalance(true);
    setError("");

    try {
      await setDoc(
        doc(db, "users", user.uid, "profile", "main"),
        {
          currentBalance: parsedBalance,
          currency: "GBP",
          updatedAt: serverTimestamp(),
          createdAt: account?.id ? account.createdAt || serverTimestamp() : serverTimestamp(),
        },
        { merge: true },
      );
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingBalance(false);
    }
  }

  function startBillEdit(bill) {
    setEditingBillId(bill.id);
    setEditingBillForm({
      name: bill.name || "",
      amount: bill.amount?.toString() || "",
      dueDay: bill.dueDay?.toString() || "",
    });
    setError("");
  }

  function cancelBillEdit() {
    setEditingBillId("");
    setEditingBillForm({ name: "", amount: "", dueDay: "" });
  }

  async function handleBillEditSave(event, billId) {
    event.preventDefault();

    if (!user) {
      return;
    }

    const amount = Number(editingBillForm.amount);
    const dueDay = Number(editingBillForm.dueDay);

    if (!editingBillForm.name.trim() || !Number.isFinite(amount) || !Number.isFinite(dueDay)) {
      setError("Add a bill name, amount, and due day before saving.");
      return;
    }

    setSavingEdit(true);
    setError("");

    try {
      const updatedBill = buildBillDocument({
        name: editingBillForm.name.trim(),
        amount,
        dueDay,
        currency: "GBP",
        reminderOffsetDays: 1,
      });

      await setDoc(
        doc(db, "users", user.uid, "bills", billId),
        {
          ...updatedBill,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      cancelBillEdit();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleIncomeSave(event) {
    event.preventDefault();

    if (!user) {
      return;
    }

    const amount = Number(incomeForm.amount);
    const payDay = Number(incomeForm.payDay);

    if (!Number.isFinite(amount) || !Number.isFinite(payDay)) {
      setError("Add payday amount and day before saving.");
      return;
    }

    setSavingEdit(true);
    setError("");

    try {
      await saveIncome(
        user.uid,
        {
          name: income?.name || "Payday",
          amount,
          payDay,
          currency: "GBP",
        },
        Boolean(income),
      );
      setEditingIncome(false);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingEdit(false);
    }
  }

  function handleVoiceToggle() {
    if (!voiceSupported || !recognitionRef.current) {
      setVoiceMessage("Voice input is not supported in this browser. You can still type your bill.");
      return;
    }

    if (listening) {
      recognitionRef.current.stop();
      return;
    }

    setAssistantMessage("");
    setVoiceMessage("Listening...");
    recognitionRef.current.start();
  }

  if (!authReady) {
    return <main className="dashboard-shell">Loading...</main>;
  }

  if (!isFirebaseClientConfigured) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <p className="eyebrow">BillPilot</p>
          <h1>Firebase client setup is incomplete.</h1>
          <p>
            Add the public Firebase values to <code>.env.local</code>, then restart the dev server.
          </p>
          <p className="helper-text">
            Missing: {missingFirebaseClientEnv.join(", ")}
          </p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <p className="eyebrow">BillPilot</p>
          <h1>Sign in to track what is due before payday.</h1>
          <p>For this v1 build, anonymous Firebase sign-in keeps the setup simple.</p>
          <button className="primary-button" type="button" onClick={handleSignIn}>
            Sign in
          </button>
          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">BillPilot</p>
          <h1 className="brand">Bill heads-up</h1>
        </div>
        <div className="topbar-actions">
          <span className="user-id">Signed in</span>
          <button className="secondary-button" type="button" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </header>

      <section className="summary-grid" aria-label="Bill summary">
        <SummaryCard
          label="Before payday"
          value={`${formatGBP(dashboard.totalBeforePayday)} due before you get paid`}
        />
        <SummaryCard
          label="Left for food and fun"
          value={
            account?.currentBalance !== undefined
              ? `${formatGBP(dashboard.leftBeforePayday)} after bills before payday`
              : "Add your balance"
          }
        />
        <SummaryCard
          label="Next bill"
          value={
            dashboard.nextBill
              ? `${dashboard.nextBill.name} - ${formatGBP(dashboard.nextBill.amount)} due ${formatDueLabel(dashboard.nextBill.nextDueDate)}`
              : "No bills logged"
          }
        />
        <SummaryCard
          label="Payday"
          value={dashboard.paydayDate ? formatDisplayDate(dashboard.paydayDate) : "Not set"}
        />
      </section>

      <section className="content-grid">
        <div className="stack">
          <section className="chat-panel">
            <h2>Account balance</h2>
            <form className="chat-form" onSubmit={handleBalanceSave}>
              <div className="chat-input-row">
                <input
                  inputMode="decimal"
                  value={balanceInput}
                  onChange={(event) => setBalanceInput(event.target.value)}
                  placeholder="Current balance in GBP"
                />
                <button className="secondary-button" type="submit" disabled={savingBalance}>
                  {savingBalance ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
            <p className="helper-text balance-copy">
              {account?.currentBalance !== undefined
                ? `${formatGBP(dashboard.currentBalance)} in the account. ${formatGBP(dashboard.leftBeforePayday)} left after bills due before payday.`
                : "Add your current balance to see what is left after bills before payday."}
            </p>
          </section>

          <section className="chat-panel">
            <h2>Add a bill or payday</h2>
            <form className="chat-form" onSubmit={handleSubmit}>
              <div className="chat-input-row">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="My rent is GBP 1,100 due on the 26th every month."
                />
                <button
                  className={`secondary-button mic-button${listening ? " is-listening" : ""}`}
                  type="button"
                  onClick={handleVoiceToggle}
                  aria-pressed={listening}
                >
                  {listening ? "Stop" : "Mic"}
                </button>
              </div>
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? "Reading..." : "Log it"}
              </button>
            </form>
            {voiceMessage ? <p className="helper-text voice-status">{voiceMessage}</p> : null}
            {assistantMessage ? <p className="assistant-message">{assistantMessage}</p> : null}
            {error ? <p className="error">{error}</p> : null}
          </section>

          <section className="runway-panel">
            <h2>Runway</h2>
            <div className="runway" aria-label="Timeline from today to payday">
              {dashboard.runwayEvents.map((event, index) => (
                <RunwayItem
                  key={`${event.type}-${event.label}-${index}`}
                  event={event}
                  showDivider={index > 0}
                />
              ))}
            </div>
          </section>

          <section className="reminders-panel">
            <h2>In-app reminders</h2>
            {reminders.length ? (
              <ul className="reminder-list">
                {reminders.map((reminder) => (
                  <li key={reminder.id}>
                    <span>{reminder.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">No reminders created yet.</p>
            )}
          </section>
        </div>

        <section className="list-panel">
          <h2>Bill list</h2>
          <section className="bill-section">
            <div className="section-head">
              <h3>Payday</h3>
              <button
                className="secondary-button small-button"
                type="button"
                onClick={() => setEditingIncome((current) => !current)}
              >
                {editingIncome ? "Cancel" : income ? "Edit" : "Set"}
              </button>
            </div>
            {editingIncome ? (
              <form className="edit-form" onSubmit={handleIncomeSave}>
                <input
                  inputMode="decimal"
                  value={incomeForm.amount}
                  onChange={(event) => setIncomeForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="Payday amount"
                />
                <input
                  inputMode="numeric"
                  value={incomeForm.payDay}
                  onChange={(event) => setIncomeForm((current) => ({ ...current, payDay: event.target.value }))}
                  placeholder="Payday day"
                />
                <div className="edit-actions">
                  <button className="primary-button" type="submit" disabled={savingEdit}>
                    {savingEdit ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>
            ) : (
              <p className="helper-text">
                {income
                  ? `${formatGBP(income.amount)} on the ${formatOrdinal(income.payDay)} of each month.`
                  : "No payday set yet."}
              </p>
            )}
          </section>
          <BillGroup
            title="Before payday"
            bills={dashboard.beforePayday}
            editingBillId={editingBillId}
            editingBillForm={editingBillForm}
            onBillFormChange={setEditingBillForm}
            onEditStart={startBillEdit}
            onEditCancel={cancelBillEdit}
            onEditSave={handleBillEditSave}
            savingEdit={savingEdit}
          />
          <BillGroup
            title="After payday"
            bills={dashboard.afterPayday}
            editingBillId={editingBillId}
            editingBillForm={editingBillForm}
            onBillFormChange={setEditingBillForm}
            onEditStart={startBillEdit}
            onEditCancel={cancelBillEdit}
            onEditSave={handleBillEditSave}
            savingEdit={savingEdit}
          />
        </section>
      </section>
    </main>
  );
}

function SummaryCard({ label, value }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function RunwayItem({ event, showDivider }) {
  return (
    <>
      {showDivider ? <span className="runway-divider" aria-hidden="true" /> : null}
      <span className="runway-item">
        <strong>{event.label}</strong> {event.detail}
      </span>
    </>
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
}) {
  return (
    <div className="bill-section">
      <h3>{title}</h3>
      {bills.length ? (
        <ul className="bill-list">
          {bills.map((bill) => (
            <li key={bill.id}>
              {editingBillId === bill.id ? (
                <form className="edit-form bill-edit-form" onSubmit={(event) => onEditSave(event, bill.id)}>
                  <input
                    value={editingBillForm.name}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Bill name"
                  />
                  <input
                    inputMode="decimal"
                    value={editingBillForm.amount}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, amount: event.target.value }))}
                    placeholder="Amount"
                  />
                  <input
                    inputMode="numeric"
                    value={editingBillForm.dueDay}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, dueDay: event.target.value }))}
                    placeholder="Due day"
                  />
                  <div className="edit-actions">
                    <button className="primary-button small-button" type="submit" disabled={savingEdit}>
                      {savingEdit ? "Saving..." : "Save"}
                    </button>
                    <button className="secondary-button small-button" type="button" onClick={onEditCancel}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="bill-row-main">
                    <span>{bill.name}</span>
                    <span className="bill-meta">
                      {formatGBP(bill.amount)} - {formatOrdinal(bill.dueDay)}
                    </span>
                  </div>
                  <button className="secondary-button small-button" type="button" onClick={() => onEditStart(bill)}>
                    Edit
                  </button>
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

async function saveBill(userId, parsed) {
  const bill = buildBillDocument(parsed);

  await addDoc(collection(db, "users", userId, "bills"), {
    ...bill,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function saveIncome(userId, parsed, hasExistingIncome) {
  const income = buildIncomeDocument(parsed);
  const payload = {
    ...income,
    updatedAt: serverTimestamp(),
  };

  if (!hasExistingIncome) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(doc(db, "users", userId, "income", "main"), payload, { merge: true });
}

async function applyParsedActions(userId, parsed, hasExistingIncome) {
  if (parsed.action === "batch") {
    let incomeSaved = hasExistingIncome;

    for (const item of parsed.items || []) {
      if (item.action === "create_bill") {
        await saveBill(userId, item);
      }

      if (item.action === "set_income") {
        await saveIncome(userId, item, incomeSaved);
        incomeSaved = true;
      }
    }

    return;
  }

  if (parsed.action === "create_bill") {
    await saveBill(userId, parsed);
  }

  if (parsed.action === "set_income") {
    await saveIncome(userId, parsed, hasExistingIncome);
  }
}
