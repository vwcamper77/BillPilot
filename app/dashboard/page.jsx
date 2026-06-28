"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
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
  createUserWithEmailAndPassword,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  app as firebaseApp,
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
  isValidDueDay,
} from "@/lib/billMath";

const IMAGE_IMPORT_FETCH_TIMEOUT_MS = 70000;

function getBalanceDocPath(userId) {
  return `users/${userId}/settings/balance`;
}

function getIncomeDocPath(userId) {
  return `users/${userId}/income/main`;
}

function getBillsCollectionPath(userId) {
  return `users/${userId}/bills`;
}

function getBillDocPath(userId, billId) {
  return `users/${userId}/bills/${billId}`;
}

function getReminderDocPath(userId, reminderId) {
  return `users/${userId}/reminders/${reminderId}`;
}

function getDebugDocPath(userId) {
  return `users/${userId}/debug/test`;
}

function isValidIncomeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0;
}

function getIncomeStatusText(income) {
  const hasValidAmount = isValidIncomeAmount(income?.amount);
  const hasValidPayday = isValidDueDay(income?.payDay);

  if (hasValidAmount && hasValidPayday) {
    return `${formatGBP(income.amount)} on the ${formatOrdinal(income.payDay)} of each month.`;
  }

  if (hasValidAmount) {
    return "Add payday date";
  }

  if (hasValidPayday) {
    return `Payday: ${formatOrdinal(income.payDay)} of each month`;
  }

  return "No payday set yet.";
}

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
  const [currentImportStep, setCurrentImportStep] = useState("idle");
  const [lastCompletedImportJobName, setLastCompletedImportJobName] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [lastImportError, setLastImportError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [emailForm, setEmailForm] = useState({ email: "", password: "" });
  const [optimisticBalance, setOptimisticBalance] = useState(null);
  const [optimisticIncome, setOptimisticIncome] = useState(null);
  const [firestoreTestState, setFirestoreTestState] = useState("idle");
  const balanceSaveRequestRef = useRef(0);

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
    if (!user || !db) {
      setBills([]);
      setIncome(null);
      setAccount(null);
      setReminders([]);
      return undefined;
    }

    const balanceDocRef = doc(db, "users", user.uid, "settings", "balance");
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
      console.log("[firestore-read] bills count", {
        uid: user.uid,
        path: getBillsCollectionPath(user.uid),
        count: snapshot.size,
      });
      setBills(snapshot.docs.map((billDoc) => ({ id: billDoc.id, ...billDoc.data() })));
    });
    const unsubscribeIncome = onSnapshot(doc(db, "users", user.uid, "income", "main"), (snapshot) => {
      console.log("[firestore-read] income exists", {
        uid: user.uid,
        path: getIncomeDocPath(user.uid),
        exists: snapshot.exists(),
      });
      const loadedIncome = snapshot.exists() ? snapshot.data() : null;
      console.log("[payday-load] loaded", loadedIncome);
      if (loadedIncome && !isValidDueDay(loadedIncome.payDay)) {
        console.warn("[payday-load] invalid payDay", loadedIncome.payDay);
      }
      const nextIncome = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      setIncome(nextIncome);
      setOptimisticIncome(null);
      setIncomeForm({
        amount: nextIncome?.amount === null || nextIncome?.amount === undefined ? "" : String(nextIncome.amount),
        payDay: nextIncome?.payDay === null || nextIncome?.payDay === undefined ? "" : String(nextIncome.payDay),
      });
    });
    const unsubscribeAccount = onSnapshot(balanceDocRef, (snapshot) => {
      console.log("[firestore-read] balance exists", {
        uid: user.uid,
        path: getBalanceDocPath(user.uid),
        exists: snapshot.exists(),
      });
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

  useEffect(() => {
    if (!user || !db) {
      return undefined;
    }

    const userId = user.uid;

    void (async () => {
      try {
        const [balanceSnapshot, incomeSnapshot, billsSnapshot] = await Promise.all([
          getDoc(doc(db, "users", userId, "settings", "balance")),
          getDoc(doc(db, "users", userId, "income", "main")),
          getDocs(query(collection(db, "users", userId, "bills"))),
        ]);

        console.log("[firestore-read] dashboard load", {
          uid: userId,
          balancePath: getBalanceDocPath(userId),
          balanceExists: balanceSnapshot.exists(),
          incomePath: getIncomeDocPath(userId),
          incomeExists: incomeSnapshot.exists(),
          billsPath: getBillsCollectionPath(userId),
          billsCount: billsSnapshot.size,
        });
      } catch (error) {
        console.error("[firestore-read] dashboard load failed", error?.code, error?.message);
      }
    })();

    return undefined;
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
  const incomeForDashboard = useMemo(() => {
    if (!displayIncome) {
      return null;
    }

    if (!isValidDueDay(displayIncome.payDay)) {
      return {
        ...displayIncome,
        payDay: null,
      };
    }

    return displayIncome;
  }, [displayIncome]);
  const dashboard = useMemo(
    () => calculateDashboard(bills, incomeForDashboard, displayAccount),
    [bills, displayAccount, incomeForDashboard],
  );
  const hasBalanceSnapshot = displayAccount?.currentBalance !== undefined;
  const hasPayday = isValidDueDay(displayIncome?.payDay);
  const hasIncomeAmount = isValidIncomeAmount(displayIncome?.amount);
  const hasBills = bills.length > 0;
  const setupStep = !hasBalanceSnapshot ? 1 : !hasPayday ? 2 : !hasBills ? 3 : 4;
  const balanceSnapshotLabel = useMemo(
    () => formatBalanceSnapshotLabel(displayAccount?.snapshotEnteredAt || displayAccount?.updatedAt),
    [displayAccount?.snapshotEnteredAt, displayAccount?.updatedAt],
  );
  const importLocked = isImporting;
  const importQueueFinished = importJobs.length > 0 && !isImporting && importJobs.some((job) => job.status !== "queued");
  const importButtonLabel = getImportButtonLabel(isImporting, currentImportStep, importJobs, currentImportJobId);
  const setupMessage = getSetupMessage(setupStep);
  const firestoreDiagnostics = {
    uid: auth?.currentUser?.uid || user?.uid || "none",
    envProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
    appProjectId: firebaseApp?.options?.projectId || "",
    dbExists: Boolean(db),
  };

  async function handleSignIn() {
    if (!auth) {
      setAuthError("Sign-in is not available right now. Try again later.");
      return;
    }

    setSigningIn(true);
    setAuthError("");

    try {
      await authPersistenceReady;
      await signInAnonymously(auth);
    } catch (signInError) {
      setAuthError(friendlyAuthError(signInError));
    } finally {
      setSigningIn(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!auth || !googleProvider) {
      setAuthError("Sign-in is not available right now. Try again later.");
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
      setAuthError(friendlyAuthError(signInError));
    } finally {
      setSigningIn(false);
    }
  }

  async function handleEmailAuth(event) {
    event.preventDefault();

    if (!auth) {
      setAuthError("Sign-in is not available right now. Try again later.");
      return;
    }

    const { email, password } = emailForm;

    if (!email || !email.includes("@")) {
      setAuthError("Enter a valid email address.");
      return;
    }

    if (!password) {
      setAuthError("Enter your password.");
      return;
    }

    setSigningIn(true);
    setAuthError("");

    try {
      await authPersistenceReady;

      if (authMode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (emailError) {
      setAuthError(friendlyAuthError(emailError));
    } finally {
      setSigningIn(false);
    }
  }

  async function handleFirestoreTestWrite() {
    if (!user || !db) {
      return;
    }

    const path = getDebugDocPath(user.uid);
    const payload = {
      message: "Firestore write test",
      createdAt: serverTimestamp(),
    };

    setFirestoreTestState("writing");
    console.log("[firestore-test] writing", path);

    try {
      await setDoc(doc(db, "users", user.uid, "debug", "test"), payload, { merge: true });
      console.log("[firestore-test] success");
      setFirestoreTestState("success");
    } catch (error) {
      console.error("[firestore-test] failed", error?.code, error?.message);
      setFirestoreTestState("failed");
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
    setCurrentImportStep("idle");

    const jobsToRun = importJobs.filter((job) => job.status === "queued");

    let importedTotal = 0;
    let skippedTotal = 0;
    let processedTotal = 0;

    try {
      for (const job of jobsToRun) {
        setCurrentImportJobId(job.id);
        setCurrentImportStep("uploading_image");

        updateJob(job.id, {
          status: "uploading",
          progressText: "Uploading screenshot…",
          errorMessage: "",
          totalBillsFound: 0,
          billsSaved: 0,
          billsSkipped: 0,
          currentBillIndex: 0,
        });

        try {
          console.log("[import-queue] starting job", job.id, job.name);

          const result = await importSingleImage(job);

          importedTotal += result.importedCount || 0;
          skippedTotal += result.skippedCount || 0;
          processedTotal += 1;

          updateJob(job.id, {
            status: result.importedCount > 0 ? "done" : "failed",
            progressText: buildImportDoneMessage(result.importedCount, result.skippedCount),
            importedCount: result.importedCount || 0,
            skippedCount: result.skippedCount || 0,
            totalBillsFound: result.totalBillsFound || 0,
            billsSaved: result.importedCount || 0,
            billsSkipped: result.skippedCount || 0,
            currentBillIndex: result.totalBillsFound || 0,
            errorMessage: "",
            skippedRows: result.skippedRows || [],
          });
          setCurrentImportStep("job_done");

          console.log("[import-queue] finished job", job.id, job.name, result);
        } catch (error) {
          processedTotal += 1;

          const errMsg = error?.message || "Unknown import error";
          setLastImportError(errMsg);

          updateJob(job.id, {
            status: "failed",
            progressText: "Could not read this screenshot. Try again.",
            totalBillsFound: 0,
            billsSaved: 0,
            billsSkipped: 0,
            currentBillIndex: 0,
            errorMessage: errMsg,
          });
          setCurrentImportStep("job_failed");

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
      parts.push(
        importedTotal === 1
          ? "Import completed. Added 1 bill."
          : `Import completed. Added ${importedTotal} bills.`,
      );
      if (skippedTotal === 1) parts.push("Skipped 1 duplicate.");
      else if (skippedTotal > 1) parts.push(`Skipped ${skippedTotal} duplicates.`);
      if (parts.length) setAssistantMessage(parts.join(" "));

      setIsImporting(false);
      setCurrentImportStep("idle");
    }
  }

  async function importSingleImage(job) {
    console.log("[import-single] sending", job.name);
    setCurrentImportStep("uploading_image");
    updateJob(job.id, {
      status: "uploading",
      progressText: "Uploading screenshot…",
      currentBillIndex: 0,
    });

    const formData = new FormData();
    formData.append("image", job.file, job.name);
    if (message.trim()) {
      formData.append("message", message);
    }

    const response = await fetchImageImport(formData, job.name);

    console.log("[import-single] response received", response.status, response.ok);
    setCurrentImportStep("reading_response");
    updateJob(job.id, {
      status: "identifying",
      progressText: "Identifying bills…",
    });
    const json = await response.json();
    setCurrentImportStep("json_received");
    console.log("[import-single] json received", json);
    if (!response.ok || json.ok === false) {
      throw new Error(json.error || json.message || "Image import failed");
    }

    const bills = Array.isArray(json.bills) ? json.bills : [];
    console.log("[import-single] bills returned", Array.isArray(json.bills) ? json.bills.length : "not array");
    if (!bills.length) {
      throw new Error(json.error || json.message || "No bills found in this screenshot.");
    }

    const qualityResults = bills.map(scoreAndClassifyBill);
    const billsToSave = qualityResults.filter((r) => r.shouldImport).map((r) => r.bill);
    const skippedRows = qualityResults
      .filter((r) => !r.shouldImport)
      .map((r) => ({ name: r.bill.name || "", rawText: r.bill.rawText || r.bill.name || "", reason: r.skipReason }));

    updateJob(job.id, {
      status: "rationalising",
      progressText: "Rationalising bill names…",
      totalBillsFound: bills.length,
      billsSaved: 0,
      billsSkipped: 0,
      currentBillIndex: 0,
      skippedRows,
    });
    let importedCount = 0;
    let skippedCount = skippedRows.length;

    if (!billsToSave.length) {
      return {
        importedCount: 0,
        skippedCount,
        totalBillsFound: bills.length,
        skippedRows,
        bills,
      };
    }

    for (let index = 0; index < billsToSave.length; index += 1) {
      const bill = billsToSave[index];

      try {
        setCurrentImportStep(`saving_bill_${index + 1}_of_${billsToSave.length}`);
        updateJob(job.id, {
          status: "saving",
          progressText: `Adding bill ${index + 1} of ${billsToSave.length}…`,
          totalBillsFound: billsToSave.length,
          billsSaved: importedCount,
          billsSkipped: skippedCount,
          currentBillIndex: index + 1,
        });
        console.log(`[import-single] saving bill ${index + 1}/${billsToSave.length}`, bill);
        const result = await withTimeout(
          saveImportedBill(user.uid, bill),
          10000,
          `save ${bill.name}`,
        );

        if (result?.skipped) {
          skippedCount += 1;
        } else {
          importedCount += 1;
        }
        updateJob(job.id, {
          status: "saving",
          progressText: `Adding bill ${index + 1} of ${billsToSave.length}…`,
          totalBillsFound: billsToSave.length,
          billsSaved: importedCount,
          billsSkipped: skippedCount,
          currentBillIndex: index + 1,
        });
        console.log(`[import-single] saved bill ${index + 1}/${billsToSave.length}`, result);
      } catch (error) {
        console.error("[import-single] save failed", bill, error);
        skippedCount += 1;
        updateJob(job.id, {
          status: "saving",
          progressText: `Adding bill ${index + 1} of ${billsToSave.length}…`,
          totalBillsFound: billsToSave.length,
          billsSaved: importedCount,
          billsSkipped: skippedCount,
          currentBillIndex: index + 1,
        });
      }
    }

    setCurrentImportStep("save_complete");
    updateJob(job.id, {
      status: importedCount > 0 ? "done" : "failed",
      progressText: buildImportDoneMessage(importedCount, skippedCount),
      totalBillsFound: bills.length,
      billsSaved: importedCount,
      billsSkipped: skippedCount,
      currentBillIndex: bills.length,
      skippedRows,
    });
    console.log("[import-single] image result", {
      name: job.name,
      responseOk: response.ok,
      jsonOk: json.ok,
      billCount: bills.length,
      importedCount,
      skippedCount,
      qualitySkipped: skippedRows.length,
    });
    setCurrentImportStep("returning_result");
    console.log("[import-single] returning result", { importedCount, skippedCount });

    return {
      importedCount,
      skippedCount,
      totalBillsFound: bills.length,
      skippedRows,
      bills,
    };
  }

  function updateJob(jobId, patch) {
    setImportJobs((jobs) =>
      jobs.map((job) =>
        job.id === jobId ? { ...job, ...patch } : job,
      ),
    );
  }

  function parseDueDayFromText(value) {
    if (!value) {
      return null;
    }

    const text = String(value).toLowerCase();
    const patterns = [
      /\b([1-9]|[12][0-9]|3[01])\s*(st|nd|rd|th)\b/,
      /\bmonthly\s+on\s+([1-9]|[12][0-9]|3[01])\b/,
      /\bdue\s+([1-9]|[12][0-9]|3[01])\b/,
      /\bon\s+the\s+([1-9]|[12][0-9]|3[01])\b/,
      /\b([1-9]|[12][0-9]|3[01])\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (match) {
        const day = Number(match[1]);

        if (day >= 1 && day <= 31) {
          return day;
        }
      }
    }

    return null;
  }

  async function saveImportedBill(userId, bill) {
    console.log("[date-debug-client-before-save]", {
      name: bill.name,
      amount: bill.amount,
      dueDay: bill.dueDay,
      dateText: bill.dateText,
      rawText: bill.rawText,
    });

    const repairedDueDay = isValidDueDay(bill?.dueDay)
      ? Number(bill?.dueDay)
      : parseDueDayFromText(
        [
          bill?.dateText,
          bill?.rawText,
          bill?.name,
        ].filter(Boolean).join(" "),
      );

    const parsedBill = {
      action: "create_bill",
      name: String(bill?.name || "").trim(),
      amount: Number(bill?.amount),
      currency: bill?.currency || "GBP",
      frequency: "monthly",
      dueDay: isValidDueDay(repairedDueDay) ? Number(repairedDueDay) : null,
      reminderOffsetDays: 1,
      dateText: bill?.dateText || null,
      rawText: bill?.rawText || null,
    };

    if (!parsedBill.name || !Number.isFinite(parsedBill.amount)) {
      return { skipped: true, reason: "invalid" };
    }

    const currentBills = billsRef.current || [];
    const duplicate = currentBills.some((existingBill) => billFingerprint(existingBill) === billFingerprint(parsedBill));

    if (duplicate) {
      return { skipped: true, reason: "duplicate" };
    }

    const billRef = doc(collection(db, "users", userId, "bills"));
    const billDocument = buildBillDocument(parsedBill);
    const path = getBillDocPath(userId, billRef.id);
    const payload = {
      ...billDocument,
      dateText: parsedBill.dateText,
      rawText: parsedBill.rawText,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    console.log("[firestore-bill-save] writing", {
      uid: userId,
      path,
      payload,
    });
    console.log("[date-debug-firestore-payload]", payload);
    const batch = writeBatch(db);

    batch.set(billRef, payload);

    try {
      await batch.commit();
      console.log("[firestore-bill-save] success", { uid: userId, path });
    } catch (error) {
      console.error("[firestore-bill-save] failed", error?.code, error?.message);
      throw error;
    }
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

    const saveRequestId = balanceSaveRequestRef.current + 1;
    balanceSaveRequestRef.current = saveRequestId;

    setBalanceError("");
    setPageNotice("");
    setOptimisticBalance(parsedBalance);
    setBalanceInput(parsedBalance.toString());
    setSavingBalance(false);
    setPageNotice(`Balance snapshot updated to ${formatGBP(parsedBalance)}.`);

    const path = getBalanceDocPath(user.uid);
    const payload = {
      currentBalance: parsedBalance,
      currency: "GBP",
      updatedAt: serverTimestamp(),
      snapshotEnteredAt: serverTimestamp(),
      createdAt: account?.id ? account.createdAt || serverTimestamp() : serverTimestamp(),
    };
    console.log("[firestore-balance-save] writing", {
      uid: user.uid,
      path,
      payload,
    });

    void setDoc(
      doc(db, "users", user.uid, "settings", "balance"),
      payload,
      { merge: true },
    )
      .then(() => {
        if (balanceSaveRequestRef.current !== saveRequestId) {
          return;
        }

        console.log("[firestore-balance-save] success", {
          uid: user.uid,
          path,
        });
        setPageNotice(`Balance snapshot saved: ${formatGBP(parsedBalance)}.`);
      })
      .catch((saveError) => {
        if (balanceSaveRequestRef.current !== saveRequestId) {
          return;
        }

        console.error("[firestore-balance-save] failed", saveError?.code, saveError?.message);
        setOptimisticBalance(null);
        setPageNotice("");
        setBalanceError(saveError.message || "Balance snapshot could not be saved.");
      });

    return;
    setBalanceError("");
    setPageNotice("");
    setOptimisticBalance(parsedBalance);
    setBalanceInput(parsedBalance.toString());
    setPageNotice("Saving balance snapshot…");

    try {
      await runWithTimeout(
        setDoc(
        doc(db, "users", user.uid, "profile", "main"),
        {
          currentBalance: parsedBalance,
          currency: "GBP",
          updatedAt: serverTimestamp(),
          snapshotEnteredAt: serverTimestamp(),
          createdAt: account?.id ? account.createdAt || serverTimestamp() : serverTimestamp(),
        },
        { merge: true },
      ),
        "Saving balance snapshot is taking too long. Check your connection and try again.",
      );
      setPageNotice(`Balance snapshot saved: ${formatGBP(parsedBalance)}.`);
    } catch (saveError) {
      setOptimisticBalance(null);
      setPageNotice("");
      setBalanceError(saveError.message || "Balance snapshot could not be saved.");
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
      const path = getBillDocPath(user.uid, billId);
      const payload = {
        ...updatedBill,
        updatedAt: serverTimestamp(),
      };
      console.log("[firestore-bill-save] writing", {
        uid: user.uid,
        path,
        payload,
      });

      await runWithTimeout(setDoc(
        doc(db, "users", user.uid, "bills", billId),
        payload,
        { merge: true },
      ), "Saving that bill is taking too long. Check your connection and try again.");

      console.log("[firestore-bill-save] success", {
        uid: user.uid,
        path,
      });
      cancelBillEdit();
      setPageNotice("Bill updated.");
    } catch (saveError) {
      console.error("[firestore-bill-save] failed", saveError?.code, saveError?.message);
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

    const incomeAmountInput = incomeForm.amount;
    const payDayInput = incomeForm.payDay;
    const amount = Number(incomeAmountInput);
    const payDay = Number(payDayInput);

    console.log("[payday-save] input", { incomeAmountInput, payDayInput });

    if (!Number.isFinite(amount) || amount < 0) {
      setEditError("Enter your monthly income amount.");
      return;
    }

    if (!Number.isInteger(payDay) || payDay < 1 || payDay > 31) {
      setEditError("Enter a payday between 1 and 31.");
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
    const parsedIncome = {
      name: "Payday",
      amount,
      payDay,
      currency: "GBP",
    };
    const payload = {
      ...buildIncomeDocument(parsedIncome),
      updatedAt: serverTimestamp(),
      ...(income?.id ? {} : { createdAt: serverTimestamp() }),
    };

    console.log("[payday-save] payload", payload);

    setEditingIncome(false);
    setPageNotice(`Payday set for the ${formatOrdinal(payDay)}.`);

    try {
      await saveIncome(
        user.uid,
        parsedIncome,
        Boolean(income),
      );
      console.log("[firestore-payday-save] success", {
        uid: user.uid,
        path: getIncomeDocPath(user.uid),
      });
    } catch (saveError) {
      console.error("[firestore-payday-save] failed", saveError?.code, saveError?.message);
      setOptimisticIncome(null);
      setEditingIncome(true);
      setPageNotice("");
      setEditError(saveError.message);
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
          totalBillsFound: 0,
          billsSaved: 0,
          billsSkipped: 0,
          currentBillIndex: 0,
          errorMessage: "",
          skippedRows: [],
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
          <p className="eyebrow">ClearTill</p>
          <h1>Sign-in is not available.</h1>
          {process.env.NODE_ENV !== "production" ? (
            <>
              <p>Add the required environment variables to <code>.env.local</code>, then restart the dev server.</p>
              <p className="helper-text">Missing: {missingFirebaseClientEnv.join(", ")}</p>
            </>
          ) : (
            <p>Something went wrong. Please try again later.</p>
          )}
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <p className="eyebrow">ClearTill</p>
          <h1>Know you&apos;re clear till payday.</h1>
          <p>Add your balance snapshot, payday and bills. ClearTill shows what&apos;s due before payday and what may be left after.</p>
          <button className="primary-button" type="button" onClick={handleGoogleSignIn} disabled={signingIn}>
            {signingIn ? "Signing in…" : "Continue with Google"}
          </button>
          <div className="auth-divider" aria-hidden="true"><span>or</span></div>
          <form className="auth-email-form" onSubmit={handleEmailAuth}>
            <input
              type="email"
              value={emailForm.email}
              onChange={(e) => setEmailForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="Email"
              autoComplete="email"
              disabled={signingIn}
            />
            <input
              type="password"
              value={emailForm.password}
              onChange={(e) => setEmailForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Password"
              autoComplete={authMode === "signup" ? "new-password" : "current-password"}
              disabled={signingIn}
            />
            <div className="auth-button-row">
              <button className="primary-button" type="submit" disabled={signingIn}>
                {authMode === "signup" ? "Create account" : "Sign in"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={signingIn}
                onClick={() => { setAuthMode((m) => m === "signup" ? "signin" : "signup"); setAuthError(""); }}
              >
                {authMode === "signup" ? "Sign in instead" : "Create account"}
              </button>
            </div>
          </form>
          {process.env.NEXT_PUBLIC_ALLOW_GUEST_LOGIN === "true" ? (
            <button className="secondary-button auth-guest-button" type="button" onClick={handleSignIn} disabled={signingIn}>
              Just testing? Continue as guest
            </button>
          ) : null}
          <p className="helper-text auth-trust">No bank connection. No spending tracking. Just a simple payday heads-up.</p>
          {authError ? <p className="error">{authError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ClearTill</p>
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

      <section className="setup-card">
        <div className="setup-progress">
          <div>
            <p className="eyebrow">Setup</p>
            <h2>{setupMessage.title}</h2>
            <p className="helper-text">{setupMessage.detail}</p>
          </div>
          <div className="setup-chip-row" aria-label="Setup progress">
            <button className={`setup-chip ${getSetupChipState(1, setupStep)}`} type="button">
              <span>{setupStep > 1 ? "✓" : "1"}</span> Balance
            </button>
            <button className={`setup-chip ${getSetupChipState(2, setupStep)}`} type="button">
              <span>{setupStep > 2 ? "✓" : "2"}</span> Payday
            </button>
            <button className={`setup-chip ${getSetupChipState(3, setupStep)}`} type="button">
              <span>{setupStep > 3 ? "✓" : "3"}</span> Bills
            </button>
          </div>
        </div>
        <div className="setup-cta-row">
          {setupStep === 1 ? <button className="primary-button" type="button">Add balance snapshot</button> : null}
          {setupStep === 2 ? <button className="primary-button" type="button" onClick={() => setEditingIncome(true)}>Add payday</button> : null}
          {setupStep === 3 ? <button className="primary-button" type="button">Add bills</button> : null}
          {setupStep === 4 ? (
            <>
              <button className="secondary-button" type="button">Update snapshot</button>
              <button className="primary-button" type="button">Add another bill</button>
            </>
          ) : null}
        </div>
      </section>

      <section className="summary-grid" aria-label="Bill summary">
        <SummaryCard
          label="Bills before payday"
          value={
            dashboard.paydayDate
              ? `${formatGBP(dashboard.totalBeforePayday)} due before payday`
              : dashboard.upcomingBills.length
                ? `${dashboard.upcomingBills.length} upcoming bill${dashboard.upcomingBills.length === 1 ? "" : "s"}`
                : "No upcoming bills"
          }
          muted={!hasBalanceSnapshot || !hasPayday || !hasBills}
          helper="Bills landing before your next payday."
        />
        <SummaryCard
          label="Clear till payday"
          value={
            displayAccount?.currentBalance !== undefined
              ? `~${formatGBP(dashboard.leftBeforePayday)} remaining`
              : "Add your balance snapshot"
          }
          muted={false}
          helper={hasBalanceSnapshot ? "Based on your balance snapshot minus bills before payday." : "Add your balance snapshot first so Billie can forecast what may be left."}
        />
        <SummaryCard
          label="Next bill"
          value={
            dashboard.nextBill
              ? `${dashboard.nextBill.name} — ${formatGBP(dashboard.nextBill.amount)} ${dashboard.nextBill.nextDueDate ? `due ${formatDueLabel(dashboard.nextBill.nextDueDate)}` : "date not set"}`
              : "No bills logged"
          }
          muted={!hasBills}
          helper={hasBills ? "Sorted from today forward." : "Add bills to build your runway."}
        />
        <SummaryCard
          label="Payday"
          value={dashboard.paydayDate ? formatDisplayDate(dashboard.paydayDate) : "Not set"}
          muted={!hasBalanceSnapshot}
          helper="Your next payday."
        />
      </section>

      {process.env.NODE_ENV !== "production" ? (
        <section className="chat-panel">
          <h2>Firestore diagnostics</h2>
          <div className="helper-text" style={{ fontFamily: "monospace" }}>
            <p>auth.currentUser.uid: {firestoreDiagnostics.uid}</p>
            <p>NEXT_PUBLIC_FIREBASE_PROJECT_ID: {firestoreDiagnostics.envProjectId || "missing"}</p>
            <p>Firebase app options.projectId: {firestoreDiagnostics.appProjectId || "missing"}</p>
            <p>db exists: {String(firestoreDiagnostics.dbExists)}</p>
            <p>balance path: {getBalanceDocPath(user.uid)}</p>
            <p>income path: {getIncomeDocPath(user.uid)}</p>
            <p>bills path: {getBillsCollectionPath(user.uid)}</p>
            <p>reminders path: {getReminderDocPath(user.uid, "{reminderId}")}</p>
            <p>test write: {firestoreTestState}</p>
          </div>
          <button className="secondary-button" type="button" onClick={handleFirestoreTestWrite}>
            Test Firestore write
          </button>
        </section>
      ) : null}

      <section className="content-grid">
        <div className="stack">
          <section className={`chat-panel ${setupStep !== 1 ? "" : "setup-current"}`}>
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
                  <button className="secondary-button" type="submit" disabled={importLocked}>
                    Save
                  </button>
                </div>
              </div>
            </form>
            {displayAccount?.currentBalance !== undefined ? (
              <div className="helper-text balance-copy">
                <p>Balance snapshot: {formatGBP(dashboard.currentBalance)}</p>
                <p>{balanceSnapshotLabel}</p>
                <p>Clear till payday: ~{formatGBP(dashboard.leftBeforePayday)} remaining</p>
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

          <section className={`chat-panel ${setupStep === 3 ? "setup-current" : ""} ${!hasBalanceSnapshot ? "is-disabled-soft" : ""}`}>
            <h2>Add a bill or payday</h2>
            {!hasBalanceSnapshot || !hasPayday ? (
              <p className="helper-text helper-tooltip">
                {!hasBalanceSnapshot
                  ? "Bills can be added now, but the forecast works best after balance and payday are set."
                  : "You can add bills now, but Billie needs your payday to show what lands before you get paid."}
              </p>
            ) : null}
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
                        {job.status !== "queued" ? (
                          <div className="image-progress" aria-hidden="true">
                            <span
                              className="image-progress-bar"
                              style={{ width: `${getImportJobProgress(job)}%` }}
                            />
                          </div>
                        ) : null}
                        {(job.skippedRows || []).length > 0 ? (
                          <div className="skipped-rows-panel">
                            <p className="helper-text">Skipped rows</p>
                            <ul className="skipped-rows-list">
                              {(job.skippedRows || []).map((row, i) => (
                                <li key={i} className="helper-text">
                                  {row.name || row.rawText} — {row.reason}
                                </li>
                              ))}
                            </ul>
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
              {process.env.NODE_ENV !== "production" && importJobs.length ? (
                <div className="import-debug-panel" style={{ fontSize: "11px", fontFamily: "monospace", background: "#1a1a2e", color: "#a0d8ef", padding: "10px 12px", borderRadius: "6px", lineHeight: 1.7 }}>
                  <strong style={{ color: "#e0e0e0" }}>Import Debug</strong>
                  <div>queue started: {isImporting ? "true" : "false"}</div>
                  <div>isImporting: {String(isImporting)}</div>
                  <div>current job id: {currentImportJobId || "none"}</div>
                  <div>current job name: {currentImportJobId ? (importJobs.find((j) => j.id === currentImportJobId)?.name ?? "?") : "none"}</div>
                  <div>current job status: {currentImportJobId ? (importJobs.find((j) => j.id === currentImportJobId)?.status ?? "?") : "none"}</div>
                  <div>current step: {currentImportStep || "none"}</div>
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
                {importLocked ? importButtonLabel : submitting ? "Reading..." : "Log it"}
              </button>
            </form>
            {importQueueFinished ? (
              <button className="secondary-button small-button" type="button" onClick={clearImports}>
                Clear imports
              </button>
            ) : null}
            {importSummary ? (
              <p className="assistant-message">
                {buildImportSummaryMessage(importSummary)}
              </p>
            ) : null}
            {voiceMessage ? <p className="helper-text voice-status">{voiceMessage}</p> : null}
            {assistantMessage ? <p className="assistant-message">{assistantMessage}</p> : null}
            {chatError ? <p className="error">{chatError}</p> : null}
          </section>

          <section className={`runway-panel ${!hasBills || !hasPayday ? "is-disabled-soft" : ""}`}>
            <h2>{dashboard.runwayTitle}</h2>
            {dashboard.runwayEvents.length ? (
              <div className="runway" aria-label="Timeline of upcoming bills">
                {dashboard.runwayEvents.map((event, index) => (
                  <RunwayItem
                    key={`${event.type}-${event.label}-${index}`}
                    event={event}
                    showDivider={index > 0}
                  />
                ))}
              </div>
            ) : (
              <p className="empty">
                {!hasBills
                  ? "Add bills to build your runway."
                  : !hasPayday
                    ? "Add payday to see your full payday runway."
                    : "No upcoming bills yet."}
              </p>
            )}
            {!hasBills || !hasPayday ? (
              <p className="helper-text helper-tooltip">
                {!hasBills
                  ? "Your runway appears after you add bills."
                  : "Your runway appears after you add payday and bills."}
              </p>
            ) : null}
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

        <section className={`list-panel ${!hasBalanceSnapshot && !hasPayday && !hasBills ? "is-disabled-soft" : ""}`}>
          <h2>Bill list</h2>
          <section className={`bill-section ${!hasBalanceSnapshot ? "is-disabled-soft" : ""}`}>
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
                  placeholder="Monthly income in GBP"
                />
                <label className="field-label" htmlFor="payday-day">Payday</label>
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
              <>
                <p className="helper-text">{getIncomeStatusText(displayIncome)}</p>
                {displayIncome && hasIncomeAmount && !hasPayday ? (
                  <p className="helper-text helper-tooltip">Add payday date</p>
                ) : null}
                {displayIncome && hasPayday && !hasIncomeAmount ? (
                  <p className="helper-text helper-tooltip">Add income amount if you want Billie to show income context.</p>
                ) : null}
              </>
            )}
            {!hasBalanceSnapshot ? (
              <p className="helper-text helper-tooltip">
                Add your balance snapshot first so Billie can forecast what may be left.
              </p>
            ) : null}
          </section>
          {dashboard.paydayDate ? (
            <>
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
            </>
          ) : (
            <BillGroup
              title="Upcoming bills"
              bills={dashboard.upcomingBills}
              editingBillId={editingBillId}
              editingBillForm={editingBillForm}
              onBillFormChange={setEditingBillForm}
              onEditStart={startBillEdit}
              onEditCancel={cancelBillEdit}
              onEditSave={handleBillEditSave}
              savingEdit={savingEdit}
              importLocked={importLocked}
            />
          )}
          {editingIncome || editingBillId ? (editError ? <p className="error">{editError}</p> : null) : null}
        </section>
      </section>
    </main>
  );
}

function SummaryCard({ label, value, muted = false, helper = "" }) {
  return (
    <article className={`summary-card ${muted ? "is-disabled-soft" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <p className="helper-text helper-tooltip">{helper}</p> : null}
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
                      {formatGBP(bill.amount)} - {isValidDueDay(bill.dueDay) ? formatOrdinal(bill.dueDay) : "date not set"}
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
  const path = getIncomeDocPath(userId);
  const payload = {
    ...income,
    updatedAt: serverTimestamp(),
  };

  if (!hasExistingIncome) {
    payload.createdAt = serverTimestamp();
  }

  console.log("[firestore-payday-save] writing", {
    uid: userId,
    path,
    payload,
  });
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
        const path = getBillDocPath(userId, billRef.id);
        const batch = writeBatch(db);
        const payload = {
          ...bill,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        console.log("[firestore-bill-save] writing", {
          uid: userId,
          path,
          payload,
        });
        batch.set(billRef, payload);
        return batch.commit();
      }),
    );
    outcome.createdBills = saveResults.filter((r) => r.status === "fulfilled").length;
    saveResults.forEach((result, index) => {
      const item = billItems.toCreate[index];

      if (!item) {
        return;
      }

      if (result.status === "fulfilled") {
        console.log("[firestore-bill-save] success", {
          uid: userId,
          path: `${getBillsCollectionPath(userId)}/(generated)`,
          name: item.name,
        });
      } else {
        console.error("[firestore-bill-save] failed", result.reason?.code, result.reason?.message);
      }
    });
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

async function fetchImageImport(formData, jobName) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(`Image import timed out for ${jobName}`), IMAGE_IMPORT_FETCH_TIMEOUT_MS)
    : null;

  try {
    return await fetch("/api/parse", {
      method: "POST",
      body: formData,
      signal: controller?.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${jobName} timed out after ${IMAGE_IMPORT_FETCH_TIMEOUT_MS}ms`);
    }

    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
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

  if (["uploading", "identifying", "rationalising", "saving", "processing"].includes(job.status)) {
    return " is-processing";
  }

  if (job.status === "failed") {
    return " is-error";
  }

  return "";
}

function getImportJobProgress(job) {
  switch (job.status) {
    case "queued":
      return 0;
    case "uploading":
      return 20;
    case "identifying":
      return 45;
    case "rationalising":
      return 65;
    case "saving": {
      const total = Math.max(Number(job.totalBillsFound) || 0, 1);
      const current = Math.min(Number(job.currentBillIndex) || 0, total);
      return 65 + ((current / total) * 30);
    }
    case "done":
    case "failed":
      return 100;
    default:
      return 0;
  }
}

function buildImportDoneMessage(importedCount, skippedCount) {
  if (importedCount > 0 && skippedCount > 0) {
    return `Imported ${importedCount} bill${importedCount === 1 ? "" : "s"}. Skipped ${skippedCount} unclear row${skippedCount === 1 ? "" : "s"}.`;
  }

  if (importedCount > 0) {
    return `Imported ${importedCount} bill${importedCount === 1 ? "" : "s"}.`;
  }

  return "Couldn't read enough from this screenshot. Try a clearer screenshot showing bill name, amount and date.";
}

function buildImportSummaryMessage(summary) {
  if (!summary) {
    return "";
  }

  const imported = summary.importedCount || 0;
  const skipped = summary.skippedCount || 0;

  if (imported > 0 && skipped > 0) {
    return `Import completed. Added ${imported} bill${imported === 1 ? "" : "s"}. Skipped ${skipped} unclear row${skipped === 1 ? "" : "s"}.`;
  }

  if (imported > 0) {
    return `Import completed. Added ${imported} bill${imported === 1 ? "" : "s"}.`;
  }

  return "Import completed. No bills were added.";
}

function getImportButtonLabel(isImporting, currentImportStep, importJobs, currentImportJobId) {
  if (!isImporting) {
    return "Log it";
  }

  const currentJob = importJobs.find((job) => job.id === currentImportJobId);

  if (currentImportStep === "uploading_image" || currentJob?.status === "uploading") {
    return "Uploading screenshot…";
  }

  if (currentImportStep === "reading_response" || currentJob?.status === "identifying") {
    return "Identifying bills…";
  }

  if (currentImportStep === "json_received" || currentJob?.status === "rationalising") {
    return "Rationalising…";
  }

  if (currentJob?.status === "saving") {
    const total = currentJob.totalBillsFound || 0;
    const current = currentJob.currentBillIndex || 0;
    return total ? `Adding ${current} of ${total}…` : "Adding bills…";
  }

  return "Importing…";
}

function getSetupChipState(stepNumber, setupStep) {
  if (setupStep > stepNumber) {
    return "complete";
  }

  if (setupStep === stepNumber) {
    return "current";
  }

  return "waiting";
}

function getSetupMessage(setupStep) {
  if (setupStep === 1) {
    return {
      title: "Step 1 of 3 — Add your balance snapshot",
      detail: "Billie works best when you start with a manual balance snapshot.",
    };
  }

  if (setupStep === 2) {
    return {
      title: "Step 2 of 3 — Add your payday",
      detail: "Once payday is set, Billie can show what lands before you get paid.",
    };
  }

  if (setupStep === 3) {
    return {
      title: "Step 3 of 3 — Add your bills",
      detail: "Add your bills to build the forecast and runway.",
    };
  }

  return {
    title: "Setup complete — Billie can now show your payday forecast.",
    detail: "You can update your snapshot, payday, or bills any time.",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function friendlyAuthError(error) {
  const code = error?.code || "";

  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (
    code === "auth/user-not-found" ||
    code === "auth/wrong-password" ||
    code === "auth/invalid-credential"
  ) return "That email or password doesn't look right.";
  if (code === "auth/email-already-in-use") return "This email is already registered. Try signing in instead.";
  if (code === "auth/weak-password") return "Use a password of at least 6 characters.";
  if (code === "auth/too-many-requests") return "Too many attempts. Try again in a few minutes.";
  if (code === "auth/popup-closed-by-user") return "Google sign-in was cancelled. Try again or use email.";
  if (code === "auth/unauthorized-domain") return "Google sign-in was blocked. Try again or use email.";
  if (code === "auth/network-request-failed") return "Network error. Check your connection and try again.";
  if (code === "auth/operation-not-allowed") return "This sign-in method isn't enabled. Try another option.";
  if (code === "auth/user-disabled") return "This account has been disabled. Contact support.";

  return "Something went wrong. Try again.";
}

function scoreImportedBillQuality(bill) {
  let score = 0;
  if (bill.name && bill.name.trim().length >= 2) score += 1;
  if (Number.isFinite(Number(bill.amount)) && Number(bill.amount) > 0) score += 1;
  if (isValidDueDay(bill.dueDay) || parseDueDayFromText(bill.dateText || bill.rawText || "")) score += 1;
  if (bill.confidence && bill.confidence >= 0.75) score += 1;
  return score;
}

function scoreAndClassifyBill(bill) {
  const score = scoreImportedBillQuality(bill);
  const hasName = Boolean(bill.name && bill.name.trim().length >= 2);
  const hasAmount = Number.isFinite(Number(bill.amount)) && Number(bill.amount) > 0;
  const shouldImport = score >= 3 || (score === 2 && hasName && hasAmount);

  if (shouldImport) {
    return { bill, shouldImport: true, skipReason: null };
  }

  let skipReason = "unreadable row";
  if (!hasName) skipReason = "missing name";
  else if (!hasAmount) skipReason = "missing amount";
  else skipReason = "low confidence";

  return { bill, shouldImport: false, skipReason };
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
