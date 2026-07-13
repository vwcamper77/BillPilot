"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import {
  collection,
  deleteDoc,
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
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
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
  buildLargeCostDocument,
  calculateBillSchedule,
  calculateLargeCostImpact,
  calculateDashboard,
  diffDays,
  formatCurrency,
  formatDisplayDate,
  formatDueLabel,
  formatOrdinal,
  getTodayIso,
  isValidDueDay,
  normaliseLargeCostFundingStatus,
} from "@/lib/billMath";
import { analyseCsvText } from "@/lib/csvBillFinder";
import { trackClientAnalyticsEvent } from "@/lib/clientAnalytics";
import { logSecurityEventClient, storeImportArchive } from "@/lib/security/clientSecurity";
import { safeError, safeWarn } from "@/lib/security/safeLog";

const IMAGE_IMPORT_FETCH_TIMEOUT_MS = 70000;

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
    return "Add pay date";
  }

  if (hasValidPayday) {
    return `Pay date: ${formatOrdinal(income.payDay)} of each month`;
  }

  return "No pay date set yet.";
}

const BILLS_PER_PAGE = 6;
const BALANCE_HELPER_TEXT = "This is just the money currently available in your account, so ClearTill can show today’s cash position after bills.";
const BALANCE_MISSING_FORECAST_COPY = "Add your current available money to see today’s exact cash forecast.";

