"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import RepairAccessButton from "@/app/billing/success/RepairAccessButton";
import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  linkWithPopup,
  onAuthStateChanged,
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
  buildWeeklySafeSpendingPlan,
  diffDays,
  formatCurrency,
  formatDisplayDate,
  getTodayIso,
  isValidDueDay,
} from "@/lib/billMath";
import { calculateLargeCostAffordabilityPlans } from "@/lib/largeCostPlanner";
import { calculateCashPosition, expandIncomeEvents } from "@/lib/cashflowTimeline";
import { hasActiveIncomeSchedule } from "@/lib/incomeSchedule";
import { trackEvent } from "@/lib/analytics/track";
import { getStoredAttribution } from "@/lib/analytics/attribution";
import { logSecurityEventClient } from "@/lib/security/clientSecurity";
import { safeError } from "@/lib/security/safeLog";
import { postDashboardSettingsAction, postDashboardStateAction, saveIncome as saveIncomeRequest } from "./lib/dashboardApi";
import { friendlyAuthError, friendlySettingsError } from "./lib/friendlyErrors";
import { friendlyGoogleAuthError, logGoogleAuthError } from "@/lib/googleAuthErrors";
import { triggerQuickAction } from "./components/QuickActions";
import { getScrollBehavior } from "./lib/billHelpers";
import CollapsibleSection from "./components/CollapsibleSection";
import HeroCard from "./components/HeroCard";
import AfterNextIncome from "./components/AfterNextIncome";
import AttentionStrip, { isBalanceSnapshotStale, STALE_BALANCE_DAYS } from "./components/AttentionStrip";
import BalanceEditor from "./components/BalanceEditor";
import AddBills from "./components/AddBills";
import BillList from "./components/BillList";
import LargeCostForm from "./components/LargeCostForm";
import SavingsEditor from "./components/SavingsEditor";
import UtilitiesTracker, { buildTrackerChecks } from "./components/UtilitiesTracker";
import FourWeekChart from "./components/FourWeekChart";
import SetupWizard from "./components/SetupWizard";
import AdditionalIncomeEditor from "./components/AdditionalIncomeEditor";
import DashboardNav from "./components/DashboardNav";
import Drawer from "./components/Drawer";
import CurrentPositionCard from "./components/CurrentPositionCard";
import MoneyRunway from "./components/MoneyRunway";
import WeekBreakdownDrawer from "./components/WeekBreakdownDrawer";
import SpendTestDrawer from "./components/SpendTestDrawer";
import { buildSixWeekRunwayRows, resolveRunwayIncomeBoundary } from "./lib/runwayModel";

const RECENT_SESSION_STORAGE_KEY = "cleartill_recent_checkout_session_id";
const SETUP_COMPLETED_STORAGE_KEY = "ct.setup.completedAt";

function isValidIncomeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0;
}

