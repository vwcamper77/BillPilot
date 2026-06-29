"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
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
  formatCurrency,
  formatDisplayDate,
  formatDueLabel,
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

function getIncomeStatusText(income, currency = "GBP") {
  const hasValidAmount = isValidIncomeAmount(income?.amount);
  const hasValidPayday = isValidDueDay(income?.payDay);

  if (hasValidAmount && hasValidPayday) {
    return `${formatCurrency(income.amount, currency)} on the ${formatOrdinal(income.payDay)} of each month.`;
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
  const [editingBillForm, setEditingBillForm] = useState({ name: "", amount: "", dueDay: "", category: "" });
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
  const [displayCurrency, setDisplayCurrency] = useState("GBP");
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedBillIds, setSelectedBillIds] = useState(new Set());
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
    const dismissed = localStorage.getItem("cleartill_setup_dismissed");
    if (dismissed === "true") setSetupDismissed(true);
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
    const unsubscribePreferences = onSnapshot(doc(db, "users", user.uid, "settings", "preferences"), (snapshot) => {
      if (snapshot.exists()) {
        const prefs = snapshot.data();
        if (prefs.currency) setDisplayCurrency(prefs.currency);
      }
    });

    return () => {
      unsubscribeBills();
      unsubscribeIncome();
      unsubscribeAccount();
      unsubscribeReminders();
      unsubscribePreferences();
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
    () => calculateDashboard(bills, incomeForDashboard, displayAccount, undefined, displayCurrency),
    [bills, displayAccount, displayCurrency, incomeForDashboard],
  );
  const hasBalanceSnapshot = displayAccount?.currentBalance !== undefined;
  const hasPayday = isValidDueDay(displayIncome?.payDay);
  const hasIncomeAmount = isValidIncomeAmount(displayIncome?.amount);
  const hasBills = bills.length > 0;
  const setupStep = !hasBalanceSnapshot ? 1 : !hasPayday ? 2 : !hasBills ? 3 : 4;

  const clearTillStatus = (() => {
    if (!hasBalanceSnapshot || !hasPayday) return "";
    if (dashboard.leftBeforePayday < 0) return "negative";
    if (dashboard.leftBeforePayday < 50) return "low";
    return "ok";
  })();

  const clearTillValue = (() => {
    if (!hasBalanceSnapshot) return "Add your balance snapshot";
    const abs = Math.abs(dashboard.leftBeforePayday);
    if (clearTillStatus === "negative") return `${formatCurrency(abs, displayCurrency)} short before payday`;
    return `${formatCurrency(dashboard.leftBeforePayday, displayCurrency)} left until payday`;
  })();

  const clearTillHelper = (() => {
    if (!hasBalanceSnapshot) return "Add your balance snapshot first so ClearTill can forecast what may be left.";
    if (clearTillStatus === "negative") return "Bills before payday exceed your balance snapshot.";
    if (clearTillStatus === "low") return "Low buffer before payday.";
    return "Based on your balance snapshot minus bills before payday.";
  })();

  const billsBeforePaydayOverBudget =
    hasBalanceSnapshot && hasPayday && hasBills &&
    dashboard.totalBeforePayday > dashboard.currentBalance;

  const monthlySpendingRoomStatus = (() => {
    if (dashboard.monthlySpendingRoom === null || !hasIncomeAmount) return "";
    if (dashboard.monthlySpendingRoom < 0) return "negative";
    if (dashboard.monthlySpendingRoom < 100) return "low";
    return "ok";
  })();

  const monthlySpendingRoomValue = (() => {
    if (!hasIncomeAmount) return "Add expected income";
    if (!hasBills) return "No bills logged yet";
    const msr = dashboard.monthlySpendingRoom;
    if (msr < 0) return `${formatCurrency(Math.abs(msr), displayCurrency)} short each month`;
    return `${formatCurrency(msr, displayCurrency)} left each month`;
  })();

  const monthlySpendingRoomHelper = (() => {
    if (!hasIncomeAmount || !hasBills) return "Set your expected income and bills to see monthly spending room.";
    if (dashboard.monthlySpendingRoom < 0) return "Your regular bills exceed your expected monthly income.";
    if (dashboard.monthlySpendingRoom < 100) return "Low margin after regular bills.";
    return "After regular bills, from your expected monthly income.";
  })();

  const dailyLimitStatus = (() => {
    if (!hasBalanceSnapshot || !hasPayday) return "";
    if (dashboard.leftBeforePayday < 0) return "negative";
    if (dashboard.dailyLimitTillPayday < 10) return "low";
    return "ok";
  })();

  const dailyLimitValue = (() => {
    if (!hasBalanceSnapshot) return "Add your balance snapshot";
    if (!hasPayday) return "Set your payday date";
    if (dashboard.leftBeforePayday < 0) return `${formatCurrency(Math.abs(dashboard.leftBeforePayday), displayCurrency)} short before payday`;
    return `${formatCurrency(dashboard.dailyLimitTillPayday, displayCurrency)} per day`;
  })();

  const dailyLimitHelper = (() => {
    if (!hasBalanceSnapshot) return "Add your balance snapshot to see your daily limit.";
    if (!hasPayday) return "Set your payday date to calculate your daily limit.";
    if (dashboard.leftBeforePayday < 0) return "Bills before payday exceed your balance snapshot.";
    if (dashboard.dailyLimitTillPayday < 10) return "Low daily limit until payday.";
    return `Based on your balance snapshot after bills, spread over ${dashboard.daysTillPayday} day${dashboard.daysTillPayday === 1 ? "" : "s"}.`;
  })();
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

          {
            const extractedCount = (result.bills || []).length || result.totalBillsFound || 0;
            const qualitySkipped = (result.skippedRows || []).length;
            const queueFinalStatus =
              (result.importedCount || 0) > 0 || (extractedCount > 0 && (result.skippedCount || 0) > 0)
                ? "done"
                : "failed";
            updateJob(job.id, {
              status: queueFinalStatus,
              progressText: buildImportDoneMessage(
                result.importedCount || 0,
                result.skippedCount || 0,
                extractedCount,
                qualitySkipped,
              ),
              importedCount: result.importedCount || 0,
              skippedCount: result.skippedCount || 0,
              totalBillsFound: result.totalBillsFound || 0,
              billsSaved: result.importedCount || 0,
              billsSkipped: result.skippedCount || 0,
              currentBillIndex: result.totalBillsFound || 0,
              errorMessage: "",
              skippedRows: result.skippedRows || [],
            });
          }
          setCurrentImportStep("job_done");

          console.log("[import-queue] finished job", job.id, job.name, result);
        } catch (error) {
          processedTotal += 1;

          const errMsg = error?.message || "Unknown import error";
          const isTimeout = errMsg.toLowerCase().includes("timed out");
          setLastImportError(errMsg);

          updateJob(job.id, {
            status: "failed",
            progressText: isTimeout
              ? "Timed out. Try a clearer screenshot."
              : "Couldn't read enough from this screenshot.",
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
      if (importedTotal > 0) {
        parts.push(importedTotal === 1 ? "Import completed. Added 1 bill." : `Import completed. Added ${importedTotal} bills.`);
        if (skippedTotal > 0) parts.push(`Skipped ${skippedTotal} row${skippedTotal === 1 ? "" : "s"}.`);
      } else {
        parts.push("Import completed. No new bills added.");
        if (skippedTotal > 0) parts.push(`${skippedTotal} row${skippedTotal === 1 ? "" : "s"} were already imported or skipped.`);
      }
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
    const finalStatus = importedCount > 0 || (bills.length > 0 && skippedCount > 0) ? "done" : "failed";
    updateJob(job.id, {
      status: finalStatus,
      progressText: buildImportDoneMessage(importedCount, skippedCount, bills.length, skippedRows.length),
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
    setPageNotice(`Balance snapshot updated to ${formatCurrency(parsedBalance, displayCurrency)}.`);

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
        setPageNotice(`Balance snapshot saved: ${formatCurrency(parsedBalance, displayCurrency)}.`);
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
      setPageNotice(`Balance snapshot saved: ${formatCurrency(parsedBalance, displayCurrency)}.`);
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
      category: bill.category || "",
    });
    setEditError("");
  }

  function cancelBillEdit() {
    setEditingBillId("");
    setEditingBillForm({ name: "", amount: "", dueDay: "", category: "" });
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
        category: editingBillForm.category || null,
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

  async function handleBillDelete(billId) {
    if (!user || !db) return;
    if (!window.confirm("Remove this bill?")) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "bills", billId));
    } catch {
      setEditError("Could not delete that bill. Try again.");
    }
  }

  async function handleBulkDelete() {
    if (!user || !db || selectedBillIds.size === 0) return;
    const count = selectedBillIds.size;
    if (!window.confirm(`Delete ${count} selected bill${count === 1 ? "" : "s"}?`)) return;
    try {
      const batch = writeBatch(db);
      selectedBillIds.forEach((billId) => {
        batch.delete(doc(db, "users", user.uid, "bills", billId));
      });
      await batch.commit();
      setSelectedBillIds(new Set());
      setSelectMode(false);
    } catch {
      setEditError("Could not delete the selected bills. Try again.");
    }
  }

  function handleSetupDismiss() {
    localStorage.setItem("cleartill_setup_dismissed", "true");
    setSetupDismissed(true);
  }

  async function handleCurrencySave(currency) {
    if (!user || !db) return;
    setDisplayCurrency(currency);
    try {
      await setDoc(doc(db, "users", user.uid, "settings", "preferences"), { currency }, { merge: true });
    } catch {
      // Currency preference updated locally; Firestore sync failed silently
    }
  }

  async function handleRetryImport(jobId) {
    const job = importJobs.find((j) => j.id === jobId);
    if (!job || isImporting) return;

    if (!job.file) {
      updateJob(jobId, { progressText: "Please choose this screenshot again." });
      return;
    }

    setIsImporting(true);
    setCurrentImportJobId(jobId);

    try {
      updateJob(jobId, {
        status: "uploading",
        progressText: "Uploading screenshot…",
        importedCount: 0,
        skippedCount: 0,
        totalBillsFound: 0,
        billsSaved: 0,
        skippedRows: [],
        errorMessage: "",
      });

      const result = await importSingleImage(job);

      {
        const retryExtractedCount = (result.bills || []).length || result.totalBillsFound || 0;
        const retryQualitySkipped = (result.skippedRows || []).length;
        const retryFinalStatus =
          (result.importedCount || 0) > 0 || (retryExtractedCount > 0 && (result.skippedCount || 0) > 0)
            ? "done"
            : "failed";
        updateJob(jobId, {
          status: retryFinalStatus,
          progressText: buildImportDoneMessage(
            result.importedCount || 0,
            result.skippedCount || 0,
            retryExtractedCount,
            retryQualitySkipped,
          ),
          importedCount: result.importedCount || 0,
          skippedCount: result.skippedCount || 0,
          totalBillsFound: result.totalBillsFound || 0,
          billsSaved: result.importedCount || 0,
          skippedRows: result.skippedRows || [],
        });
      }
    } catch (error) {
      const errMsg = error?.message || "Unknown import error";
      const isTimeout = errMsg.toLowerCase().includes("timed out");
      updateJob(jobId, {
        status: "failed",
        progressText: isTimeout
          ? "Timed out. Try a clearer screenshot."
          : "Couldn't read enough from this screenshot.",
        errorMessage: errMsg,
      });
    } finally {
      setIsImporting(false);
      setCurrentImportJobId(null);
      setCurrentImportStep("idle");
    }
  }

  if (!authReady) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <p className="eyebrow">ClearTill</p>
          <h1>Loading your payday forecast…</h1>
        </section>
      </main>
    );
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

      {!setupDismissed ? (
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
                <button className="secondary-button small-button setup-dismiss" type="button" onClick={handleSetupDismiss}>
                  Dismiss
                </button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="summary-grid" aria-label="Bill summary">
        <SummaryCard
          label="Balance snapshot"
          value={hasBalanceSnapshot
            ? `${formatCurrency(dashboard.currentBalance, displayCurrency)} in account`
            : "Not set"}
          muted={!hasBalanceSnapshot}
          helper="Manual snapshot, not a live bank balance."
        />
        <SummaryCard
          label="Bills before payday"
          value={
            dashboard.paydayDate
              ? `${formatCurrency(dashboard.totalBeforePayday, displayCurrency)} due before payday`
              : hasBills
                ? `${dashboard.upcomingBills.length} upcoming bill${dashboard.upcomingBills.length === 1 ? "" : "s"}`
                : "No upcoming bills"
          }
          muted={!hasBalanceSnapshot || !hasPayday || !hasBills}
          helper={billsBeforePaydayOverBudget ? "Bills before payday exceed your balance snapshot." : "Bills landing before your next payday."}
          status={billsBeforePaydayOverBudget ? "negative" : ""}
        />
        <SummaryCard
          label="Clear till payday"
          value={clearTillValue}
          muted={false}
          helper={clearTillHelper}
          status={clearTillStatus}
        />
        <SummaryCard
          label="Daily limit till payday"
          value={dailyLimitValue}
          muted={!hasBalanceSnapshot || !hasPayday}
          helper={dailyLimitHelper}
          status={dailyLimitStatus}
        />
      </section>

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
                    placeholder="Balance snapshot"
                  />
                  <button className="secondary-button" type="submit" disabled={importLocked}>
                    Save
                  </button>
                </div>
              </div>
            </form>
            {displayAccount?.currentBalance !== undefined ? (
              <div className="helper-text balance-copy">
                <p>Balance snapshot: {formatCurrency(dashboard.currentBalance, displayCurrency)}</p>
                <p>{balanceSnapshotLabel}</p>
                {hasPayday && hasBills ? (
                  <p>Bills before payday: {formatCurrency(dashboard.totalBeforePayday, displayCurrency)}</p>
                ) : null}
                <p>Clear till payday: {clearTillValue}</p>
                <p>Still around {formatCurrency(dashboard.currentBalance, displayCurrency)}? Update if this has changed.</p>
              </div>
            ) : (
              <p className="helper-text balance-copy">
                Enter your current balance. ClearTill will forecast what may be left after bills before payday.
              </p>
            )}
            {displayAccount?.currentBalance === undefined ? (
              <p className="helper-text balance-copy">
                Add your balance snapshot to see what may be left before payday.
              </p>
            ) : null}
            <div className="field-row" style={{ marginTop: "14px" }}>
              <label className="field-label" htmlFor="display-currency">Display currency</label>
              <select
                id="display-currency"
                className="currency-select"
                value={displayCurrency}
                onChange={(e) => handleCurrencySave(e.target.value)}
              >
                <option value="GBP">GBP £</option>
                <option value="EUR">EUR €</option>
                <option value="USD">USD $</option>
              </select>
            </div>
            {balanceError ? <p className="error">{balanceError}</p> : null}
          </section>

          <section className={`chat-panel ${setupStep === 3 ? "setup-current" : ""} ${!hasBalanceSnapshot ? "is-disabled-soft" : ""}`}>
            <h2>Add a bill or payday</h2>
            {!hasBalanceSnapshot || !hasPayday ? (
              <p className="helper-text helper-tooltip">
                {!hasBalanceSnapshot
                  ? "Bills can be added now, but the forecast works best after balance and payday are set."
                  : "You can add bills now, but ClearTill needs your payday to show what lands before you get paid."}
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
                            <p className="helper-text">
                              Skipped {job.skippedRows.length} unclear row{job.skippedRows.length === 1 ? "" : "s"}
                            </p>
                            <ul className="skipped-rows-list">
                              {job.skippedRows.map((row, i) => (
                                <li key={i} className="helper-text">
                                  {row.name || row.rawText} — {row.reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                      <div className="import-card-actions">
                        {job.status === "failed" ? (
                          <button
                            className="secondary-button small-button"
                            type="button"
                            disabled={isImporting}
                            onClick={() => handleRetryImport(job.id)}
                          >
                            Retry
                          </button>
                        ) : null}
                        <button
                          className="secondary-button small-button"
                          type="button"
                          disabled={importLocked}
                          onClick={() => removeSelectedImage(job.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
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

          <section className={`runway-panel ${!hasBills ? "is-disabled-soft" : ""}`}>
            <h2>{dashboard.runwayTitle}</h2>
            {hasBills ? (
              <>
                <div className="runway" aria-label="Timeline of upcoming bills">
                  {dashboard.runwayEvents.map((event, index) => (
                    <RunwayItem
                      key={`${event.type}-${event.label}-${index}`}
                      event={event}
                      showDivider={index > 0}
                    />
                  ))}
                  {dashboard.runwayMoreCount > 0 ? (
                    <>
                      <span className="runway-divider" aria-hidden="true">→</span>
                      <span className="runway-item runway-item-more">+{dashboard.runwayMoreCount} more</span>
                    </>
                  ) : null}
                </div>
                <p className="runway-helper">Sorted from today forward.</p>
              </>
            ) : (
              <p className="empty">No upcoming bills found.</p>
            )}
          </section>

          <section className="reminders-panel">
            <h2>Reminders</h2>
            {reminders.length ? (
              <ul className="reminder-list">
                {reminders.map((reminder) => {
                  const createdAt = reminder.createdAt?.toDate?.();
                  const createdLabel = createdAt
                    ? formatDisplayDate(createdAt.toISOString().slice(0, 10))
                    : null;

                  return (
                    <li key={reminder.id}>
                      <div className="bill-row-main">
                        <span>{reminder.message}</span>
                        {createdLabel ? (
                          <span className="bill-meta">
                            {createdLabel}{reminder.status ? ` — ${reminder.status}` : ""}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="empty">ClearTill will show reminders here when bills are due soon.</p>
            )}
          </section>
        </div>

        <section className={`list-panel ${!hasBalanceSnapshot && !hasPayday && !hasBills ? "is-disabled-soft" : ""}`}>
          <div className="section-head">
            <h2 style={{ margin: 0 }}>Bill list</h2>
            {bills.length > 0 ? (
              <div className="select-mode-controls">
                <button
                  className="secondary-button small-button"
                  type="button"
                  onClick={() => { setSelectMode((s) => !s); setSelectedBillIds(new Set()); }}
                >
                  {selectMode ? "Done" : "Select bills"}
                </button>
                {selectMode ? (
                  <>
                    <button
                      className="secondary-button small-button"
                      type="button"
                      onClick={() => setSelectedBillIds(new Set(bills.map((b) => b.id)))}
                    >
                      Select all
                    </button>
                    <button
                      className="secondary-button small-button"
                      type="button"
                      onClick={() => setSelectedBillIds(new Set())}
                    >
                      Clear
                    </button>
                    {selectedBillIds.size > 0 ? (
                      <button
                        className="secondary-button small-button delete-button"
                        type="button"
                        onClick={handleBulkDelete}
                      >
                        Delete {selectedBillIds.size} selected
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
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
                  placeholder="Monthly income"
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
                <p className="helper-text">{getIncomeStatusText(displayIncome, displayCurrency)}</p>
                {displayIncome && hasIncomeAmount ? (
                  <div className="helper-text helper-tooltip">
                    <p>Expected monthly income: {formatCurrency(Number(displayIncome.amount), displayCurrency)}</p>
                    {hasBills ? (
                      <>
                        <p>Monthly bills: {formatCurrency(dashboard.totalMonthlyBills, displayCurrency)}</p>
                        <p>Monthly spending room: {monthlySpendingRoomValue}</p>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {displayIncome && hasIncomeAmount && !hasPayday ? (
                  <p className="helper-text helper-tooltip">Add payday date</p>
                ) : null}
                {displayIncome && hasPayday && !hasIncomeAmount ? (
                  <p className="helper-text helper-tooltip">Add income amount if you want ClearTill to show monthly spending room.</p>
                ) : null}
              </>
            )}
            {!hasBalanceSnapshot ? (
              <p className="helper-text helper-tooltip">
                Add your balance snapshot first so ClearTill can forecast what may be left.
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
                onDelete={handleBillDelete}
                selectMode={selectMode}
                selectedBillIds={selectedBillIds}
                onToggleSelect={(id) => setSelectedBillIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                displayCurrency={displayCurrency}
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
                onDelete={handleBillDelete}
                selectMode={selectMode}
                selectedBillIds={selectedBillIds}
                onToggleSelect={(id) => setSelectedBillIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                displayCurrency={displayCurrency}
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
              onDelete={handleBillDelete}
              selectMode={selectMode}
              selectedBillIds={selectedBillIds}
              onToggleSelect={(id) => setSelectedBillIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
              displayCurrency={displayCurrency}
            />
          )}
          {editingIncome || editingBillId ? (editError ? <p className="error">{editError}</p> : null) : null}
          <HouseholdTracker bills={bills} />
        </section>
      </section>
    </main>
  );
}

function isRecentlyAdded(bill) {
  if (!bill?.createdAt) return false;
  const t = typeof bill.createdAt.toMillis === "function"
    ? bill.createdAt.toMillis()
    : new Date(bill.createdAt).getTime();
  return Date.now() - t < 48 * 60 * 60 * 1000;
}

const CATEGORY_META = {
  household: { icon: "🏠", label: "Household" },
  subscription: { icon: "🔁", label: "Subscription" },
  work_side_project: { icon: "💼", label: "Work / side project" },
  vehicle: { icon: "🚗", label: "Vehicle" },
  debt: { icon: "💳", label: "Debt / repayment" },
  family: { icon: "🧒", label: "Children / family" },
  other: { icon: "📌", label: "Other" },
};

function classifyBill(bill) {
  const raw = `${bill.name || ""} ${bill.description || ""}`.toLowerCase();

  function has(kw) {
    if (kw.length <= 3) {
      return new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(raw);
    }
    return raw.includes(kw);
  }

  function any(kws) { return kws.some(has); }

  if (any(["google workspace"])) return { category: "work_side_project", subCategory: "software_subscription", confidence: "medium", needsReview: true, reason: "google workspace" };

  if (any(["octopus", "british gas", "e.on", "edf", "ovo energy", "shell energy", "scottish power"])) return { category: "household", subCategory: "energy", confidence: "high", needsReview: false, reason: "energy supplier" };
  if (has("eon")) return { category: "household", subCategory: "energy", confidence: "high", needsReview: false, reason: "eon energy" };
  if (any(["electricity", "electric", "energy bill", "gas bill"])) return { category: "household", subCategory: "energy", confidence: "high", needsReview: false, reason: "energy keyword" };
  if (any(["energy", "gas", "electric"])) return { category: "household", subCategory: "energy", confidence: "medium", needsReview: false, reason: "energy keyword" };

  if (any(["southern water", "thames water", "severn trent", "united utilities", "yorkshire water", "affinity water", "south east water"])) return { category: "household", subCategory: "water", confidence: "high", needsReview: false, reason: "water supplier" };
  if (any(["wastewater", "waste water", "sewerage", "sewage", "drainage"])) return { category: "household", subCategory: "wastewater", confidence: "high", needsReview: false, reason: "wastewater keyword" };
  if (any(["water"])) return { category: "household", subCategory: "water", confidence: "medium", needsReview: false, reason: "water keyword" };

  if (any(["council tax", "council rates"])) return { category: "household", subCategory: "council_tax", confidence: "high", needsReview: false, reason: "council tax" };
  if (any(["council"])) return { category: "household", subCategory: "council_tax", confidence: "medium", needsReview: false, reason: "council keyword" };

  if (any(["broadband", "wifi", "wi-fi", "internet", "virgin media", "sky broadband", "talktalk", "plusnet", "vodafone broadband", "ee broadband"])) return { category: "household", subCategory: "broadband", confidence: "high", needsReview: false, reason: "broadband keyword" };
  if (has("bt")) return { category: "household", subCategory: "broadband", confidence: "medium", needsReview: false, reason: "bt broadband" };

  if (any(["home insurance", "contents insurance", "buildings insurance", "compare the market"])) return { category: "household", subCategory: "home_insurance", confidence: "high", needsReview: false, reason: "insurance keyword" };
  if (any(["aviva", "direct line", "admiral", "churchill"])) return { category: "household", subCategory: "home_insurance", confidence: "high", needsReview: false, reason: "insurance provider" };

  if (any(["mortgage", "landlord", "letting agent", "santander mortgage", "barclays mortgage"])) return { category: "household", subCategory: "rent_mortgage", confidence: "high", needsReview: false, reason: "mortgage/rent keyword" };
  if (any(["rent"])) return { category: "household", subCategory: "rent_mortgage", confidence: "high", needsReview: false, reason: "rent keyword" };
  if (any(["halifax", "nationwide"])) return { category: "household", subCategory: "rent_mortgage", confidence: "low", needsReview: true, reason: "bank could be mortgage" };

  if (any(["giffgaff", "lebara", "voxi"])) return { category: "household", subCategory: "mobile", confidence: "high", needsReview: false, reason: "mobile provider" };
  if (has("o2")) return { category: "household", subCategory: "mobile", confidence: "high", needsReview: false, reason: "o2 mobile" };
  if (any(["three mobile", "three network", "three sim"])) return { category: "household", subCategory: "mobile", confidence: "high", needsReview: false, reason: "three mobile" };
  if (any(["mobile", "phone plan", "sim plan", "sim only"])) return { category: "household", subCategory: "mobile", confidence: "medium", needsReview: false, reason: "mobile keyword" };
  if (has("ee")) return { category: "household", subCategory: "mobile", confidence: "medium", needsReview: true, reason: "ee could be mobile or broadband" };
  if (any(["vodafone"])) return { category: "household", subCategory: "mobile", confidence: "medium", needsReview: true, reason: "vodafone could be mobile or broadband" };

  if (any(["netflix"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "netflix" };
  if (any(["spotify"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "spotify" };
  if (any(["disney+", "disney plus", "disney"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "disney" };
  if (any(["youtube premium", "youtube music"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "youtube" };
  if (any(["amazon prime", "prime video"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "prime streaming" };
  if (any(["prime"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "prime subscription" };

  if (any(["apple storage", "icloud"])) return { category: "subscription", subCategory: "cloud_storage", confidence: "high", needsReview: false, reason: "apple storage/icloud" };
  if (any(["apple"])) return { category: "subscription", subCategory: "cloud_storage", confidence: "high", needsReview: false, reason: "apple subscription" };

  if (any(["audible"])) return { category: "subscription", subCategory: "audiobook", confidence: "high", needsReview: false, reason: "audible" };
  if (any(["microsoft 365", "office 365"])) return { category: "subscription", subCategory: "software_subscription", confidence: "high", needsReview: false, reason: "microsoft 365" };
  if (any(["adobe", "canva", "figma"])) return { category: "subscription", subCategory: "software_subscription", confidence: "high", needsReview: false, reason: "software subscription" };
  if (any(["chatgpt", "openai"])) return { category: "subscription", subCategory: "software_subscription", confidence: "high", needsReview: false, reason: "ai subscription" };
  if (any(["puregym", "david lloyd", "anytime fitness"])) return { category: "subscription", subCategory: "gym", confidence: "high", needsReview: false, reason: "gym membership" };
  if (any(["gym", "fitness"])) return { category: "subscription", subCategory: "gym", confidence: "high", needsReview: false, reason: "gym keyword" };
  if (any(["amazon"])) return { category: "subscription", subCategory: "amazon_unknown", confidence: "low", needsReview: true, reason: "amazon (unclear type)" };

  if (any(["car insurance", "vehicle insurance", "motor insurance"])) return { category: "vehicle", subCategory: "car_insurance", confidence: "high", needsReview: false, reason: "vehicle insurance" };
  if (any(["dvla", "vehicle tax", "road tax", "mot"])) return { category: "vehicle", subCategory: "vehicle", confidence: "high", needsReview: false, reason: "vehicle keyword" };
  if (any(["car finance", "car loan", "parking", "congestion"])) return { category: "vehicle", subCategory: "vehicle", confidence: "medium", needsReview: false, reason: "vehicle keyword" };

  if (any(["credit card", "loan repayment", "personal loan", "barclaycard", "capital one", "klarna"])) return { category: "debt", subCategory: "loan", confidence: "high", needsReview: false, reason: "debt keyword" };
  if (any(["nursery", "childcare", "child maintenance", "school fees"])) return { category: "family", subCategory: "childcare", confidence: "high", needsReview: false, reason: "family keyword" };

  return { category: "other", subCategory: null, confidence: "low", needsReview: false, reason: "no match" };
}

const TRACKER_CHECKS = [
  { label: "Energy", key: "energy", keywords: ["gas", "electric", "electricity", "energy", "octopus", "british gas", "eon", "e.on", "edf", "ovo", "shell energy", "scottish power"] },
  { label: "Water", key: "water", keywords: ["water", "affinity water", "southern water", "thames water", "severn trent", "united utilities", "yorkshire water", "south east water"] },
  { label: "Wastewater", key: "wastewater", keywords: ["wastewater", "waste water", "sewerage", "sewage", "drainage", "southern water", "thames water"] },
  { label: "Council tax", key: "council_tax", keywords: ["council tax", "council"] },
  { label: "Broadband", key: "broadband", keywords: ["broadband", "wifi", "wi-fi", "internet", "virgin media", "bt", "sky broadband", "talktalk", "vodafone broadband", "plusnet", "ee broadband"] },
  { label: "Mobile", key: "mobile", keywords: ["mobile", "phone", "o2", "ee", "vodafone", "three", "giffgaff", "lebara", "voxi"] },
  { label: "Home insurance", key: "home_insurance", keywords: ["home insurance", "contents insurance", "buildings insurance", "aviva", "direct line", "admiral", "churchill", "compare the market"] },
  { label: "Rent / mortgage", key: "rent_mortgage", keywords: ["rent", "mortgage", "landlord", "letting agent", "halifax", "nationwide", "santander mortgage", "barclays mortgage"] },
];

function trackerBillMatch(billName, keywords) {
  const text = (billName || "").toLowerCase();
  return keywords.some((kw) => {
    if (kw.length <= 3) {
      return new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(text);
    }
    return text.includes(kw);
  });
}

function BillCategoryPill({ bill }) {
  const category = bill.category || classifyBill(bill).category || "other";
  const meta = CATEGORY_META[category] || CATEGORY_META.other;
  return (
    <span className="bill-category-pill">
      {meta.icon} {meta.label}
    </span>
  );
}

function HouseholdTracker({ bills }) {
  const checks = TRACKER_CHECKS.map((check) => ({
    ...check,
    found: bills.some((bill) => trackerBillMatch(bill.name, check.keywords)),
  }));

  return (
    <div className="tracker-card">
      <h3>🏠 Household utilities tracker</h3>
      <p className="tracker-sub">ClearTill checks whether the main household bills are in your forecast.</p>
      <div className="tracker-grid">
        {checks.map((check) => (
          <div key={check.key} className={`tracker-row ${check.found ? "tracker-added" : "tracker-missing"}`}>
            <span>{check.found ? "✅" : "⚠️"}</span>
            <span>{check.label}</span>
          </div>
        ))}
      </div>
      <button className="tracker-action" type="button">Add missing utility</button>
    </div>
  );
}

function SummaryCard({ label, value, muted = false, helper = "", status = "" }) {
  const statusClass = status ? `summary-card-${status}` : "";
  return (
    <article className={`summary-card ${muted ? "is-disabled-soft" : ""} ${statusClass}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <p className="helper-text helper-tooltip">{helper}</p> : null}
    </article>
  );
}

function RunwayItem({ event, showDivider }) {
  return (
    <>
      {showDivider ? <span className="runway-divider" aria-hidden="true">→</span> : null}
      <span className={`runway-item runway-item-${event.type}`}>
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
  onDelete,
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
                    placeholder="Amount"
                  />
                  <label className="field-label" htmlFor={`bill-due-day-${bill.id}`}>Day of month</label>
                  <input
                    id={`bill-due-day-${bill.id}`}
                    inputMode="numeric"
                    value={editingBillForm.dueDay}
                    onChange={(event) => onBillFormChange((current) => ({ ...current, dueDay: event.target.value }))}
                    placeholder="Day of month"
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
                    <span>
                      {bill.name}
                      {isRecentlyAdded(bill) ? <span className="bill-new-tag">Recently added</span> : null}
                    </span>
                    <span className="bill-meta">
                      {formatCurrency(bill.amount, displayCurrency)} — {isValidDueDay(bill.dueDay) ? formatOrdinal(bill.dueDay) : "date not set"}
                    </span>
                    <BillCategoryPill bill={bill} />
                  </div>
                  {!selectMode ? (
                    <div className="edit-actions">
                      <button className="secondary-button small-button" type="button" disabled={importLocked} onClick={() => onEditStart(bill)}>
                        Edit
                      </button>
                      <button className="secondary-button small-button remove-button" type="button" disabled={importLocked} onClick={() => onDelete?.(bill.id)}>
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

function buildImportDoneMessage(importedCount, skippedCount, extractedCount = 0, qualitySkippedCount = 0) {
  const ic = importedCount || 0;
  const sc = skippedCount || 0;
  const ec = extractedCount || 0;
  const qsc = qualitySkippedCount || 0;
  const dupSkipped = Math.max(0, sc - qsc);

  if (ic > 0 && sc > 0) {
    const skipLabel = dupSkipped > qsc ? "duplicate" : "unclear row";
    return `Imported ${ic} bill${ic === 1 ? "" : "s"}. Skipped ${sc} ${skipLabel}${sc === 1 ? "" : "s"}.`;
  }

  if (ic > 0) {
    return `Imported ${ic} bill${ic === 1 ? "" : "s"}.`;
  }

  if (ec > 0 && sc > 0) {
    const skipLabel = dupSkipped > qsc ? "duplicate" : "unclear row";
    return `Read this screenshot. No new bills added. Skipped ${sc} ${skipLabel}${sc === 1 ? "" : "s"}.`;
  }

  if (ec > 0) {
    return "Read this screenshot. No new bills added.";
  }

  return "Couldn't read enough from this screenshot.";
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

  if (skipped > 0) {
    return `Import completed. No new bills added. ${skipped} row${skipped === 1 ? "" : "s"} were already imported or skipped.`;
  }

  return "Import completed. No new bills added.";
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
      detail: "ClearTill works best when you start with a manual balance snapshot.",
    };
  }

  if (setupStep === 2) {
    return {
      title: "Step 2 of 3 — Add your payday",
      detail: "Once payday is set, ClearTill can show what lands before you get paid.",
    };
  }

  if (setupStep === 3) {
    return {
      title: "Step 3 of 3 — Add your bills",
      detail: "Add your bills to build the forecast and runway.",
    };
  }

  return {
    title: "Setup complete — ClearTill can now show your payday forecast.",
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