export default function DashboardPage() {
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const imageInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const addBillSectionRef = useRef(null);
  const messageInputRef = useRef(null);
  const balanceSectionRef = useRef(null);
  const balanceInputRef = useRef(null);
  const paydaySectionRef = useRef(null);
  const paydaySettingsSectionRef = useRef(null);
  const paydayAmountInputRef = useRef(null);
  const paydayDayInputRef = useRef(null);
  const forecastPaydayAmountInputRef = useRef(null);
  const billsRef = useRef([]);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [bills, setBills] = useState([]);
  const [largeCosts, setLargeCosts] = useState([]);
  const [savings, setSavings] = useState(null);
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
  const [billReviewDrafts, setBillReviewDrafts] = useState([]);
  const [editingReviewId, setEditingReviewId] = useState("");
  const [billReviewForm, setBillReviewForm] = useState({ name: "", amount: "", dueDay: "", category: "", frequency: "monthly" });
  const [balanceError, setBalanceError] = useState("");
  const [editError, setEditError] = useState("");
  const [pageNotice, setPageNotice] = useState("");
  const [onboardingHelper, setOnboardingHelper] = useState(null);
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
  const [csvPhase, setCsvPhase] = useState("idle");
  const [csvSuggestions, setCsvSuggestions] = useState([]);
  const [csvIgnored, setCsvIgnored] = useState(new Set());
  const [csvEditingId, setCsvEditingId] = useState(null);
  const [csvEditForm, setCsvEditForm] = useState({ name: "", amount: "", dueDay: "", category: "" });
  const [csvSavingId, setCsvSavingId] = useState(null);
  const [csvSavedCount, setCsvSavedCount] = useState(0);
  const [csvError, setCsvError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [entryAuthMode] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    const requestedMode = String(new URLSearchParams(window.location.search).get("auth") || "").toLowerCase();
    return requestedMode === "signup" || requestedMode === "signin" ? requestedMode : "";
  });
  const [entryIntent] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return String(new URLSearchParams(window.location.search).get("intent") || "").toLowerCase();
  });
  const shouldUseDirectAuthEntry = entryAuthMode === "signup" || entryAuthMode === "signin";
  const shouldShowDirectAuth = shouldUseDirectAuthEntry && (!user || user.isAnonymous);
  const [emailForm, setEmailForm] = useState({ email: "", password: "" });
  const [optimisticBalance, setOptimisticBalance] = useState(null);
  const [optimisticIncome, setOptimisticIncome] = useState(null);
  const [displayCurrency, setDisplayCurrency] = useState("GBP");
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [billingConfig, setBillingConfig] = useState({
    enabled: false,
    offerHeadline: "Start your 7-day free trial",
    offerCopy: "£0 today. After 7 days, ClearTill bills £1.99, then continues monthly unless you cancel.",
    checkoutCommitmentCopy: "By continuing, you start a 7-day free trial. Stripe collects your payment method today, charges £0 now, bills £1.99 after the 7-day trial, then charges monthly unless you cancel.",
    monthlyPriceDisplay: "£1.99",
    trialLengthDays: 7,
  });
  const [billingEntitlement, setBillingEntitlement] = useState(null);
  const [billingSubscription, setBillingSubscription] = useState(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [showTrialAccountForm, setShowTrialAccountForm] = useState(false);
  const [showGuestAuthFallback, setShowGuestAuthFallback] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedBillIds, setSelectedBillIds] = useState(new Set());
  const [billListPage, setBillListPage] = useState(0);
  const [billListFilter, setBillListFilter] = useState("all");
  const [quickAddContext, setQuickAddContext] = useState(null);
  const [showLargeCostForm, setShowLargeCostForm] = useState(false);
  const [editingLargeCostId, setEditingLargeCostId] = useState("");
  const [largeCostForm, setLargeCostForm] = useState({
    name: "",
    amount: "",
    amountAlreadySaved: "",
    dueDate: "",
    frequency: "one_off",
    category: "other",
    fundingStatus: "unassigned",
  });
  const [largeCostError, setLargeCostError] = useState("");
  const [savingLargeCost, setSavingLargeCost] = useState(false);
  const [savingsInput, setSavingsInput] = useState("");
  const [savingSavings, setSavingSavings] = useState(false);
  const [savingsError, setSavingsError] = useState("");
  const [highlightBalanceForm, setHighlightBalanceForm] = useState(false);
  const [highlightPaydayForm, setHighlightPaydayForm] = useState(false);
  const [highlightAddBillForm, setHighlightAddBillForm] = useState(false);
  const [pendingSetupFocus, setPendingSetupFocus] = useState("");
  const [fundingEditorCostId, setFundingEditorCostId] = useState("");
  const [fundingEditorForm, setFundingEditorForm] = useState({ fundingStatus: "unassigned", savingsAmount: "" });
  const balanceSaveRequestRef = useRef(0);
  const onboardingHelperTimeoutRef = useRef(null);
  const firstResultTrackedRef = useRef(false);
  const trialOfferTrackedRef = useRef(false);
  const onboardingStartedRef = useRef(false);
  const checkoutStartedRef = useRef(false);

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
        setSigningIn(false);
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || user || !auth) {
      return;
    }

    if (shouldUseDirectAuthEntry) {
      return;
    }

    let cancelled = false;
    setSigningIn(true);
    setAuthError("");

    authPersistenceReady
      .then(() => signInAnonymously(auth))
      .catch((error) => {
        if (!cancelled) {
          setAuthError(friendlyAuthError(error));
          setShowGuestAuthFallback(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSigningIn(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, shouldUseDirectAuthEntry, user]);

  useEffect(() => {
    if (
      entryIntent !== "trial" ||
      !authReady ||
      !user ||
      checkoutStartedRef.current
    ) {
      return;
    }

    void startTrialCheckoutForUser(user);
  }, [authReady, entryIntent, user]);

  useEffect(() => {
    if (!shouldUseDirectAuthEntry) {
      return;
    }

    setShowGuestAuthFallback(true);
    setAuthMode(entryAuthMode);
  }, [entryAuthMode, shouldUseDirectAuthEntry]);

  useEffect(() => {
    billsRef.current = bills;
  }, [bills]);

  useEffect(() => () => {
    if (onboardingHelperTimeoutRef.current) {
      window.clearTimeout(onboardingHelperTimeoutRef.current);
    }
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
          ? "Voice captured. Review it, then add it."
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
    if (user && !user.isAnonymous) {
      setShowTrialAccountForm(false);
      if (billingError === "Save your result with Google or email before starting the 7-day free trial.") {
        setBillingError("");
      }
    }
  }, [billingError, user]);

  useEffect(() => {
    void trackClientAnalyticsEvent("landing_page_viewed", {});
  }, []);

  useEffect(() => {
    if (!user || !db || entryIntent === "trial" || (shouldUseDirectAuthEntry && user.isAnonymous)) {
      setBills([]);
      setLargeCosts([]);
      setSavings(null);
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
    const largeCostsQuery = query(
      collection(db, "users", user.uid, "largeCosts"),
      where("active", "==", true),
    );

    const unsubscribeBills = onSnapshot(billsQuery, (snapshot) => {
      setBills(snapshot.docs.map((billDoc) => ({ id: billDoc.id, ...billDoc.data() })));
    });
    const unsubscribeIncome = onSnapshot(doc(db, "users", user.uid, "income", "main"), (snapshot) => {
      const loadedIncome = snapshot.exists() ? snapshot.data() : null;
      if (loadedIncome && !isValidDueDay(loadedIncome.payDay)) {
        safeWarn("[payday-load] invalid payDay");
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
      const nextAccount = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      setAccount(nextAccount);
      setOptimisticBalance(null);
      setBalanceInput(nextAccount?.currentBalance?.toString() || "");
    });
    const unsubscribeLargeCosts = onSnapshot(largeCostsQuery, (snapshot) => {
      setLargeCosts(snapshot.docs.map((costDoc) => ({ id: costDoc.id, ...costDoc.data() })));
    });
    const unsubscribeSavings = onSnapshot(doc(db, "users", user.uid, "settings", "savings"), (snapshot) => {
      const nextSavings = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      setSavings(nextSavings);
      setSavingsInput(nextSavings?.totalSetAside === undefined || nextSavings?.totalSetAside === null ? "" : String(nextSavings.totalSetAside));
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
      unsubscribeLargeCosts();
      unsubscribeSavings();
      unsubscribeReminders();
      unsubscribePreferences();
    };
  }, [entryIntent, shouldUseDirectAuthEntry, user]);

  useEffect(() => {
    let cancelled = false;

    async function loadBillingStatus() {
      try {
        const headers = {};
        if (auth?.currentUser) {
          headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
        }

        const response = await fetch("/api/billing/status", { headers });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Could not load billing status.");
        }
        if (cancelled) return;
        setBillingConfig(payload.config || billingConfig);
        setBillingSubscription(payload.subscription || null);
        setBillingEntitlement(payload.entitlement || null);
      } catch (error) {
        if (!cancelled) {
          setBillingError(error?.message || "Could not load billing status.");
        }
      }
    }

    void loadBillingStatus();

    return () => {
      cancelled = true;
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
  const todayIso = getTodayIso();
  const generalProtectedSavings = Math.max(0, Number(savings?.totalSetAside) || 0);
  const balanceValue = displayAccount?.currentBalance;
  const hasBalanceSnapshot = balanceValue !== undefined && balanceValue !== null && balanceValue !== "" && Number.isFinite(Number(balanceValue));
  const hasPayday = isValidDueDay(displayIncome?.payDay);
  const hasIncomeAmount = isValidIncomeAmount(displayIncome?.amount);
  const hasBills = bills.length > 0;
  const hasFirstResult = hasBalanceSnapshot && hasPayday && hasBills;
  const trialEnabled = Boolean(billingConfig.enabled);
  const hasPremiumAccess = !trialEnabled || Boolean(billingEntitlement?.hasFullAccess);
  const shouldShowTrialOffer = trialEnabled && hasFirstResult && !hasPremiumAccess;
  const shouldLockPremiumSections = trialEnabled && hasFirstResult && !hasPremiumAccess;
  const setupStep = !hasBalanceSnapshot ? 1 : !hasPayday ? 2 : !hasBills ? 3 : 4;

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
  const totalMonthlyBills = bills.reduce((sum, b) => sum + (b.amount || 0), 0);

  const monthlySpendingRoomValue = (() => {
    if (!hasIncomeAmount) return "Add expected income";
    if (!hasBills) return "No bills logged yet";
    const msr = dashboard.monthlySpendingRoom;
    if (msr < 0) return `${formatCurrency(Math.abs(msr), displayCurrency)} short each month`;
    return `${formatCurrency(msr, displayCurrency)} left each month`;
  })();

  const largeCostImpact = useMemo(
    () => calculateLargeCostImpact(largeCosts, generalProtectedSavings, dashboard.dailyLimitTillPayday || 0, dashboard.daysTillPayday || 0, todayIso),
    [dashboard.dailyLimitTillPayday, dashboard.daysTillPayday, largeCosts, generalProtectedSavings, todayIso],
  );
  const bigCostsDueBeforePayday = useMemo(() => {
    if (!dashboard.paydayDate) {
      return 0;
    }

    return largeCostImpact.costs.reduce((total, cost) => {
      if (!cost.nextDueDate || cost.nextDueDate >= dashboard.paydayDate) {
        return total;
      }

      return total + (Number(cost.currentAccountAmount) || 0);
    }, 0);
  }, [dashboard.paydayDate, largeCostImpact.costs]);
  const unassignedCostsBeforePayday = useMemo(() => {
    if (!dashboard.paydayDate) {
      return 0;
    }

    return largeCostImpact.costs.reduce((total, cost) => {
      if (!cost.nextDueDate || cost.nextDueDate >= dashboard.paydayDate) {
        return total;
      }
      if (cost.fundingStatus !== "unassigned") {
        return total;
      }
      return total + (Number(cost.amount) || 0);
    }, 0);
  }, [dashboard.paydayDate, largeCostImpact.costs]);
  const totalProtectedSavings = largeCostImpact.totalProtectedSavings;
  const spendingRoomUntilPayday = hasBalanceSnapshot
    ? dashboard.currentBalance - dashboard.totalBeforePayday - bigCostsDueBeforePayday
    : null;
  const dailySpendingRoom = hasPayday && dashboard.daysTillPayday && spendingRoomUntilPayday !== null
    ? spendingRoomUntilPayday / dashboard.daysTillPayday
    : null;
  const spendingRoomStatus = (() => {
    if (!hasBalanceSnapshot || !hasPayday || spendingRoomUntilPayday === null) return "";
    if (spendingRoomUntilPayday < 0) return "negative";
    if (spendingRoomUntilPayday < 50) return "low";
    return "ok";
  })();
  const spendingRoomValue = (() => {
    if (!hasBalanceSnapshot) return BALANCE_MISSING_FORECAST_COPY;
    if (!hasPayday) return "Set your pay date";
    if (spendingRoomUntilPayday === null) return "—";
    if (spendingRoomUntilPayday < 0) return `${formatCurrency(Math.abs(spendingRoomUntilPayday), displayCurrency)} needed before payday`;
    return formatCurrency(spendingRoomUntilPayday, displayCurrency);
  })();
  const spendingRoomSummary = (() => {
    if (!hasBalanceSnapshot) return BALANCE_MISSING_FORECAST_COPY;
    if (!hasPayday) return "Set your pay date";
    if (spendingRoomUntilPayday === null) return "Spending room unavailable";
    if (spendingRoomUntilPayday < 0) return `You're ${formatCurrency(Math.abs(spendingRoomUntilPayday), displayCurrency)} short before payday`;
    return `You're clear - ${formatCurrency(spendingRoomUntilPayday, displayCurrency)} left`;
  })();
  const spendingRoomHelper = (() => {
    if (!hasBalanceSnapshot) return BALANCE_MISSING_FORECAST_COPY;
    if (!hasPayday) return "Set your pay date so ClearTill can work to that date.";
    if (dailySpendingRoom === null) return "";
    if (spendingRoomUntilPayday < 0) {
      if (bigCostsDueBeforePayday > 0) {
        return `This is mainly because ${formatCurrency(bigCostsDueBeforePayday, displayCurrency)} of big costs are coming from your current account.`;
      }
      return `You need ${formatCurrency(Math.abs(spendingRoomUntilPayday), displayCurrency)} more before payday.`;
    }
    return `About ${formatCurrency(Math.max(0, dailySpendingRoom), displayCurrency)}/day until payday.`;
  })();
  const spendingRoomFallbackCopy = (() => {
    if (!hasBalanceSnapshot || !hasPayday || spendingRoomUntilPayday === null || spendingRoomUntilPayday >= 0 || totalProtectedSavings <= 0) {
      return "Not counted as daily spending money.";
    }
    return "Your savings now could cover this, but ClearTill does not count savings as daily spending money.";
  })();
  const clearTillStatus = spendingRoomStatus;
  const paydayCountdownLabel = dashboard.paydayDate
    ? `${dashboard.daysTillPayday} day${dashboard.daysTillPayday === 1 ? "" : "s"} to payday`
    : "Pay date not set";
  const beforePaydayPreviewBills = dashboard.beforePayday.slice(0, 4);
  const weeklySafePosition = dailySpendingRoom === null
    ? null
    : Math.max(0, dailySpendingRoom * 7);

  useEffect(() => {
    if (!onboardingStartedRef.current && (hasBalanceSnapshot || hasPayday || hasBills)) {
      onboardingStartedRef.current = true;
      void trackClientAnalyticsEvent("onboarding_started", {});
    }
  }, [hasBalanceSnapshot, hasPayday, hasBills]);

  useEffect(() => {
    if (hasFirstResult && !firstResultTrackedRef.current) {
      firstResultTrackedRef.current = true;
      void trackClientAnalyticsEvent("first_clear_result_viewed", {});
    }
  }, [hasFirstResult]);

  useEffect(() => {
    if (shouldShowTrialOffer && !trialOfferTrackedRef.current) {
      trialOfferTrackedRef.current = true;
      void trackClientAnalyticsEvent("trial_offer_viewed", {});
    }
  }, [shouldShowTrialOffer]);

  const largeCostsWithStatus = useMemo(
    () => [...largeCostImpact.costs]
      .sort((a, b) => {
        if (a.status === "due_now" && b.status !== "due_now") return -1;
        if (a.status !== "due_now" && b.status === "due_now") return 1;
        if (a.nextDueDate && b.nextDueDate) return String(a.nextDueDate).localeCompare(String(b.nextDueDate));
        return String(a.name || "").localeCompare(String(b.name || ""));
      })
      .map((cost) => ({
        ...cost,
        fundingMeta: LARGE_COST_FUNDING_META[cost.fundingStatus] || LARGE_COST_FUNDING_META.unassigned,
        statusBadge: (() => {
          if (cost.fundingStatus === "unassigned") return "Choose funding";
          if (cost.fundingStatus === "savings") return "Covered";
          if (cost.status === "overdue") return "Overdue";
          if (cost.status === "due_now") return "Due now";
          if (largeCostImpact.normalDailyBudget <= 0) return "At risk";
          if (cost.adjustedPerDayRaw >= largeCostImpact.normalDailyBudget * 0.9) return "At risk";
          if (cost.adjustedPerDayRaw >= largeCostImpact.normalDailyBudget * 0.5) return "Tight";
          return "On track";
        })(),
      })),
    [largeCostImpact],
  );
  const dueBeforePaydayLargeCosts = useMemo(
    () => largeCostsWithStatus.filter((cost) => cost.nextDueDate && dashboard.paydayDate && cost.nextDueDate < dashboard.paydayDate),
    [dashboard.paydayDate, largeCostsWithStatus],
  );
  const balanceSnapshotLabel = useMemo(
    () => formatBalanceSnapshotLabel(displayAccount?.snapshotEnteredAt || displayAccount?.updatedAt),
    [displayAccount?.snapshotEnteredAt, displayAccount?.updatedAt],
  );
  const importLocked = isImporting;
  const importQueueFinished = importJobs.length > 0 && !isImporting && importJobs.some((job) => job.status !== "queued");
  const importButtonLabel = getImportButtonLabel(isImporting, currentImportStep, importJobs, currentImportJobId);
  const setupMessage = getSetupMessage(setupStep);
  const showSetupCard = setupStep < 4 || !setupDismissed;
  const shouldShowGuestFallback = showGuestAuthFallback || shouldUseDirectAuthEntry;
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
      setShowGuestAuthFallback(false);
    } catch (signInError) {
      setAuthError(friendlyAuthError(signInError));
      setShowGuestAuthFallback(true);
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
        const credential = await linkWithPopup(auth.currentUser, googleProvider);
        if (entryIntent === "trial") {
          await startTrialCheckoutForUser(credential.user);
        }
        return;
      }

      const credential = await signInWithPopup(auth, googleProvider);
      setShowGuestAuthFallback(false);
      if (entryIntent === "trial") {
        await startTrialCheckoutForUser(credential.user);
      }
    } catch (signInError) {
      setAuthError(friendlyGoogleAuthError(signInError));
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

      let credential;
      if (auth.currentUser?.isAnonymous) {
        const emailCredential = EmailAuthProvider.credential(email, password);
        const linkedCredential = await linkWithCredential(auth.currentUser, emailCredential);
        credential = linkedCredential;
      } else if (authMode === "signup") {
        credential = await createUserWithEmailAndPassword(auth, email, password);
      } else {
        credential = await signInWithEmailAndPassword(auth, email, password);
      }
      setShowGuestAuthFallback(false);
      if (entryIntent === "trial") {
        await startTrialCheckoutForUser(credential.user);
      }
    } catch (emailError) {
      setAuthError(friendlyAuthError(emailError));
    } finally {
      setSigningIn(false);
    }
  }

  async function startTrialCheckoutForUser(accountUser) {
    if (!accountUser) {
      setBillingError("Please wait for ClearTill to finish setting up your session.");
      return;
    }

    if (checkoutStartedRef.current) {
      return;
    }

    checkoutStartedRef.current = true;
    setBillingBusy(true);
    setBillingError("");

    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await accountUser.getIdToken()}`,
        },
        body: JSON.stringify({
          successPath: "/billing/subscribe/success?session_id={CHECKOUT_SESSION_ID}",
          cancelPath: "/dashboard?checkout=cancelled",
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok || !payload?.url) {
        throw new Error(payload?.error || "Could not open Stripe Checkout.");
      }

      void trackClientAnalyticsEvent("trial_checkout_started", { source: "dashboard" });
      window.location.assign(payload.url);
    } catch (error) {
      checkoutStartedRef.current = false;
      setBillingError(error?.message || "Could not open Stripe Checkout.");
    } finally {
      setBillingBusy(false);
    }
  }

  async function handleStartTrialCheckout() {
    await startTrialCheckoutForUser(auth?.currentUser);
  }

  async function handleRetryTrialCheckout() {
    checkoutStartedRef.current = false;
    if (!auth?.currentUser) {
      await handleSignIn();
      return;
    }
    await startTrialCheckoutForUser(auth.currentUser);
  }

  async function handleManageSubscription() {
    if (!auth?.currentUser) {
      return;
    }

    setBillingBusy(true);
    setBillingError("");

    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok || !payload?.url) {
        throw new Error(payload?.error || "Could not open subscription management.");
      }

      window.location.assign(payload.url);
    } catch (error) {
      setBillingError(error?.message || "Could not open subscription management.");
    } finally {
      setBillingBusy(false);
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
      setSubmitting(true);
      if (importJobs.length) {
        await reviewImportQueue();
      } else {
        const response = await runWithTimeout(fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        }), "The parser is taking too long. Try again.");
        const parsed = await response.json();

        if (!response.ok) {
          throw new Error(parsed.responseMessage || "I could not read that yet.");
        }

        const parsedWithContext = applyQuickAddContext(parsed, quickAddContext);
        const reviewDrafts = buildBillReviewDrafts(parsedWithContext, {
          sourceText: message,
          quickAddContext,
        });

        if (reviewDrafts.length) {
          setBillReviewDrafts(reviewDrafts);
          setEditingReviewId("");
          setAssistantMessage(
            reviewDrafts.some((draft) => draft.missingFields?.length)
              ? "Review bill before adding. I found a likely match but still need any missing fields."
              : "Review bill before adding.",
          );
          return;
        }

        if (parsedWithContext.action === "set_income") {
          const outcome = await applyParsedActions(user.uid, parsedWithContext, Boolean(displayIncome), bills);
          setAssistantMessage(buildOutcomeMessage(parsedWithContext, outcome));
          return;
        }

        const fallbackDraft = buildLooseBillReviewDraft(message, quickAddContext);
        if (fallbackDraft) {
          setBillReviewDrafts([fallbackDraft]);
          setEditingReviewId(fallbackDraft.id);
          setBillReviewForm({
            name: fallbackDraft.name,
            amount: fallbackDraft.amount ? String(fallbackDraft.amount) : "",
            dueDay: fallbackDraft.dueDay ? String(fallbackDraft.dueDay) : "",
            category: fallbackDraft.category || "",
            frequency: fallbackDraft.frequency || "monthly",
          });
          setAssistantMessage("Review bill before adding. I found the bill name, but need the amount and due date.");
          return;
        }

        setAssistantMessage(parsedWithContext.responseMessage || "I could not turn that into a clean bill yet.");
      }
    } catch (submitError) {
      if (submitError?.message === "Failed to fetch") {
        setChatError("That image did not upload properly. Try the screenshot again, or type the bill in the box.");
      } else {
        setChatError(submitError.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function reviewImportQueue() {
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
    const collectedDrafts = [];

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

          const result = await importSingleImage(job, { saveBills: false });

          importedTotal += result.reviewCount || 0;
          skippedTotal += result.skippedCount || 0;
          processedTotal += 1;
          collectedDrafts.push(...(result.reviewDrafts || []));

          {
            const extractedCount = (result.bills || []).length || result.totalBillsFound || 0;
            const qualitySkipped = (result.skippedRows || []).length;
            const queueFinalStatus =
              (result.reviewCount || 0) > 0 || (extractedCount > 0 && (result.skippedCount || 0) > 0)
                ? "done"
                : "failed";
            updateJob(job.id, {
              status: queueFinalStatus,
              progressText: (result.reviewCount || 0) > 0
                ? `${result.reviewCount || 0} bill${result.reviewCount === 1 ? "" : "s"} ready to review.`
                : buildImportDoneMessage(
                  result.reviewCount || 0,
                  result.skippedCount || 0,
                  extractedCount,
                  qualitySkipped,
                ),
              importedCount: result.reviewCount || 0,
              skippedCount: result.skippedCount || 0,
              totalBillsFound: result.totalBillsFound || 0,
              billsSaved: result.reviewCount || 0,
              billsSkipped: result.skippedCount || 0,
              currentBillIndex: result.totalBillsFound || 0,
              errorMessage: "",
              skippedRows: result.skippedRows || [],
            });
          }
          setCurrentImportStep("job_done");
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

          safeError("[import-queue] job failed", { reason: isTimeout ? "timeout" : "import_error" });
        } finally {
          setLastCompletedImportJobName(job.name);
          setCurrentImportJobId(null);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } finally {
      const summary = { importedCount: importedTotal, skippedCount: skippedTotal, processedCount: processedTotal };
      setImportSummary(summary);

      if (collectedDrafts.length) {
        setBillReviewDrafts(collectedDrafts);
        setAssistantMessage(
          collectedDrafts.length === 1
            ? "Review bill before adding."
            : `Review ${collectedDrafts.length} bills before adding.`,
        );
      } else {
        const parts = [];
        parts.push("I could not cleanly extract a bill to review from those screenshots.");
        if (skippedTotal > 0) parts.push(`${skippedTotal} row${skippedTotal === 1 ? "" : "s"} were unclear or incomplete.`);
        setAssistantMessage(parts.join(" "));
      }

      setIsImporting(false);
      setCurrentImportStep("idle");
    }
  }

  async function importSingleImage(job, { saveBills = true } = {}) {
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

    setCurrentImportStep("reading_response");
    updateJob(job.id, {
      status: "identifying",
      progressText: "Identifying bills…",
    });
    const json = await response.json();
    setCurrentImportStep("json_received");
    if (!response.ok || json.ok === false) {
      throw new Error(json.error || json.message || "Image import failed");
    }

    const bills = Array.isArray(json.bills) ? json.bills : [];
    if (!bills.length) {
      throw new Error(json.error || json.message || "No bills found in this screenshot.");
    }

    // Archive the AI-extracted provenance text server-side (encrypted at rest)
    // and record that an AI import was used — no financial values are logged.
    logSecurityEventClient("ai_import_used", { billCount: bills.length });
    storeImportArchive({
      source: "ai_image",
      rawText: bills.map((bill) => bill?.rawText).filter(Boolean).join("\n"),
      payload: { billCount: bills.length },
    });

    const qualityResults = bills.map(scoreAndClassifyBill);
    const billsToSave = qualityResults.filter((r) => r.shouldImport).map((r) => r.bill);
    const skippedRows = qualityResults
      .filter((r) => !r.shouldImport)
      .map((r) => ({ name: r.bill.name || "", rawText: r.bill.rawText || r.bill.name || "", reason: r.skipReason }));

    if (!saveBills) {
      const reviewDrafts = billsToSave
        .map((bill) => buildBillReviewDraft(bill, {
          sourceText: bill?.rawText || message,
          importJobId: job.id,
          importJobName: job.name,
        }))
        .filter(Boolean);

      return {
        reviewCount: reviewDrafts.length,
        skippedCount: skippedRows.length,
        totalBillsFound: bills.length,
        skippedRows,
        bills,
        reviewDrafts,
      };
    }

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
      } catch {
        safeError("[import-single] bill save failed", { reason: "save_error" });
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
    setCurrentImportStep("returning_result");

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
    const payload = {
      ...billDocument,
      dateText: parsedBill.dateText,
      rawText: parsedBill.rawText,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const batch = writeBatch(db);

    batch.set(billRef, payload);

    try {
      await batch.commit();
      logSecurityEventClient("bill_created", { source: "import" });
    } catch (error) {
      safeError("[firestore-bill-save] failed", { code: error?.code });
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

  async function handleSkipBalance() {
    if (!user) {
      return;
    }

    setBalanceError("");
    setPageNotice("You can add your current available money later for a more accurate forecast.");
    setOptimisticBalance(null);
    setBalanceInput("");

    const payload = {
      currentBalance: null,
      currency: "GBP",
      updatedAt: serverTimestamp(),
      createdAt: account?.id ? account.createdAt || serverTimestamp() : serverTimestamp(),
    };

    void setDoc(doc(db, "users", user.uid, "settings", "balance"), payload, { merge: true })
      .catch((saveError) => {
        safeError("[firestore-balance-skip] failed", { code: saveError?.code });
      });
  }

  async function handleBalanceSave(event) {
    event.preventDefault();

    if (!user) {
      return;
    }

    const trimmedBalanceInput = balanceInput.trim();

    if (!trimmedBalanceInput) {
      setBalanceError("");
      setPageNotice("You can add your current available money later for a more accurate forecast.");
      setOptimisticBalance(null);
      setBalanceInput("");

      const payload = {
        currentBalance: null,
        currency: "GBP",
        updatedAt: serverTimestamp(),
        createdAt: account?.id ? account.createdAt || serverTimestamp() : serverTimestamp(),
      };

      void setDoc(doc(db, "users", user.uid, "settings", "balance"), payload, { merge: true })
        .catch((saveError) => {
          safeError("[firestore-balance-save] failed", { code: saveError?.code });
        });
      return;
    }

    const parsedBalance = Number(trimmedBalanceInput);

    if (!Number.isFinite(parsedBalance)) {
      setBalanceError("Add your current available money as a number.");
      return;
    }

    const saveRequestId = balanceSaveRequestRef.current + 1;
    balanceSaveRequestRef.current = saveRequestId;
    const shouldAdvanceToPayday = setupStep === 1;

    setBalanceError("");
    setPageNotice("");
    setOptimisticBalance(parsedBalance);
    setBalanceInput(parsedBalance.toString());
    setSavingBalance(false);
    setPageNotice(`Current available money updated to ${formatCurrency(parsedBalance, displayCurrency)}.`);

    const payload = {
      currentBalance: parsedBalance,
      currency: "GBP",
      updatedAt: serverTimestamp(),
      snapshotEnteredAt: serverTimestamp(),
      createdAt: account?.id ? account.createdAt || serverTimestamp() : serverTimestamp(),
    };

    void setDoc(
      doc(db, "users", user.uid, "settings", "balance"),
      payload,
      { merge: true },
    )
      .then(() => {
        if (balanceSaveRequestRef.current !== saveRequestId) {
          return;
        }

        logSecurityEventClient("balance_updated");
        if (shouldAdvanceToPayday) {
          setPageNotice(`Current available money saved: ${formatCurrency(parsedBalance, displayCurrency)}. Next, add your pay date.`);
          showOnboardingHelper("payday");
          window.setTimeout(() => {
            focusPaydayForm();
          }, 220);
          return;
        }

        setPageNotice(`Current available money saved: ${formatCurrency(parsedBalance, displayCurrency)}.`);
      })
      .catch((saveError) => {
        if (balanceSaveRequestRef.current !== saveRequestId) {
          return;
        }

        safeError("[firestore-balance-save] failed", { code: saveError?.code });
        setOptimisticBalance(null);
        setPageNotice("");
        setBalanceError(saveError.message || "Current available money could not be saved.");
      });
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
      const existingBill = bills.find((bill) => bill.id === billId);
      const updatedBill = buildBillDocument({
        name: editingBillForm.name.trim(),
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
        updatedAt: serverTimestamp(),
      };

      await runWithTimeout(setDoc(
        doc(db, "users", user.uid, "bills", billId),
        payload,
        { merge: true },
      ), "Saving that bill is taking too long. Check your connection and try again.");

      logSecurityEventClient("bill_updated", { source: "edit" });
      cancelBillEdit();
      setPageNotice("Bill updated.");
    } catch (saveError) {
      safeError("[firestore-bill-save] failed", { code: saveError?.code });
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
    const shouldAdvanceToBills = setupStep === 2;

    if (!Number.isFinite(amount) || amount < 0) {
      setEditError("Enter your monthly income amount.");
      return;
    }

    if (!Number.isInteger(payDay) || payDay < 1 || payDay > 31) {
      setEditError("Enter a pay date between 1 and 31.");
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

    setEditingIncome(false);
    setPageNotice(`Pay date set for the ${formatOrdinal(payDay)}.`);

    try {
      await saveIncome(
        user.uid,
        parsedIncome,
        Boolean(income),
      );

      if (shouldAdvanceToBills) {
        setPageNotice(`Pay date set for the ${formatOrdinal(payDay)}. Next, add your bills.`);
        showOnboardingHelper("bills");
        window.setTimeout(() => {
          focusAddBillComposer();
        }, 220);
      }
    } catch (saveError) {
      safeError("[firestore-payday-save] failed", { code: saveError?.code });
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

  function isImageUploadFile(file) {
    const fileName = (file?.name || "").toLowerCase();

    return file?.type?.startsWith("image/")
      || [".png", ".jpg", ".jpeg", ".webp", ".gif"].some((ext) => fileName.endsWith(ext));
  }

  function isCsvUploadFile(file) {
    const fileName = (file?.name || "").toLowerCase();
    const fileType = String(file?.type || "").toLowerCase();

    return fileName.endsWith(".csv") || fileType === "text/csv" || fileType.includes("comma");
  }

  function handleImportedFiles(fileList) {
    if (importLocked) {
      return;
    }

    const files = Array.from(fileList || []).filter(Boolean);

    if (!files.length) {
      return;
    }

    const imageFiles = files.filter(isImageUploadFile);

    if (imageFiles.length) {
      void handleImageFiles(imageFiles);
      return;
    }

    const csvFile = files.find(isCsvUploadFile);

    if (csvFile) {
      handleCsvFile(csvFile);
      return;
    }

    setChatError("Please upload a CSV, PNG, JPG, WEBP, or GIF file.");
  }

  function handleUploadChange(event) {
    handleImportedFiles(event.target.files);
    event.target.value = "";
  }

  function handleCsvFile(file) {
    setCsvError("");
    setCsvPhase("parsing");
    setCsvSuggestions([]);
    setCsvIgnored(new Set());
    setCsvEditingId(null);
    setCsvSavedCount(0);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target.result || "";
        const result = analyseCsvText(csvText);
        if (result.error === "no_columns") {
          setCsvError("We could not find date, description and amount columns in this CSV.");
          setCsvPhase("error");
        } else if (result.error) {
          setCsvError("We could not read this CSV. Try exporting it again from your banking app.");
          setCsvPhase("error");
        } else if (!result.suggestions || result.suggestions.length === 0) {
          setCsvPhase("empty");
        } else {
          setCsvSuggestions(result.suggestions);
          setCsvPhase("reviewing");
          // Archive the uploaded CSV text server-side (encrypted at rest) and
          // record the upload — no financial values are logged.
          logSecurityEventClient("csv_uploaded", { suggestionCount: result.suggestions.length });
          storeImportArchive({ source: "csv", csvText: String(csvText).slice(0, 100000) });
        }
      } catch {
        setCsvError("We could not read this CSV. Try exporting it again from your banking app.");
        setCsvPhase("error");
      }
    };
    reader.onerror = () => {
      setCsvError("We could not read this CSV. Try exporting it again from your banking app.");
      setCsvPhase("error");
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleCsvAddBill(suggestion) {
    if (!user || !db) return;
    setCsvSavingId(suggestion.id);
    setCsvError("");
    try {
      const todayIso = getTodayIso();
      const billDoc = buildBillDocument({
        name: suggestion.merchantName,
        amount: suggestion.averageAmount,
        dueDay: suggestion.usualPaymentDay,
        currency: "GBP",
      }, todayIso);
      const billRef = doc(collection(db, "users", user.uid, "bills"));
      await setDoc(billRef, {
        ...billDoc,
        source: "csv_detected",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const saved = { ...billDoc, id: billRef.id, source: "csv_detected" };
      setBills((current) => current.some((b) => b.id === saved.id) ? current : [...current, saved]);
      billsRef.current = [...(billsRef.current || []), saved];
      setCsvSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setCsvSavedCount((n) => n + 1);
      logSecurityEventClient("bill_created", { source: "csv" });
    } catch {
      setCsvError("Could not save that bill. Try again.");
    } finally {
      setCsvSavingId(null);
    }
  }

  function startCsvEdit(suggestion) {
    setCsvEditingId(suggestion.id);
    setCsvError("");
    setCsvEditForm({
      name: suggestion.merchantName,
      amount: String(suggestion.averageAmount),
      dueDay: String(suggestion.usualPaymentDay),
      category: "",
    });
  }

  async function handleCsvEditSave(suggestion) {
    if (!user || !db) return;
    const amount = parseFloat(csvEditForm.amount);
    const dueDay = parseInt(csvEditForm.dueDay, 10);
    if (!csvEditForm.name.trim() || !Number.isFinite(amount) || amount <= 0) {
      setCsvError("Enter a valid name and amount before saving.");
      return;
    }
    setCsvSavingId(suggestion.id);
    setCsvError("");
    try {
      const todayIso = getTodayIso();
      const billDoc = buildBillDocument({
        name: csvEditForm.name.trim(),
        amount,
        dueDay: isValidDueDay(dueDay) ? dueDay : null,
        currency: "GBP",
        category: csvEditForm.category || null,
      }, todayIso);
      const billRef = doc(collection(db, "users", user.uid, "bills"));
      await setDoc(billRef, {
        ...billDoc,
        source: "csv_detected",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const saved = { ...billDoc, id: billRef.id, source: "csv_detected" };
      setBills((current) => current.some((b) => b.id === saved.id) ? current : [...current, saved]);
      billsRef.current = [...(billsRef.current || []), saved];
      setCsvSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setCsvEditingId(null);
      setCsvSavedCount((n) => n + 1);
      logSecurityEventClient("bill_created", { source: "csv" });
    } catch {
      setCsvError("Could not save that bill. Try again.");
    } finally {
      setCsvSavingId(null);
    }
  }

  function resetCsv() {
    setCsvPhase("idle");
    setCsvSuggestions([]);
    setCsvIgnored(new Set());
    setCsvEditingId(null);
    setCsvSavedCount(0);
    setCsvError("");
  }

  function hasDraggedFiles(dataTransfer) {
    if (!dataTransfer) {
      return false;
    }

    return Array.from(dataTransfer.items || []).some((item) => item.kind === "file")
      || Array.from(dataTransfer.types || []).includes("Files");
  }

  function handleDragOver(event) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setDragActive(false);
  }

  function handleDrop(event) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    setDragActive(false);
    handleImportedFiles(event.dataTransfer.files);
  }

  function handlePaste(event) {
    if (importLocked) {
      return;
    }

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

  function clearImports({ preserveAssistantMessage = false } = {}) {
    setImportJobs((current) => {
      current.forEach((job) => {
        if (job.previewUrl) {
          URL.revokeObjectURL(job.previewUrl);
        }
      });

      return [];
    });
    if (!preserveAssistantMessage) {
      setAssistantMessage("");
    }
    setChatError("");
    setImportSummary(null);
    setLastImportError(null);
    setLastCompletedImportJobName(null);
    setCurrentImportJobId(null);
  }

  async function handleBillDelete(billId) {
    if (!user || !db) return;
    if (!window.confirm("Remove this bill?")) return;
    const previousBills = bills;
    setBills((current) => current.filter((bill) => bill.id !== billId));
    try {
      await deleteDoc(doc(db, "users", user.uid, "bills", billId));
      logSecurityEventClient("bill_deleted");
    } catch {
      setBills(previousBills);
      setEditError("Could not delete that bill. Try again.");
    }
  }

  async function handleBillPaidToggle(bill) {
    if (!user || !db) {
      return;
    }

    if (isPaidBill(bill)) {
      const previousPaidThroughDate = bill.paidThroughDate || null;
      const previousLastPaidAt = bill.lastPaidAt || null;

      setEditError("");
      setPageNotice(`${bill.name} reactivated.`);
      setBills((current) => current.map((entry) => (
        entry.id === bill.id
          ? { ...entry, paidThroughDate: null, lastPaidAt: null }
          : entry
      )));

      try {
        await runWithTimeout(
          setDoc(
            doc(db, "users", user.uid, "bills", bill.id),
            {
              paidThroughDate: null,
              lastPaidAt: null,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          ),
          "Saving the paid status is taking too long. Check your connection and try again.",
        );
      } catch (saveError) {
        setBills((current) => current.map((entry) => (
          entry.id === bill.id
            ? { ...entry, paidThroughDate: previousPaidThroughDate, lastPaidAt: previousLastPaidAt }
            : entry
        )));
        setPageNotice("");
        setEditError(saveError.message || "Could not reactivate that bill.");
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
    setPageNotice(`${bill.name} marked as paid.`);
    setBills((current) => current.map((entry) => (
      entry.id === bill.id
        ? { ...entry, paidThroughDate: cycleDate }
        : entry
    )));

    try {
      await runWithTimeout(
        setDoc(
          doc(db, "users", user.uid, "bills", bill.id),
          {
            paidThroughDate: cycleDate,
            lastPaidAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        ),
        "Saving the paid status is taking too long. Check your connection and try again.",
      );
    } catch (saveError) {
      setBills((current) => current.map((entry) => (
        entry.id === bill.id
          ? { ...entry, paidThroughDate: previousPaidThroughDate }
          : entry
      )));
      setPageNotice("");
      setEditError(saveError.message || "Could not mark that bill as paid.");
    }
  }

  function focusAddBillComposer() {
    setHighlightAddBillForm(true);
    setPendingSetupFocus("bills");
    window.requestAnimationFrame(() => {
      messageInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange?.(
        messageInputRef.current.value.length,
        messageInputRef.current.value.length,
      );
    });
    window.setTimeout(() => {
      setHighlightAddBillForm(false);
    }, 1800);
  }

  function handleAddMissingUtility(check) {
    if (!check) {
      return;
    }

    setQuickAddContext({
      name: check.label,
      category: "household",
    });
    setMessage(check.label);
    setAssistantMessage("");
    setChatError("");
    focusAddBillComposer();
  }

  function startBillReviewEdit(draft) {
    setEditingReviewId(draft.id);
    setBillReviewForm({
      name: draft.name || "",
      amount: draft.amount === null || draft.amount === undefined ? "" : String(draft.amount),
      dueDay: draft.dueDay === null || draft.dueDay === undefined ? "" : String(draft.dueDay),
      category: draft.category || "",
      frequency: draft.frequency || "monthly",
    });
    setChatError("");
  }

  function cancelBillReviewDraft(draftId) {
    setBillReviewDrafts((current) => current.filter((draft) => draft.id !== draftId));
    if (editingReviewId === draftId) {
      setEditingReviewId("");
    }
  }

  function saveBillReviewEdit(draftId) {
    const amount = Number(billReviewForm.amount);
    const dueDay = Number(billReviewForm.dueDay);

    if (!billReviewForm.name.trim()) {
      setChatError("Add a bill name before continuing.");
      return;
    }

    setBillReviewDrafts((current) => current.map((draft) => {
      if (draft.id !== draftId) {
        return draft;
      }

      const classified = classifyBill({ name: billReviewForm.name.trim() });

      return {
        ...draft,
        name: billReviewForm.name.trim(),
        amount: Number.isFinite(amount) && amount > 0 ? amount : null,
        dueDay: Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 ? dueDay : null,
        category: billReviewForm.category || classified.category || "other",
        frequency: billReviewForm.frequency || "monthly",
        subCategory: classified.subCategory || draft.subCategory || null,
        confidence: draft.confidence || classified.confidence || 0.6,
        missingFields: [
          ...(Number.isFinite(amount) && amount > 0 ? [] : ["amount"]),
          ...(Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 ? [] : ["dueDay"]),
        ],
      };
    }));
    setEditingReviewId("");
    setChatError("");
  }

  async function confirmBillReviewDraft(draftId) {
    if (!user) {
      return;
    }

    const draft = billReviewDrafts.find((entry) => entry.id === draftId);

    if (!draft) {
      return;
    }

    if (!draft.name?.trim()) {
      setChatError("Add a bill name before saving.");
      return;
    }

    if (!Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0) {
      setChatError("I found the bill name, but need the amount and due date.");
      startBillReviewEdit(draft);
      return;
    }

    if (!Number.isInteger(Number(draft.dueDay)) || Number(draft.dueDay) < 1 || Number(draft.dueDay) > 31) {
      setChatError("I found the bill name, but need the amount and due date.");
      startBillReviewEdit(draft);
      return;
    }

    setSubmitting(true);
    setChatError("");

    try {
      const parsedDraft = {
        action: "create_bill",
        name: draft.name,
        amount: Number(draft.amount),
        dueDay: Number(draft.dueDay),
        frequency: draft.frequency || "monthly",
        currency: "GBP",
        category: draft.category || null,
        rawText: draft.sourceText || null,
      };
      const outcome = await applyParsedActions(user.uid, parsedDraft, Boolean(displayIncome), billsRef.current || bills);

      if (outcome.savedBills?.length) {
        setBills((current) => {
          const next = [...current];
          outcome.savedBills.forEach((savedBill) => {
            if (!next.some((existingBill) => existingBill.id === savedBill.id)) {
              next.push(savedBill);
            }
          });
          return next;
        });
        billsRef.current = mergeOutcomeBills(billsRef.current || bills, {
          action: "batch",
          items: outcome.savedBills.map((savedBill) => ({
            action: "create_bill",
            ...savedBill,
          })),
        });
      }

      cancelBillReviewDraft(draftId);
      setAssistantMessage(`Added ${draft.name}.`);

      const remainingDrafts = billReviewDrafts.filter((entry) => entry.id !== draftId);
      if (remainingDrafts.length === 0) {
        setMessage("");
        setQuickAddContext(null);
        setVoiceMessage("");
        transcriptRef.current = "";
        clearImports({ preserveAssistantMessage: true });
      }
    } catch (saveError) {
      setChatError(saveError.message || "Could not save that bill yet.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBulkDelete() {
    if (!user || !db || selectedBillIds.size === 0) return;
    const count = selectedBillIds.size;
    if (!window.confirm(`Delete ${count} selected bill${count === 1 ? "" : "s"}?`)) return;
    const previousBills = bills;
    setBills((current) => current.filter((bill) => !selectedBillIds.has(bill.id)));
    try {
      const batch = writeBatch(db);
      selectedBillIds.forEach((billId) => {
        batch.delete(doc(db, "users", user.uid, "bills", billId));
      });
      await batch.commit();
      logSecurityEventClient("bill_deleted", { count });
      setSelectedBillIds(new Set());
      setSelectMode(false);
    } catch {
      setBills(previousBills);
      setEditError("Could not delete the selected bills. Try again.");
    }
  }

  function handleSetupDismiss() {
    localStorage.setItem("cleartill_setup_dismissed", "true");
    setSetupDismissed(true);
  }

  function resetLargeCostForm() {
    setLargeCostForm({
      name: "",
      amount: "",
      amountAlreadySaved: "",
      dueDate: "",
      frequency: "one_off",
      category: "other",
      fundingStatus: "unassigned",
    });
    setEditingLargeCostId("");
    setLargeCostError("");
    setShowLargeCostForm(false);
  }

  function startLargeCostCreate() {
    setLargeCostError("");
    setEditingLargeCostId("");
    setLargeCostForm({
      name: "",
      amount: "",
      amountAlreadySaved: "",
      dueDate: todayIso,
      frequency: "one_off",
      category: "other",
      fundingStatus: "unassigned",
    });
    setShowLargeCostForm(true);
  }

  function startLargeCostEdit(cost) {
    setLargeCostError("");
    setEditingLargeCostId(cost.id);
    setLargeCostForm({
      name: cost.name || "",
      amount: cost.amount?.toString() || "",
      amountAlreadySaved: cost.amountAlreadySaved?.toString() || "",
      dueDate: cost.dueDate || todayIso,
      frequency: cost.frequency || "one_off",
      category: cost.category || "other",
      fundingStatus: normaliseLargeCostFundingStatus(cost.fundingStatus),
    });
    setShowLargeCostForm(true);
  }

  async function handleLargeCostSave(event) {
    event.preventDefault();

    if (!user || !db) {
      return;
    }

    const amount = Number(largeCostForm.amount);
    const amountAlreadySaved = Number(largeCostForm.amountAlreadySaved || 0);

    if (!largeCostForm.name.trim() || !Number.isFinite(amount) || amount <= 0 || !largeCostForm.dueDate) {
      setLargeCostError("Add a name, amount, and due date before saving.");
      return;
    }
    if (!Number.isFinite(amountAlreadySaved) || amountAlreadySaved < 0) {
      setLargeCostError("Amount already saved must be zero or more.");
      return;
    }

    setSavingLargeCost(true);
    setLargeCostError("");

    try {
      const costId = editingLargeCostId || doc(collection(db, "users", user.uid, "largeCosts")).id;
      const payload = {
        ...buildLargeCostDocument({
          name: largeCostForm.name.trim(),
          amount,
          amountAlreadySaved,
          dueDate: largeCostForm.dueDate,
          frequency: largeCostForm.frequency,
          category: largeCostForm.category,
          fundingStatus: largeCostForm.fundingStatus,
          currency: "GBP",
        }, todayIso),
        updatedAt: serverTimestamp(),
        ...(editingLargeCostId ? {} : { createdAt: serverTimestamp() }),
      };

      await runWithTimeout(
        setDoc(doc(db, "users", user.uid, "largeCosts", costId), payload, { merge: true }),
        "Saving that large cost is taking too long. Check your connection and try again.",
      );
      setPageNotice(editingLargeCostId ? "Large cost updated." : "Large cost added.");
      resetLargeCostForm();
    } catch (saveError) {
      safeError("[firestore-large-cost-save] failed", { code: saveError?.code });
      setLargeCostError(saveError.message || "Could not save that large cost.");
    } finally {
      setSavingLargeCost(false);
    }
  }

  async function handleLargeCostDelete(costId) {
    if (!user || !db) return;
    if (!window.confirm("Remove this large cost?")) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "largeCosts", costId));
      if (editingLargeCostId === costId) {
        resetLargeCostForm();
      }
    } catch {
      setLargeCostError("Could not delete that large cost. Try again.");
    }
  }

  function openFundingEditor(cost) {
    setFundingEditorCostId(cost.id);
    setFundingEditorForm({
      fundingStatus: normaliseLargeCostFundingStatus(cost.fundingStatus),
      savingsAmount: String(cost.amountAlreadySaved ?? ""),
    });
  }

  function closeFundingEditor() {
    setFundingEditorCostId("");
    setFundingEditorForm({ fundingStatus: "unassigned", savingsAmount: "" });
  }

  async function saveFundingEditor(cost) {
    if (!user || !db) return;

    const amount = Number(cost.amount) || 0;
    const fundingStatus = normaliseLargeCostFundingStatus(fundingEditorForm.fundingStatus);
    let amountAlreadySaved = 0;

    if (fundingStatus === "savings") {
      amountAlreadySaved = amount;
    } else if (fundingStatus === "split") {
      amountAlreadySaved = Number(fundingEditorForm.savingsAmount || 0);
      if (!Number.isFinite(amountAlreadySaved) || amountAlreadySaved < 0 || amountAlreadySaved > amount) {
        setLargeCostError("Savings amount must be between 0 and the total cost.");
        return;
      }
    }

    setLargeCostError("");

    try {
      await setDoc(doc(db, "users", user.uid, "largeCosts", cost.id), {
        fundingStatus,
        amountAlreadySaved,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      closeFundingEditor();
    } catch {
      setLargeCostError("Could not update how that cost is funded. Try again.");
    }
  }

  async function handleSavingsSave(event) {
    event.preventDefault();

    if (!user || !db) {
      return;
    }

    const totalSetAside = Number(savingsInput || 0);

    if (!Number.isFinite(totalSetAside) || totalSetAside < 0) {
      setSavingsError("Savings not assigned to a big cost must be zero or more.");
      return;
    }

    setSavingSavings(true);
    setSavingsError("");

    try {
      await runWithTimeout(
        setDoc(doc(db, "users", user.uid, "settings", "savings"), {
          totalSetAside,
          updatedAt: serverTimestamp(),
          ...(savings?.id ? {} : { createdAt: serverTimestamp() }),
        }, { merge: true }),
        "Saving your extra savings is taking too long. Check your connection and try again.",
      );
      setPageNotice("Savings not assigned to a big cost updated.");
    } catch (saveError) {
      setSavingsError(saveError.message || "Could not save your extra savings.");
    } finally {
      setSavingSavings(false);
    }
  }

  function focusBalanceSnapshotForm() {
    balanceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightBalanceForm(true);
    window.setTimeout(() => {
      balanceInputRef.current?.focus();
      balanceInputRef.current?.select?.();
    }, 180);
    window.setTimeout(() => {
      setHighlightBalanceForm(false);
    }, 1800);
  }

  function focusPaydayForm() {
    setEditingIncome(true);
    paydaySettingsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightPaydayForm(true);
    setPendingSetupFocus("payday-settings");
    window.setTimeout(() => {
      setHighlightPaydayForm(false);
    }, 1800);
  }

  useEffect(() => {
    if (pendingSetupFocus === "payday-settings" && editingIncome && forecastPaydayAmountInputRef.current) {
      forecastPaydayAmountInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      forecastPaydayAmountInputRef.current.focus();
      forecastPaydayAmountInputRef.current.select?.();
      setPendingSetupFocus("");
      return;
    }

    if (pendingSetupFocus === "bills" && messageInputRef.current) {
      messageInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      messageInputRef.current.focus();
      messageInputRef.current.setSelectionRange?.(
        messageInputRef.current.value.length,
        messageInputRef.current.value.length,
      );
      setPendingSetupFocus("");
    }
  }, [editingIncome, pendingSetupFocus]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const focus = params.get("focus");
    const checkout = params.get("checkout");

    if (focus === "balance") {
      window.setTimeout(() => {
        focusBalanceSnapshotForm();
      }, 150);
    }

    if (checkout === "success") {
      setPageNotice("Your 7-day ClearTill trial has started. Stripe charged £0 today, will bill £1.99 after 7 days, then continue monthly unless you cancel.");
      void trackClientAnalyticsEvent("trial_checkout_completed", { source: "stripe_redirect" });
    }

    if (checkout === "cancelled") {
      setPageNotice("Your trial has not started yet. Your result is still here when you're ready.");
    }
  }, []);

  function showOnboardingHelper(target) {
    const nextHelper = getOnboardingHelperContent(target);
    setOnboardingHelper(nextHelper);

    if (onboardingHelperTimeoutRef.current) {
      window.clearTimeout(onboardingHelperTimeoutRef.current);
    }

    onboardingHelperTimeoutRef.current = window.setTimeout(() => {
      setOnboardingHelper((current) => (current?.target === target ? null : current));
      onboardingHelperTimeoutRef.current = null;
    }, 7000);
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

  if (entryIntent === "trial") {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Opening your secure 7-day free trial…</h1>
          {billingError || authError ? (
            <>
              <p className="error" aria-live="polite">{billingError || authError}</p>
              <div className="auth-button-row">
                <button className="primary-button" type="button" onClick={handleRetryTrialCheckout} disabled={billingBusy || signingIn}>
                  {billingBusy ? "Opening checkout…" : "Try opening checkout again"}
                </button>
                <Link className="secondary-button" href="/">Return to homepage</Link>
              </div>
            </>
          ) : (
            <p className="helper-text" aria-live="polite">
              {authError || "Stripe will securely collect your email and card details. £0 is charged today."}
            </p>
          )}
        </section>
      </main>
    );
  }

  if (!authReady) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Loading your pay-date forecast…</h1>
        </section>
      </main>
    );
  }

  if (!isFirebaseClientConfigured) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
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

  if (!user || shouldShowDirectAuth) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>{shouldUseDirectAuthEntry ? "Create your ClearTill account" : "Preparing your free pay-date forecast…"}</h1>
          <p>
            {shouldUseDirectAuthEntry
              ? "Save your result, then continue to Stripe to enter your card. You pay £0 today, then £1.99 after 7 days and monthly after that unless you cancel."
              : "ClearTill is opening a private guest session so you can see your first result before any payment step."}
          </p>
          <TrustShield className="auth-trust-banner" compact />
          {authError ? (
            <>
              {!shouldUseDirectAuthEntry ? <p className="error">{authError}</p> : null}
              {!shouldUseDirectAuthEntry ? (
                <button className="secondary-button" type="button" onClick={handleSignIn} disabled={signingIn}>
                  Try guest access again
                </button>
              ) : null}
              {shouldShowGuestFallback ? (
                <div className="auth-panel auth-panel-inline" style={{ marginTop: "16px" }}>
                  <p>
                    {shouldUseDirectAuthEntry
                      ? "Use Google or email to create your account and carry on to your free trial."
                      : "Guest access is unavailable right now. Continue with Google or email so you can still get your first ClearTill result."}
                  </p>
                  <button className="primary-button" type="button" onClick={handleGoogleSignIn} disabled={signingIn}>
                    {signingIn ? "Opening Google..." : "Continue with Google"}
                  </button>
                  <div className="auth-divider" aria-hidden="true"><span>or</span></div>
                  <div className="auth-mode-row">
                    <button
                      className={`secondary-button${authMode === "signin" ? " is-active" : ""}`}
                      type="button"
                      onClick={() => setAuthMode("signin")}
                      disabled={signingIn}
                    >
                      Sign in with email
                    </button>
                    <button
                      className={`secondary-button${authMode === "signup" ? " is-active" : ""}`}
                      type="button"
                      onClick={() => setAuthMode("signup")}
                      disabled={signingIn}
                    >
                      Create account
                    </button>
                  </div>
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
                        {signingIn ? "Continuing..." : authMode === "signup" ? "Create account to continue" : "Continue with email"}
                      </button>
                    </div>
                  </form>
                  {shouldUseDirectAuthEntry ? <p className="error">{authError}</p> : null}
                </div>
              ) : null}
            </>
          ) : (
            shouldShowGuestFallback ? (
              <div className="auth-panel auth-panel-inline" style={{ marginTop: "16px" }}>
                <p>
                  {entryIntent === "trial"
                    ? "Create your account first, then Stripe will securely collect your card for the free 7-day trial."
                    : "Continue with Google or email to get into ClearTill."}
                </p>
                <button className="primary-button" type="button" onClick={handleGoogleSignIn} disabled={signingIn}>
                  {signingIn ? "Opening Google..." : "Continue with Google"}
                </button>
                <div className="auth-divider" aria-hidden="true"><span>or</span></div>
                <div className="auth-mode-row">
                  <button
                    className={`secondary-button${authMode === "signin" ? " is-active" : ""}`}
                    type="button"
                    onClick={() => setAuthMode("signin")}
                    disabled={signingIn}
                  >
                    Sign in with email
                  </button>
                  <button
                    className={`secondary-button${authMode === "signup" ? " is-active" : ""}`}
                    type="button"
                    onClick={() => setAuthMode("signup")}
                    disabled={signingIn}
                  >
                    Create account
                  </button>
                </div>
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
                      {signingIn ? "Continuing..." : authMode === "signup" ? "Create account to continue" : "Continue with email"}
                    </button>
                  </div>
                </form>
                {authError ? <p className="error">{authError}</p> : null}
              </div>
            ) : (
              <p className="helper-text">{signingIn ? "Starting secure guest access…" : "One moment…"}</p>
            )
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand">Your pay-date heads-up for bills.</h1>
        </div>
        <div className="topbar-actions">
          <span className="user-id">
            {user?.isAnonymous
              ? "Guest session"
              : user?.displayName || user?.email || "Signed in"}
          </span>
          {user?.isAnonymous && !showTrialAccountForm ? (
            <button className="secondary-button" type="button" onClick={handleGoogleSignIn} disabled={signingIn}>
              Save with Google
            </button>
          ) : null}
          {billingEntitlement?.canManageSubscription ? (
            <button className="secondary-button" type="button" onClick={handleManageSubscription} disabled={billingBusy}>
              Manage subscription
            </button>
          ) : null}
          <Link className="secondary-button" href="/account">Account</Link>
        </div>
      </header>

      {pageNotice ? (
        <section className="page-notice" aria-live="polite">
          {pageNotice}
        </section>
      ) : null}

      {user?.isAnonymous ? (
        <section className="setup-card" id="save-access" aria-labelledby="save-access-title">
          <div className="setup-progress">
            <div>
              <p className="eyebrow">Keep your ClearTill access</p>
              <h2 id="save-access-title">Save your access so you can return on another device.</h2>
              <p className="helper-text">Your current data and subscription stay on this same ClearTill profile.</p>
            </div>
          </div>
          <div className="auth-panel auth-panel-inline">
            <button className="primary-button" type="button" onClick={handleGoogleSignIn} disabled={signingIn}>
              {signingIn ? "Saving…" : "Continue with Google"}
            </button>
            <div className="auth-divider" aria-hidden="true"><span>or</span></div>
            <form className="auth-email-form" onSubmit={handleEmailAuth}>
              <input
                type="email"
                value={emailForm.email}
                onChange={(event) => setEmailForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="Email"
                autoComplete="email"
                disabled={signingIn}
              />
              <input
                type="password"
                value={emailForm.password}
                onChange={(event) => setEmailForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Create a password"
                autoComplete="new-password"
                disabled={signingIn}
              />
              <button className="secondary-button" type="submit" disabled={signingIn}>
                {signingIn ? "Saving…" : "Create email account"}
              </button>
            </form>
            {authError ? <p className="error">{authError}</p> : null}
          </div>
        </section>
      ) : null}

      {showSetupCard ? (
        <section className="setup-card">
          <div className="setup-progress">
            <div>
              <p className="eyebrow">Setup</p>
              <h2>{setupMessage.title}</h2>
              <p className="helper-text">{setupMessage.detail}</p>
              <TrustShield className="setup-trust-banner" compact showTitle={false} />
            </div>
            <div className="setup-chip-row" aria-label="Setup progress">
              <button className={`setup-chip ${getSetupChipState(1, setupStep)}`} type="button" onClick={focusBalanceSnapshotForm}>
                <span>{setupStep > 1 ? "✓" : "1"}</span> Money
              </button>
              <button className={`setup-chip ${getSetupChipState(2, setupStep)}`} type="button" onClick={focusPaydayForm}>
                <span>{setupStep > 2 ? "✓" : "2"}</span> Pay date
              </button>
              <button className={`setup-chip ${getSetupChipState(3, setupStep)}`} type="button" onClick={focusAddBillComposer}>
                <span>{setupStep > 3 ? "✓" : "3"}</span> Bills
              </button>
            </div>
          </div>
          <div className="setup-cta-row">
            {setupStep === 1 ? <button className="primary-button" type="button" onClick={focusBalanceSnapshotForm}>Add current available money</button> : null}
            {setupStep === 2 ? <button className="primary-button" type="button" onClick={focusPaydayForm}>Add pay date</button> : null}
            {setupStep === 3 ? <button className="primary-button" type="button" onClick={focusAddBillComposer}>Add bills</button> : null}
            {setupStep === 4 ? (
              <>
                <button className="secondary-button" type="button" onClick={focusBalanceSnapshotForm}>Update snapshot</button>
                <button className="primary-button" type="button" onClick={focusAddBillComposer}>Add another bill</button>
                <button className="secondary-button small-button setup-dismiss" type="button" onClick={handleSetupDismiss}>
                  Dismiss
                </button>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <HeroCard
        status={clearTillStatus}
        headline={(() => {
          if (!hasBalanceSnapshot) return "Add your current available money to get started";
          if (spendingRoomUntilPayday === null) return "Set your pay date to get started";
          if (clearTillStatus === "negative") return `Not clear yet: ${formatCurrency(Math.abs(spendingRoomUntilPayday), displayCurrency)} still needed before payday`;
          return `You're clear: ${formatCurrency(spendingRoomUntilPayday, displayCurrency)} left till payday`;
        })()}
        subLine={(() => {
          if (!(hasBalanceSnapshot && hasPayday)) return null;
          if (spendingRoomUntilPayday === null) return null;
          if (spendingRoomUntilPayday < 0) {
            return totalProtectedSavings > 0
              ? "Your savings now could cover this, but ClearTill does not count savings as daily spending money."
              : "You need to use savings or find another way to fund this before payday.";
          }
          if (dailySpendingRoom === null) return null;
          return `Due before payday: ${formatCurrency(dashboard.totalBeforePayday + bigCostsDueBeforePayday, displayCurrency)}. Safe weekly position: about ${formatCurrency(weeklySafePosition || 0, displayCurrency)}/week until ${formatDisplayDate(dashboard.paydayDate)}.`;
        })()}
        onUpdateBalance={focusBalanceSnapshotForm}
        trustLine="ClearTill Trust: No bank login • No Open Banking • You control your data"
        trustNote="Sensitive import data encrypted where supported."
      />

      {shouldShowTrialOffer ? (
        <section className="setup-card" aria-live="polite">
          <div className="setup-progress">
            <div>
              <p className="eyebrow">Subscription trial</p>
              <h2>{billingConfig.offerHeadline}</h2>
              <p className="helper-text">{billingConfig.offerCopy}</p>
              <p className="helper-text">
                You&apos;ve seen your first personalised result. Continue only if you want the 7-day free trial, then £1.99 after the free week and monthly after that.
              </p>
              <p className="helper-text">
                {billingConfig.checkoutCommitmentCopy}
              </p>
            </div>
            <div className="setup-chip-row" aria-label="Trial steps">
              <span className="setup-chip is-done"><span>1</span> Result</span>
              <span className="setup-chip is-current"><span>2</span> Trial</span>
              <span className="setup-chip"><span>3</span> Billing</span>
            </div>
          </div>
          <div className="setup-cta-row">
            <button className="primary-button" type="button" onClick={handleStartTrialCheckout} disabled={billingBusy}>
              {billingBusy ? "Opening Stripe..." : "Start 7-day free trial"}
            </button>
            {user?.isAnonymous ? (
              <button className="secondary-button" type="button" onClick={() => setShowTrialAccountForm((current) => !current)} disabled={billingBusy}>
                {showTrialAccountForm ? "Hide sign-in options" : "Save my result first"}
              </button>
            ) : null}
          </div>
          {showTrialAccountForm ? (
            <div className="auth-panel" style={{ marginTop: "16px" }}>
              <p>Save this result with Google or email first, then we&apos;ll send you to Stripe Checkout to start the 7-day free trial and confirm £1.99 after that, then monthly.</p>
              <button className="primary-button" type="button" onClick={handleGoogleSignIn} disabled={signingIn || billingBusy}>
                {signingIn ? "Saving..." : "Save with Google"}
              </button>
              <div className="auth-divider" aria-hidden="true"><span>or</span></div>
              <form className="auth-email-form" onSubmit={handleEmailAuth}>
                <input
                  type="email"
                  value={emailForm.email}
                  onChange={(e) => setEmailForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="Email"
                  autoComplete="email"
                  disabled={signingIn || billingBusy}
                />
                <input
                  type="password"
                  value={emailForm.password}
                  onChange={(e) => setEmailForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Password"
                  autoComplete="new-password"
                  disabled={signingIn || billingBusy}
                />
                <div className="auth-button-row">
                  <button className="primary-button" type="submit" disabled={signingIn || billingBusy}>
                    Save my result
                  </button>
                </div>
              </form>
            </div>
          ) : null}
          {billingError ? <p className="error">{billingError}</p> : null}
        </section>
      ) : null}

      {hasPremiumAccess && billingEntitlement?.canManageSubscription ? (
        <section className="page-notice" aria-live="polite">
          {billingEntitlement.subscriptionStatus === "trialing" ? "Trial active." : "Subscription active."}
          {" "}
          {billingEntitlement.trialEnd
            ? `First payment on ${formatDisplayDate(new Date(billingEntitlement.trialEnd).toISOString().slice(0, 10))}.`
            : billingEntitlement.currentPeriodEnd
              ? `Renews on ${formatDisplayDate(new Date(billingEntitlement.currentPeriodEnd).toISOString().slice(0, 10))}.`
              : "Renewal date will appear here once Stripe confirms it."}
          {" "}
          {billingConfig.monthlyPriceDisplay}/month. Cancel anytime in Manage subscription.
        </section>
      ) : null}

      <div className="stat-chip-row">
        <span className="stat-chip">
          <strong>{hasBalanceSnapshot ? formatCurrency(dashboard.currentBalance, displayCurrency) : "—"}</strong>
          {" in account"}
        </span>
        <span className="stat-chip">
          <strong>{hasBalanceSnapshot && hasPayday ? formatCurrency(dashboard.totalBeforePayday, displayCurrency) : "—"}</strong>
          {" bills before payday"}
        </span>
        <span className="stat-chip">
          {"Pay date "}
          <strong>{dashboard.paydayDate ? formatDisplayDate(dashboard.paydayDate) : "not set"}</strong>
        </span>
        {hasBills ? (
          <span className="stat-chip">
            <strong>{formatCurrency(totalMonthlyBills, displayCurrency)}</strong>
            {" total monthly bills"}
          </span>
        ) : null}
        <span className="stat-chip">
          {"Today "}
          <strong>{formatDisplayDate(todayIso)}</strong>
        </span>
      </div>

      <section className="content-grid">
        <div className="stack">
          <section
            ref={balanceSectionRef}
            className={`chat-panel balance-action-card ${setupStep !== 1 ? "" : "setup-current"} ${highlightBalanceForm ? "form-highlight" : ""}`}
          >
            <div className="section-head">
              <div>
                <h2 style={{ margin: 0 }}>Current available money</h2>
                <p className="helper-text balance-copy">Update this when your cash position changes. ClearTill uses it to work out what is still safe to spend until payday.</p>
              </div>
            </div>
            <p className="balance-action-value">
              {hasBalanceSnapshot ? formatCurrency(dashboard.currentBalance, displayCurrency) : BALANCE_MISSING_FORECAST_COPY}
            </p>
            <form className="chat-form" onSubmit={handleBalanceSave}>
              <div className="field-row">
                <label className="field-label" htmlFor="account-balance">
                  Current available money
                </label>
                <div className="chat-input-row">
                  <input
                    ref={balanceInputRef}
                    id="account-balance"
                    inputMode="decimal"
                    value={balanceInput}
                    disabled={importLocked}
                    onChange={(event) => setBalanceInput(event.target.value)}
                    placeholder="Current available money"
                  />
                  <button className="secondary-button" type="submit" disabled={importLocked}>
                    Update
                  </button>
                </div>
              </div>
            </form>
            <p className="helper-text balance-copy" style={{ marginTop: "8px" }}>{BALANCE_HELPER_TEXT}</p>
            <button className="secondary-button small-button" type="button" onClick={handleSkipBalance} disabled={importLocked} style={{ marginTop: "8px" }}>
              Skip for now
            </button>
            {hasBalanceSnapshot ? (
              <div className="helper-text balance-copy">
                <p>{balanceSnapshotLabel}</p>
                <p>Still around {formatCurrency(dashboard.currentBalance, displayCurrency)}? Update it whenever that changes.</p>
              </div>
            ) : (
              <p className="helper-text balance-copy">
                {BALANCE_MISSING_FORECAST_COPY}
              </p>
            )}
            {!hasBalanceSnapshot ? (
              <p className="helper-text balance-copy">
                Add your current available money later for a more accurate forecast.
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

          <section
            id="payday-settings"
            ref={paydaySettingsSectionRef}
            className={`runway-panel forecast-focus-card ${(!hasBalanceSnapshot || (!hasPayday && !editingIncome)) ? "is-disabled-soft" : ""} ${highlightPaydayForm ? "form-highlight" : ""}`}
          >
            {onboardingHelper?.target === "payday" ? (
              <div className="onboarding-helper-card" role="status" aria-live="polite">
                <div className="onboarding-helper-copy">
                  <strong>{onboardingHelper.title}</strong>
                  <span>{onboardingHelper.detail}</span>
                </div>
                <button className="onboarding-helper-dismiss" type="button" onClick={() => setOnboardingHelper(null)}>
                  Got it
                </button>
              </div>
            ) : null}
            <div className="section-head">
              <div>
                <h2 style={{ margin: 0 }}>Spending room until payday</h2>
                <p className="helper-text">This uses current available money only, after bills and large costs due before payday.</p>
              </div>
            </div>
            <div className="forecast-header">
              <div>
                <span className="forecast-label">Pay-date countdown</span>
                <p className="forecast-countdown">{paydayCountdownLabel}</p>
                <div className="forecast-meta-list">
                  <span className="forecast-meta-chip">Pay date: <strong>{dashboard.paydayDate ? formatDisplayDate(dashboard.paydayDate) : "Not set"}</strong></span>
                  <span className="forecast-meta-chip">Expected pay: <strong>{hasIncomeAmount ? formatCurrency(Number(displayIncome.amount), displayCurrency) : "Not set"}</strong></span>
                </div>
                <button
                  className="secondary-button small-button forecast-settings-button"
                  type="button"
                  disabled={importLocked}
                  onClick={() => setEditingIncome((current) => !current)}
                >
                  {editingIncome ? "Close forecast settings" : "Edit forecast settings"}
                </button>
              </div>
              <div className={`forecast-total-block${spendingRoomUntilPayday !== null && spendingRoomUntilPayday < 0 ? " is-negative" : ""}`}>
                <span className="forecast-label">Spending room</span>
                <p className="forecast-summary-headline">
                  {spendingRoomSummary}
                </p>
                <p className="forecast-support">{spendingRoomHelper}</p>
                {spendingRoomUntilPayday !== null && spendingRoomUntilPayday < 0 && bigCostsDueBeforePayday > 0 ? (
                  <Link className="secondary-button small-button forecast-review-button" href="/big-costs">
                    Review big costs
                  </Link>
                ) : null}
              </div>
            </div>
            {editingIncome ? (
              <form className="edit-form forecast-settings-drawer" onSubmit={handleIncomeSave}>
                <label className="field-label" htmlFor="forecast-payday-amount">Expected pay</label>
                <input
                  ref={forecastPaydayAmountInputRef}
                  id="forecast-payday-amount"
                  inputMode="decimal"
                  disabled={importLocked}
                  value={incomeForm.amount}
                  onChange={(event) => setIncomeForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="Monthly income"
                />
                <label className="field-label" htmlFor="forecast-payday-day">Pay date</label>
                <input
                  id="forecast-payday-day"
                  inputMode="numeric"
                  disabled={importLocked}
                  value={incomeForm.payDay}
                  onChange={(event) => setIncomeForm((current) => ({ ...current, payDay: event.target.value }))}
                  placeholder="Day of month"
                />
                <div className="edit-actions">
                  <button className="primary-button small-button" type="submit" disabled={savingEdit || importLocked}>
                    {savingEdit ? "Saving..." : "Save forecast settings"}
                  </button>
                </div>
              </form>
            ) : null}
            <div className="forecast-breakdown">
              <h3>Explain this number</h3>
              <div className="forecast-breakdown-list">
                <div className="forecast-breakdown-row">
                  <span>Current available money</span>
                  <strong>{hasBalanceSnapshot ? formatCurrency(dashboard.currentBalance, displayCurrency) : "—"}</strong>
                </div>
                <div className="forecast-breakdown-row">
                  <span>Less bills before payday</span>
                  <strong>-{hasPayday ? formatCurrency(dashboard.totalBeforePayday, displayCurrency) : "—"}</strong>
                </div>
                <div className="forecast-breakdown-row">
                  <span>Big costs hitting current account</span>
                  <strong>-{hasPayday ? formatCurrency(bigCostsDueBeforePayday, displayCurrency) : "—"}</strong>
                </div>
                <div className="forecast-breakdown-row total">
                  <span>Spending room until payday</span>
                  <strong>{spendingRoomValue}</strong>
                </div>
              </div>
              <ProtectedSavingsEditor
                value={savingsInput}
                onChange={setSavingsInput}
                onSave={handleSavingsSave}
                saving={savingSavings}
                error={savingsError}
                displayCurrency={displayCurrency}
                protectedTotal={largeCostImpact.totalProtectedSavings}
                generalSavings={generalProtectedSavings}
                assignedSavings={largeCostImpact.totalCostSpecificSaved}
                assignedSavingsByCost={largeCostImpact.costs}
                bigCostsCoveredBySavings={largeCostImpact.bigCostsCoveredBySavings}
                fallbackCopy={spendingRoomFallbackCopy}
              />
            </div>
            <ForecastLargeCostsSection
              costs={dueBeforePaydayLargeCosts}
              allCosts={largeCostsWithStatus}
              displayCurrency={displayCurrency}
              showForm={showLargeCostForm}
              editingId={editingLargeCostId}
              form={largeCostForm}
              onFormChange={setLargeCostForm}
              onStartAdd={startLargeCostCreate}
              onEditStart={startLargeCostEdit}
              onCancel={resetLargeCostForm}
              onSave={handleLargeCostSave}
              onDelete={handleLargeCostDelete}
              saving={savingLargeCost}
              error={largeCostError}
              hasPayday={hasPayday}
              unassignedAmount={unassignedCostsBeforePayday}
              fundingEditorCostId={fundingEditorCostId}
              fundingEditorForm={fundingEditorForm}
              onFundingEditorChange={setFundingEditorForm}
              onFundingEditorOpen={openFundingEditor}
              onFundingEditorClose={closeFundingEditor}
              onFundingEditorSave={saveFundingEditor}
            />
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
              <p className="empty">No reminders yet — ClearTill will show upcoming due bills here.</p>
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
          <section
            ref={paydaySectionRef}
            className={`bill-section ${!hasBalanceSnapshot ? "is-disabled-soft" : ""} ${highlightPaydayForm ? "form-highlight" : ""}`}
          >
            <div className="section-head">
              <h3>Pay date</h3>
              <button
                className="secondary-button small-button"
                type="button"
                disabled={importLocked}
                onClick={() => {
                  if (editingIncome) {
                    setEditingIncome(false);
                    return;
                  }

                  focusPaydayForm();
                }}
              >
                {editingIncome ? "Cancel" : income ? "Edit" : "Set"}
              </button>
            </div>
            {editingIncome ? (
              <form className="edit-form" onSubmit={handleIncomeSave}>
                <label className="field-label" htmlFor="payday-amount">Amount</label>
                <input
                  ref={paydayAmountInputRef}
                  id="payday-amount"
                  inputMode="decimal"
                  disabled={importLocked}
                  value={incomeForm.amount}
                  onChange={(event) => setIncomeForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="Monthly income"
                />
                <label className="field-label" htmlFor="payday-day">Pay date</label>
                <input
                  ref={paydayDayInputRef}
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
                  <p className="helper-text helper-tooltip">Add pay date</p>
                ) : null}
                {displayIncome && hasPayday && !hasIncomeAmount ? (
                  <p className="helper-text helper-tooltip">Add income amount if you want ClearTill to show monthly spending room.</p>
                ) : null}
              </>
            )}
            {!hasBalanceSnapshot ? (
              <p className="helper-text helper-tooltip">
                Add your current available money first so ClearTill can forecast what may be left.
              </p>
            ) : null}
          </section>
          {hasBills ? (
            <div className="bill-filter-tabs">
              {[
                { key: "all", label: "All" },
                ...(dashboard.paydayDate ? [{ key: "before", label: "Before payday" }, { key: "after", label: "After payday" }] : []),
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
              {pagedBeforeGroup.length > 0 ? (
                <BillGroup
                  title="Before payday"
                  bills={pagedBeforeGroup}
                  editingBillId={editingBillId}
                  editingBillForm={editingBillForm}
                  onBillFormChange={setEditingBillForm}
                  onEditStart={startBillEdit}
                  onEditCancel={cancelBillEdit}
                  onEditSave={handleBillEditSave}
                  savingEdit={savingEdit}
                  importLocked={importLocked}
                  onDelete={handleBillDelete}
                  onMarkPaid={handleBillPaidToggle}
                  selectMode={selectMode}
                  selectedBillIds={selectedBillIds}
                  onToggleSelect={(id) => setSelectedBillIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                  displayCurrency={displayCurrency}
                />
              ) : null}
              {pagedAfterGroup.length > 0 ? (
                <BillGroup
                  title="After payday"
                  bills={pagedAfterGroup}
                  editingBillId={editingBillId}
                  editingBillForm={editingBillForm}
                  onBillFormChange={setEditingBillForm}
                  onEditStart={startBillEdit}
                  onEditCancel={cancelBillEdit}
                  onEditSave={handleBillEditSave}
                  savingEdit={savingEdit}
                  importLocked={importLocked}
                  onDelete={handleBillDelete}
                  onMarkPaid={handleBillPaidToggle}
                  selectMode={selectMode}
                  selectedBillIds={selectedBillIds}
                  onToggleSelect={(id) => setSelectedBillIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                  displayCurrency={displayCurrency}
                />
              ) : null}
              {pagedBills.length === 0 ? <p className="empty">No bills on this page.</p> : null}
            </>
          ) : (
            <BillGroup
              title={
                billListFilter === "before" ? "Before payday"
                : billListFilter === "after" ? "After payday"
                : billListFilter === "recent" ? "Recently added"
                : billListFilter === "paid" ? "Paid bills"
                : "All bills"
              }
              bills={pagedBills}
              editingBillId={editingBillId}
              editingBillForm={editingBillForm}
              onBillFormChange={setEditingBillForm}
              onEditStart={startBillEdit}
              onEditCancel={cancelBillEdit}
              onEditSave={handleBillEditSave}
              savingEdit={savingEdit}
              importLocked={importLocked}
              onDelete={handleBillDelete}
              onMarkPaid={handleBillPaidToggle}
              selectMode={selectMode}
              selectedBillIds={selectedBillIds}
              onToggleSelect={(id) => setSelectedBillIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
              displayCurrency={displayCurrency}
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

          {editingIncome || editingBillId ? (editError ? <p className="error">{editError}</p> : null) : null}

          {/* Add bills — unified card: type, speak, or upload (CSV/image) */}
          <section
            ref={addBillSectionRef}
            className={`chat-panel add-bills-card ${setupStep === 3 ? "setup-current" : ""} ${!hasBalanceSnapshot ? "is-disabled-soft" : ""} ${highlightAddBillForm ? "form-highlight" : ""} ${dragActive ? "is-dragging" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {onboardingHelper?.target === "bills" ? (
              <div className="onboarding-helper-card" role="status" aria-live="polite">
                <div className="onboarding-helper-copy">
                  <strong>{onboardingHelper.title}</strong>
                  <span>{onboardingHelper.detail}</span>
                </div>
                <button className="onboarding-helper-dismiss" type="button" onClick={() => setOnboardingHelper(null)}>
                  Got it
                </button>
              </div>
            ) : null}
            <h2>Add bills</h2>
            {!hasBalanceSnapshot || !hasPayday ? (
              <p className="helper-text helper-tooltip">
                {!hasBalanceSnapshot
                  ? "Bills can be added now, but the forecast works best after balance and payday are set."
                  : "You can add bills now, but ClearTill needs your payday to show what lands before you get paid."}
              </p>
            ) : null}
            <p className="helper-text helper-tooltip">Type it, say it, or drop in a banking-app screenshot. ClearTill will pull out the bill name, amount, and usual due day.</p>
            <p className="helper-text add-bills-drop-hint">
              Best for screenshots of a bank transaction, bill payment, or statement line that shows the merchant, amount, and date.
            </p>
            {quickAddContext ? (
              <div className="quick-add-note" role="status" aria-live="polite">
                <div className="quick-add-copy">
                  <strong>Smart add ready: {quickAddContext.name}</strong>
                  <span>We have already set the category to Household. Add the amount and due day, then review it.</span>
                </div>
                <button className="quick-add-clear" type="button" onClick={() => setQuickAddContext(null)}>
                  Clear
                </button>
              </div>
            ) : null}
            {billReviewDrafts.length ? (
              <div className="bill-review-panel">
                <div className="bill-review-panel-head">
                  <div>
                    <h3>Review bill before adding</h3>
                    <p className="helper-text">
                      We cleaned the input into bill fields. Confirm or edit it before anything is saved.
                    </p>
                  </div>
                </div>
                <div className="bill-review-list">
                  {billReviewDrafts.map((draft) => (
                    <BillReviewCard
                      key={draft.id}
                      draft={draft}
                      displayCurrency={displayCurrency}
                      isEditing={editingReviewId === draft.id}
                      form={editingReviewId === draft.id ? billReviewForm : null}
                      onFormChange={setBillReviewForm}
                      onEdit={() => startBillReviewEdit(draft)}
                      onSave={() => saveBillReviewEdit(draft.id)}
                      onAdd={() => confirmBillReviewDraft(draft.id)}
                      onCancelEdit={() => setEditingReviewId("")}
                      onCancel={() => cancelBillReviewDraft(draft.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <form className="chat-form" onSubmit={handleSubmit} onPaste={handlePaste}>
              <textarea
                ref={messageInputRef}
                value={message}
                disabled={submitting || importLocked}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={
                  quickAddContext
                    ? `Example: ${quickAddContext.name} is £28 due on the 14th each month.`
                    : "My rent is £1,100 on the 26th every month."
                }
              />
              <div className="add-bills-actions">
                <button className="primary-button" type="submit" disabled={submitting || importLocked}>
                  {submitting ? "Reviewing..." : importJobs.length ? "Review bills" : "Review bill"}
                </button>
                <button
                  className={`secondary-button${listening ? " is-listening" : ""}`}
                  type="button"
                  disabled={submitting || importLocked}
                  onClick={handleVoiceToggle}
                  aria-pressed={listening}
                >
                  {listening ? "Stop listening" : "Speak"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={submitting || importLocked || csvPhase === "parsing"}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  Upload
                </button>
              </div>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,.csv,text/csv"
                hidden
                onChange={handleUploadChange}
              />
            </form>

            {/* Image import queue */}
            {importJobs.length ? (
              <div className="selected-image-list">
                {importJobs.map((job) => (
                  <div key={job.id} className={`selected-image-card${getImportJobClass(job)}`}>
                    <div>
                      <div className="selected-image-head">
                        <img className="selected-image-preview" src={job.previewUrl} alt="" />
                        <strong>{job.name}</strong>
                      </div>
                      <p className="helper-text image-meta">
                        {job.status === "queued" ? "Ready to scan" : job.progressText}
                      </p>
                      {job.status !== "queued" ? (
                        <div className="image-progress" aria-hidden="true">
                          <span className="image-progress-bar" style={{ width: `${getImportJobProgress(job)}%` }} />
                        </div>
                      ) : null}
                      {(job.skippedRows || []).length > 0 ? (
                        <div className="skipped-rows-panel">
                          <p className="helper-text">
                            Skipped {job.skippedRows.length} unclear row{job.skippedRows.length === 1 ? "" : "s"}
                          </p>
                          <ul className="skipped-rows-list">
                            {job.skippedRows.map((row, i) => (
                              <li key={i} className="helper-text">{row.name || row.rawText} — {row.reason}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    <div className="import-card-actions">
                      {job.status === "failed" ? (
                        <button className="secondary-button small-button" type="button" disabled={isImporting} onClick={() => handleRetryImport(job.id)}>
                          Retry
                        </button>
                      ) : null}
                      <button className="secondary-button small-button" type="button" disabled={importLocked} onClick={() => removeSelectedImage(job.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {importQueueFinished ? (
              <button className="secondary-button small-button" type="button" onClick={clearImports}>Clear imports</button>
            ) : null}
            {importSummary ? (
              <p className="assistant-message">{buildImportSummaryMessage(importSummary)}</p>
            ) : null}

            {/* CSV review (shown after CSV upload) */}
            {csvPhase === "parsing" ? (
              <p className="helper-text" style={{ marginTop: "12px" }}>Checking your CSV...</p>
            ) : null}
            {csvPhase === "empty" ? (
              <div style={{ marginTop: "12px" }}>
                <p className="helper-text">We could not find clear regular payments in this CSV. You can still type a bill above.</p>
                <button className="secondary-button small-button" type="button" style={{ marginTop: "10px" }} onClick={resetCsv}>Try another file</button>
              </div>
            ) : null}
            {(csvPhase === "error") && csvError ? (
              <p className="error" style={{ marginTop: "10px" }}>{csvError}</p>
            ) : null}
            {csvPhase === "reviewing" ? (() => {
              const visibleSuggestions = csvSuggestions.filter((s) => !csvIgnored.has(s.id));
              const CONF_LABEL = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };
              return (
                <div className="csv-review-section">
                  <div className="csv-review-header">
                    <p><strong>We found {csvSuggestions.length} possible regular payment{csvSuggestions.length === 1 ? "" : "s"}.</strong></p>
                    <p className="helper-text">Review each one before adding it to your bills.</p>
                    {csvSavedCount > 0 ? <p className="helper-text">{csvSavedCount} bill{csvSavedCount === 1 ? "" : "s"} added so far.</p> : null}
                  </div>
                  {visibleSuggestions.length === 0 ? (
                    <div>
                      <p className="helper-text">All suggestions reviewed.</p>
                      <div className="csv-suggestion-actions" style={{ marginTop: "10px" }}>
                        <button className="secondary-button small-button" type="button" onClick={() => uploadInputRef.current?.click()}>Try another file</button>
                        <button className="secondary-button small-button" type="button" onClick={resetCsv}>Start over</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="csv-suggestions-list">
                        {visibleSuggestions.map((s) => (
                          <div key={s.id} className="csv-suggestion-card">
                            <div className="csv-suggestion-head">
                              <div>
                                <strong className="csv-suggestion-name">{s.merchantName}</strong>
                                <span className={`csv-confidence-pill csv-pill-${s.confidence}`}>{CONF_LABEL[s.confidence]}</span>
                              </div>
                              <div className="csv-suggestion-amount">
                                <strong>{formatCurrency(s.averageAmount, displayCurrency)}</strong>
                                <span className="csv-suggestion-freq">{s.frequency}</span>
                              </div>
                            </div>
                            <div className="csv-suggestion-meta">
                              <span>Last paid {formatDisplayDate(s.lastPaidDate)}</span>
                              <span>Next {formatDisplayDate(s.nextExpectedDate)}</span>
                              <span>{s.detectedTransactionsCount} found</span>
                            </div>
                            {csvEditingId === s.id ? (
                              <div className="csv-edit-form">
                                <div className="field-row">
                                  <label className="field-label" htmlFor={`csv-name-${s.id}`}>Bill name</label>
                                  <input id={`csv-name-${s.id}`} value={csvEditForm.name} onChange={(e) => setCsvEditForm((f) => ({ ...f, name: e.target.value }))} placeholder="Bill name" />
                                </div>
                                <div className="field-row">
                                  <label className="field-label" htmlFor={`csv-amount-${s.id}`}>Amount</label>
                                  <input id={`csv-amount-${s.id}`} inputMode="decimal" value={csvEditForm.amount} onChange={(e) => setCsvEditForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                                </div>
                                <div className="field-row">
                                  <label className="field-label" htmlFor={`csv-day-${s.id}`}>Due day (1–31)</label>
                                  <input id={`csv-day-${s.id}`} inputMode="numeric" value={csvEditForm.dueDay} onChange={(e) => setCsvEditForm((f) => ({ ...f, dueDay: e.target.value }))} placeholder="e.g. 1" />
                                </div>
                                <div className="field-row">
                                  <label className="field-label" htmlFor={`csv-cat-${s.id}`}>Category</label>
                                  <select id={`csv-cat-${s.id}`} className="category-select" value={csvEditForm.category} onChange={(e) => setCsvEditForm((f) => ({ ...f, category: e.target.value }))}>
                                    <option value="">Auto-detect</option>
                                    <option value="household">Household</option>
                                    <option value="subscription">Subscription</option>
                                    <option value="vehicle">Vehicle</option>
                                    <option value="debt">Debt / repayment</option>
                                    <option value="family">Children / family</option>
                                    <option value="work_side_project">Work / side project</option>
                                    <option value="other">Other</option>
                                  </select>
                                </div>
                                <div className="csv-suggestion-actions">
                                  <button className="primary-button small-button" type="button" disabled={csvSavingId === s.id} onClick={() => handleCsvEditSave(s)}>
                                    {csvSavingId === s.id ? "Saving..." : "Save bill"}
                                  </button>
                                  <button className="secondary-button small-button" type="button" onClick={() => setCsvEditingId(null)}>Cancel</button>
                                </div>
                                {csvError ? <p className="error">{csvError}</p> : null}
                              </div>
                            ) : (
                              <div className="csv-suggestion-actions">
                                <button className="secondary-button small-button" type="button" disabled={!!csvSavingId} onClick={() => handleCsvAddBill(s)}>
                                  {csvSavingId === s.id ? "Adding..." : "Add as bill"}
                                </button>
                                <button className="secondary-button small-button" type="button" disabled={!!csvSavingId} onClick={() => startCsvEdit(s)}>Edit</button>
                                <button className="secondary-button small-button" type="button" onClick={() => setCsvIgnored((prev) => new Set([...prev, s.id]))}>Ignore</button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="csv-suggestion-actions" style={{ marginTop: "12px" }}>
                        <button className="secondary-button small-button" type="button" onClick={resetCsv}>Start over</button>
                      </div>
                      {csvError ? <p className="error">{csvError}</p> : null}
                    </>
                  )}
                </div>
              );
            })() : null}

            {voiceMessage ? <p className="helper-text voice-status">{voiceMessage}</p> : null}
            {assistantMessage ? <p className="assistant-message">{assistantMessage}</p> : null}
            {chatError ? <p className="error">{chatError}</p> : null}
          </section>

          <div className="stack">
            <HouseholdTracker bills={bills} onAddMissingUtility={handleAddMissingUtility} />
            <SpendCurveCard
              dashboard={dashboard}
              dueBeforePaydayLargeCosts={dueBeforePaydayLargeCosts}
              dailySpendingRoom={dailySpendingRoom}
              hasBalanceSnapshot={hasBalanceSnapshot}
              todayIso={todayIso}
              displayCurrency={displayCurrency}
            />
          </div>
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

function isPaidBill(bill) {
  return Boolean(bill?.paidThroughDate);
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
  { label: "Energy", key: "energy", keywords: ["energy", "gas", "electric", "electricity", "octopus", "british gas", "eon", "e.on", "ovo", "bulb", "shell energy"] },
  { label: "Water", key: "water", keywords: ["water"] },
  { label: "Wastewater", key: "wastewater", keywords: ["wastewater", "waste water", "sewerage", "sewage"] },
  { label: "Council tax", key: "council_tax", keywords: ["council tax"] },
  { label: "Broadband", key: "broadband", keywords: ["broadband", "internet", "fibre", "sky", "virgin", "bt", "plusnet", "talktalk"] },
  { label: "Mobile", key: "mobile", keywords: ["mobile", "phone", "o2", "vodafone", "ee", "three", "giffgaff"] },
  { label: "Home insurance", key: "home_insurance", keywords: ["home insurance", "contents insurance", "buildings insurance", "aviva", "direct line", "admiral", "churchill", "compare the market"] },
  { label: "Rent / mortgage", key: "rent_mortgage", keywords: ["rent", "mortgage", "landlord", "letting agent", "halifax", "nationwide", "santander mortgage", "barclays mortgage"] },
];

function normaliseTrackerText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trackerBillMatch(billName, keywords) {
  const text = ` ${normaliseTrackerText(billName)} `;
  if (!text.trim()) {
    return false;
  }

  return keywords.some((keyword) => {
    const normalisedKeyword = normaliseTrackerText(keyword);
    if (!normalisedKeyword) {
      return false;
    }

    return text.includes(` ${normalisedKeyword} `);
  });
}

function buildTrackerChecks(bills) {
  const activeBills = (bills || []).filter((bill) => bill?.active !== false);

  return TRACKER_CHECKS.map((check) => {
    const matchedBill = activeBills.find((bill) => trackerBillMatch(bill?.name, check.keywords));
    return {
      ...check,
      found: Boolean(matchedBill),
      matchedBillName: matchedBill?.name || "",
    };
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

function SpendCurveCard({ dashboard, dueBeforePaydayLargeCosts, dailySpendingRoom, hasBalanceSnapshot, todayIso, displayCurrency }) {
  const { currentBalance, paydayDate, beforePayday } = dashboard;

  if (!paydayDate || !hasBalanceSnapshot) return null;

  // Group bills + account-funded large costs into 4 weekly buckets
  const weekTotals = [0, 0, 0, 0];
  for (const bill of beforePayday) {
    if (bill.nextDueDate && bill.amount > 0) {
      const day = Math.max(0, diffDays(todayIso, bill.nextDueDate));
      weekTotals[Math.min(3, Math.floor(day / 7))] += bill.amount;
    }
  }
  for (const cost of dueBeforePaydayLargeCosts) {
    const acctAmt = Number(cost.currentAccountAmount) || 0;
    if (acctAmt > 0 && cost.nextDueDate) {
      const day = Math.max(0, diffDays(todayIso, cost.nextDueDate));
      weekTotals[Math.min(3, Math.floor(day / 7))] += acctAmt;
    }
  }

  const totalBills = weekTotals.reduce((a, b) => a + b, 0);
  const lowestBal = currentBalance - totalBills;
  const goesNegative = lowestBal < 0;
  const maxWeek = Math.max(...weekTotals, 100);

  // SVG layout
  const W = 400, H = 120;
  const PL = 34, PR = 10, PT = 10, PB = 22;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const baseY = PT + chartH;
  const numBars = 4;
  const barGap = 10;
  const barW = (chartW - (numBars - 1) * barGap) / numBars;

  const toBarH = (amt) => (amt / maxWeek) * chartH;
  const toBarX = (i) => PL + i * (barW + barGap);

  // £100 reference line
  const ref100Y = baseY - toBarH(100);
  const sym = displayCurrency === "EUR" ? "€" : displayCurrency === "USD" ? "$" : "£";

  return (
    <section className="spend-curve-card">
      <h2 className="spend-curve-title">Bills per week to payday</h2>
      <div className="spend-curve-summary">
        <span className="curve-stat">
          <span className="curve-stat-label">Today</span>
          <strong>{formatCurrency(currentBalance, displayCurrency)}</strong>
        </span>
        <span className="curve-stat">
          <span className="curve-stat-label">After bills</span>
          <strong className={goesNegative ? "curve-negative" : ""}>{formatCurrency(lowestBal, displayCurrency)}</strong>
        </span>
        {dailySpendingRoom !== null ? (
          <span className="curve-stat">
            <span className="curve-stat-label">Safe daily</span>
            <strong>{formatCurrency(dailySpendingRoom, displayCurrency)}/day</strong>
          </span>
        ) : null}
        <span className="curve-stat">
          <span className="curve-stat-label">Payday</span>
          <strong>{formatDisplayDate(paydayDate)}</strong>
        </span>
      </div>
      {goesNegative ? (
        <p className="spend-curve-warning">You may go below £0 before payday.</p>
      ) : null}
      <svg viewBox={`0 0 ${W} ${H}`} className="spend-curve-svg" role="img" aria-label="Bills per week to payday">
        {/* £100 reference line */}
        {ref100Y > PT && ref100Y < baseY ? (
          <>
            <line x1={PL} y1={ref100Y} x2={PL + chartW} y2={ref100Y} stroke="var(--line)" strokeWidth="0.8" strokeDasharray="3 3" />
            <text x={PL - 4} y={ref100Y + 3.5} textAnchor="end" fontSize="9" fill="var(--muted)">{sym}100</text>
          </>
        ) : null}
        {/* Bars */}
        {weekTotals.map((total, i) => {
          const bh = Math.max(toBarH(total), total > 0 ? 2 : 0);
          return (
            <rect
              key={i}
              x={toBarX(i).toFixed(1)}
              y={(baseY - bh).toFixed(1)}
              width={barW.toFixed(1)}
              height={bh.toFixed(1)}
              fill="var(--accent)"
              opacity={total > 0 ? 0.72 : 0.12}
              rx="3"
            />
          );
        })}
        {/* Baseline */}
        <line x1={PL} y1={baseY} x2={PL + chartW} y2={baseY} stroke="var(--line)" strokeWidth="1" />
        {/* Payday label under last bar */}
        <text x={(toBarX(3) + barW / 2).toFixed(1)} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--muted)">Payday</text>
      </svg>
    </section>
  );
}

function HouseholdTracker({ bills, onAddMissingUtility }) {
  const checks = buildTrackerChecks(bills);
  const missingChecks = checks.filter((check) => !check.found);

  return (
    <div className="tracker-card">
      <h3>🏠 Household utilities tracker</h3>
      <p className="tracker-sub">ClearTill checks whether the main household bills are in your forecast.</p>
      <div className="tracker-grid">
        {checks.map((check) => (
          <div key={check.key} className={`tracker-row ${check.found ? "tracker-added" : "tracker-missing"}`}>
            <div className="tracker-row-main">
              <span className="tracker-state" aria-hidden="true">{check.found ? "✓" : null}</span>
              <div className="tracker-copy">
                <span className="tracker-label">{check.label}</span>
                <span className="tracker-note">{check.found ? "Added to forecast" : "Missing from forecast"}</span>
              </div>
            </div>
            {!check.found ? (
              <button
                className="tracker-inline-action"
                type="button"
                onClick={() => onAddMissingUtility?.(check)}
              >
                Add
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {missingChecks.length ? (
        <button
          className="tracker-action"
          type="button"
          onClick={() => onAddMissingUtility?.(missingChecks[0])}
        >
          Add missing utility
        </button>
      ) : null}
    </div>
  );
}

function BillReviewCard({
  draft,
  displayCurrency,
  isEditing,
  form,
  onFormChange,
  onEdit,
  onSave,
  onAdd,
  onCancelEdit,
  onCancel,
}) {
  const categoryMeta = CATEGORY_META[draft.category] || CATEGORY_META.other;
  const dueLabel = draft.dueDay ? `${formatOrdinal(draft.dueDay)} of each month` : "Missing";
  const amountLabel = Number.isFinite(Number(draft.amount)) && Number(draft.amount) > 0
    ? formatCurrency(Number(draft.amount), displayCurrency)
    : "Missing";
  const frequencyLabel = draft.frequency === "monthly" ? "Monthly" : draft.frequency || "Monthly";
  const subCategoryLabel = draft.subCategory ? prettifySubCategory(draft.subCategory) : categoryMeta.label;

  return (
    <div className="bill-review-card">
      {isEditing ? (
        <div className="bill-review-edit-grid">
          <div className="field-row">
            <label className="field-label" htmlFor={`review-name-${draft.id}`}>Bill name</label>
            <input
              id={`review-name-${draft.id}`}
              value={form?.name || ""}
              onChange={(event) => onFormChange((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor={`review-amount-${draft.id}`}>Amount</label>
            <input
              id={`review-amount-${draft.id}`}
              inputMode="decimal"
              value={form?.amount || ""}
              onChange={(event) => onFormChange((current) => ({ ...current, amount: event.target.value }))}
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor={`review-dueDay-${draft.id}`}>Due day</label>
            <input
              id={`review-dueDay-${draft.id}`}
              inputMode="numeric"
              value={form?.dueDay || ""}
              onChange={(event) => onFormChange((current) => ({ ...current, dueDay: event.target.value }))}
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor={`review-category-${draft.id}`}>Category</label>
            <select
              id={`review-category-${draft.id}`}
              className="category-select"
              value={form?.category || ""}
              onChange={(event) => onFormChange((current) => ({ ...current, category: event.target.value }))}
            >
              <option value="household">Household</option>
              <option value="subscription">Subscription</option>
              <option value="vehicle">Vehicle</option>
              <option value="debt">Debt / repayment</option>
              <option value="family">Children / family</option>
              <option value="work_side_project">Work / side project</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="bill-review-actions">
            <button className="primary-button small-button" type="button" onClick={onSave}>Save changes</button>
            <button className="secondary-button small-button" type="button" onClick={onCancelEdit}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="bill-review-head">
            <div>
              <h3>{draft.name || "Bill name needed"}</h3>
              <p className="helper-text">
                Confidence {Math.round((draft.confidence || 0.65) * 100)}%
                {draft.sourceText ? " • cleaned from your input" : ""}
              </p>
            </div>
            <span className="bill-review-category">{categoryMeta.icon} {subCategoryLabel}</span>
          </div>
          <div className="bill-review-grid">
            <div className="bill-review-item">
              <span>Amount</span>
              <strong>{amountLabel}</strong>
            </div>
            <div className="bill-review-item">
              <span>Due day</span>
              <strong>{dueLabel}</strong>
            </div>
            <div className="bill-review-item">
              <span>Frequency</span>
              <strong>{frequencyLabel}</strong>
            </div>
            <div className="bill-review-item">
              <span>Category</span>
              <strong>{categoryMeta.label}</strong>
            </div>
          </div>
          {draft.missingFields?.length ? (
            <p className="helper-text helper-tooltip bill-review-helper">
              {draft.missingFields.includes("amount") && draft.missingFields.includes("dueDay")
                ? "I found the bill name, but need the amount and due date."
                : draft.missingFields.includes("amount")
                  ? "I found the bill name and due date, but need the amount."
                  : "I found the bill name and amount, but need the due date."}
            </p>
          ) : null}
          <div className="bill-review-actions">
            <button className="primary-button small-button" type="button" onClick={onAdd}>Add bill</button>
            <button className="secondary-button small-button" type="button" onClick={onEdit}>Edit</button>
            <button className="secondary-button small-button" type="button" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

const LARGE_COST_CATEGORY_META = {
  holiday: { icon: "✈️", label: "Holiday" },
  car: { icon: "🚗", label: "Car" },
  home: { icon: "🏠", label: "Home" },
  kids: { icon: "🧒", label: "Kids" },
  emergency: { icon: "🛠", label: "Emergency" },
  other: { icon: "📌", label: "Other" },
};

const LARGE_COST_FREQUENCY_LABELS = {
  one_off: "One-off",
  every_2_months: "Every 2 months",
  quarterly: "Quarterly",
  every_6_months: "Every 6 months",
  yearly: "Yearly",
};

const LARGE_COST_FUNDING_META = {
  unassigned: {
    label: "Unassigned",
    shortLabel: "Unassigned",
    note: "Choose how this will be paid.",
  },
  current_account: {
    label: "Current account",
    shortLabel: "Current account",
    note: "Hits current account. Reduces daily spending room.",
  },
  savings: {
    label: "Savings",
    shortLabel: "Savings",
    note: "Covered by savings. Not counted as daily spending money.",
  },
  split: {
    label: "Split",
    shortLabel: "Split",
    note: "Partly covered by savings. Only the remaining amount affects daily spending room.",
  },
};

function ForecastLargeCostsSection({
  costs,
  allCosts,
  displayCurrency,
  showForm,
  editingId,
  form,
  onFormChange,
  onStartAdd,
  onEditStart,
  onCancel,
  onSave,
  onDelete,
  saving,
  error,
  hasPayday,
  unassignedAmount,
  fundingEditorCostId,
  fundingEditorForm,
  onFundingEditorChange,
  onFundingEditorOpen,
  onFundingEditorClose,
  onFundingEditorSave,
}) {
  return (
    <section className="forecast-large-costs">
      <div className="section-head">
        <div>
          <h3 style={{ margin: 0 }}>Large costs before payday</h3>
          <p className="helper-text">Only costs hitting the current account change daily spending room.</p>
        </div>
        <button className="secondary-button small-button" type="button" onClick={showForm ? onCancel : onStartAdd}>
          {showForm ? "Cancel" : "Add large cost"}
        </button>
      </div>

      {showForm ? (
        <form className="edit-form large-cost-form forecast-inline-form" onSubmit={onSave}>
          <label className="field-label" htmlFor="large-cost-name">Name</label>
          <input
            id="large-cost-name"
            value={form.name}
            onChange={(event) => onFormChange((current) => ({ ...current, name: event.target.value }))}
            placeholder="Holiday"
          />
          <label className="field-label" htmlFor="large-cost-amount">Amount</label>
          <input
            id="large-cost-amount"
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => onFormChange((current) => ({ ...current, amount: event.target.value }))}
            placeholder="5000"
          />
          <label className="field-label" htmlFor="large-cost-saved">Amount already saved</label>
          <input
            id="large-cost-saved"
            inputMode="decimal"
            value={form.amountAlreadySaved}
            onChange={(event) => onFormChange((current) => ({ ...current, amountAlreadySaved: event.target.value }))}
            placeholder="0"
          />
          <label className="field-label" htmlFor="large-cost-due-date">Due date</label>
          <input
            id="large-cost-due-date"
            type="date"
            value={form.dueDate}
            onChange={(event) => onFormChange((current) => ({ ...current, dueDate: event.target.value }))}
          />
          <label className="field-label" htmlFor="large-cost-frequency">Frequency</label>
          <select
            id="large-cost-frequency"
            className="category-select"
            value={form.frequency}
            onChange={(event) => onFormChange((current) => ({ ...current, frequency: event.target.value }))}
          >
            {Object.entries(LARGE_COST_FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <label className="field-label" htmlFor="large-cost-category">Category</label>
          <select
            id="large-cost-category"
            className="category-select"
            value={form.category}
            onChange={(event) => onFormChange((current) => ({ ...current, category: event.target.value }))}
          >
            {Object.entries(LARGE_COST_CATEGORY_META).map(([value, meta]) => (
              <option key={value} value={value}>{meta.icon} {meta.label}</option>
            ))}
          </select>
          <div className="field-row">
            <label className="field-label">Funding source</label>
            <div className="funding-toggle-row">
              {Object.entries(LARGE_COST_FUNDING_META).map(([value, meta]) => (
                <button
                  key={value}
                  className={`funding-toggle${form.fundingStatus === value ? " is-active" : ""}`}
                  type="button"
                  onClick={() => onFormChange((current) => ({ ...current, fundingStatus: value }))}
                >
                  {meta.shortLabel}
                </button>
              ))}
            </div>
            <p className="helper-text">{(LARGE_COST_FUNDING_META[form.fundingStatus] || LARGE_COST_FUNDING_META.unassigned).note}</p>
          </div>
          <div className="edit-actions">
            <button className="primary-button small-button" type="submit" disabled={saving}>
              {saving ? "Saving..." : editingId ? "Save changes" : "Save"}
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </form>
      ) : null}

      {hasPayday ? (
        <>
          {unassignedAmount > 0 ? (
            <p className="forecast-unassigned-warning">
              You have {formatCurrency(unassignedAmount, displayCurrency)} of upcoming costs not assigned to a funding source. Your daily spending room may change.
            </p>
          ) : null}
          {costs.length ? (
          <ul className="forecast-compact-list">
            {costs.map((cost) => {
              const isEditingFunding = fundingEditorCostId === cost.id;
              const fundingLabel = cost.fundingMeta?.label || "Unassigned";
              const primaryLabel = cost.fundingStatus === "unassigned" ? "Choose funding" : "Change funding";

              return (
              <li key={cost.id} className="forecast-compact-row">
                <div className="forecast-compact-main">
                  <div className="forecast-cost-summary-row">
                    <span className="forecast-compact-name">{cost.name}</span>
                    <strong className="forecast-cost-amount">{formatCurrency(cost.amount, displayCurrency)}</strong>
                  </div>
                  <div className="forecast-cost-summary-row forecast-cost-summary-row-secondary">
                    <span className="forecast-compact-meta">Due {cost.nextDueDate ? formatDisplayDate(cost.nextDueDate) : cost.dueLabel}</span>
                    <span className="forecast-funding-status">{fundingLabel}</span>
                  </div>
                  <span className="forecast-compact-note">{cost.fundingMeta.note}</span>
                  {cost.fundingStatus === "split" ? (
                    <span className="forecast-compact-meta">
                      {formatCurrency(cost.currentAccountAmount || 0, displayCurrency)} hits current account
                    </span>
                  ) : null}
                  <div className="forecast-cost-actions">
                    <button className="secondary-button small-button forecast-funding-button" type="button" onClick={() => onFundingEditorOpen(cost)}>
                      {primaryLabel}
                    </button>
                    <div className="forecast-secondary-actions">
                      <button className="bill-action-button bill-action-edit" type="button" onClick={() => onEditStart(cost)}>
                        Edit
                      </button>
                      <button className="bill-action-button bill-action-remove" type="button" onClick={() => onDelete(cost.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                  {isEditingFunding ? (
                    <div className="forecast-funding-editor">
                      <h4>How will you pay for {cost.name}?</h4>
                      <div className="funding-toggle-row">
                        {[
                          ["current_account", "Current account"],
                          ["savings", "Savings"],
                          ["split", "Split"],
                          ["unassigned", "Not sure yet"],
                        ].map(([value, label]) => (
                          <button
                            key={`${cost.id}-${value}-editor`}
                            className={`funding-toggle${fundingEditorForm.fundingStatus === value ? " is-active" : ""}`}
                            type="button"
                            onClick={() => onFundingEditorChange((current) => ({ ...current, fundingStatus: value }))}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {fundingEditorForm.fundingStatus === "split" ? (
                        <div className="field-row" style={{ marginTop: "12px" }}>
                          <label className="field-label" htmlFor={`funding-savings-${cost.id}`}>Amount from savings</label>
                          <input
                            id={`funding-savings-${cost.id}`}
                            inputMode="decimal"
                            value={fundingEditorForm.savingsAmount}
                            onChange={(event) => onFundingEditorChange((current) => ({ ...current, savingsAmount: event.target.value }))}
                            placeholder="0"
                          />
                          <p className="helper-text">
                            Amount from current account: {formatCurrency(Math.max(0, (Number(cost.amount) || 0) - (Number(fundingEditorForm.savingsAmount || 0) || 0)), displayCurrency)}
                          </p>
                        </div>
                      ) : null}
                      <div className="edit-actions">
                        <button className="primary-button small-button" type="button" onClick={() => onFundingEditorSave(cost)}>
                          Save
                        </button>
                        <button className="secondary-button small-button" type="button" onClick={onFundingEditorClose}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            )})}
          </ul>
          ) : (
            <p className="empty large-costs-empty">None due before payday.</p>
          )}
        </>
      ) : (
        <p className="empty large-costs-empty">
          Set your payday first, then ClearTill will show which large costs land before it.
        </p>
      )}

      {allCosts.length ? (
        <Link className="summary-card-link" href="/big-costs">
          View big cost plan →
        </Link>
      ) : null}
    </section>
  );
}

// CsvBillFinder is now inlined into DashboardPage — this stub is unused.
function CsvBillFinder({ userId, bills, displayCurrency, onBillSaved }) { // eslint-disable-line no-unused-vars
  const fileInputRef = useRef(null);
  const [phase, setPhase] = useState("idle"); // idle | parsing | reviewing | empty | error
  const [suggestions, setSuggestions] = useState([]);
  const [ignored, setIgnored] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", amount: "", dueDay: "", category: "" });
  const [savingId, setSavingId] = useState(null);
  const [savedCount, setSavedCount] = useState(0);
  const [csvError, setCsvError] = useState("");

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const name = (file.name || "").toLowerCase();
    if (!name.endsWith(".csv") && file.type !== "text/csv" && !file.type.includes("comma")) {
      setCsvError("Please upload a CSV file.");
      setPhase("error");
      return;
    }

    setCsvError("");
    setPhase("parsing");
    setSuggestions([]);
    setIgnored(new Set());
    setEditingId(null);
    setSavedCount(0);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = analyseCsvText(e.target.result || "");
        if (result.error === "no_columns") {
          setCsvError("We could not find date, description and amount columns in this CSV.");
          setPhase("error");
        } else if (result.error) {
          setCsvError("We could not read this CSV. Try exporting it again from your banking app.");
          setPhase("error");
        } else if (!result.suggestions || result.suggestions.length === 0) {
          setPhase("empty");
        } else {
          setSuggestions(result.suggestions);
          setPhase("reviewing");
        }
      } catch {
        setCsvError("We could not read this CSV. Try exporting it again from your banking app.");
        setPhase("error");
      }
    };
    reader.onerror = () => {
      setCsvError("We could not read this CSV. Try exporting it again from your banking app.");
      setPhase("error");
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleAddBill(suggestion) {
    if (!userId || !db) return;
    setSavingId(suggestion.id);
    setCsvError("");
    try {
      const todayIso = getTodayIso();
      const billDoc = buildBillDocument({
        name: suggestion.merchantName,
        amount: suggestion.averageAmount,
        dueDay: suggestion.usualPaymentDay,
        currency: "GBP",
      }, todayIso);
      const billRef = doc(collection(db, "users", userId, "bills"));
      await setDoc(billRef, {
        ...billDoc,
        source: "csv_detected",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const saved = { ...billDoc, id: billRef.id, source: "csv_detected" };
      onBillSaved(saved);
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setSavedCount((n) => n + 1);
    } catch {
      setCsvError("Could not save that bill. Try again.");
    } finally {
      setSavingId(null);
    }
  }

  function startEdit(suggestion) {
    setEditingId(suggestion.id);
    setCsvError("");
    setEditForm({
      name: suggestion.merchantName,
      amount: String(suggestion.averageAmount),
      dueDay: String(suggestion.usualPaymentDay),
      category: "",
    });
  }

  async function handleEditSave(suggestion) {
    if (!userId || !db) return;
    const amount = parseFloat(editForm.amount);
    const dueDay = parseInt(editForm.dueDay, 10);
    if (!editForm.name.trim() || !Number.isFinite(amount) || amount <= 0) {
      setCsvError("Enter a valid name and amount before saving.");
      return;
    }
    setSavingId(suggestion.id);
    setCsvError("");
    try {
      const todayIso = getTodayIso();
      const billDoc = buildBillDocument({
        name: editForm.name.trim(),
        amount,
        dueDay: isValidDueDay(dueDay) ? dueDay : null,
        currency: "GBP",
        category: editForm.category || null,
      }, todayIso);
      const billRef = doc(collection(db, "users", userId, "bills"));
      await setDoc(billRef, {
        ...billDoc,
        source: "csv_detected",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const saved = { ...billDoc, id: billRef.id, source: "csv_detected" };
      onBillSaved(saved);
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setEditingId(null);
      setSavedCount((n) => n + 1);
    } catch {
      setCsvError("Could not save that bill. Try again.");
    } finally {
      setSavingId(null);
    }
  }

  function reset() {
    setPhase("idle");
    setSuggestions([]);
    setIgnored(new Set());
    setEditingId(null);
    setSavedCount(0);
    setCsvError("");
  }

  const visibleSuggestions = suggestions.filter((s) => !ignored.has(s.id));
  const CONF_LABEL = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

  return (
    <section className="chat-panel csv-finder-panel">
      <h2>Find bills from CSV</h2>

      {phase === "idle" || phase === "error" ? (
        <>
          <p className="helper-text helper-tooltip">
            Upload a CSV bank export for the last 3 months. ClearTill will spot possible recurring payments — nothing is added until you approve it.
          </p>
          <div className="csv-privacy-note">
            <p className="helper-text">Your CSV is only used to find possible regular payments. We only save bills you confirm.</p>
            <p className="helper-text">Your CSV is checked on your device. We do not store the original file.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            style={{ marginTop: "12px" }}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload CSV
          </button>
          <p className="helper-text" style={{ marginTop: "6px", fontSize: "0.82rem" }}>Upload CSV, PDF, or screenshot — CSV only for now</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={handleFileChange}
          />
          {csvError ? <p className="error">{csvError}</p> : null}
        </>
      ) : null}

      {phase === "parsing" ? (
        <p className="helper-text" style={{ marginTop: "10px" }}>Checking your CSV...</p>
      ) : null}

      {phase === "empty" ? (
        <>
          <p className="helper-text" style={{ marginTop: "10px" }}>
            We could not find clear regular payments in this CSV. You can still add bills manually above.
          </p>
          <button className="secondary-button small-button" type="button" style={{ marginTop: "12px" }} onClick={reset}>
            Try another file
          </button>
        </>
      ) : null}

      {phase === "reviewing" ? (
        <>
          <div className="csv-review-header">
            <p><strong>We found {suggestions.length} possible regular payment{suggestions.length === 1 ? "" : "s"}.</strong></p>
            <p className="helper-text">Review each one before adding it to your bills.</p>
            {savedCount > 0 ? (
              <p className="helper-text">{savedCount} bill{savedCount === 1 ? "" : "s"} added so far.</p>
            ) : null}
          </div>

          {visibleSuggestions.length === 0 ? (
            <>
              <p className="helper-text" style={{ marginTop: "10px" }}>All suggestions reviewed.</p>
              <button className="secondary-button small-button" type="button" style={{ marginTop: "12px" }} onClick={reset}>
                Try another file
              </button>
            </>
          ) : (
            <div className="csv-suggestions-list">
              {visibleSuggestions.map((s) => (
                <div key={s.id} className="csv-suggestion-card">
                  <div className="csv-suggestion-head">
                    <div>
                      <strong className="csv-suggestion-name">{s.merchantName}</strong>
                      <span className={`csv-confidence-pill csv-pill-${s.confidence}`}>
                        {CONF_LABEL[s.confidence]}
                      </span>
                    </div>
                    <div className="csv-suggestion-amount">
                      <strong>{formatCurrency(s.averageAmount, displayCurrency)}</strong>
                      <span className="csv-suggestion-freq">{s.frequency}</span>
                    </div>
                  </div>

                  <div className="csv-suggestion-meta">
                    <span>Last paid {formatDisplayDate(s.lastPaidDate)}</span>
                    <span>Next {formatDisplayDate(s.nextExpectedDate)}</span>
                    <span>{s.detectedTransactionsCount} found</span>
                  </div>

                  {editingId === s.id ? (
                    <div className="csv-edit-form">
                      <div className="field-row">
                        <label className="field-label" htmlFor={`csv-name-${s.id}`}>Bill name</label>
                        <input
                          id={`csv-name-${s.id}`}
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          placeholder="Bill name"
                        />
                      </div>
                      <div className="field-row">
                        <label className="field-label" htmlFor={`csv-amount-${s.id}`}>Amount</label>
                        <input
                          id={`csv-amount-${s.id}`}
                          inputMode="decimal"
                          value={editForm.amount}
                          onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="field-row">
                        <label className="field-label" htmlFor={`csv-day-${s.id}`}>Due day (1–31)</label>
                        <input
                          id={`csv-day-${s.id}`}
                          inputMode="numeric"
                          value={editForm.dueDay}
                          onChange={(e) => setEditForm((f) => ({ ...f, dueDay: e.target.value }))}
                          placeholder="e.g. 1"
                        />
                      </div>
                      <div className="field-row">
                        <label className="field-label" htmlFor={`csv-cat-${s.id}`}>Category</label>
                        <select
                          id={`csv-cat-${s.id}`}
                          className="category-select"
                          value={editForm.category}
                          onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                        >
                          <option value="">Auto-detect</option>
                          <option value="household">Household</option>
                          <option value="subscription">Subscription</option>
                          <option value="vehicle">Vehicle</option>
                          <option value="debt">Debt / repayment</option>
                          <option value="family">Children / family</option>
                          <option value="work_side_project">Work / side project</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="csv-suggestion-actions">
                        <button
                          className="primary-button small-button"
                          type="button"
                          disabled={savingId === s.id}
                          onClick={() => handleEditSave(s)}
                        >
                          {savingId === s.id ? "Saving..." : "Save bill"}
                        </button>
                        <button
                          className="secondary-button small-button"
                          type="button"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="csv-suggestion-actions">
                      <button
                        className="secondary-button small-button"
                        type="button"
                        disabled={!!savingId}
                        onClick={() => handleAddBill(s)}
                      >
                        {savingId === s.id ? "Adding..." : "Add as bill"}
                      </button>
                      <button
                        className="secondary-button small-button"
                        type="button"
                        disabled={!!savingId}
                        onClick={() => startEdit(s)}
                      >
                        Edit
                      </button>
                      <button
                        className="secondary-button small-button"
                        type="button"
                        onClick={() => setIgnored((prev) => new Set([...prev, s.id]))}
                      >
                        Ignore
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: "14px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button className="secondary-button small-button" type="button" onClick={reset}>
              Start over
            </button>
          </div>
          {csvError ? <p className="error">{csvError}</p> : null}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={handleFileChange}
          />
        </>
      ) : null}
    </section>
  );
}

function ProtectedSavingsEditor({
  value,
  onChange,
  onSave,
  saving,
  error,
  displayCurrency,
  protectedTotal,
  generalSavings = 0,
  assignedSavings = 0,
  assignedSavingsByCost = [],
  bigCostsCoveredBySavings = 0,
  fallbackCopy = "Not counted as daily spending money.",
}) {
  const costsWithSavings = assignedSavingsByCost.filter((cost) => (cost.amountAlreadySaved || 0) > 0);
  const underfundedCosts = costsWithSavings
    .map((cost) => ({
      ...cost,
      stillNeededAmount: Math.max(0, (Number(cost.amount) || 0) - (Number(cost.amountAlreadySaved) || 0)),
    }))
    .filter((cost) => cost.stillNeededAmount > 0);
  const savingsLeftAfterCosts = protectedTotal - bigCostsCoveredBySavings;

  return (
    <div className="forecast-support-block">
      <h3 className="savings-section-label">Savings</h3>
      <p className="helper-text forecast-support-copy">Savings now means your total available savings.</p>
      <div className="savings-main-total">
        <span>Savings now</span>
        <strong>{formatCurrency(protectedTotal, displayCurrency)}</strong>
      </div>
      <div className="savings-breakdown-list">
        <div className="savings-breakdown-row">
          <span>Savings not assigned to a big cost</span>
          <strong>{formatCurrency(generalSavings, displayCurrency)}</strong>
        </div>
        {costsWithSavings.map((cost) => (
          <div key={cost.id} className="savings-breakdown-row">
            <span>Saved for {cost.name}</span>
            <strong>{formatCurrency(cost.amountAlreadySaved || 0, displayCurrency)}</strong>
          </div>
        ))}
        {bigCostsCoveredBySavings > 0 ? (
          <>
            <div className="savings-breakdown-row savings-deduction">
              <span>Planned big costs paid from savings</span>
              <strong>-{formatCurrency(bigCostsCoveredBySavings, displayCurrency)}</strong>
            </div>
            <div className="savings-breakdown-row savings-total">
              <span>Savings left after planned costs</span>
              <strong>{formatCurrency(savingsLeftAfterCosts, displayCurrency)}</strong>
            </div>
          </>
        ) : null}
        {underfundedCosts.map((cost) => (
          <div key={`needed-${cost.id}`} className="savings-breakdown-row savings-needed">
            <span>Still needed for {cost.name}</span>
            <strong>{formatCurrency(cost.stillNeededAmount || 0, displayCurrency)}</strong>
          </div>
        ))}
      </div>
      <p className="helper-text forecast-support-copy">
        Savings not assigned to a big cost means money you have saved but have not linked to a specific planned cost.
      </p>
      <p className="helper-text forecast-support-copy">{fallbackCopy}</p>
      <form className="chat-form forecast-inline-form" onSubmit={onSave}>
        <div className="field-row">
          <label className="field-label" htmlFor="savings-set-aside">Savings not assigned to a big cost</label>
          <div className="chat-input-row">
            <input
              id="savings-set-aside"
              inputMode="decimal"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="2000"
            />
            <button className="secondary-button" type="submit" disabled={saving}>
              {saving ? "Updating..." : "Update savings"}
            </button>
          </div>
        </div>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  muted = false,
  helper = "",
  status = "",
  detailLines = [],
  href = "",
  footerLink = "",
  compact = false,
  emphasized = false,
  actionLabel = "",
  onAction,
}) {
  const statusClass = status ? `summary-card-${status}` : "";
  const compactClass = compact ? "summary-card-compact" : "";
  const emphasizedClass = emphasized ? "summary-card-emphasized" : "";
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {detailLines.length ? (
        <div className="summary-card-details">
          {detailLines.map((line) => <p key={line} className="helper-text">{line}</p>)}
        </div>
      ) : null}
      {helper ? <p className="helper-text helper-tooltip">{helper}</p> : null}
      {actionLabel ? (
        <button className="summary-card-action" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {footerLink ? <span className="summary-card-link">{footerLink}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link className={`summary-card summary-card-clickable ${compactClass} ${emphasizedClass} ${muted ? "is-disabled-soft" : ""} ${statusClass}`.trim()} href={href}>
        {content}
      </Link>
    );
  }

  return (
    <article className={`summary-card ${compactClass} ${emphasizedClass} ${muted ? "is-disabled-soft" : ""} ${statusClass}`.trim()}>
      {content}
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

function HeroCard({ status, headline, subLine, onUpdateBalance, trustLine, trustNote }) {
  const colorClass = status ? `hero-card-${status}` : "";
  return (
    <div className={`hero-card ${colorClass}`.trim()}>
      <p className="hero-value">{headline}</p>
      {subLine ? <p className="hero-sub">{subLine}</p> : null}
      <button className="secondary-button hero-action" type="button" onClick={onUpdateBalance}>
        Update balance
      </button>
      {trustLine ? (
        <div className="hero-trust">
          <p className="hero-trust-line">{trustLine}</p>
          {trustNote ? <p className="hero-trust-note">{trustNote}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function OverviewLinksSection({ costsTotal, savingsTotal, generalSavings, assignedSavings, displayCurrency }) {
  return (
    <div className="overview-rows">
      <Link className="overview-row" href="/big-costs">
        <span className="overview-row-label">Large upcoming costs</span>
        <span style={{ display: "flex", alignItems: "center" }}>
          <span className="overview-row-value">{formatCurrency(costsTotal, displayCurrency)} planned</span>
          <span className="overview-row-arrow">→</span>
        </span>
      </Link>
      <Link className="overview-row" href="/big-costs">
        <span className="overview-row-label">Savings set aside</span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className="overview-row-value">
            {savingsTotal > 0 ? `${formatCurrency(savingsTotal, displayCurrency)} protected` : "None set"}
          </span>
          {(generalSavings > 0 || assignedSavings > 0) ? (
            <span className="overview-row-value">
              {`${formatCurrency(generalSavings, displayCurrency)} general pot + ${formatCurrency(assignedSavings, displayCurrency)} assigned`}
            </span>
          ) : null}
          <span className="overview-row-arrow">→</span>
        </span>
      </Link>
    </div>
  );
}

function BillPagination({ page, total, onPrev, onNext }) {
  return (
    <div className="bill-pagination">
      <button
        className="secondary-button"
        type="button"
        disabled={page === 0}
        onClick={onPrev}
      >← Previous</button>
      <span className="bill-pagination-label">Page {page + 1} of {total}</span>
      <button
        className="secondary-button"
        type="button"
        disabled={page >= total - 1}
        onClick={onNext}
      >Next →</button>
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

function applyQuickAddContext(parsed, quickAddContext) {
  if (!quickAddContext?.name || !parsed) {
    return parsed;
  }

  const normalisedHintName = quickAddContext.name.trim().toLowerCase();

  const attachHint = (item) => {
    if (item?.action !== "create_bill") {
      return item;
    }

    const itemName = String(item.name || "").trim().toLowerCase();

    const matchesHint =
      itemName === normalisedHintName ||
      itemName.includes(normalisedHintName) ||
      normalisedHintName.includes(itemName);

    if (item.category || !matchesHint) {
      return item;
    }

    return {
      ...item,
      category: quickAddContext.category || "household",
    };
  };

  if (parsed.action === "batch") {
    return {
      ...parsed,
      items: (parsed.items || []).map(attachHint),
    };
  }

  return attachHint(parsed);
}

async function applyParsedActions(userId, parsed, hasExistingIncome, existingBills = []) {
  const outcome = { createdBills: 0, skippedBills: 0, savedIncome: false, savedBills: [] };
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
        const payload = {
          ...bill,
          category: item.category || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        batch.set(billRef, payload);
        return batch.commit().then(() => ({
          id: billRef.id,
          ...payload,
        }));
      }),
    );
    outcome.createdBills = saveResults.filter((r) => r.status === "fulfilled").length;
    outcome.savedBills = saveResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const failures = saveResults.filter((r) => r.status === "rejected");
    if (failures.length) {
      safeError("[applyParsedActions] some bill saves failed", { count: failures.length });
    }
  }

  if (incomeItems.length) {
    try {
      await saveIncome(userId, incomeItems[incomeItems.length - 1], hasExistingIncome);
      outcome.savedIncome = true;
    } catch (saveError) {
      safeError("[applyParsedActions] income save failed", { code: saveError?.code });
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
      title: "Step 1 of 3 — Add your current available money",
      detail: "ClearTill works best when you start with your current available money, even if you want to skip it for now.",
    };
  }

  if (setupStep === 2) {
    return {
      title: "Step 2 of 3 — Add your pay date",
      detail: "Once your pay date is set, ClearTill can show what lands before you get paid.",
    };
  }

  if (setupStep === 3) {
    return {
      title: "Step 3 of 3 — Add your bills",
      detail: "Add your bills to build the forecast and runway.",
    };
  }

  return {
    title: "Setup complete — ClearTill can now show your pay-date forecast.",
    detail: "You can update your snapshot, pay date, or bills any time.",
  };
}

function getOnboardingHelperContent(target) {
  if (target === "payday") {
    return {
      target,
      title: "Next: add your pay date",
      detail: "Enter your expected pay and pay date here so ClearTill can work out what lands before you get paid.",
    };
  }

  if (target === "bills") {
    return {
      target,
      title: "Next: add your bills",
      detail: "Type one in, paste a screenshot, or use the utility shortcuts below to start building your forecast.",
    };
  }

  return null;
}

function buildBillReviewDrafts(parsed, { sourceText = "", quickAddContext = null } = {}) {
  const items = parsed?.action === "batch" ? parsed.items || [] : [parsed];

  return items
    .filter((item) => item?.action === "create_bill")
    .map((item, index) => buildBillReviewDraft(item, {
      sourceText: item?.sourceText || item?.rawText || sourceText,
      quickAddContext,
      draftIndex: index,
    }))
    .filter(Boolean);
}

function buildBillReviewDraft(item, { sourceText = "", quickAddContext = null, importJobId = "", importJobName = "", draftIndex = 0 } = {}) {
  if (!item?.name) {
    return null;
  }

  const inferred = classifyBill({ name: item.name, description: sourceText });
  const canonicalName = canonicalisePreviewBillName(item.name, inferred);

  return {
    id: `${importJobId || "draft"}-${draftIndex}-${canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "bill"}`,
    name: canonicalName,
    amount: Number.isFinite(Number(item.amount)) && Number(item.amount) > 0 ? Number(item.amount) : null,
    dueDay: isValidDueDay(item.dueDay) ? Number(item.dueDay) : null,
    frequency: item.frequency || "monthly",
    category: item.category || quickAddContext?.category || inferred.category || "other",
    subCategory: inferred.subCategory || null,
    confidence: Number(item.confidence ?? inferred.confidence ?? 0.65),
    sourceText: sourceText || "",
    sourceLabel: importJobName || "",
    missingFields: [
      ...(Number.isFinite(Number(item.amount)) && Number(item.amount) > 0 ? [] : ["amount"]),
      ...(isValidDueDay(item.dueDay) ? [] : ["dueDay"]),
    ],
  };
}

function buildLooseBillReviewDraft(sourceText, quickAddContext) {
  const text = String(sourceText || "").trim();
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();
  const amountMatch = lower.match(/(?:£|\bgbp\b|\bpounds?\b|\bquid\b)\s*(\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)/i)
    || lower.match(/\b(\d{1,4}(?:\.\d{1,2})?)\s*(?:pounds?|quid)\b/i);
  const dueMatch = lower.match(/\b([12]?\d|3[01])(st|nd|rd|th)\b/i)
    || lower.match(/\b(?:on|due(?:\s+on)?|comes out)\s+(?:the\s+)?([12]?\d|3[01])\b/i);
  const roughName = text
    .replace(/(?:£|\bgbp\b|\bpounds?\b|\bquid\b)\s*\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?/gi, " ")
    .replace(/\b\d{1,5}(?:\.\d{1,2})?\b/g, " ")
    .replace(/\b(my|i|have|its|it's|that|this|comes out|comes|out|around|about|approximately|every|month|each|of|on|the|due)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!roughName) {
    return null;
  }

  return buildBillReviewDraft({
    action: "create_bill",
    name: roughName,
    amount: amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null,
    dueDay: dueMatch ? Number(dueMatch[1]) : null,
    frequency: "monthly",
    category: quickAddContext?.category || null,
    confidence: 0.52,
  }, { sourceText: text, quickAddContext });
}

function canonicalisePreviewBillName(name, classified) {
  const text = String(name || "").trim().toLowerCase();

  if (!text) {
    return "";
  }

  const canonicalMap = [
    [/octopus/, "Octopus Energy"],
    [/british gas/, "British Gas"],
    [/\be\.?on\b/, "E.ON"],
    [/\bovo\b/, "OVO Energy"],
    [/shell energy/, "Shell Energy"],
    [/vodafone/, "Vodafone"],
    [/\bo2\b/, "O2"],
    [/\bee\b/, "EE"],
    [/giffgaff/, "giffgaff"],
  ];

  const matched = canonicalMap.find(([pattern]) => pattern.test(text));
  if (matched) {
    return matched[1];
  }

  if (!/[a-z]/i.test(text) && classified?.subCategory) {
    return prettifySubCategory(classified.subCategory);
  }

  if (classified?.subCategory && ["energy", "water", "wastewater", "council_tax", "broadband", "mobile"].includes(classified.subCategory)) {
    const genericNames = {
      energy: "Gas",
      water: "Water",
      wastewater: "Wastewater",
      council_tax: "Council Tax",
      broadband: "Broadband",
      mobile: "Mobile",
    };
    const plainWords = ["bill", "payment", "direct debit", "standing order"];
    if (plainWords.some((word) => text === word || text.includes(`${word} `))) {
      return genericNames[classified.subCategory];
    }
  }

  return name;
}

function prettifySubCategory(value) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
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

function friendlyGoogleAuthError(error) {
  const code = error?.code || "";

  if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
    return "Google sign-in was blocked by the browser. Please try again, or use email sign-in.";
  }

  if (code === "auth/unauthorized-domain") {
    return "Google sign-in was blocked for this domain. Add this Vercel domain in Firebase Authentication > Settings > Authorized domains.";
  }

  if (code === "auth/operation-not-allowed") {
    return "Google sign-in is not enabled in Firebase Authentication yet.";
  }

  const message = friendlyAuthError(error);

  if (message !== "Something went wrong. Try again.") {
    return message;
  }

  return "Google sign-in failed. Check Firebase Google sign-in and Authorized domains, then try again.";
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

  const hasDraftBill = Boolean(parsed?.needsDueDay);
  const parts = [];

  if (outcome.createdBills > 0) {
    if (hasDraftBill && outcome.createdBills === 1) {
      parts.push("Saved 1 bill draft.");
    } else {
      parts.push(
        outcome.createdBills === 1
          ? "Logged 1 new bill."
          : `Logged ${outcome.createdBills} new bills.`,
      );
    }
  }

  if (outcome.skippedBills > 0) {
    parts.push(
      outcome.skippedBills === 1
        ? "Skipped 1 duplicate."
        : `Skipped ${outcome.skippedBills} duplicates.`,
    );
  }

  if (outcome.savedIncome) {
    parts.push("Pay date updated.");
  }

  if (parsed.responseMessage) {
    parts.push(parsed.responseMessage);
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
    parts.push("Pay date updated.");
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
