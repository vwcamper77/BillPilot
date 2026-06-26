"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  auth,
  authPersistenceReady,
  db,
  googleProvider,
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
  const imageInputRef = useRef(null);
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
  const [selectedImages, setSelectedImages] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [pendingImportedBills, setPendingImportedBills] = useState([]);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }

    let isMounted = true;
    let unsubscribe = () => undefined;

    authPersistenceReady.finally(() => {
      if (!isMounted) {
        return;
      }

      unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
        setAuthReady(true);
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
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

  const displayBills = useMemo(
    () => mergeUniqueBills(bills, pendingImportedBills),
    [bills, pendingImportedBills],
  );
  const dashboard = useMemo(
    () => calculateDashboard(displayBills, income, account),
    [account, displayBills, income],
  );

  async function handleSignIn() {
    if (!auth) {
      setError("Firebase is not configured yet.");
      return;
    }

    setSigningIn(true);
    setError("");

    try {
      await authPersistenceReady;
      await signInAnonymously(auth);
    } catch (signInError) {
      setError(signInError.message);
    } finally {
      setSigningIn(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!auth || !googleProvider) {
      setError("Firebase is not configured yet.");
      return;
    }

    setSigningIn(true);
    setError("");

    try {
      await authPersistenceReady;

      if (auth.currentUser?.isAnonymous) {
        try {
          await linkWithPopup(auth.currentUser, googleProvider);
          return;
        } catch (linkError) {
          if (linkError?.code !== "auth/credential-already-in-use") {
            throw linkError;
          }
        }
      }

      await signInWithPopup(auth, googleProvider);
    } catch (signInError) {
      if (signInError?.code === "auth/popup-closed-by-user") {
        setError("Google sign-in was closed before it finished.");
        return;
      }

      if (signInError?.code === "auth/unauthorized-domain") {
        setError("Add this site to Firebase Authentication authorised domains, then try again.");
        return;
      }

      setError(signInError.message);
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if ((!message.trim() && !selectedImages.length) || !user) {
      return;
    }

    setSubmitting(true);
    setError("");
    setAssistantMessage("");
    setImportProgress(null);

    try {
      const response = await runWithTimeout(fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          imageDataUrls: selectedImages.map((image) => image.dataUrl),
          imageNames: selectedImages.map((image) => image.name),
        }),
      }), "The parser is taking too long. Try again.");
      const parsed = await response.json();

      if (!response.ok) {
        throw new Error(parsed.responseMessage || "I could not read that yet.");
      }

      const outcome = await applyParsedActions(user.uid, parsed, Boolean(income), bills, {
        onPendingBills: setPendingImportedBills,
        onProgress: setImportProgress,
      });
      setAssistantMessage(buildOutcomeMessage(parsed, outcome));

      if (parsed.action === "unknown") {
        return;
      }

      setMessage("");
      setVoiceMessage("");
      setSelectedImages([]);
      transcriptRef.current = "";
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setPendingImportedBills([]);
      setImportProgress(null);
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
      await runWithTimeout(setDoc(
        doc(db, "users", user.uid, "profile", "main"),
        {
          currentBalance: parsedBalance,
          currency: "GBP",
          updatedAt: serverTimestamp(),
          createdAt: account?.id ? account.createdAt || serverTimestamp() : serverTimestamp(),
        },
        { merge: true },
      ), "Saving the balance is taking too long. Check your connection and try again.");
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

      await runWithTimeout(setDoc(
        doc(db, "users", user.uid, "bills", billId),
        {
          ...updatedBill,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ), "Saving that bill is taking too long. Check your connection and try again.");

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

  async function handleImageFiles(fileList) {
    const imageFiles = Array.from(fileList || []).filter((entry) => entry?.type?.startsWith("image/"));

    if (!imageFiles.length) {
      setError("Add a PNG, JPG, WEBP, or GIF screenshot.");
      return;
    }

    setError("");
    setAssistantMessage("");

    try {
      const nextImages = await Promise.all(
        imageFiles.slice(0, 8).map(async (file) => ({
          name: file.name || "bill-screenshot.png",
          size: file.size || 0,
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      setSelectedImages((current) => mergeSelectedImages(current, nextImages));
    } catch {
      setError("I could not read that image. Try a different screenshot or file.");
    }
  }

  function handleImagePickerChange(event) {
    void handleImageFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    void handleImageFiles(event.dataTransfer.files);
  }

  function handlePaste(event) {
    const imageItem = Array.from(event.clipboardData?.items || []).find((item) =>
      item.type?.startsWith("image/"));

    if (!imageItem) {
      return;
    }

    const file = imageItem.getAsFile();

    if (!file) {
      return;
    }

    event.preventDefault();
    void handleImageFiles([file]);
  }

  function removeSelectedImage(imageKey) {
    setSelectedImages((current) => current.filter((image) => image.key !== imageKey));
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
          <p>Use Google to keep your bills saved across refreshes and devices.</p>
          <button className="primary-button" type="button" onClick={handleGoogleSignIn} disabled={signingIn}>
            {signingIn ? "Opening sign-in..." : "Continue with Google"}
          </button>
          <button className="secondary-button auth-google-button" type="button" onClick={handleSignIn} disabled={signingIn}>
            Continue as guest
          </button>
          <p className="helper-text">Guest mode is temporary. Google sign-in keeps your data attached to your account.</p>
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
          <span className="user-id">
            {user?.isAnonymous
              ? "Guest session"
              : user?.displayName || user?.email || "Signed in"}
          </span>
          {user?.isAnonymous ? (
            <button className="secondary-button" type="button" onClick={handleGoogleSignIn} disabled={signingIn}>
              Save with Google
            </button>
          ) : null}
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
              <div className="field-row">
                <label className="field-label" htmlFor="account-balance">
                  Current balance
                </label>
                <div className="chat-input-row">
                  <input
                    id="account-balance"
                    inputMode="decimal"
                    value={balanceInput}
                    onChange={(event) => setBalanceInput(event.target.value)}
                    placeholder="Current balance in GBP"
                  />
                  <button className="secondary-button" type="submit" disabled={savingBalance}>
                    {savingBalance ? "Saving..." : "Save"}
                  </button>
                </div>
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
              <div
                className={`upload-panel${dragActive ? " is-dragging" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setDragActive(false);
                  }
                }}
                onDrop={handleDrop}
              >
                <div>
                  <strong>Add a screenshot or bill image</strong>
                  <p className="helper-text upload-copy">
                    Drag and drop one or more screenshots here, paste a screenshot, or choose files.
                  </p>
                </div>
                <div className="upload-actions">
                  <button
                    className="secondary-button small-button"
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                  >
                    Choose image
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={handleImagePickerChange}
                  />
                </div>
              </div>
              {selectedImages.length ? (
                <div className="selected-image-list">
                  {selectedImages.map((image) => (
                    <div key={image.key} className="selected-image-card">
                      <div>
                        <strong>{image.name}</strong>
                        <p className="helper-text image-meta">
                          Screenshot ready. I&apos;ll read it when you log it.
                        </p>
                      </div>
                      <button
                        className="secondary-button small-button"
                        type="button"
                        onClick={() => removeSelectedImage(image.key)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="chat-input-row">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onPaste={handlePaste}
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
            {importProgress ? (
              <p className="helper-text voice-status">
                {importProgress.message}
              </p>
            ) : null}
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
                <label className="field-label" htmlFor="payday-amount">Amount</label>
                <input
                  id="payday-amount"
                  inputMode="decimal"
                  value={incomeForm.amount}
                  onChange={(event) => setIncomeForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="Payday amount in GBP"
                />
                <label className="field-label" htmlFor="payday-day">Day of month</label>
                <input
                  id="payday-day"
                  inputMode="numeric"
                  value={incomeForm.payDay}
                  onChange={(event) => setIncomeForm((current) => ({ ...current, payDay: event.target.value }))}
                  placeholder="Day of month"
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
                  <label className="field-label" htmlFor={`bill-name-${bill.id}`}>Bill name</label>
                  <input
                    id={`bill-name-${bill.id}`}
                    value={editingBillForm.name}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Bill name"
                  />
                  <label className="field-label" htmlFor={`bill-amount-${bill.id}`}>Amount</label>
                  <input
                    id={`bill-amount-${bill.id}`}
                    inputMode="decimal"
                    value={editingBillForm.amount}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, amount: event.target.value }))}
                    placeholder="Amount in GBP"
                  />
                  <label className="field-label" htmlFor={`bill-due-day-${bill.id}`}>Day of month</label>
                  <input
                    id={`bill-due-day-${bill.id}`}
                    inputMode="numeric"
                    value={editingBillForm.dueDay}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, dueDay: event.target.value }))}
                    placeholder="Day of month"
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
                      {bill.pendingImport ? " - importing..." : ""}
                    </span>
                  </div>
                  {bill.pendingImport ? null : (
                    <button className="secondary-button small-button" type="button" onClick={() => onEditStart(bill)}>
                      Edit
                    </button>
                  )}
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

async function saveIncome(userId, parsed, hasExistingIncome) {
  const income = buildIncomeDocument(parsed);
  const payload = {
    ...income,
    updatedAt: serverTimestamp(),
  };

  if (!hasExistingIncome) {
    payload.createdAt = serverTimestamp();
  }

  await runWithTimeout(
    setDoc(doc(db, "users", userId, "income", "main"), payload, { merge: true }),
    "Saving payday is taking too long. Check your connection and try again.",
  );
}

async function applyParsedActions(userId, parsed, hasExistingIncome, existingBills = [], handlers = {}) {
  const onPendingBills = handlers.onPendingBills || (() => undefined);
  const onProgress = handlers.onProgress || (() => undefined);
  const outcome = { createdBills: 0, skippedBills: 0, savedIncome: false };
  const items = parsed.action === "batch" ? parsed.items || [] : [parsed];
  const billItems = dedupeBillItems(
    items.filter((item) => item.action === "create_bill"),
    existingBills,
  );
  const incomeItems = items.filter((item) => item.action === "set_income");
  const totalSteps = billItems.toCreate.length + (incomeItems.length ? 1 : 0);

  if (billItems.toCreate.length) {
    onPendingBills(billItems.toCreate.map(buildPendingBill));
  } else {
    onPendingBills([]);
  }

  onProgress({
    completed: 0,
    total: totalSteps,
    message: buildImportProgressMessage(0, totalSteps, billItems.toCreate.length),
  });

  outcome.skippedBills = billItems.skipped;

  if (billItems.toCreate.length) {
    const batch = writeBatch(db);

    billItems.toCreate.forEach((item) => {
      const billRef = doc(collection(db, "users", userId, "bills"));
      const bill = buildBillDocument(item);

      batch.set(billRef, {
        ...bill,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await runWithTimeout(
      batch.commit(),
      "Importing those bills is taking too long. Check your connection and try again.",
      25000,
    );
    outcome.createdBills = billItems.toCreate.length;
    onProgress({
      completed: outcome.createdBills,
      total: totalSteps,
      message: buildImportProgressMessage(outcome.createdBills, totalSteps, billItems.toCreate.length),
    });
  }

  if (incomeItems.length) {
    await saveIncome(userId, incomeItems[incomeItems.length - 1], hasExistingIncome);
    outcome.savedIncome = true;
    onProgress({
      completed: outcome.createdBills + 1,
      total: totalSteps,
      message: buildImportProgressMessage(outcome.createdBills + 1, totalSteps, billItems.toCreate.length),
    });
  }

  return outcome;
}

async function runWithTimeout(promise, timeoutMessage, timeoutMs = 12000) {
  let timeoutId;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function mergeSelectedImages(current, next) {
  const merged = [...current];
  const seen = new Set(current.map((image) => image.key));

  for (const image of next) {
    const key = `${image.name}_${image.size}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push({ ...image, key });
  }

  return merged.slice(0, 8);
}

function billFingerprint(bill) {
  return [
    String(bill.name || "").trim().toLowerCase(),
    Number(bill.amount || 0).toFixed(2),
    Number(bill.dueDay || 0),
  ].join("|");
}

function mergeUniqueBills(savedBills, pendingBills) {
  const savedKeys = new Set(savedBills.map((bill) => billFingerprint(bill)));
  return [
    ...savedBills,
    ...pendingBills.filter((bill) => !savedKeys.has(billFingerprint(bill))),
  ];
}

function buildPendingBill(parsed) {
  return {
    id: `pending-${billFingerprint(parsed)}`,
    pendingImport: true,
    ...buildBillDocument(parsed),
  };
}

function dedupeBillItems(items, existingBills) {
  const existingKeys = new Set(existingBills.map((bill) => billFingerprint(bill)));
  const seen = new Set();
  const toCreate = [];
  let skipped = 0;

  items.forEach((item) => {
    const key = billFingerprint(item);

    if (existingKeys.has(key) || seen.has(key)) {
      skipped += 1;
      return;
    }

    seen.add(key);
    toCreate.push(item);
  });

  return { toCreate, skipped };
}

function buildImportProgressMessage(completed, total, newBills) {
  if (!total) {
    return "";
  }

  if (completed < total) {
    if (newBills > 1) {
      return `Importing your bills. ${completed} of ${total} steps done. Watch the bill list update as they land.`;
    }

    return `Saving your bill. ${completed} of ${total} steps done.`;
  }

  if (newBills > 1) {
    return `Import complete. ${newBills} bills processed.`;
  }

  return "Import complete.";
}

function buildOutcomeMessage(parsed, outcome) {
  if (parsed.action === "unknown") {
    return parsed.responseMessage;
  }

  const parts = [];

  if (outcome.createdBills > 0) {
    parts.push(
      outcome.createdBills === 1
        ? "Logged 1 new bill."
        : `Logged ${outcome.createdBills} new bills.`,
    );
  }

  if (outcome.skippedBills > 0) {
    parts.push(
      outcome.skippedBills === 1
        ? "Skipped 1 duplicate."
        : `Skipped ${outcome.skippedBills} duplicates.`,
    );
  }

  if (outcome.savedIncome) {
    parts.push("Payday updated.");
  }

  return parts.join(" ") || parsed.responseMessage;
}