function toDateMaybe(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
    return new Date(Number(value.seconds) * 1000);
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
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

function HomeDashboardContent({ view = "overview" }) {
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
    entitlement: null,
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
  const [selectedRunwayWeek, setSelectedRunwayWeek] = useState(null);
  const [spendTestOpen, setSpendTestOpen] = useState(false);
  const [addBillOpen, setAddBillOpen] = useState(false);
  const [billsIncomeTab, setBillsIncomeTab] = useState("bills");
  const [previewStartBusy, setPreviewStartBusy] = useState(false);
  const [previewStartError, setPreviewStartError] = useState("");

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
  const currentPositionRef = useRef(null);
  const updateBalanceButtonRef = useRef(null);
  const balanceCompletionPendingRef = useRef(false);
  const incomeSectionRef = useRef(null);
  const previewAutoStartAttemptedRef = useRef(false);

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
    const reminder = searchParams.get("reminder");
    if (["preview_balance_check", "preview_cost_check"].includes(reminder)) {
      trackEvent("preview_reminder_opened", { reminder });
    }
  }, [searchParams]);

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
          entitlement: payload?.entitlement || null,
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
  // Setup completion is sticky: established users remain in the operational
  // dashboard even if their entries later become incomplete.
  const hasCompletedSetupBefore = accessCheck.entitlement?.previewUsed
    || accessCheck.entitlement?.hasAccess
    || (!accessCheck.entitlement?.canStartPreview
      && typeof window !== "undefined"
      && Boolean(window.localStorage.getItem(SETUP_COMPLETED_STORAGE_KEY)));
  const [positionConfirmed, setPositionConfirmed] = useState(false);
  const setupStep = hasCompletedSetupBefore || positionConfirmed
    ? 5
    : !hasBalanceSnapshot
      ? 1
      : !hasPayday
        ? 2
        : !hasBills
          ? 3
          : 4;
  const experienceMode = setupStep < 5 ? "onboarding" : "bau";
  const accessState = accessCheck.entitlement?.accessType === "no_card_preview"
    ? "preview_active"
    : accessCheck.entitlement?.previewUsed && !accessCheck.entitlement?.hasAccess
      ? "preview_expired"
      : accessCheck.entitlement?.hasAccess ? "paid" : "preview_available";
  const canEdit = accessCheck.entitlement?.canEdit !== false;
  const previewDaysLeft = accessState === "preview_active"
    ? accessCheck.entitlement?.previewDaysRemaining ?? null
    : null;
  const previewExpiryLabel = accessCheck.entitlement?.previewEndsAt
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }).format(new Date(accessCheck.entitlement.previewEndsAt))
    : "";
  const previewBadgeLabel = accessState === "preview_active"
    ? `7-day live preview · ${previewDaysLeft ?? 0} ${previewDaysLeft === 1 ? "day" : "days"} remaining${previewExpiryLabel ? ` · Ends ${previewExpiryLabel}` : ""}`
    : accessState === "paid" ? "Member" : "Preview ended";

  useEffect(() => {
    if (setupStep === 5 && typeof window !== "undefined" && !window.localStorage.getItem(SETUP_COMPLETED_STORAGE_KEY)) {
      window.localStorage.setItem(SETUP_COMPLETED_STORAGE_KEY, new Date().toISOString());
    }
  }, [setupStep]);

  async function handleCompleteFirstPosition() {
    if (!auth?.currentUser || previewStartBusy) return;
    setPreviewStartBusy(true);
    setPreviewStartError("");
    trackEvent("position_calculated", { source: "onboarding" });
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch("/api/preview/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not start your preview.");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SETUP_COMPLETED_STORAGE_KEY, new Date().toISOString());
      }
      setAccessCheck((current) => ({ ...current, state: "access_active", accessActive: true, entitlement: payload.access || current.entitlement }));
      setPositionConfirmed(true);
    } catch (error) {
      setPreviewStartError(error?.message || "Could not start your preview. Check your position and try again.");
    } finally {
      setPreviewStartBusy(false);
    }
  }

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
  const largeCostLedgerAllocations = useMemo(() => largeCostPlans.plans.flatMap((plan) => [
    plan.currentPeriodAllocation > 0 ? {
      id: `${plan.costId}-current`,
      name: `${plan.name} funding`,
      currentAccountAmount: plan.currentPeriodAllocation,
      nextDueDate: todayIso,
      frequency: "one_off",
    } : null,
    ...plan.futurePeriodAllocations.map((allocation, index) => ({
      id: `${plan.costId}-future-${index}`,
      name: `${plan.name} funding`,
      currentAccountAmount: allocation.amount,
      nextDueDate: allocation.payDate,
      frequency: "one_off",
    })),
  ].filter(Boolean)), [largeCostPlans.plans, todayIso]);
  const cashPosition = useMemo(() => hasBalanceSnapshot ? calculateCashPosition({
    todayIso,
    horizonDate: forecastHorizonDate,
    currentBalance: dashboard.currentBalance,
    bills: [...dashboard.beforePayday, ...dashboard.afterPayday],
    largeCostAllocations: largeCostLedgerAllocations,
    additionalIncomeEvents: incomeEvents,
  }) : null, [dashboard.afterPayday, dashboard.beforePayday, dashboard.currentBalance, forecastHorizonDate, hasBalanceSnapshot, incomeEvents, largeCostLedgerAllocations, todayIso]);
  const runwayIncomeBoundaryDate = resolveRunwayIncomeBoundary(
    cashPosition?.nextConfirmedIncome,
    dashboard.paydayDate,
  );
  const sixWeekPlan = useMemo(() => hasBalanceSnapshot ? buildWeeklySafeSpendingPlan(
    todayIso,
    runwayIncomeBoundaryDate,
    dashboard.currentBalance,
    [...dashboard.beforePayday, ...dashboard.afterPayday],
    largeCostLedgerAllocations,
    0,
    incomeEvents,
    6,
  ) : [], [dashboard.afterPayday, dashboard.beforePayday, dashboard.currentBalance, hasBalanceSnapshot, incomeEvents, largeCostLedgerAllocations, runwayIncomeBoundaryDate, todayIso]);
  const fundingGapDates = useMemo(() => largeCostPlans.plans
    .filter((plan) => Number(plan.shortfall) > 0)
    .map((plan) => plan.dueDate), [largeCostPlans.plans]);
  const runwayRows = useMemo(
    () => buildSixWeekRunwayRows(sixWeekPlan, fundingGapDates),
    [fundingGapDates, sixWeekPlan],
  );
  const bigCostsDueBeforePayday = cashPosition?.protectedBeforeNextIncomeTotal || 0;
  const spendingRoomUntilPayday = cashPosition?.safeUntilNextIncome ?? null;
  const dailySpendingRoom = cashPosition?.safePerDayUntilNextIncome ?? null;
  const estimatedIncomeOccurrences = useMemo(() => (
    expandIncomeEvents(incomeEvents, todayIso, forecastHorizonDate, { confirmedOnly: false })
      .filter((item) => item.confidence === "estimated" && item.date < forecastHorizonDate)
  ), [forecastHorizonDate, incomeEvents, todayIso]);
  const estimatedIncomeTotal = estimatedIncomeOccurrences.reduce((total, item) => total + (Number(item.amount) || 0), 0);

  useEffect(() => {
    if (!pendingBalanceResult) return;

    const { previousResult } = pendingBalanceResult;
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

    const resultMessage = spendingRoomUntilPayday === null
      ? "Your current position has been recalculated."
      : `${formatCurrency(spendingRoomUntilPayday, displayCurrency)} left until your next income.`;
    setPageNotice(`Balance updated. ${resultMessage}`);
    setBalanceImpact(impact);
    setPendingBalanceResult(null);
    balanceCompletionPendingRef.current = true;
    setBalanceEditorOpen(false);
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
    amount: Math.abs(Number(item.currentAccountAmount ?? item.amount) || 0),
    type,
  })).filter((item) => item.date && item.amount > 0);
  const beforePaydayBillItems = toDisclosureItems(cashPosition?.billsBeforeNextIncome, "Bill", "bill");
  const beforePaydayLargeCostItems = toDisclosureItems(cashPosition?.protectedBeforeNextIncome, "Large-cost funding", "large_cost");

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
    : (cashPosition?.incomeEvents || []);
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
  const balanceIsStale = isBalanceSnapshotStale({
    hasBalanceSnapshot,
    optimisticBalance,
    balanceSnapshotDate,
    staleBalanceDays: staleBalanceDaysForStrip,
  });

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
    .filter((item) => item.date >= todayIso && item.date <= (cashPosition?.nextConfirmedIncome?.date || forecastHorizonDate))
    .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  function trackAccountCreated(method) {
    trackEvent("account_created", { method, attribution: getStoredAttribution() });
    trackEvent("onboarding_started");
  }

  async function handleGoogleSignIn() {
    if (!auth || !googleProvider) {
      setAuthError("Sign-in is not available right now. Try again later.");
      return;
    }

    setSigningIn(true);
    setAuthError("");

    try {
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
      logGoogleAuthError(signInError, "dashboard");
      if (
        signInError?.code === "auth/credential-already-in-use"
        && auth.currentUser?.isAnonymous
      ) {
        await signOut(auth).catch(() => undefined);
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
    const previousResult = spendingRoomUntilPayday;

    setBalanceError("");
    setPageNotice("");
    setBalanceImpact("");
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
      trackEvent("onboarding_step_completed", { step: "balance" });
      if (accessState === "preview_active") {
        trackEvent("balance_updated_during_preview");
        trackEvent("position_recalculated_during_preview", { source: "balance_update" });
      }
      setOptimisticBalance(parsedBalance);
      setPendingBalanceResult({
        previousResult,
      });
    } catch (saveError) {
      if (balanceSaveRequestRef.current !== saveRequestId) {
        return;
      }

      safeError("[dashboard-settings-balance-save] failed", { code: saveError?.code });
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
      trackEvent("onboarding_step_completed", { step: "payday" });
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
    balanceCompletionPendingRef.current = false;
    setFocusPayday(Boolean(withFocusPayday));
    setBalanceEditorOpen(true);
  }

  function handleBalanceDrawerAfterClose() {
    if (!balanceCompletionPendingRef.current) return;
    balanceCompletionPendingRef.current = false;

    const position = currentPositionRef.current || primaryResultRef.current;
    if (!position) return;
    const rect = position.getBoundingClientRect();
    const mobileLayout = window.matchMedia?.("(max-width: 760px)").matches ?? window.innerWidth <= 760;
    const outsideViewport = rect.top < 0 || rect.bottom > window.innerHeight;
    if (mobileLayout || outsideViewport) {
      position.scrollIntoView({ block: "start", behavior: "auto" });
    }
    (updateBalanceButtonRef.current || position).focus?.({ preventScroll: true });
  }

  useEffect(() => {
    if (setupStep !== 4) {
      previewAutoStartAttemptedRef.current = false;
      return;
    }
    if (!auth?.currentUser || previewStartBusy || previewAutoStartAttemptedRef.current) return;
    previewAutoStartAttemptedRef.current = true;
    void handleCompleteFirstPosition();
    // The failed state deliberately does not loop. The visible completion
    // button retries the same idempotent endpoint, and a reload retries once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupStep]);

  function focusIncomeSection() {
    if (accessState === "preview_expired") return;
    setBillsIncomeTab("income");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const section = incomeSectionRef.current;
        if (!section) return;
        section.scrollIntoView({ behavior: getScrollBehavior(), block: "start" });
        const focusTarget = section.querySelector("#income-pattern:not(:disabled)")
          || section.querySelector("#income-section-title");
        focusTarget?.focus({ preventScroll: true });
      });
    });
  }

  function focusBillsAddSection() {
    if (accessState === "preview_expired") return;
    setBillsIncomeTab("bills");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => triggerQuickAction("bills", "add-bills"));
    });
  }

  function handleBillsIncomeTabKeyDown(event) {
    const tabs = ["bills", "income"];
    const currentIndex = tabs.indexOf(billsIncomeTab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    setBillsIncomeTab(tabs[nextIndex]);
    window.requestAnimationFrame(() => document.getElementById(`bills-income-tab-${tabs[nextIndex]}`)?.focus());
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
          <h1>Sign in to view your ClearTill dashboard</h1>
          <p>Your saved position is connected to your account.</p>
          <div className="auth-button-row">
            <Link className="primary-button" href="/signin">Sign in</Link>
            <Link className="secondary-button" href="/start">Create an account</Link>
          </div>
        </section>
      </main>
    );
  }

  if (false && !user) {
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

  if (experienceMode === "onboarding" && accessState !== "preview_expired") {
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
        paydayDate={forecastHorizonDate}
        nextIncomeDate={cashPosition?.nextConfirmedIncome?.date || forecastHorizonDate}
        spendingRoomUntilPayday={spendingRoomUntilPayday}
        dailySpendingRoom={dailySpendingRoom}
        daysTillPayday={dashboard.daysTillPayday || 1}
        confirmedIncomeThroughHorizon={cashPosition?.confirmedIncomeThroughHorizon || 0}
        forecastAtHorizon={cashPosition?.forecastAtHorizon || 0}
        onComplete={handleCompleteFirstPosition}
        completing={previewStartBusy}
        completionError={previewStartError}
      />
    );
  }

  const activeIncomeCount = incomeEvents.filter((source) => source?.active !== false).length;
  const largestFundingGap = largeCostPlans.plans.reduce((largest, plan) => Math.max(largest, Number(plan.shortfall) || 0), 0);
  const missingTrackerCount = trackerChecks.filter((check) => !check.found).length;
  const viewTitle = view === "bills-income" ? "Bills & income" : view === "large-costs-savings" ? "Large costs & savings" : "Overview";
  const planningContext = {
    currentBalance: hasBalanceSnapshot ? dashboard.currentBalance : 0,
    incomeAmount: 0,
    additionalIncomeEvents: incomeEvents,
    paydayDate: dashboard.paydayDate,
    savingsAvailable: generalProtectedSavings,
    bills: [...dashboard.beforePayday, ...dashboard.afterPayday],
  };

  if (["overview", "bills-income", "large-costs-savings"].includes(view)) {
    return (
      <main className={`dashboard-shell dashboard-view-${view}${accessState === "preview_expired" ? " dashboard-readonly" : ""}`} data-experience-mode="bau" data-access-state={accessState}>
        <header className="topbar">
          <div>
            <Link className="brand-link" href="/" aria-label="ClearTill home"><Logo className="eyebrow-logo" /></Link>
            <p className="brand">{viewTitle}</p>
          </div>
          <div className="topbar-actions">
            <span className="access-badge" title={previewExpiryLabel ? `Seven-day live preview ends ${previewExpiryLabel}` : undefined}>{previewBadgeLabel}</span>
            {accessState === "preview_active" && previewExpiryLabel ? <span className="sr-only">Live preview ends {previewExpiryLabel}</span> : null}
            <span className="user-id">{user?.isAnonymous ? "Guest session" : user?.displayName || user?.email || "Signed in"}</span>
            {user?.isAnonymous ? <button className="secondary-button" type="button" onClick={handleGoogleSignIn} disabled={signingIn}>Save with Google</button> : null}
            {isAnalyticsAdmin ? <Link className="secondary-button" href="/admin/analytics">Analytics</Link> : null}
          </div>
        </header>

        <DashboardNav />

        {accessState === "preview_active" && previewDaysLeft === 1 ? (
          <section className="preview-ending-banner" role="status"><div><strong>Your live preview ends tomorrow</strong><p>No automatic payment will occur. Continue for £24.99 annually — Best value — or £3.99 monthly.</p></div><Link className="primary-link" href="/pricing">View plans</Link></section>
        ) : null}
        {accessState === "preview_expired" ? (
          <section className="expired-preview-banner" role="status">
            <div><strong>Your live ClearTill position is paused</strong><p>This result was last updated on {balanceFreshness.replace(/^Updated /, "").toLowerCase()} and may no longer reflect your current position.</p></div>
            <div className="expired-preview-actions"><Link className="primary-link upgrade-action" href="/pricing">View monthly and annual plans</Link></div>
          </section>
        ) : null}
        {pageNotice ? <section className="page-notice" aria-live="polite">{pageNotice}</section> : null}

        {view === "overview" ? (
          <>
            <div ref={primaryResultRef} className={highlightPrimaryResult ? "primary-result-highlight" : ""} tabIndex={-1} aria-live="polite">
              <CurrentPositionCard currentPositionRef={currentPositionRef} updateBalanceButtonRef={updateBalanceButtonRef} cashPosition={cashPosition} displayCurrency={displayCurrency} onUpdateBalance={() => openBalanceEditor(false)} onTestSpend={() => setSpendTestOpen(true)} onAddBill={() => setAddBillOpen(true)} />
              {balanceImpact ? <p className="balance-impact" role="status">{balanceImpact}</p> : null}
            </div>

            <AttentionStrip
              compact
              reminders={reminders}
              billsDueSoon={billsDueSoon}
              staleBalanceDays={staleBalanceDaysForStrip}
              onUpdateBalance={() => openBalanceEditor(false)}
              onReviewPosition={() => primaryResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              onAddCost={() => setAddBillOpen(true)}
              issues={[
                unassignedCostsBeforePayday > 0 ? `${formatCurrency(unassignedCostsBeforePayday, displayCurrency)} of planned costs still needs a funding choice.` : "",
                estimatedIncomeTotal > 0 ? `${formatCurrency(estimatedIncomeTotal, displayCurrency)} of estimated income is not counted in the available amount.` : "",
                bills.some((bill) => !bill.nextDueDate && !bill.dueDay) ? "A bill is missing its usual due date." : "",
              ]}
            />

            <MoneyRunway rows={runwayRows} displayCurrency={displayCurrency} onSelectWeek={setSelectedRunwayWeek} />

            <section className="overview-management" aria-labelledby="manage-title">
              <div className="overview-section-heading"><div><p className="overview-kicker">Manage</p><h2 id="manage-title">Keep your plan up to date</h2></div></div>
              <div className="overview-management-grid">
                <Link href="/dashboard/bills-income"><strong>Bills & income</strong><span>{bills.length} active bill{bills.length === 1 ? "" : "s"} · {activeIncomeCount} income source{activeIncomeCount === 1 ? "" : "s"}</span><small>{nextDueBill?.nextDueDate ? `Next bill ${formatDisplayDate(nextDueBill.nextDueDate)}` : "Review regular money in and out"}</small></Link>
                <Link href="/dashboard/large-costs-savings"><strong>Large costs & savings</strong><span>{largeCostPlans.plans.length} planned cost{largeCostPlans.plans.length === 1 ? "" : "s"}</span><small>{largestFundingGap > 0 ? `${formatCurrency(largestFundingGap, displayCurrency)} largest funding gap` : `${formatCurrency(generalProtectedSavings, displayCurrency)} protected savings`}</small></Link>
                <Link href="/account"><strong>Account</strong><span>{reminders.length} recent reminder{reminders.length === 1 ? "" : "s"}</span><small>{missingTrackerCount ? `${missingTrackerCount} household item${missingTrackerCount === 1 ? "" : "s"} to review` : "Household tracker complete"}</small></Link>
              </div>
            </section>

            <Drawer open={balanceEditorOpen} onClose={() => setBalanceEditorOpen(false)} onAfterClose={handleBalanceDrawerAfterClose} closeDisabled={savingBalance} title="Update your position" description="Update the balance currently available in your account.">
              <BalanceEditor open focusPayday={focusPayday} onConsumeFocusPayday={() => setFocusPayday(false)} hasBalanceSnapshot={hasBalanceSnapshot} currentBalance={dashboard.currentBalance} balanceInput={balanceInput} onBalanceInputChange={setBalanceInput} balanceError={balanceError} savingBalance={savingBalance} onSubmitBalance={handleBalanceSave} income={displayIncome} hasPayday={hasPayday} hasIncomeAmount={hasIncomeAmount} hasBills={hasBills} totalMonthlyBills={totalMonthlyBills} monthlySpendingRoomValue={monthlySpendingRoomValue} editingIncome={editingIncome} onSetEditingIncome={setEditingIncome} incomeForm={incomeForm} onIncomeFormChange={setIncomeForm} savingEdit={savingEdit} editError={editError} onSubmitIncome={handleIncomeSave} incomeEvents={incomeEvents} onIncomeEventsChange={setIncomeEvents} todayIso={todayIso} onNotice={setPageNotice} displayCurrency={displayCurrency} onCurrencySelect={handleCurrencySave} />
            </Drawer>
            <SpendTestDrawer open={spendTestOpen} onClose={() => setSpendTestOpen(false)} cashPosition={cashPosition} displayCurrency={displayCurrency} />
            <Drawer open={addBillOpen} onClose={() => setAddBillOpen(false)} title="Add a bill" description="Add one bill here, or use the full management page for imports and reviews." size="wide">
              <AddBills bills={bills} onBillsChange={setBills} hasIncome={Boolean(displayIncome)} hasBalanceSnapshot={hasBalanceSnapshot} hasPayday={hasPayday} displayCurrency={displayCurrency} onImportingChange={setBillsBusy} autoFocusOnMount />
            </Drawer>
            <WeekBreakdownDrawer row={selectedRunwayWeek} displayCurrency={displayCurrency} onClose={() => setSelectedRunwayWeek(null)} />
          </>
        ) : null}

        {view === "bills-income" ? (
          <div className="management-page-stack">
            <section className="bills-income-header" aria-labelledby="bills-income-title">
              <div className="bills-income-header-main">
                <div>
                  <p className="overview-kicker">Money in and out</p>
                  <h1 id="bills-income-title">Bills & income</h1>
                  <p>Manage the regular money used by your runway.</p>
                </div>
                <div className="management-page-actions">
                  <button className="primary-button" type="button" disabled={!canEdit} onClick={focusBillsAddSection}>Add bill</button>
                  <button className="secondary-button" type="button" disabled={!canEdit} onClick={focusIncomeSection}>Add income</button>
                </div>
              </div>
              <dl className="bills-income-metrics">
                <div><dt>Monthly bills</dt><dd>{formatCurrency(totalMonthlyBills, displayCurrency)}</dd></div>
                <div><dt>Active bills</dt><dd>{bills.length}</dd></div>
                <div><dt>Income sources</dt><dd>{activeIncomeCount}</dd></div>
                {cashPosition?.nextConfirmedIncome ? <div><dt>Due before payday</dt><dd>{formatCurrency(cashPosition.billsBeforeNextIncomeTotal || 0, displayCurrency)}</dd></div> : null}
              </dl>
              <div className="bills-income-tabs" role="tablist" aria-label="Bills and income" onKeyDown={handleBillsIncomeTabKeyDown}>
                <button id="bills-income-tab-bills" type="button" role="tab" aria-selected={billsIncomeTab === "bills"} aria-controls="bills-income-panel-bills" tabIndex={billsIncomeTab === "bills" ? 0 : -1} onClick={() => setBillsIncomeTab("bills")}>Bills <span>{bills.length}</span></button>
                <button id="bills-income-tab-income" type="button" role="tab" aria-selected={billsIncomeTab === "income"} aria-controls="bills-income-panel-income" tabIndex={billsIncomeTab === "income" ? 0 : -1} onClick={() => setBillsIncomeTab("income")}>Income <span>{activeIncomeCount}</span></button>
              </div>
            </section>
            <div id="bills-income-panel-bills" className="bills-income-tab-panel" role="tabpanel" aria-labelledby="bills-income-tab-bills" hidden={billsIncomeTab !== "bills"}>
              <section className="management-panel bills-management-panel" aria-labelledby="bill-management-title"><h2 className="sr-only" id="bill-management-title">Bills</h2><BillList bills={bills} dashboard={dashboard} displayCurrency={displayCurrency} hasBalanceSnapshot={hasBalanceSnapshot} importLocked={billsBusy || !canEdit} todayIso={todayIso} onBillsChange={setBills} onNotice={setPageNotice} /></section>
              <section className="management-panel" aria-labelledby="household-utilities-title"><h2 id="household-utilities-title">Household utilities tracker</h2><UtilitiesTracker bills={bills} onAddMissingUtility={handleAddMissingUtility} /></section>
              <section className="management-panel" aria-labelledby="add-bills-title"><h2 id="add-bills-title">Add or import bills</h2><AddBills bills={bills} onBillsChange={setBills} hasIncome={Boolean(displayIncome)} hasBalanceSnapshot={hasBalanceSnapshot} hasPayday={hasPayday} displayCurrency={displayCurrency} onImportingChange={setBillsBusy} /></section>
            </div>
            <div id="bills-income-panel-income" className="bills-income-tab-panel" role="tabpanel" aria-labelledby="bills-income-tab-income" hidden={billsIncomeTab !== "income"}>
              <section ref={incomeSectionRef} id="income-section" className="management-panel" aria-labelledby="income-section-title"><h2 id="income-section-title" tabIndex={-1}>Income</h2><AdditionalIncomeEditor incomeEvents={incomeEvents} onIncomeEventsChange={setIncomeEvents} todayIso={todayIso} displayCurrency={displayCurrency} onNotice={setPageNotice} defaultExpanded /></section>
            </div>
          </div>
        ) : null}

        {view === "large-costs-savings" ? (
          <div className="management-page-stack">
            <section className="management-page-intro"><p className="overview-kicker">Plan ahead</p><h1>Large costs & savings</h1><p>Choose how upcoming costs are funded and keep protected savings separate from daily spending.</p></section>
            <section className="management-panel"><LargeCostForm onLargeCostsChange={setLargeCosts} displayCurrency={displayCurrency} hasPayday={hasPayday} todayIso={todayIso} costsWithStatus={largeCostsWithStatus} plannedCosts={largeCostsWithStatus} unassignedAmount={unassignedCostsBeforePayday} planSummary={largeCostPlans.summary} planningContext={planningContext} onSavingsChange={setSavings} onNotice={setPageNotice} /></section>
            <section className="management-panel" aria-labelledby="savings-management-title"><h2 id="savings-management-title">Savings and protected money</h2><SavingsEditor savings={savings} onSavingsChange={setSavings} displayCurrency={displayCurrency} protectedTotal={largeCostImpact.totalProtectedSavings} generalSavings={generalProtectedSavings} assignedSavings={largeCostImpact.totalCostSpecificSaved} assignedSavingsByCost={largeCostImpact.costs} bigCostsCoveredBySavings={largeCostImpact.bigCostsCoveredBySavings} fallbackCopy={spendingRoomFallbackCopy} /></section>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className={`dashboard-shell${accessState === "preview_expired" ? " dashboard-readonly" : ""}`} data-experience-mode="bau" data-access-state={accessState}>
      <header className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <p className="brand">Your payday position</p>
        </div>
        <div className="topbar-actions">
          <span className="access-badge">
            <span title={previewExpiryLabel ? `Seven-day live preview ends ${previewExpiryLabel}` : undefined}>{previewBadgeLabel}</span>
          </span>
          {accessState === "preview_active" && previewExpiryLabel ? <span className="sr-only">Live preview ends {previewExpiryLabel}</span> : null}
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

      {accessState === "preview_active" && previewDaysLeft === 1 ? (
        <section className="preview-ending-banner" role="status"><div><strong>Your live preview ends tomorrow</strong><p>No automatic payment will occur. Continue for £24.99 annually — Best value — or £3.99 monthly.</p></div><Link className="primary-link" href="/pricing">View plans</Link></section>
      ) : null}
      {accessState === "preview_expired" ? (
        <section className="expired-preview-banner" role="status">
          <div>
            <strong>Your live ClearTill position is paused</strong>
            <p>This result was last updated on {balanceFreshness.replace(/^Updated /, "").toLowerCase()} and may no longer reflect your current position.</p>
          </div>
          <div className="expired-preview-actions">
            <Link className="primary-link upgrade-action" href="/pricing">View monthly and annual plans</Link>
          </div>
        </section>
      ) : null}

      {pageNotice ? (
        <section className="page-notice" aria-live="polite">
          {pageNotice}
        </section>
      ) : null}

      <AttentionStrip
        reminders={reminders}
        billsDueSoon={billsDueSoon}
        staleBalanceDays={staleBalanceDaysForStrip}
        onUpdateBalance={() => openBalanceEditor(false)}
        onReviewPosition={() => primaryResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onAddCost={() => triggerQuickAction("bills", "add-bills")}
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
          daysTillPayday={cashPosition?.daysUntilNextIncome || dashboard.daysTillPayday || 28}
          displayCurrency={displayCurrency}
          onUpdateBalance={() => openBalanceEditor(false)}
          nextCommitments={nextCommitments}
          balanceFreshness={balanceFreshness}
          balanceIsStale={balanceIsStale}
          estimatedIncome={estimatedIncomeTotal}
          timingConstrained={Boolean(cashPosition?.sameDayDependencies.length)}
          breakdownProps={{
            hasBalanceSnapshot,
            currentBalance: dashboard.currentBalance,
            hasPayday: hasIncomeSchedule,
            totalBeforePayday: cashPosition?.billsBeforeNextIncomeTotal || 0,
            bigCostsDueBeforePayday,
            totalCommittedBeforeIncome: cashPosition?.outflowBeforeNextIncomeTotal || 0,
            nextIncome: cashPosition?.nextConfirmedIncome || null,
            horizonDate: forecastHorizonDate,
            spendingRoomValue,
            displayCurrency,
            billItems: beforePaydayBillItems,
            largeCostItems: beforePaydayLargeCostItems,
          }}
        />
        {balanceImpact ? <p className="balance-impact" role="status">{balanceImpact}</p> : null}
      </div>

      <AfterNextIncome
        confirmedIncome={cashPosition?.confirmedIncomeThroughHorizon || 0}
        displayCurrency={displayCurrency}
        events={cashPosition?.events || []}
        forecastAtHorizon={cashPosition?.forecastAtHorizon || 0}
        horizonDate={forecastHorizonDate}
        nextIncome={cashPosition?.nextConfirmedIncome || null}
        sameDayDependencies={cashPosition?.sameDayDependencies || []}
        onEditPaydaySettings={() => openBalanceEditor(true)}
      />

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

      <CollapsibleSection title="Looking ahead" summaryValue={`Next four weeks · Payday ${formatDisplayDate(forecastHorizonDate)}${nextCommitments[0] ? ` · next cost ${formatCurrency(nextCommitments[0].amount, displayCurrency)}` : ""}`} defaultCollapsed storageKey="chart">
        <FourWeekChart
          dashboard={dashboard}
          dueBeforePaydayLargeCosts={largeCostLedgerAllocations}
          dailySpendingRoom={dailySpendingRoom}
          spendingRoomUntilPayday={spendingRoomUntilPayday}
          minimumProjectedBalance={cashPosition?.lowestProjectedBalance}
          hasBalanceSnapshot={hasBalanceSnapshot}
          todayIso={todayIso}
          displayCurrency={displayCurrency}
          incomeAmount={0}
          additionalIncomeEvents={incomeEvents}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Bills and regular income" summaryValue={billsSummaryValue} storageKey="bills">
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

      <CollapsibleSection title="One-off costs" summaryValue={largeCostsSummaryValue} storageKey="largecosts">
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

      <CollapsibleSection title="Savings and protected money" summaryValue={`${formatCurrency(generalProtectedSavings, displayCurrency)} currently protected`} storageKey="savings">
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

      <CollapsibleSection title="Reminder settings" summaryValue="Balance checks and upcoming-cost reminders" storageKey="utilities">
        <UtilitiesTracker bills={bills} onAddMissingUtility={handleAddMissingUtility} />
      </CollapsibleSection>
      {canEdit ? <button className="mobile-balance-action" type="button" onClick={() => openBalanceEditor(false)}>Update balance</button> : null}
    </main>
  );
}

export default function HomeDashboard({ view = "overview" }) {
  return (
    <Suspense fallback={<HomeDashboardFallback />}>
      <HomeDashboardContent view={view} />
    </Suspense>
  );
}
