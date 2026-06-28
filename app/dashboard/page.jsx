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
  getTodayIso,
} from "@/lib/billMath";

export default function DashboardPage() {
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const imageInputRef = useRef(null);
  const billsRef = useRef([]);
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
  const [authError, setAuthError] = useState("");
  const [chatError, setChatError] = useState("");
  const [balanceError, setBalanceError] = useState("");
  const [editError, setEditError] = useState("");
  const [pageNotice, setPageNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingBalance, setSavingBalance] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [importJobs, setImportJobs] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [currentImportJobId, setCurrentImportJobId] = useState(null);
  const [lastCompletedImportJobName, setLastCompletedImportJobName] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [lastImportError, setLastImportError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [optimisticBalance, setOptimisticBalance] = useState(null);
  const [optimisticIncome, setOptimisticIncome] = useState(null);

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
    billsRef.current = bills;
  }, [bills]);

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
      setChatError("");
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
      setOptimisticIncome(null);
      setIncomeForm({
        amount: nextIncome?.amount?.toString() || "",
        payDay: nextIncome?.payDay?.toString() || "",
      });
    });
    const unsubscribeAccount = onSnapshot(doc(db, "users", user.uid, "profile", "main"), (snapshot) => {
      const nextAccount = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      setAccount(nextAccount);
      setOptimisticBalance(null);
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

  const displayIncome = useMemo(() => (
    optimisticIncome === null
      ? income
      : { ...(income || {}), ...optimisticIncome, type: "income", active: true, currency: "GBP" }
  ), [income, optimisticIncome]);
  const displayAccount = useMemo(() => (
    optimisticBalance === null
      ? account
      : { ...(account || {}), currentBalance: optimisticBalance, currency: "GBP" }
  ), [account, optimisticBalance]);
  const dashboard = useMemo(
    () => calculateDashboard(bills, displayIncome, displayAccount),
    [bills, displayAccount, displayIncome],
  );
  const balanceSnapshotLabel = useMemo(
    () => formatBalanceSnapshotLabel(displayAccount?.updatedAt),
    [displayAccount?.updatedAt],
  );
  const importLocked = isImporting;
  const importQueueFinished = importJobs.length > 0 && !isImporting && importJobs.some((job) => job.status !== "queued");

  async function handleSignIn() {
    if (!auth) {
      setAuthError("Firebase is not configured yet.");
      return;
    }

    setSigningIn(true);
    setAuthError("");

    try {
      await authPersistenceReady;
      await signInAnonymously(auth);
    } catch (signInError) {
      setAuthError(signInError.message);
    } finally {
      setSigningIn(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!auth || !googleProvider) {
      setAuthError("Firebase is not configured yet.");
      return;
    }

    setSigningIn(true);
    setAuthError("");

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
        setAuthError("Google sign-in was closed before it finished.");
        return;
      }

      if (signInError?.code === "auth/unauthorized-domain") {
        setAuthError("Add this site to Firebase Authentication authorised domains, then try again.");
        return;
      }

      setAuthError(signInError.message);
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if ((!message.trim() && !importJobs.length) || !user) {
      return;
    }

    setChatError("");
    setAssistantMessage("");
    setPageNotice("");

    try {
      if (importJobs.length) {
        await runImportQueue();
      } else {
        setSubmitting(true);
        const response = await runWithTimeout(fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        }), "The parser is taking too long. Try again.");
        const parsed = await response.json();

        if (!response.ok) {
          throw new Error(parsed.responseMessage || "I could not read that yet.");
        }

        const outcome = await applyParsedActions(user.uid, parsed, Boolean(displayIncome), bills);
        setAssistantMessage(buildOutcomeMessage(parsed, outcome));
      }

      setMessage("");
      setVoiceMessage("");
      transcriptRef.current = "";
    } catch (submitError) {
      if (submitError?.message === "Failed to fetch") {
        setChatError("The screenshot did not reach the server. Try again with that image.");
      } else {
        setChatError(submitError.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function runImportQueue() {
    if (isImporting) return;

    setIsImporting(true);
    setImportSummary(null);
    setLastImportError(null);
    setLastCompletedImportJobName(null);

    const jobsToRun = importJobs.filter((job) => job.status === "queued");

    let importedTotal = 0;
    let skippedTotal = 0;
    let processedTotal = 0;

    try {
      for (const job of jobsToRun) {
        setCurrentImportJobId(job.id);

        updateJob(job.id, {
          status: "processing",
          progressText: "Reading this screenshot now",
          errorMessage: "",
        });

        try {
          console.log("[import-queue] starting job", job.id, job.name);

          const result = await withTimeout(
            importSingleImage(job),
            45000,
            job.name,
          );

          importedTotal += result.importedCount || 0;
          skippedTotal += result.skippedCount || 0;
          processedTotal += 1;
          const progressParts = [];

          if (result.importedCount === 1) progressParts.push("Imported 1 bill.");
          else if (result.importedCount > 1) progressParts.push(`Imported ${result.importedCount} bills.`);

          if (result.skippedCount === 1) progressParts.push("Skipped 1 duplicate or unreadable row.");
          else if (result.skippedCount > 1) progressParts.push(`Skipped ${result.skippedCount} duplicate or unreadable rows.`);

          updateJob(job.id, {
            status: "done",
            progressText: progressParts.join(" ") || "Imported.",
            importedCount: result.importedCount || 0,
            skippedCount: result.skippedCount || 0,
            errorMessage: "",
          });

          console.log("[import-queue] finished job", job.id, job.name, result);
        } catch (error) {
          processedTotal += 1;

          const errMsg = error?.message || "Unknown import error";
          setLastImportError(errMsg);

          updateJob(job.id, {
            status: "failed",
            progressText: "Could not read this screenshot. Try again.",
            errorMessage: errMsg,
          });

          console.error("[import-queue] failed job", job.id, job.name, error);
        } finally {
          setLastCompletedImportJobName(job.name);
          setCurrentImportJobId(null);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } finally {
      const summary = { importedCount: importedTotal, skippedCount: skippedTotal, processedCount: processedTotal };
      setImportSummary(summary);

      const parts = [];
      if (importedTotal === 1) parts.push("Imported 1 bill.");
      else if (importedTotal > 1) parts.push(`Imported ${importedTotal} bills.`);
      if (skippedTotal === 1) parts.push("Skipped 1 duplicate.");
      else if (skippedTotal > 1) parts.push(`Skipped ${skippedTotal} duplicates.`);
      if (parts.length) setAssistantMessage(parts.join(" "));

      setIsImporting(false);
    }
  }

  async function importSingleImage(job) {
    console.log("[import-single] sending", job.name);

    const formData = new FormData();
    formData.append("image", job.file, job.name);
    if (message.trim()) {
      formData.append("message", message);
    }

    const response = await fetch("/api/parse", {
      method: "POST",
      body: formData,
    });

    console.log("[import-single] response status", response.status);
    const json = await response.json();
    console.log("[import-single] parsed json", json);
    if (!response.ok || json.ok === false) {
      throw new Error(json.error || json.message || "Image import failed");
    }

    const parsedBills = Array.isArray(json.bills) ? json.bills : [];
    console.log("[import-single] bills returned", parsedBills.length, parsedBills);
    let importedCount = 0;
    let skippedCount = 0;
    let saveErrorCount = 0;
    let firstSaveError = null;

    for (const bill of parsedBills) {
      try {
        const result = await saveImportedBill(user.uid, bill);

        if (result?.skipped) {
          skippedCount += 1;
        } else {
          importedCount += 1;
        }
      } catch (error) {
        console.error("[import-single] failed saving bill", bill, error);
        skippedCount += 1;
        saveErrorCount += 1;
        if (!firstSaveError) {
          firstSaveError = error;
        }
      }
    }

    if (parsedBills.length > 0 && importedCount === 0 && saveErrorCount > 0) {
      throw new Error(firstSaveError?.message || "Imported rows could not be saved.");
    }

    console.log("[import-single] image result", {
      name: job.name,
      responseOk: response.ok,
      jsonOk: json.ok,
      billCount: parsedBills.length,
      importedCount,
      skippedCount,
    });

    return {
      importedCount,
      skippedCount,
      bills: parsedBills,
    };
  }

  function updateJob(jobId, patch) {
    setImportJobs((jobs) =>
      jobs.map((job) =>
        job.id === jobId ? { ...job, ...patch } : job,
      ),
    );
  }

  async function saveImportedBill(userId, bill) {
    const parsedBill = {
      action: "create_bill",
      name: String(bill?.name || "").trim(),
      amount: Number(bill?.amount),
      currency: bill?.currency || "GBP",
      frequency: "monthly",
      dueDay: Number(bill?.dueDay),
      reminderOffsetDays: 1,
    };

    if (!parsedBill.name || !Number.isFinite(parsedBill.amount) || !Number.isFinite(parsedBill.dueDay)) {
      return { skipped: true, reason: "invalid" };
    }

    const currentBills = billsRef.current || [];
    const duplicate = currentBills.some((existingBill) => billFingerprint(existingBill) === billFingerprint(parsedBill));

    if (duplicate) {
      return { skipped: true, reason: "duplicate" };
    }

    const billRef = doc(collection(db, "users", userId, "bills"));
    const billDocument = buildBillDocument(parsedBill);
    const batch = writeBatch(db);

    batch.set(billRef, {
      ...billDocument,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    const savedBill = {
      ...billDocument,
      id: billRef.id,
    };

    billsRef.current = [...currentBills, savedBill];
    setBills((current) => {
      if (current.some((existingBill) => existingBill.id === savedBill.id)) {
        return current;
      }

      return [...current, savedBill];
    });

    return { skipped: false };
  }

  async function handleBalanceSave(event) {
    event.preventDefault();

    if (!user) {
      return;
    }

    const parsedBalance = Number(balanceInput);

    if (!Number.isFinite(parsedBalance)) {
      setBalanceError("Add your balance snapshot as a number.");
      return;
    }

    setSavingBalance(true);
    setBalanceError("");
    setPageNotice("");
    setOptimisticBalance(parsedBalance);
    setBalanceInput(parsedBalance.toString());
    setPageNotice(`Balance snapshot updated to ${formatGBP(parsedBalance)}.`);

    setSavingBalance(false);

    setDoc(
        doc(db, "users", user.uid, "profile", "main"),
        {
          currentBalance: parsedBalance,
          currency: "GBP",
          updatedAt: serverTimestamp(),
          createdAt: account?.id ? account.createdAt || serverTimestamp() : serverTimestamp(),
        },
        { merge: true },
      ).catch((saveError) => {
        setOptimisticBalance(null);
        setPageNotice("");
        setBalanceError(saveError.message || "Balance could not be saved.");
      });
  }

  function startBillEdit(bill) {
    setEditingBillId(bill.id);
    setEditingBillForm({
      name: bill.name || "",
      amount: bill.amount?.toString() || "",
      dueDay: bill.dueDay?.toString() || "",
    });
    setEditError("");
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
      setEditError("Add a bill name, amount, and due day before saving.");
      return;
    }

    setSavingEdit(true);
    setEditError("");
    setPageNotice("");

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
      setPageNotice("Bill updated.");
    } catch (saveError) {
      setEditError(saveError.message);
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
      setEditError("Add payday amount and day before saving.");
      return;
    }

    setSavingEdit(true);
    setEditError("");
    setPageNotice("");
    setOptimisticIncome({
      name: income?.name || "Payday",
      amount,
      payDay,
    });
    setIncomeForm({
      amount: amount.toString(),
      payDay: payDay.toString(),
    });
    setEditingIncome(false);
    setPageNotice(`Payday set for the ${formatOrdinal(payDay)}.`);

    setSavingEdit(false);

    saveIncome(
      user.uid,
      {
        name: income?.name || "Payday",
        amount,
        payDay,
        currency: "GBP",
      },
      Boolean(income),
    ).catch((saveError) => {
      setOptimisticIncome(null);
      setEditingIncome(true);
      setPageNotice("");
      setEditError(saveError.message);
    });
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
    if (importLocked) {
      return;
    }

    const imageFiles = Array.from(fileList || []).filter((entry) => entry?.type?.startsWith("image/"));

    if (!imageFiles.length) {
      setChatError("Add a PNG, JPG, WEBP, or GIF screenshot.");
      return;
    }

    setChatError("");
    setAssistantMessage("");

    try {
      const nextJobs = await Promise.all(
        imageFiles.slice(0, 8).map(async (file) => ({
          id: buildImportJobId(file),
          file,
          name: file.name || "bill-screenshot.png",
          previewUrl: URL.createObjectURL(file),
          status: "queued",
          progressText: "Waiting",
          importedCount: 0,
          skippedCount: 0,
          errorMessage: "",
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      setImportJobs((current) => mergeImportJobs(current, nextJobs));
    } catch {
      setChatError("I could not read that image. Try a different screenshot or file.");
    }
  }

  function handleImagePickerChange(event) {
    if (importLocked) {
      event.target.value = "";
      return;
    }

    void handleImageFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    if (importLocked) {
      return;
    }
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
    setImportJobs((current) => {
      const removed = current.find((job) => job.id === imageKey);

      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }

      return current.filter((job) => job.id !== imageKey);
    });
  }

  function clearImports() {
    setImportJobs((current) => {
      current.forEach((job) => {
        if (job.previewUrl) {
          URL.revokeObjectURL(job.previewUrl);
        }
      });

      return [];
    });
    setAssistantMessage("");
    setChatError("");
    setImportSummary(null);
    setLastImportError(null);
    setLastCompletedImportJobName(null);
    setCurrentImportJobId(null);
  }

  if (!authReady) {
    return <main className="dashboard-shell">Loading...</main>;
  }

  if (!isFirebaseClientConfigured) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <p className="eyebrow">Billie</p>
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
          <p className="eyebrow">Billie</p>
          <h1>Sign in to track what is due before payday.</h1>
          <p>Use Google to keep your bills saved across refreshes and devices.</p>
          <button className="primary-button" type="button" onClick={handleGoogleSignIn} disabled={signingIn}>
            {signingIn ? "Opening sign-in..." : "Continue with Google"}
          </button>
          <button className="secondary-button auth-google-button" type="button" onClick={handleSignIn} disabled={signingIn}>
            Continue as guest
          </button>
          <p className="helper-text">Guest mode is temporary. Google sign-in keeps your data attached to your account.</p>
          {authError ? <p className="error">{authError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Billie</p>
          <h1 className="brand">Your payday heads-up for bills.</h1>
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

      {pageNotice ? (
        <section className="page-notice" aria-live="polite">
          {pageNotice}
        </section>
      ) : null}

      <section className="summary-grid" aria-label="Bill summary">
        <SummaryCard
          label="Before payday"
          value={`${formatGBP(dashboard.totalBeforePayday)} due before you get paid`}
        />
        <SummaryCard
          label="Balance snapshot"
          value={
            displayAccount?.currentBalance !== undefined
              ? `Forecast: ~${formatGBP(dashboard.leftBeforePayday)} left after bills before payday`
              : "Add your balance snapshot"
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
            <h2>Balance snapshot</h2>
            <form className="chat-form" onSubmit={handleBalanceSave}>
              <div className="field-row">
                <label className="field-label" htmlFor="account-balance">
                  Balance snapshot
                </label>
                <div className="chat-input-row">
                  <input
                    id="account-balance"
                    inputMode="decimal"
                    value={balanceInput}
                    disabled={importLocked}
                    onChange={(event) => setBalanceInput(event.target.value)}
                    placeholder="Balance snapshot in GBP"
                  />
                  <button className="secondary-button" type="submit" disabled={savingBalance || importLocked}>
                    {savingBalance ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </form>
            {displayAccount?.currentBalance !== undefined ? (
              <div className="helper-text balance-copy">
                <p>Balance snapshot: {formatGBP(dashboard.currentBalance)}</p>
                <p>{balanceSnapshotLabel}</p>
                <p>Forecast: ~{formatGBP(dashboard.leftBeforePayday)} left after bills before payday</p>
                <p>Still around {formatGBP(dashboard.currentBalance)}? Update if this has changed.</p>
              </div>
            ) : (
              <p className="helper-text balance-copy">
                Enter your current balance. Billie will forecast what may be left after bills before payday.
              </p>
            )}
            {displayAccount?.currentBalance === undefined ? (
              <p className="helper-text balance-copy">
                Add your balance snapshot to see what may be left before payday.
              </p>
            ) : null}
            {balanceError ? <p className="error">{balanceError}</p> : null}
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
                    disabled={importLocked}
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
              {importJobs.length ? (
                <div className="selected-image-list">
                  {importJobs.map((job) => (
                    <div
                      key={job.id}
                      className={`selected-image-card${getImportJobClass(job)}`}
                    >
                      <div>
                        <div className="selected-image-head">
                          <img className="selected-image-preview" src={job.previewUrl} alt="" />
                          <strong>{job.name}</strong>
                        </div>
                        <p className="helper-text image-meta">
                          {job.progressText}
                        </p>
                        {job.status === "processing" ? (
                          <div className="image-progress" aria-hidden="true">
                            <span
                              className="image-progress-bar"
                              style={{ width: "100%" }}
                            />
                          </div>
                        ) : null}
                      </div>
                      <button
                        className="secondary-button small-button"
                        type="button"
                        disabled={importLocked}
                        onClick={() => removeSelectedImage(job.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {importJobs.length ? (
                <div className="import-debug-panel" style={{ fontSize: "11px", fontFamily: "monospace", background: "#1a1a2e", color: "#a0d8ef", padding: "10px 12px", borderRadius: "6px", lineHeight: 1.7 }}>
                  <strong style={{ color: "#e0e0e0" }}>Import Debug</strong>
                  <div>queue started: {isImporting ? "true" : "false"}</div>
                  <div>isImporting: {String(isImporting)}</div>
                  <div>current job id: {currentImportJobId || "none"}</div>
                  <div>current job name: {currentImportJobId ? (importJobs.find((j) => j.id === currentImportJobId)?.name ?? "?") : "none"}</div>
                  <div>current job status: {currentImportJobId ? (importJobs.find((j) => j.id === currentImportJobId)?.status ?? "?") : "none"}</div>
                  <div>last completed job: {lastCompletedImportJobName || "none"}</div>
                  <div>last error: {lastImportError || "none"}</div>
                  <div>queued: {importJobs.filter((j) => j.status === "queued").length}</div>
                  <div>done: {importJobs.filter((j) => j.status === "done").length}</div>
                  <div>failed: {importJobs.filter((j) => j.status === "failed").length}</div>
                </div>
              ) : null}
              <div className="chat-input-row">
                <textarea
                  value={message}
                  disabled={importLocked}
                  onChange={(event) => setMessage(event.target.value)}
                  onPaste={handlePaste}
                  placeholder="My rent is GBP 1,100 due on the 26th every month."
                />
                <button
                  className={`secondary-button mic-button${listening ? " is-listening" : ""}`}
                  type="button"
                  disabled={importLocked}
                  onClick={handleVoiceToggle}
                  aria-pressed={listening}
                >
                  {listening ? "Stop" : "Mic"}
                </button>
              </div>
              <button className="primary-button" type="submit" disabled={submitting || importLocked}>
                {importLocked ? "Importing..." : submitting ? "Reading..." : "Log it"}
              </button>
            </form>
            {importQueueFinished ? (
              <button className="secondary-button small-button" type="button" onClick={clearImports}>
                Clear imports
              </button>
            ) : null}
            {voiceMessage ? <p className="helper-text voice-status">{voiceMessage}</p> : null}
            {assistantMessage ? <p className="assistant-message">{assistantMessage}</p> : null}
            {chatError ? <p className="error">{chatError}</p> : null}
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
                disabled={importLocked}
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
                  disabled={importLocked}
                  value={incomeForm.amount}
                  onChange={(event) => setIncomeForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="Payday amount in GBP"
                />
                <label className="field-label" htmlFor="payday-day">Day of month</label>
                <input
                  id="payday-day"
                  inputMode="numeric"
                  disabled={importLocked}
                  value={incomeForm.payDay}
                  onChange={(event) => setIncomeForm((current) => ({ ...current, payDay: event.target.value }))}
                  placeholder="Day of month"
                />
                <div className="edit-actions">
                  <button className="primary-button" type="submit" disabled={savingEdit || importLocked}>
                    {savingEdit ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>
            ) : (
              <p className="helper-text">
                {displayIncome
                  ? `${formatGBP(displayIncome.amount)} on the ${formatOrdinal(displayIncome.payDay)} of each month.`
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
            importLocked={importLocked}
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
            importLocked={importLocked}
          />
          {editingIncome || editingBillId ? (editError ? <p className="error">{editError}</p> : null) : null}
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
  importLocked,
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
                  <div className="bill-row-main">
                    <span>{bill.name}</span>
                    <span className="bill-meta">
                      {formatGBP(bill.amount)} - {formatOrdinal(bill.dueDay)}
                    </span>
                  </div>
                  <button className="secondary-button small-button" type="button" disabled={importLocked} onClick={() => onEditStart(bill)}>
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

async function applyParsedActions(userId, parsed, hasExistingIncome, existingBills = []) {
  const outcome = { createdBills: 0, skippedBills: 0, savedIncome: false };
  const items = parsed.action === "batch" ? parsed.items || [] : [parsed];
  const billItems = dedupeBillItems(
    items.filter((item) => item.action === "create_bill"),
    existingBills,
  );
  const incomeItems = items.filter((item) => item.action === "set_income");

  outcome.skippedBills = billItems.skipped;

  if (billItems.toCreate.length) {
    const saveResults = await Promise.allSettled(
      billItems.toCreate.map((item) => {
        const billRef = doc(collection(db, "users", userId, "bills"));
        const bill = buildBillDocument(item);
        const batch = writeBatch(db);
        batch.set(billRef, {
          ...bill,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return batch.commit();
      }),
    );
    outcome.createdBills = saveResults.filter((r) => r.status === "fulfilled").length;
    const failures = saveResults.filter((r) => r.status === "rejected");
    if (failures.length) {
      console.error("[applyParsedActions] some bill saves failed", failures.map((f) => f.reason));
    }
  }

  if (incomeItems.length) {
    try {
      await saveIncome(userId, incomeItems[incomeItems.length - 1], hasExistingIncome);
      outcome.savedIncome = true;
    } catch (saveError) {
      console.error("[applyParsedActions] income save failed", saveError);
    }
  }

  return outcome;
}

async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
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

    reader.onload = async () => {
      const originalDataUrl = String(reader.result || "");

      try {
        if (!file.type.startsWith("image/")) {
          resolve(originalDataUrl);
          return;
        }

        const compressed = await compressImageDataUrl(originalDataUrl, file.type);
        resolve(compressed);
      } catch {
        resolve(originalDataUrl);
      }
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl, mimeType) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const maxDimension = 1600;
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");

      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Canvas is not available"));
        return;
      }

      context.drawImage(image, 0, 0, width, height);

      const outputType = mimeType === "image/png" ? "image/png" : "image/jpeg";
      const quality = outputType === "image/jpeg" ? 0.82 : undefined;
      const nextDataUrl = canvas.toDataURL(outputType, quality);

      resolve(nextDataUrl);
    };

    image.onerror = () => reject(new Error("Could not process image"));
    image.src = dataUrl;
  });
}

function buildImportJobId(file) {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

function mergeImportJobs(current, next) {
  const seen = new Set(current.map((job) => job.id));
  const merged = [...current];

  for (const job of next) {
    if (seen.has(job.id)) {
      continue;
    }

    seen.add(job.id);
    merged.push(job);
  }

  return merged.slice(0, 8);
}

function getImportJobClass(job) {
  if (job.status === "done") {
    return " is-done";
  }

  if (job.status === "processing") {
    return " is-processing";
  }

  if (job.status === "failed") {
    return " is-error";
  }

  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function billFingerprint(bill) {
  return [
    String(bill.name || "").trim().toLowerCase(),
    Number(bill.amount || 0).toFixed(2),
    Number(bill.dueDay || 0),
  ].join("|");
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

function mergeOutcomeBills(existingBills, parsed) {
  const nextBills = [...existingBills];
  const items = parsed.action === "batch" ? parsed.items || [] : [parsed];

  items.forEach((item) => {
    if (item.action !== "create_bill") {
      return;
    }

    if (nextBills.some((bill) => billFingerprint(bill) === billFingerprint(item))) {
      return;
    }

    nextBills.push(item);
  });

  return nextBills;
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

function buildBatchOutcomeMessage(outcome, sourceCount) {
  const parts = [];

  if (outcome.createdBills > 0) {
    parts.push(
      outcome.createdBills === 1
        ? "Imported 1 bill."
        : `Imported ${outcome.createdBills} bills.`,
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

  if (sourceCount > 1 && parts.length) {
    parts.push(`Read across ${sourceCount} screenshots.`);
  }

  return parts.join(" ");
}

function formatBalanceSnapshotLabel(timestamp) {
  const snapshotDate = toDateMaybe(timestamp);

  if (!snapshotDate) {
    return "Entered recently";
  }

  const todayIso = getTodayIso();
  const snapshotIso = getTodayIso(snapshotDate);
  const timeLabel = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(snapshotDate);

  if (snapshotIso === todayIso) {
    return `Entered today at ${timeLabel}`;
  }

  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  }).format(snapshotDate);

  return `Entered ${dateLabel} at ${timeLabel}`;
}

function toDateMaybe(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  return null;
}
