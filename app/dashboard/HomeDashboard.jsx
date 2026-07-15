"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import AccessLockPanel from "@/components/AccessLockPanel";
import RepairAccessButton from "@/app/billing/success/RepairAccessButton";
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
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
  googleProvider,
  isFirebaseClientConfigured,
  missingFirebaseClientEnv,
} from "@/lib/firebase";
import {
  calculateDashboard,
  calculateLargeCostImpact,
  diffDays,
  formatCurrency,
  formatDisplayDate,
  getTodayIso,
  isValidDueDay,
} from "@/lib/billMath";
import { calculateLargeCostAffordabilityPlans } from "@/lib/largeCostPlanner";
import { calculateSafeSpendingPlan, expandIncomeEvents } from "@/lib/cashflowTimeline";
import { hasActiveIncomeSchedule } from "@/lib/incomeSchedule";
import { trackEvent } from "@/lib/analytics/track";
import { getStoredAttribution } from "@/lib/analytics/attribution";
import { logSecurityEventClient } from "@/lib/security/clientSecurity";
import { safeError } from "@/lib/security/safeLog";
import { postDashboardSettingsAction, postDashboardStateAction, saveIncome as saveIncomeRequest } from "./lib/dashboardApi";
import { friendlyAuthError, friendlyGoogleAuthError, friendlySettingsError } from "./lib/friendlyErrors";
import CollapsibleSection from "./components/CollapsibleSection";
import HeroCard from "./components/HeroCard";
import { triggerQuickAction } from "./components/QuickActions";
import AttentionStrip, { STALE_BALANCE_DAYS } from "./components/AttentionStrip";
import BalanceEditor from "./components/BalanceEditor";
import AddBills from "./components/AddBills";
import BillList from "./components/BillList";
import LargeCostForm from "./components/LargeCostForm";
import SavingsEditor from "./components/SavingsEditor";
import UtilitiesTracker, { buildTrackerChecks } from "./components/UtilitiesTracker";
import FourWeekChart from "./components/FourWeekChart";
import PayPeriodCards from "./components/PayPeriodCards";
import SetupWizard from "./components/SetupWizard";

const RECENT_SESSION_STORAGE_KEY = "cleartill_recent_checkout_session_id";
const SETUP_COMPLETED_STORAGE_KEY = "ct.setup.completedAt";
const JUST_FINISHED_ONBOARDING_KEY = "ct.onboarding.justFinishedBills";

function isValidIncomeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0;
}

function toDateMaybe(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

function getSafeNextPath(value) {
  const nextPath = String(value || "").trim();

  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "";
  }

  if (nextPath === "/dashboard") {
    return "";
  }

  return nextPath;
}

function HomeDashboardFallback() {
  return (
    <main className="home-shell">
      <section className="home-panel">
        <p>Loading dashboard...</p>
      </section>
    </main>
  );
}

function HomeDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [bills, setBills] = useState([]);
  const [largeCosts, setLargeCosts] = useState([]);
  const [savings, setSavings] = useState(null);
  const [income, setIncome] = useState(null);
  const [incomeEvents, setIncomeEvents] = useState([]);
  const [account, setAccount] = useState(null);
  const [accessCheck, setAccessCheck] = useState({
    state: "checking",
    accessActive: false,
    accessUntil: null,
    stripeCheckoutSessionId: null,
  });
  const [reminders, setReminders] = useState([]);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [accessLoaded, setAccessLoaded] = useState(false);
  const [recentCheckoutSessionId, setRecentCheckoutSessionId] = useState("");
  const [isAnalyticsAdmin, setIsAnalyticsAdmin] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState("GBP");
  const [signingIn, setSigningIn] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [authError, setAuthError] = useState("");
  const [emailForm, setEmailForm] = useState({ email: "", password: "" });
  const [pageNotice, setPageNotice] = useState("");
  const [billsBusy, setBillsBusy] = useState(false);
  const [balanceEditorOpen, setBalanceEditorOpen] = useState(false);
  const [focusPayday, setFocusPayday] = useState(false);
  const [balanceImpact, setBalanceImpact] = useState("");
  const [highlightPrimaryResult, setHighlightPrimaryResult] = useState(false);
  const [pendingBalanceResult, setPendingBalanceResult] = useState(null);

  const [optimisticBalance, setOptimisticBalance] = useState(null);
  const [optimisticIncome, setOptimisticIncome] = useState(null);
  const [balanceInput, setBalanceInput] = useState("");
  const [balanceError, setBalanceError] = useState("");
  const [savingBalance, setSavingBalance] = useState(false);
  const [incomeForm, setIncomeForm] = useState({ amount: "", payDay: "" });
  const [editingIncome, setEditingIncome] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const balanceSaveRequestRef = useRef(0);
  const primaryResultRef = useRef(null);

  const requestedAuthMode = searchParams.get("auth") === "signup" ? "signup" : "signin";
  const requestedNextPath = getSafeNextPath(searchParams.get("next"));

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
    if (!user) {
      setIsAnalyticsAdmin(false);
      return undefined;
    }

    let cancelled = false;

    user.getIdToken().then((idToken) =>
      fetch("/api/admin/analytics/access", {
        headers: { Authorization: `Bearer ${idToken}` },
      }),
    ).then((response) => response.json())
      .then((payload) => {
        if (!cancelled) setIsAnalyticsAdmin(Boolean(payload?.isAdmin));
      })
      .catch(() => {
        if (!cancelled) setIsAnalyticsAdmin(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedSessionId = window.localStorage.getItem(RECENT_SESSION_STORAGE_KEY) || "";
    if (storedSessionId) {
      setRecentCheckoutSessionId(storedSessionId);
    }
  }, []);

  useEffect(() => {
    setAuthMode(requestedAuthMode);
    setAuthError("");
  }, [requestedAuthMode]);

  useEffect(() => {
    if (!authReady || !user || user.isAnonymous || !requestedNextPath) {
      return;
    }

    router.replace(requestedNextPath);
  }, [authReady, requestedNextPath, router, user]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    if (!user) {
      setAccessCheck({
        state: "signed_out",
        accessActive: false,
        accessUntil: null,
        stripeCheckoutSessionId: null,
      });
      setAccessLoaded(true);
      return;
    }

    let cancelled = false;

    async function loadAccess() {
      setAccessLoaded(false);

      try {
        const idToken = await user.getIdToken();

        if (cancelled) {
          return;
        }

        const response = await fetch("/api/access", {
          headers: { Authorization: `Bearer ${idToken}` },
        });

        if (cancelled) {
          return;
        }

        const payload = await response.json().catch(() => ({}));

        if (cancelled) {
          return;
        }

        setAccessCheck({
          state: payload?.state || "access_check_error",
          accessActive: Boolean(payload?.accessActive),
          accessUntil: payload?.accessUntil || null,
          stripeCheckoutSessionId: payload?.stripeCheckoutSessionId || null,
        });

        if (payload?.stripeCheckoutSessionId && typeof window !== "undefined") {
          window.localStorage.setItem(RECENT_SESSION_STORAGE_KEY, payload.stripeCheckoutSessionId);
          setRecentCheckoutSessionId(payload.stripeCheckoutSessionId);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setAccessCheck({
          state: "access_check_error",
          accessActive: false,
          accessUntil: null,
          stripeCheckoutSessionId: null,
        });
      } finally {
        if (!cancelled) {
          setAccessLoaded(true);
        }
      }
    }

    loadAccess();

    return () => {
      cancelled = true;
    };
  }, [authReady, user]);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setBills([]);
      setLargeCosts([]);
      setSavings(null);
      setIncome(null);
      setIncomeEvents([]);
      setAccount(null);
      setBalanceInput("");
      setIncomeForm({ amount: "", payDay: "" });
      setOptimisticBalance(null);
      setOptimisticIncome(null);
      setAccountLoaded(false);
      setReminders([]);
      return undefined;
    }

    setAccountLoaded(false);

    void postDashboardStateAction()
      .then((payload) => {
        if (cancelled) {
          return;
        }

        const nextIncome = payload?.income || null;
        const nextAccount = payload?.balance || null;

        setBills(Array.isArray(payload?.bills) ? payload.bills : []);
        setLargeCosts(Array.isArray(payload?.largeCosts) ? payload.largeCosts : []);
        setSavings(payload?.savings || null);
        setIncome(nextIncome);
        setIncomeEvents(Array.isArray(payload?.incomeEvents) ? payload.incomeEvents : []);
        setOptimisticIncome(null);
        setIncomeForm({
          amount: nextIncome?.amount === null || nextIncome?.amount === undefined ? "" : String(nextIncome.amount),
          payDay: nextIncome?.payDay === null || nextIncome?.payDay === undefined ? "" : String(nextIncome.payDay),
        });
        setAccount(nextAccount);
        setOptimisticBalance(null);
        setBalanceInput(nextAccount?.currentBalance?.toString() || "");
        setReminders(Array.isArray(payload?.reminders) ? payload.reminders : []);

        if (payload?.preferences?.currency) {
          setDisplayCurrency(payload.preferences.currency);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setBills([]);
        setLargeCosts([]);
        setSavings(null);
        setIncome(null);
        setIncomeEvents([]);
        setAccount(null);
        setReminders([]);
      })
      .finally(() => {
        if (!cancelled) {
          setAccountLoaded(true);
        }
      });

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
    if (displayIncome && isValidDueDay(displayIncome.payDay)) return displayIncome;
    const monthlySource = incomeEvents.find((source) => source?.active !== false
      && source?.frequency === "monthly"
      && source?.confidence !== "estimated"
      && Number(source?.amount) > 0
      && /^\d{4}-\d{2}-\d{2}$/.test(String(source?.firstPaymentDate || source?.expectedDate || "")));
    if (!monthlySource) return displayIncome ? { ...displayIncome, payDay: null } : null;
    const firstPaymentDate = monthlySource.firstPaymentDate || monthlySource.expectedDate;
    return { name: monthlySource.name, amount: Number(monthlySource.amount), payDay: Number(firstPaymentDate.slice(8, 10)), active: true };
  }, [displayIncome, incomeEvents]);

  const dashboard = useMemo(
    () => calculateDashboard(bills, incomeForDashboard, displayAccount, undefined, displayCurrency),
    [bills, displayAccount, displayCurrency, incomeForDashboard],
  );

  const todayIso = getTodayIso();
  const generalProtectedSavings = Math.max(0, Number(savings?.totalSetAside) || 0);
  const balanceValue = displayAccount?.currentBalance;
  const hasBalanceSnapshot = balanceValue !== undefined && balanceValue !== null && balanceValue !== "" && Number.isFinite(Number(balanceValue));
  const hasPayday = isValidDueDay(incomeForDashboard?.payDay);
  const hasIncomeAmount = isValidIncomeAmount(incomeForDashboard?.amount);
  const hasIncomeSchedule = hasActiveIncomeSchedule(incomeEvents);
  const hasBills = bills.length > 0;
  // First-time onboarding shouldn't bounce someone out of "add your bills"
  // the instant they add one — let them keep going until they say they're
  // done. Returning users (who've completed setup before) skip this: as
  // soon as they have a bill again, they're back on the full dashboard.
  const hasCompletedSetupBefore = typeof window !== "undefined" && Boolean(window.localStorage.getItem(SETUP_COMPLETED_STORAGE_KEY));
  const [billsStepConfirmed, setBillsStepConfirmed] = useState(false);
  const setupStep = !hasBalanceSnapshot
    ? 1
    : !hasIncomeSchedule
      ? 2
      : (!hasCompletedSetupBefore && !billsStepConfirmed)
        ? 3
        : 4;

  useEffect(() => {
    if (setupStep === 4 && typeof window !== "undefined" && !window.localStorage.getItem(SETUP_COMPLETED_STORAGE_KEY)) {
      window.localStorage.setItem(SETUP_COMPLETED_STORAGE_KEY, new Date().toISOString());
    }
  }, [setupStep]);

  function handleFinishBillsStep() {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(JUST_FINISHED_ONBOARDING_KEY, "1");
    }
    setBillsStepConfirmed(true);
  }

  // Land on the Bills section, already open and scrolled into view, the
  // moment someone finishes onboarding — instead of a fully collapsed
  // dashboard they'd have to go hunting through.
  useEffect(() => {
    if (setupStep !== 4 || typeof window === "undefined") return;
    if (window.sessionStorage.getItem(JUST_FINISHED_ONBOARDING_KEY) !== "1") return;
    window.sessionStorage.removeItem(JUST_FINISHED_ONBOARDING_KEY);
    triggerQuickAction("bills", "add-bills");
  }, [setupStep]);

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
  const largeCostPlans = useMemo(() => calculateLargeCostAffordabilityPlans({
    todayIso,
    paydayDate: dashboard.paydayDate,
    currentBalance: hasBalanceSnapshot ? dashboard.currentBalance : 0,
    incomeAmount: 0,
    additionalIncomeEvents: incomeEvents,
    bills: [...dashboard.beforePayday, ...dashboard.afterPayday],
    largeCosts: largeCostImpact.costs,
    savingsAvailable: largeCostImpact.totalProtectedSavings,
  }), [
    dashboard.afterPayday,
    dashboard.beforePayday,
    dashboard.currentBalance,
    dashboard.paydayDate,
    displayIncome?.amount,
    hasBalanceSnapshot,
    hasIncomeAmount,
    incomeEvents,
    largeCostImpact.costs,
    largeCostImpact.totalProtectedSavings,
    todayIso,
  ]);
  const bigCostsDueBeforePayday = largeCostPlans.summary.currentPeriodProtected;
  const unassignedCostsBeforePayday = useMemo(() => {
    if (!dashboard.paydayDate) return 0;
    return largeCostImpact.costs.reduce((total, cost) => {
      if (!cost.nextDueDate || cost.nextDueDate >= dashboard.paydayDate) return total;
      if (cost.fundingStatus !== "unassigned") return total;
      return total + (Number(cost.amount) || 0);
    }, 0);
  }, [dashboard.paydayDate, largeCostImpact.costs]);
  const totalProtectedSavings = largeCostImpact.totalProtectedSavings;
  const rollingHorizonDate = useMemo(() => {
    const date = new Date(`${todayIso}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 28);
    return date.toISOString().slice(0, 10);
  }, [todayIso]);
  const forecastHorizonDate = dashboard.paydayDate || rollingHorizonDate;
  const forecastBills = dashboard.paydayDate ? dashboard.beforePayday : dashboard.afterPayday;
  const safeSpendingPlan = useMemo(() => (
    hasBalanceSnapshot && hasIncomeSchedule
      ? calculateSafeSpendingPlan({
        todayIso,
        horizonDate: forecastHorizonDate,
        currentBalance: dashboard.currentBalance,
        bills: forecastBills,
        largeCostAllocations: largeCostPlans.chartAllocations,
        additionalIncomeEvents: incomeEvents,
      })
      : null
  ), [
    dashboard.currentBalance,
    forecastBills,
    forecastHorizonDate,
    hasBalanceSnapshot,
    hasIncomeSchedule,
    incomeEvents,
    largeCostPlans.chartAllocations,
    todayIso,
  ]);
  const spendingRoomUntilPayday = safeSpendingPlan?.spendingRoom ?? null;
  const dailySpendingRoom = safeSpendingPlan?.safeDailyAmount ?? null;
  const estimatedIncomeOccurrences = useMemo(() => (
    expandIncomeEvents(incomeEvents, todayIso, forecastHorizonDate, { confirmedOnly: false })
      .filter((item) => item.confidence === "estimated" && item.date < forecastHorizonDate)
  ), [forecastHorizonDate, incomeEvents, todayIso]);
  const estimatedIncomeTotal = estimatedIncomeOccurrences.reduce((total, item) => total + (Number(item.amount) || 0), 0);

  useEffect(() => {
    if (!pendingBalanceResult) return;

    const { previousBalance, previousResult, nextBalance, focusResult } = pendingBalanceResult;
    const resultChange = previousResult === null || spendingRoomUntilPayday === null
      ? null
      : spendingRoomUntilPayday - previousResult;
    let impact = "Your dashboard result has been recalculated.";

    if (resultChange !== null && Math.abs(resultChange) >= 0.005) {
      if (previousResult < 0 && resultChange > 0) {
        impact = `Your shortfall reduced by ${formatCurrency(Math.min(Math.abs(previousResult), resultChange), displayCurrency)}.`;
      } else if (spendingRoomUntilPayday < 0 && resultChange < 0) {
        impact = `Your shortfall increased by ${formatCurrency(Math.abs(resultChange), displayCurrency)}.`;
      } else if (resultChange > 0) {
        impact = `Your safe-to-spend amount increased by ${formatCurrency(resultChange, displayCurrency)}.`;
      } else {
        impact = `Your safe-to-spend amount decreased by ${formatCurrency(Math.abs(resultChange), displayCurrency)}.`;
      }
    }

    setPageNotice(Number.isFinite(previousBalance)
      ? `Balance updated from ${formatCurrency(previousBalance, displayCurrency)} to ${formatCurrency(nextBalance, displayCurrency)}.`
      : `Balance updated to ${formatCurrency(nextBalance, displayCurrency)}.`);
    setBalanceImpact(impact);
    setPendingBalanceResult(null);

    if (focusResult) {
      setBalanceEditorOpen(false);
      setHighlightPrimaryResult(true);
      window.setTimeout(() => {
        primaryResultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        primaryResultRef.current?.focus({ preventScroll: true });
      }, 50);
      window.setTimeout(() => setHighlightPrimaryResult(false), 1800);
    }
  }, [displayCurrency, pendingBalanceResult, spendingRoomUntilPayday]);

  const clearTillStatus = (() => {
    if (!hasBalanceSnapshot || !hasIncomeSchedule || spendingRoomUntilPayday === null) return "";
    if (spendingRoomUntilPayday < 0) return "negative";
    if (unassignedCostsBeforePayday > 0 || estimatedIncomeTotal > 0 || buildTrackerChecks(bills).some((check) => !check.found)) return "attention";
    if (spendingRoomUntilPayday < 50) return "low";
    return "ok";
  })();
  const spendingRoomFallbackCopy = (() => {
    if (!hasBalanceSnapshot || !hasIncomeSchedule || spendingRoomUntilPayday === null || spendingRoomUntilPayday >= 0 || totalProtectedSavings <= 0) {
      return "Not counted as daily spending money.";
    }
    return "Your savings now could cover this, but ClearTill does not count savings as daily spending money.";
  })();
  const spendingRoomValue = (() => {
    if (!hasBalanceSnapshot) return "Unlocks after you add your balance";
    if (!hasIncomeSchedule) return "Add an income schedule";
    if (spendingRoomUntilPayday === null) return "—";
    if (spendingRoomUntilPayday < 0) return `${formatCurrency(Math.abs(spendingRoomUntilPayday), displayCurrency)} needed before payday`;
    return formatCurrency(spendingRoomUntilPayday, displayCurrency);
  })();

  const toDisclosureItems = (items, fallbackName, type) => (items || []).map((item, index) => ({
    id: item.id || `${type}-${index}`,
    name: item.name || fallbackName,
    date: item.nextDueDate || item.date,
    amount: Number(item.currentAccountAmount ?? item.amount) || 0,
    type,
  })).filter((item) => item.date && item.amount > 0);
  const beforePaydayBillItems = toDisclosureItems(forecastBills, "Bill", "bill");
  const beforePaydayLargeCostItems = toDisclosureItems(
    largeCostPlans.chartAllocations.filter((item) => (item.nextDueDate || item.date) < forecastHorizonDate),
    "Large-cost funding",
    "large_cost",
  );

  const nextPaydayDate = useMemo(() => {
    if (!dashboard.paydayDate) return null;
    const date = new Date(`${dashboard.paydayDate}T12:00:00.000Z`);
    const day = date.getUTCDate();
    const nextMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 0, 12));
    return `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, nextMonth.getUTCDate())).padStart(2, "0")}`;
  }, [dashboard.paydayDate]);
  const nextPeriodBills = useMemo(() => {
    if (!dashboard.paydayDate || !nextPaydayDate) return [];
    return bills.filter((bill) => bill?.active !== false && Number(bill?.amount) > 0).map((bill, index) => {
      const dueDay = Math.min(31, Math.max(1, Number(bill.dueDay) || 1));
      const start = new Date(`${dashboard.paydayDate}T12:00:00.000Z`);
      for (let monthOffset = 0; monthOffset <= 1; monthOffset += 1) {
        const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthOffset + 1, 0, 12));
        const date = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(dueDay, last.getUTCDate())).padStart(2, "0")}`;
        if (date >= dashboard.paydayDate && date < nextPaydayDate) {
          return { id: bill.id || `bill-${index}`, name: bill.name || "Bill", date, amount: Number(bill.amount), type: "bill" };
        }
      }
      return null;
    }).filter(Boolean);
  }, [bills, dashboard.paydayDate, nextPaydayDate]);
  const nextPeriodLargeCosts = toDisclosureItems(
    largeCostPlans.chartAllocations.filter((item) => item.periodIndex === 1),
    "Large-cost funding",
    "large_cost",
  );
  const scheduledIncomeOccurrences = dashboard.paydayDate && nextPaydayDate
    ? expandIncomeEvents(incomeEvents, todayIso, nextPaydayDate).filter((item) => item.date < nextPaydayDate)
    : (safeSpendingPlan?.incomeOccurrences || []);
  const upcomingIncome = [
    ...scheduledIncomeOccurrences.map((item) => ({ ...item, id: item.occurrenceId, type: "income" })),
  ].filter((item) => item.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.name).localeCompare(String(b.name)));
  const sumItemAmounts = (items) => items.reduce((total, item) => total + item.amount, 0);
  const currentPeriodIncome = dashboard.paydayDate
    ? upcomingIncome.filter((item) => item.date < dashboard.paydayDate)
    : upcomingIncome;
  const currentIncomeTotal = sumItemAmounts(currentPeriodIncome);
  const nextPeriodIncome = [
    ...upcomingIncome.filter((item) => item.date >= dashboard.paydayDate && item.date < nextPaydayDate),
  ];
  const nextIncomeTotal = sumItemAmounts(nextPeriodIncome);
  const nextBillTotal = sumItemAmounts(nextPeriodBills);
  const nextLargeCostTotal = sumItemAmounts(nextPeriodLargeCosts);
  const nextFreeCash = nextIncomeTotal - nextBillTotal - nextLargeCostTotal;
  const nextPeriodDays = dashboard.paydayDate && nextPaydayDate ? Math.max(1, diffDays(dashboard.paydayDate, nextPaydayDate)) : 1;

  const largeCostsWithStatus = useMemo(
    () => {
      const plansById = new Map(largeCostPlans.plans.map((plan) => [plan.costId, plan]));
      return [...largeCostImpact.costs]
      .sort((a, b) => {
        if (a.status === "due_now" && b.status !== "due_now") return -1;
        if (a.status !== "due_now" && b.status === "due_now") return 1;
        if (a.nextDueDate && b.nextDueDate) return String(a.nextDueDate).localeCompare(String(b.nextDueDate));
        return String(a.name || "").localeCompare(String(b.name || ""));
      })
      .map((cost) => ({
        ...cost,
        affordabilityPlan: plansById.get(cost.id) || null,
        fundingMeta: {
          unassigned: { label: "Unassigned", note: "Choose how this will be paid." },
          current_account: { label: "Current balance", note: "Uses this pay cycle or a future pay period. Only the planned amount reduces daily spending room." },
          savings: { label: "Savings", note: "Covered by savings. Not counted as daily spending money." },
          split: { label: "Split", note: "Partly covered by savings. Only the remaining amount affects daily spending room." },
        }[cost.fundingStatus] || { label: "Unassigned", note: "Choose how this will be paid." },
      }));
    },
    [largeCostImpact.costs, largeCostPlans.plans],
  );
  const daysSinceBalanceSnapshot = useMemo(() => {
    const snapshotDate = toDateMaybe(displayAccount?.snapshotEnteredAt || displayAccount?.updatedAt);
    if (!snapshotDate || !hasBalanceSnapshot) return null;
    return diffDays(getTodayIso(snapshotDate), todayIso);
  }, [displayAccount?.snapshotEnteredAt, displayAccount?.updatedAt, hasBalanceSnapshot, todayIso]);
  const setupCompletedDaysAgo = useMemo(() => {
    if (typeof window === "undefined") return null;
    const storedAt = window.localStorage.getItem(SETUP_COMPLETED_STORAGE_KEY);
    if (!storedAt) return null;
    return diffDays(getTodayIso(new Date(storedAt)), todayIso);
  }, [todayIso]);
  const staleBalanceDaysForStrip = (
    daysSinceBalanceSnapshot !== null
    && (setupCompletedDaysAgo === null || setupCompletedDaysAgo >= STALE_BALANCE_DAYS)
  ) ? daysSinceBalanceSnapshot : null;
  const balanceSnapshotDate = toDateMaybe(displayAccount?.snapshotEnteredAt || displayAccount?.updatedAt);
  const balanceFreshness = optimisticBalance !== null
    ? "Updated just now"
    : balanceSnapshotDate
      ? `Updated ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: balanceSnapshotDate.getFullYear() === new Date().getFullYear() ? undefined : "numeric", timeZone: "Europe/London" }).format(balanceSnapshotDate)}`
      : "Update time unavailable";
  const balanceIsStale = hasBalanceSnapshot && (staleBalanceDaysForStrip === null
    ? !balanceSnapshotDate
    : staleBalanceDaysForStrip >= STALE_BALANCE_DAYS);

  const billsDueSoon = useMemo(() => {
    const candidates = dashboard.paydayDate
      ? dashboard.beforePayday
      : dashboard.upcomingBills;
    return (candidates || []).filter((bill) => {
      if (!bill.nextDueDate) return false;
      const days = diffDays(todayIso, bill.nextDueDate);
      return days >= 0 && days <= 3;
    });
  }, [dashboard.beforePayday, dashboard.paydayDate, dashboard.upcomingBills, todayIso]);

  const nextDueBill = (dashboard.paydayDate ? [...dashboard.beforePayday, ...dashboard.afterPayday] : dashboard.upcomingBills)?.[0];
  const billsSummaryValue = !hasBills
    ? "No bills yet"
    : `${formatCurrency(totalMonthlyBills, displayCurrency)}/mo${nextDueBill ? ` · next ${formatDisplayDate(nextDueBill.nextDueDate)}` : ""}`;
  const largeCostsSummaryValue = largeCostPlans.plans.length
    ? `${largeCostPlans.plans.length} planned${largeCostPlans.summary.closestDueDate ? ` · next ${formatDisplayDate(largeCostPlans.summary.closestDueDate)}` : ""}`
    : "None planned";
  const trackerChecks = useMemo(() => buildTrackerChecks(bills), [bills]);
  const utilitiesSummaryValue = `${trackerChecks.filter((c) => c.found).length} of ${trackerChecks.length}`;
  const nextCommitments = [...beforePaydayBillItems, ...beforePaydayLargeCostItems]
    .filter((item) => item.date >= todayIso && item.date < forecastHorizonDate)
    .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  function trackAccountCreated(method) {
    trackEvent("account_created", { method, attribution: getStoredAttribution() });
    trackEvent("onboarding_started");
  }

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
        await linkWithPopup(auth.currentUser, googleProvider);
        trackAccountCreated("google");
        return;
      }

      const result = await signInWithPopup(auth, googleProvider);
      if (getAdditionalUserInfo(result)?.isNewUser) {
        trackAccountCreated("google");
      } else {
        trackEvent("login", { method: "google" });
      }
    } catch (signInError) {
      if (
        signInError?.code === "auth/credential-already-in-use"
        && auth.currentUser?.isAnonymous
      ) {
        try {
          await auth.currentUser.delete().catch(() => signOut(auth));
          const retryResult = await signInWithPopup(auth, googleProvider);
          if (getAdditionalUserInfo(retryResult)?.isNewUser) {
            trackAccountCreated("google");
          } else {
            trackEvent("login", { method: "google" });
          }
          return;
        } catch (retryError) {
          setAuthError(friendlyGoogleAuthError(retryError));
          setSigningIn(false);
          return;
        }
      }
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

    if (authMode === "signup") {
      trackEvent("signup_started", { method: "password" });
    }

    try {
      await authPersistenceReady;

      if (authMode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
        trackAccountCreated("password");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        trackEvent("login", { method: "password" });
      }
    } catch (emailError) {
      setAuthError(friendlyAuthError(emailError));
    } finally {
      setSigningIn(false);
    }
  }

  async function handleBalanceSave(event) {
    event.preventDefault();

    const trimmedBalanceInput = balanceInput.trim();

    if (!trimmedBalanceInput) {
      setBalanceError("");
      setPageNotice("You can add your current available money later for a more accurate forecast.");
      setOptimisticBalance(null);
      setBalanceInput("");

      try {
        await postDashboardSettingsAction("save_balance", {
          currentBalance: null,
          currency: "GBP",
          snapshotEntered: false,
        });
      } catch (saveError) {
        safeError("[dashboard-settings-balance-save] failed", { code: saveError?.code });
      }
      return;
    }

    const parsedBalance = Number(trimmedBalanceInput);

    if (!Number.isFinite(parsedBalance)) {
      setBalanceError("Add your current available money as a number.");
      return;
    }

    const saveRequestId = balanceSaveRequestRef.current + 1;
    balanceSaveRequestRef.current = saveRequestId;
    const previousBalance = Number(displayAccount?.currentBalance);
    const previousResult = spendingRoomUntilPayday;

    setBalanceError("");
    setPageNotice("");
    setBalanceImpact("");
    setOptimisticBalance(parsedBalance);
    setBalanceInput(parsedBalance.toString());
    setSavingBalance(true);

    try {
      await postDashboardSettingsAction("save_balance", {
        currentBalance: parsedBalance,
        currency: "GBP",
        snapshotEntered: true,
      });

      if (balanceSaveRequestRef.current !== saveRequestId) {
        return;
      }

      logSecurityEventClient("balance_updated");
      setPendingBalanceResult({
        previousBalance,
        previousResult,
        nextBalance: parsedBalance,
        focusResult: setupStep === 4,
      });
    } catch (saveError) {
      if (balanceSaveRequestRef.current !== saveRequestId) {
        return;
      }

      safeError("[dashboard-settings-balance-save] failed", { code: saveError?.code });
      setOptimisticBalance(null);
      setPageNotice("");
      setBalanceError(friendlySettingsError(saveError, "Current available money could not be saved."));
    } finally {
      if (balanceSaveRequestRef.current === saveRequestId) {
        setSavingBalance(false);
      }
    }
  }

  async function handleCurrencySave(currency) {
    setDisplayCurrency(currency);
    setBalanceError("");
    try {
      await postDashboardSettingsAction("save_preferences", { currency });
    } catch (saveError) {
      safeError("[dashboard-settings-preferences-save] failed", { code: saveError?.code });
      setBalanceError(friendlySettingsError(saveError, "Display currency could not be saved."));
    }
  }

  async function handleIncomeSave(event) {
    event.preventDefault();

    const incomeAmountInput = incomeForm.amount;
    const payDayInput = incomeForm.payDay;
    const amount = Number(incomeAmountInput);
    const payDay = Number(payDayInput);

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

    setEditingIncome(false);

    try {
      await saveIncomeRequest(parsedIncome, Boolean(income));
      trackEvent("payday_added");
      setPageNotice("Forecast settings saved.");
    } catch (saveError) {
      safeError("[firestore-payday-save] failed", { code: saveError?.code });
      setOptimisticIncome(null);
      setEditingIncome(true);
      setPageNotice("");
      setEditError(friendlySettingsError(saveError, "We could not save your forecast settings."));
    } finally {
      setSavingEdit(false);
    }
  }

  function handleAddMissingUtility(check) {
    if (!check) return;
    triggerQuickAction("bills", "add-bills", {
      name: check.label,
      category: "household",
      subCategory: check.key,
    });
  }

  function openBalanceEditor(withFocusPayday) {
    setFocusPayday(Boolean(withFocusPayday));
    setBalanceEditorOpen(true);
  }

  if (!authReady) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Loading your payday forecast…</h1>
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

  if (!user) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Know you&apos;re clear till you&apos;re paid.</h1>
          <p>ClearTill helps you plan your money without connecting to your bank.</p>
          <TrustShield className="auth-trust-banner" compact />
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
          {authError ? <p className="error">{authError}</p> : null}
        </section>
      </main>
    );
  }

  if (!accessLoaded) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Checking your access…</h1>
        </section>
      </main>
    );
  }

  if (accessCheck.state === "signed_out") {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Checking your access…</h1>
          <p className="helper-text">Your ClearTill login needs to be active before we can open your dashboard.</p>
          <div className="topbar-actions">
            <Link className="primary-link" href="/billing">Go to billing</Link>
            <Link className="secondary-button" href="/">Home</Link>
          </div>
        </section>
      </main>
    );
  }

  if (accessCheck.state === "access_missing") {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>We could not find active access for this account.</h1>
          <p className="helper-text">If you have already paid, repair your access without going back to Stripe.</p>
          <div className="topbar-actions">
            <Link className="primary-link" href="/billing">Go to billing</Link>
            <Link className="secondary-button" href="/account">Account</Link>
          </div>
          {recentCheckoutSessionId ? (
            <RepairAccessButton
              sessionId={recentCheckoutSessionId}
              successMessage="Your ClearTill access is active."
              onSuccess={() => window.location.reload()}
            />
          ) : null}
        </section>
      </main>
    );
  }

  if (accessCheck.state === "access_check_error") {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Sign in to continue.</h1>
          <p className="helper-text">We hit a problem while checking access for this account.</p>
          <div className="topbar-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setAccessLoaded(false);
                window.location.reload();
              }}
            >
              Try again
            </button>
            <Link className="secondary-button" href="/billing">Go to billing</Link>
          </div>
        </section>
      </main>
    );
  }

  if (accessCheck.state === "access_expired") {
    return <AccessLockPanel shellClassName="dashboard-shell" />;
  }

  if (!accountLoaded) {
    return (
      <main className="dashboard-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Loading your payday forecast…</h1>
        </section>
      </main>
    );
  }

  if (setupStep < 4) {
    return (
      <SetupWizard
        setupStep={setupStep}
        hasBalanceSnapshot={hasBalanceSnapshot}
        currentBalance={dashboard.currentBalance}
        balanceInput={balanceInput}
        onBalanceInputChange={setBalanceInput}
        balanceError={balanceError}
        savingBalance={savingBalance}
        onSubmitBalance={handleBalanceSave}
        income={displayIncome}
        hasPayday={hasPayday}
        hasIncomeAmount={hasIncomeAmount}
        hasBills={hasBills}
        totalMonthlyBills={totalMonthlyBills}
        monthlySpendingRoomValue={monthlySpendingRoomValue}
        editingIncome={editingIncome}
        onSetEditingIncome={setEditingIncome}
        incomeForm={incomeForm}
        onIncomeFormChange={setIncomeForm}
        savingEdit={savingEdit}
        editError={editError}
        onSubmitIncome={handleIncomeSave}
        incomeEvents={incomeEvents}
        onIncomeEventsChange={setIncomeEvents}
        todayIso={todayIso}
        onNotice={setPageNotice}
        displayCurrency={displayCurrency}
        onCurrencySelect={handleCurrencySave}
        bills={bills}
        onBillsChange={setBills}
        hasIncome={Boolean(displayIncome)}
        onFinishBillsStep={handleFinishBillsStep}
      />
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <p className="brand">Your cash runway</p>
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
          <Link className="secondary-button" href="/account">Account</Link>
          {isAnalyticsAdmin ? (
            <Link className="secondary-button" href="/admin/analytics">Analytics</Link>
          ) : null}
        </div>
      </header>

      {pageNotice ? (
        <section className="page-notice" aria-live="polite">
          {pageNotice}
        </section>
      ) : null}

      <AttentionStrip
        reminders={reminders}
        billsDueSoon={billsDueSoon}
        staleBalanceDays={staleBalanceDaysForStrip}
        issues={[
          unassignedCostsBeforePayday > 0 ? `${formatCurrency(unassignedCostsBeforePayday, displayCurrency)} of planned costs still needs a funding choice.` : "",
          estimatedIncomeTotal > 0 ? `${formatCurrency(estimatedIncomeTotal, displayCurrency)} of estimated income is not counted in the available amount.` : "",
        ]}
      />

      <div
        ref={primaryResultRef}
        className={highlightPrimaryResult ? "primary-result-highlight" : ""}
        tabIndex={-1}
        aria-live="polite"
      >
        <HeroCard
          status={clearTillStatus}
          hasBalanceSnapshot={hasBalanceSnapshot}
          hasPayday={hasIncomeSchedule}
          rollingForecast={!hasPayday}
          spendingRoomUntilPayday={spendingRoomUntilPayday}
          dailySpendingRoom={dailySpendingRoom}
          daysTillPayday={dashboard.daysTillPayday || 28}
          paydayDate={forecastHorizonDate}
          displayCurrency={displayCurrency}
          onUpdateBalance={() => openBalanceEditor(false)}
          onEditPaydaySettings={() => openBalanceEditor(true)}
          nextCommitments={nextCommitments}
          balanceFreshness={balanceFreshness}
          balanceIsStale={balanceIsStale}
          estimatedIncome={estimatedIncomeTotal}
          breakdownProps={{
            hasBalanceSnapshot,
            currentBalance: dashboard.currentBalance,
            hasPayday: hasIncomeSchedule,
            totalBeforePayday: forecastBills.reduce((total, bill) => total + (Number(bill.amount) || 0), 0),
            bigCostsDueBeforePayday,
            additionalIncomeBeforePayday: safeSpendingPlan?.confirmedAdditionalIncome || 0,
            spendingRoomValue,
            displayCurrency,
            billItems: beforePaydayBillItems,
            largeCostItems: beforePaydayLargeCostItems,
            incomeItems: currentPeriodIncome,
          }}
        />
        {balanceImpact ? <p className="balance-impact" role="status">{balanceImpact}</p> : null}
      </div>

      <BalanceEditor
        open={balanceEditorOpen}
        focusPayday={focusPayday}
        onConsumeFocusPayday={() => setFocusPayday(false)}
        onRequestClose={() => setBalanceEditorOpen(false)}
        hasBalanceSnapshot={hasBalanceSnapshot}
        currentBalance={dashboard.currentBalance}
        balanceInput={balanceInput}
        onBalanceInputChange={setBalanceInput}
        balanceError={balanceError}
        savingBalance={savingBalance}
        onSubmitBalance={handleBalanceSave}
        income={displayIncome}
        hasPayday={hasPayday}
        hasIncomeAmount={hasIncomeAmount}
        hasBills={hasBills}
        totalMonthlyBills={totalMonthlyBills}
        monthlySpendingRoomValue={monthlySpendingRoomValue}
        editingIncome={editingIncome}
        onSetEditingIncome={setEditingIncome}
        incomeForm={incomeForm}
        onIncomeFormChange={setIncomeForm}
        savingEdit={savingEdit}
        editError={editError}
        onSubmitIncome={handleIncomeSave}
        incomeEvents={incomeEvents}
        onIncomeEventsChange={setIncomeEvents}
        todayIso={todayIso}
        onNotice={setPageNotice}
        displayCurrency={displayCurrency}
        onCurrencySelect={handleCurrencySave}
      />

      {dashboard.paydayDate && nextPaydayDate ? (
        <>
          <CollapsibleSection
            title="Current pay cycle"
            summaryValue={`${formatCurrency(Math.max(0, spendingRoomUntilPayday || 0), displayCurrency)} available · to ${formatDisplayDate(dashboard.paydayDate)}`}
            storageKey="current-cycle"
          >
            <PayPeriodCards
              show="current"
              displayCurrency={displayCurrency}
              current={{
                endDate: dashboard.paydayDate,
                startingBalance: dashboard.currentBalance,
                incomeTotal: currentIncomeTotal,
                income: currentPeriodIncome,
                billTotal: dashboard.totalBeforePayday,
                bills: beforePaydayBillItems,
                largeCostTotal: bigCostsDueBeforePayday,
                largeCosts: beforePaydayLargeCostItems,
                freeCash: Math.max(0, spendingRoomUntilPayday || 0),
                dailyAllowance: Math.max(0, dailySpendingRoom || 0),
              }}
              next={{
                startDate: dashboard.paydayDate,
                endDate: nextPaydayDate,
                incomeTotal: nextIncomeTotal,
                income: nextPeriodIncome,
                billTotal: nextBillTotal,
                bills: nextPeriodBills,
                largeCostTotal: nextLargeCostTotal,
                largeCosts: nextPeriodLargeCosts,
                freeCash: Math.max(0, nextFreeCash),
                dailyAllowance: Math.max(0, nextFreeCash / nextPeriodDays),
              }}
            />
            <button className="secondary-button cycle-income-action" type="button" onClick={() => openBalanceEditor(true)}>Update pay or income</button>
          </CollapsibleSection>
          <CollapsibleSection
            title="Next pay cycle"
            summaryValue={`${formatCurrency(Math.max(0, nextFreeCash), displayCurrency)} expected · from ${formatDisplayDate(dashboard.paydayDate)}`}
            storageKey="next-cycle"
          >
            <PayPeriodCards
              show="next"
              displayCurrency={displayCurrency}
              current={{}}
              next={{
                startDate: dashboard.paydayDate,
                endDate: nextPaydayDate,
                incomeTotal: nextIncomeTotal,
                income: nextPeriodIncome,
                billTotal: nextBillTotal,
                bills: nextPeriodBills,
                largeCostTotal: nextLargeCostTotal,
                largeCosts: nextPeriodLargeCosts,
                freeCash: Math.max(0, nextFreeCash),
                dailyAllowance: Math.max(0, nextFreeCash / nextPeriodDays),
              }}
            />
          </CollapsibleSection>
        </>
      ) : null}

      <CollapsibleSection title="Four-week outlook" summaryValue={`${nextCommitments.length} upcoming event${nextCommitments.length === 1 ? "" : "s"}`} defaultCollapsed={false} storageKey="chart">
        <FourWeekChart
          dashboard={dashboard}
          dueBeforePaydayLargeCosts={largeCostPlans.chartAllocations}
          dailySpendingRoom={dailySpendingRoom}
          spendingRoomUntilPayday={spendingRoomUntilPayday}
          minimumProjectedBalance={safeSpendingPlan?.minimumProjectedBalance}
          hasBalanceSnapshot={hasBalanceSnapshot}
          todayIso={todayIso}
          displayCurrency={displayCurrency}
          incomeAmount={0}
          additionalIncomeEvents={incomeEvents}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Bills" summaryValue={billsSummaryValue} storageKey="bills">
        <BillList
          bills={bills}
          dashboard={dashboard}
          displayCurrency={displayCurrency}
          hasBalanceSnapshot={hasBalanceSnapshot}
          importLocked={billsBusy}
          todayIso={todayIso}
          onBillsChange={setBills}
          onNotice={setPageNotice}
        />
        <AddBills
          bills={bills}
          onBillsChange={setBills}
          hasIncome={Boolean(displayIncome)}
          hasBalanceSnapshot={hasBalanceSnapshot}
          hasPayday={hasPayday}
          displayCurrency={displayCurrency}
          onImportingChange={setBillsBusy}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Large costs" summaryValue={largeCostsSummaryValue} storageKey="largecosts">
        <LargeCostForm
          onLargeCostsChange={setLargeCosts}
          displayCurrency={displayCurrency}
          hasPayday={hasPayday}
          todayIso={todayIso}
          costsWithStatus={largeCostsWithStatus}
          plannedCosts={largeCostsWithStatus}
          unassignedAmount={unassignedCostsBeforePayday}
          planSummary={largeCostPlans.summary}
          planningContext={{
            currentBalance: hasBalanceSnapshot ? dashboard.currentBalance : 0,
            incomeAmount: 0,
            additionalIncomeEvents: incomeEvents,
            paydayDate: dashboard.paydayDate,
            savingsAvailable: generalProtectedSavings,
            bills: [...dashboard.beforePayday, ...dashboard.afterPayday],
          }}
          onSavingsChange={setSavings}
          onNotice={setPageNotice}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Savings" summaryValue={formatCurrency(generalProtectedSavings, displayCurrency)} storageKey="savings">
        <SavingsEditor
          savings={savings}
          onSavingsChange={setSavings}
          displayCurrency={displayCurrency}
          protectedTotal={largeCostImpact.totalProtectedSavings}
          generalSavings={generalProtectedSavings}
          assignedSavings={largeCostImpact.totalCostSpecificSaved}
          assignedSavingsByCost={largeCostImpact.costs}
          bigCostsCoveredBySavings={largeCostImpact.bigCostsCoveredBySavings}
          fallbackCopy={spendingRoomFallbackCopy}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Utilities in forecast" summaryValue={utilitiesSummaryValue} storageKey="utilities">
        <UtilitiesTracker bills={bills} onAddMissingUtility={handleAddMissingUtility} />
      </CollapsibleSection>
    </main>
  );
}

export default function HomeDashboard() {
  return (
    <Suspense fallback={<HomeDashboardFallback />}>
      <HomeDashboardContent />
    </Suspense>
  );
}
