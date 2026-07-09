"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Logo from "@/components/Logo";
import TrustShield from "@/components/TrustShield";
import AccessLockPanel from "@/components/AccessLockPanel";
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, authPersistenceReady, db, isFirebaseClientConfigured } from "@/lib/firebase";
import { hasActiveBillingAccess } from "@/lib/billingAccess";
import {
  buildLargeCostDocument,
  calculateDashboard,
  calculateLargeCostImpact,
  formatCurrency,
  formatDisplayDate,
  getTodayIso,
  isValidDueDay,
  normaliseLargeCostFundingStatus,
} from "@/lib/billMath";

const LARGE_COST_CATEGORY_META = {
  holiday: { icon: "🏖", label: "Holiday" },
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
    note: "Choose how this will be paid.",
  },
  current_account: {
    label: "Current account",
    note: "Hits current account. Reduces daily spending room.",
  },
  savings: {
    label: "Savings",
    note: "Covered by savings. Not counted as daily spending money.",
  },
  split: {
    label: "Split",
    note: "Partly covered by savings. Only the remaining amount affects daily spending room.",
  },
};

function deriveLargeCostStatus(cost, baseDailyBudget) {
  if (cost.fundingStatus === "unassigned") return "Choose funding";
  if (cost.fundingStatus === "savings") return "Covered";
  if (cost.status === "overdue") return "Overdue";
  if (cost.status === "due_now") return "Due now";
  if (baseDailyBudget <= 0) return "At risk";
  if ((cost.adjustedPerDayRaw || 0) >= baseDailyBudget * 0.9) return "At risk";
  if ((cost.adjustedPerDayRaw || 0) >= baseDailyBudget * 0.5) return "Tight";
  return "On track";
}

export default function BigCostsPlanPage() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [bills, setBills] = useState([]);
  const [largeCosts, setLargeCosts] = useState([]);
  const [savings, setSavings] = useState(null);
  const [income, setIncome] = useState(null);
  const [account, setAccount] = useState(null);
  const [billing, setBilling] = useState(null);
  const [billingLoaded, setBillingLoaded] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState("GBP");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCostId, setEditingCostId] = useState(null);
  const [savingCost, setSavingCost] = useState(false);
  const [costError, setCostError] = useState("");
  const [savingsInput, setSavingsInput] = useState("");
  const [savingSavings, setSavingSavings] = useState(false);
  const savingsInputRef = useRef(null);
  const costsSectionRef = useRef(null);
  const [costForm, setCostForm] = useState({
    name: "",
    amount: "",
    amountAlreadySaved: "",
    dueDate: "",
    frequency: "one_off",
    category: "other",
    fundingStatus: "unassigned",
  });

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }

    let isMounted = true;
    let unsubscribe = () => undefined;

    authPersistenceReady.finally(() => {
      if (!isMounted) return;
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
    if (!user || !db) {
      setBills([]);
      setLargeCosts([]);
      setIncome(null);
      setAccount(null);
      setBilling(null);
      setBillingLoaded(false);
      return undefined;
    }

    const billsQuery = query(collection(db, "users", user.uid, "bills"), where("active", "==", true));
    const largeCostsQuery = query(collection(db, "users", user.uid, "largeCosts"), where("active", "==", true));
    const unsubscribeBills = onSnapshot(billsQuery, (snapshot) => {
      setBills(snapshot.docs.map((billDoc) => ({ id: billDoc.id, ...billDoc.data() })));
    });
    const unsubscribeLargeCosts = onSnapshot(largeCostsQuery, (snapshot) => {
      setLargeCosts(snapshot.docs.map((costDoc) => ({ id: costDoc.id, ...costDoc.data() })));
    });
    const unsubscribeIncome = onSnapshot(doc(db, "users", user.uid, "income", "main"), (snapshot) => {
      setIncome(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    });
    const unsubscribeAccount = onSnapshot(doc(db, "users", user.uid, "settings", "balance"), (snapshot) => {
      setAccount(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    });
    const unsubscribeBilling = onSnapshot(doc(db, "users", user.uid, "settings", "billing"), (snapshot) => {
      setBilling(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      setBillingLoaded(true);
    });
    const unsubscribeSavings = onSnapshot(doc(db, "users", user.uid, "settings", "savings"), (snapshot) => {
      const nextSavings = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
      setSavings(nextSavings);
      setSavingsInput(nextSavings?.totalSetAside === undefined || nextSavings?.totalSetAside === null ? "" : String(nextSavings.totalSetAside));
    });
    const unsubscribePreferences = onSnapshot(doc(db, "users", user.uid, "settings", "preferences"), (snapshot) => {
      if (snapshot.exists()) {
        const prefs = snapshot.data();
        if (prefs.currency) setDisplayCurrency(prefs.currency);
      }
    });

    return () => {
      unsubscribeBills();
      unsubscribeLargeCosts();
      unsubscribeIncome();
      unsubscribeAccount();
      unsubscribeBilling();
      unsubscribeSavings();
      unsubscribePreferences();
    };
  }, [user]);

  const incomeForDashboard = useMemo(() => {
    if (!income) return null;
    if (!isValidDueDay(income.payDay)) {
      return { ...income, payDay: null };
    }
    return income;
  }, [income]);

  const dashboard = useMemo(
    () => calculateDashboard(bills, incomeForDashboard, account, undefined, displayCurrency),
    [account, bills, displayCurrency, incomeForDashboard],
  );
  const todayIso = getTodayIso();
  const generalProtectedSavings = Math.max(0, Number(savings?.totalSetAside) || 0);
  const impact = useMemo(
    () => calculateLargeCostImpact(largeCosts, generalProtectedSavings, dashboard.dailyLimitTillPayday || 0, dashboard.daysTillPayday || 0, todayIso),
    [dashboard.dailyLimitTillPayday, dashboard.daysTillPayday, largeCosts, generalProtectedSavings, todayIso],
  );
  const costs = useMemo(
    () => impact.costs
        .map((cost) => ({
          ...cost,
          fundingMeta: LARGE_COST_FUNDING_META[cost.fundingStatus] || LARGE_COST_FUNDING_META.unassigned,
          statusBadge: deriveLargeCostStatus(cost, impact.normalDailyBudget),
        }))
        .sort((a, b) => String(a.nextDueDate || "").localeCompare(String(b.nextDueDate || ""))),
    [impact],
  );

  if (!authReady) {
    return (
      <main className="plan-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Loading your big cost plan…</h1>
        </section>
      </main>
    );
  }

  if (!isFirebaseClientConfigured) {
    return (
      <main className="plan-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Firebase is not configured.</h1>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="plan-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Sign in to view your big cost plan.</h1>
          <Link className="primary-link" href="/dashboard">Back to dashboard</Link>
        </section>
      </main>
    );
  }

  if (!billingLoaded) {
    return (
      <main className="plan-shell">
        <section className="auth-panel">
          <Logo className="eyebrow-logo" />
          <h1>Checking your access…</h1>
        </section>
      </main>
    );
  }

  if (!hasActiveBillingAccess(billing)) {
    return <AccessLockPanel shellClassName="plan-shell" />;
  }

  const gapLine = impact.unassignedBigCosts > 0
    ? `You have ${formatCurrency(impact.unassignedBigCosts, displayCurrency)} of upcoming costs not assigned to a funding source. Your daily spending room may change.`
    : impact.dailyShortfall > 0
      ? `Your current-account-funded big costs need about ${formatCurrency(impact.dailyShortfall, displayCurrency)}/day more than you've got - you're ${formatCurrency(impact.fundingNeededUntilPayday, displayCurrency)} short by payday.`
      : impact.bigCostsHittingCurrentAccount > 0
        ? `Big costs hitting your current account still need about ${formatCurrency(impact.bigCostDailyNeed, displayCurrency)}/day before payday.`
        : "No big costs are hitting your current account right now.";

  const savingsBreakdownCopy = impact.totalCostSpecificSaved > 0
    ? `Savings now includes ${formatCurrency(impact.totalCostSpecificSaved, displayCurrency)} already saved against specific costs and ${formatCurrency(generalProtectedSavings, displayCurrency)} not assigned to a big cost.`
    : `Savings now currently shows ${formatCurrency(generalProtectedSavings, displayCurrency)} not assigned to a big cost.`;
  const savingsLeftAfterPlannedCosts = impact.totalProtectedSavings - impact.bigCostsCoveredBySavings;
  const underfundedSavingsCosts = costs
    .filter((cost) => (cost.amountAlreadySaved || 0) > 0)
    .map((cost) => ({
      ...cost,
      stillNeededAmount: Math.max(0, (Number(cost.amount) || 0) - (Number(cost.amountAlreadySaved) || 0)),
    }))
    .filter((cost) => cost.stillNeededAmount > 0);

  function focusCostForm() {
    window.requestAnimationFrame(() => {
      const nameInput = document.getElementById("plan-cost-name");
      nameInput?.focus();
      nameInput?.select?.();
    });
  }

  function scrollToCosts() {
    costsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToSavings() {
    savingsInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.requestAnimationFrame(() => {
      savingsInputRef.current?.focus();
      savingsInputRef.current?.select?.();
    });
  }

  function resetCostForm() {
    setCostForm({
      name: "",
      amount: "",
      amountAlreadySaved: "",
      dueDate: todayIso,
      frequency: "one_off",
      category: "other",
      fundingStatus: "unassigned",
    });
    setEditingCostId(null);
    setCostError("");
    setShowAddForm(false);
  }

  function startAddCost() {
    setCostError("");
    setCostForm({
      name: "",
      amount: "",
      amountAlreadySaved: "",
      dueDate: todayIso,
      frequency: "one_off",
      category: "other",
      fundingStatus: "unassigned",
    });
    setEditingCostId(null);
    setShowAddForm(true);
    focusCostForm();
  }

  function startEditCost(cost) {
    setCostError("");
    setEditingCostId(cost.id);
    setCostForm({
      name: cost.name || "",
      amount: String(cost.amount ?? ""),
      amountAlreadySaved: String(cost.amountAlreadySaved ?? ""),
      dueDate: cost.nextDueDate || todayIso,
      frequency: cost.frequency || "one_off",
      category: cost.category || "other",
      fundingStatus: normaliseLargeCostFundingStatus(cost.fundingStatus),
    });
    setShowAddForm(true);
    scrollToCosts();
    focusCostForm();
  }

  async function handleAddCost(event) {
    event.preventDefault();

    if (!user || !db) {
      return;
    }

    const amount = Number(costForm.amount);
    const amountAlreadySaved = Number(costForm.amountAlreadySaved || 0);

    if (!costForm.name.trim() || !Number.isFinite(amount) || amount <= 0 || !costForm.dueDate) {
      setCostError("Add a name, amount, and due date before saving.");
      return;
    }
    if (!Number.isFinite(amountAlreadySaved) || amountAlreadySaved < 0) {
      setCostError("Amount already saved must be zero or more.");
      return;
    }

    setSavingCost(true);
    setCostError("");

    try {
      const costId = editingCostId || doc(collection(db, "users", user.uid, "largeCosts")).id;
      const payload = {
        ...buildLargeCostDocument({
          name: costForm.name.trim(),
          amount,
          amountAlreadySaved,
          dueDate: costForm.dueDate,
          frequency: costForm.frequency,
          category: costForm.category,
          fundingStatus: costForm.fundingStatus,
          currency: "GBP",
        }, todayIso),
        updatedAt: serverTimestamp(),
        ...(editingCostId ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(doc(db, "users", user.uid, "largeCosts", costId), payload, { merge: true });
      resetCostForm();
    } catch (error) {
      setCostError(error?.message || "Could not save that big cost.");
    } finally {
      setSavingCost(false);
    }
  }

  async function handleDeleteCost(costId) {
    if (!user || !db) return;
    if (!window.confirm("Remove this big cost?")) return;

    try {
      await deleteDoc(doc(db, "users", user.uid, "largeCosts", costId));
    } catch (error) {
      setCostError(error?.message || "Could not remove that big cost.");
    }
  }

  async function handleFundingStatusChange(costId, fundingStatus) {
    if (!user || !db) return;

    try {
      await setDoc(doc(db, "users", user.uid, "largeCosts", costId), {
        fundingStatus,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      setCostError(error?.message || "Could not update how that big cost is funded.");
    }
  }

  async function handleSavingsSave(event) {
    event.preventDefault();

    if (!user || !db) {
      return;
    }

    const totalSetAside = Number(savingsInput || 0);

    if (!Number.isFinite(totalSetAside) || totalSetAside < 0) {
      setCostError("Savings not assigned to a big cost must be zero or more.");
      return;
    }

    setSavingSavings(true);
    setCostError("");

    try {
      await setDoc(doc(db, "users", user.uid, "settings", "savings"), {
        totalSetAside,
        updatedAt: serverTimestamp(),
        ...(savings?.id ? {} : { createdAt: serverTimestamp() }),
      }, { merge: true });
    } catch (error) {
      setCostError(error?.message || "Could not save your extra savings.");
    } finally {
      setSavingSavings(false);
    }
  }

  return (
    <main className="plan-shell">
      <div className="topbar">
        <div>
          <Link className="brand-link" href="/" aria-label="ClearTill home">
            <Logo className="eyebrow-logo" />
          </Link>
          <h1 className="brand" style={{ fontSize: "2rem" }}>Big costs plan</h1>
        </div>
        <div className="topbar-actions">
          <span className="user-id">
            {user?.isAnonymous
              ? "Guest session"
              : user?.displayName || user?.email || "Signed in"}
          </span>
          <Link className="secondary-button" href="/account">Account</Link>
          <Link className="secondary-button" href="/dashboard">Back to dashboard</Link>
        </div>
      </div>

      <TrustShield className="page-trust-banner" compact />

      <div className="plan-stack">
        <section className="plan-panel plan-gap-panel">
          <p className={`plan-gap-line ${impact.dailyShortfall > 0 ? "is-warning" : "is-calm"}`}>{gapLine}</p>
          <div className="plan-action-row">
            <button className="secondary-button small-button" type="button" onClick={scrollToSavings}>
              Add savings
            </button>
            <button className="secondary-button small-button" type="button" onClick={scrollToCosts}>
              Reduce the cost
            </button>
            <button className="secondary-button small-button" type="button" onClick={scrollToCosts}>
              Move the date
            </button>
          </div>
        </section>

        <section className="plan-panel" ref={costsSectionRef}>
          <div className="section-head">
            <h2 style={{ margin: 0 }}>Large upcoming costs</h2>
            {!showAddForm ? (
              <button className="secondary-button small-button" type="button" onClick={startAddCost}>
                Add cost
              </button>
            ) : null}
          </div>
          {showAddForm ? (
            <form className="edit-form plan-add-form" onSubmit={handleAddCost}>
              <p className="plan-copy" style={{ marginBottom: "10px" }}>
                {editingCostId ? "Update the amount or move the date for this cost." : "Add one cost at a time and keep the rest in the plan below."}
              </p>
              <label className="field-label" htmlFor="plan-cost-name">Name</label>
              <input
                id="plan-cost-name"
                value={costForm.name}
                onChange={(event) => setCostForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Holiday"
              />
              <label className="field-label" htmlFor="plan-cost-amount">Amount</label>
              <input
                id="plan-cost-amount"
                inputMode="decimal"
                value={costForm.amount}
                onChange={(event) => setCostForm((current) => ({ ...current, amount: event.target.value }))}
                placeholder="5000"
              />
              <label className="field-label" htmlFor="plan-cost-saved">Amount already saved</label>
              <input
                id="plan-cost-saved"
                inputMode="decimal"
                value={costForm.amountAlreadySaved}
                onChange={(event) => setCostForm((current) => ({ ...current, amountAlreadySaved: event.target.value }))}
                placeholder="0"
              />
              <label className="field-label" htmlFor="plan-cost-due-date">Due date</label>
              <input
                id="plan-cost-due-date"
                type="date"
                value={costForm.dueDate}
                onChange={(event) => setCostForm((current) => ({ ...current, dueDate: event.target.value }))}
              />
              <label className="field-label" htmlFor="plan-cost-frequency">Frequency</label>
              <select
                id="plan-cost-frequency"
                className="category-select"
                value={costForm.frequency}
                onChange={(event) => setCostForm((current) => ({ ...current, frequency: event.target.value }))}
              >
                {Object.entries(LARGE_COST_FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <label className="field-label" htmlFor="plan-cost-category">Category</label>
              <select
                id="plan-cost-category"
                className="category-select"
                value={costForm.category}
                onChange={(event) => setCostForm((current) => ({ ...current, category: event.target.value }))}
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
                      className={`funding-toggle${costForm.fundingStatus === value ? " is-active" : ""}`}
                      type="button"
                      onClick={() => setCostForm((current) => ({ ...current, fundingStatus: value }))}
                    >
                      {meta.label}
                    </button>
                  ))}
                </div>
                <p className="helper-text">{(LARGE_COST_FUNDING_META[costForm.fundingStatus] || LARGE_COST_FUNDING_META.unassigned).note}</p>
              </div>
              <div className="edit-actions">
                <button className="primary-button small-button" type="submit" disabled={savingCost}>
                  {savingCost ? "Saving..." : editingCostId ? "Update" : "Save"}
                </button>
                <button className="secondary-button small-button" type="button" onClick={resetCostForm}>
                  Cancel
                </button>
              </div>
              {costError ? <p className="error">{costError}</p> : null}
            </form>
          ) : null}
          {costs.length ? (
            <ul className="plan-list">
              {costs.map((cost) => {
                const category = LARGE_COST_CATEGORY_META[cost.category] || LARGE_COST_CATEGORY_META.other;
                return (
                  <li key={cost.id} className="plan-item">
                    <details className="plan-cost-details" open={editingCostId === cost.id}>
                      <summary className="plan-cost-summary">
                        <div className="plan-cost-main">
                          <span className="plan-item-name">{category.icon} {cost.name}</span>
                          <span className="plan-cost-due">Due {formatDisplayDate(cost.nextDueDate)}</span>
                          <span className="plan-cost-need">{cost.fundingMeta.note}</span>
                        </div>
                        <div className="plan-cost-side">
                          <div className="plan-cost-amounts">
                            <span><em>Total</em><strong>{formatCurrency(cost.amount, displayCurrency)}</strong></span>
                            <span><em>Saved</em><strong>{formatCurrency(cost.amountAlreadySaved || 0, displayCurrency)}</strong></span>
                            <span><em>Current account</em><strong>{formatCurrency(cost.currentAccountAmount || 0, displayCurrency)}</strong></span>
                          </div>
                          <span className={`large-cost-badge large-cost-badge-${cost.statusBadge.toLowerCase().replace(/\s+/g, "-")}`}>{cost.statusBadge}</span>
                        </div>
                      </summary>
                      <div className="plan-cost-expanded">
                        <div className="plan-item-grid">
                          <span><strong>{formatCurrency(cost.amount, displayCurrency)}</strong> big cost total</span>
                          <span><strong>{LARGE_COST_FUNDING_META[cost.fundingStatus]?.label || "Unassigned"}</strong> funding source</span>
                          <span><strong>{formatCurrency(cost.amountAlreadySaved || 0, displayCurrency)}</strong> saved against this cost</span>
                          <span><strong>{formatCurrency(cost.savingsCoveredAmount || 0, displayCurrency)}</strong> covered by savings</span>
                          <span><strong>{formatCurrency(cost.currentAccountAmount || 0, displayCurrency)}</strong> hits current account</span>
                          <span><strong>{formatCurrency(cost.adjustedPerDayRaw, displayCurrency)}/day</strong> daily current-account impact</span>
                          <span><strong>{formatCurrency(cost.adjustedMonthlySavingRaw, displayCurrency)}/month</strong> monthly equivalent</span>
                          <span><strong>{cost.daysUntilDue > 0 ? `${cost.daysUntilDue} day${cost.daysUntilDue === 1 ? "" : "s"}` : cost.statusBadge}</strong> days left</span>
                          <span><strong>{LARGE_COST_FREQUENCY_LABELS[cost.frequency]}</strong> frequency</span>
                          <span><strong>{category.label}</strong> category</span>
                        </div>
                        <div className="funding-toggle-row" style={{ marginTop: "12px" }}>
                          {Object.entries(LARGE_COST_FUNDING_META).map(([value, meta]) => (
                            <button
                              key={`${cost.id}-${value}`}
                              className={`funding-toggle${cost.fundingStatus === value ? " is-active" : ""}`}
                              type="button"
                              onClick={() => handleFundingStatusChange(cost.id, value)}
                            >
                              {meta.label}
                            </button>
                          ))}
                        </div>
                        <div className="bill-actions" style={{ marginTop: "12px" }}>
                          <button className="bill-action-button" type="button" onClick={() => startEditCost(cost)}>
                            Edit
                          </button>
                          <button className="bill-action-button bill-action-remove" type="button" onClick={() => handleDeleteCost(cost.id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="plan-copy">No large upcoming costs yet.</p>
          )}
        </section>

        <section className="plan-panel">
          <h2>Savings</h2>
          <p className="plan-copy">
            Savings now means your total available savings. Savings not assigned to a big cost is money you have saved but have not linked to a specific planned cost yet. Not counted as daily spending money.
          </p>
          <form className="edit-form plan-add-form plan-savings-form" onSubmit={handleSavingsSave} style={{ marginTop: "14px" }}>
            <label className="field-label" htmlFor="plan-savings-set-aside">Savings not assigned to a big cost</label>
            <div className="chat-input-row plan-savings-row">
              <input
                id="plan-savings-set-aside"
                inputMode="decimal"
                ref={savingsInputRef}
                value={savingsInput}
                onChange={(event) => setSavingsInput(event.target.value)}
                placeholder="2000"
              />
              <button className="secondary-button" type="submit" disabled={savingSavings}>
                {savingSavings ? "Updating..." : "Update savings"}
              </button>
            </div>
          </form>
          <div className="plan-savings-breakdown">
            <div className="plan-savings-breakdown-row">
              <span>Savings now</span>
              <strong>{formatCurrency(impact.totalProtectedSavings, displayCurrency)}</strong>
            </div>
            <div className="plan-savings-breakdown-row">
              <span>Savings not assigned to a big cost</span>
              <strong>{formatCurrency(generalProtectedSavings, displayCurrency)}</strong>
            </div>
            <div className="plan-savings-breakdown-row">
              <span>Saved against specific costs</span>
              <strong>{formatCurrency(impact.totalCostSpecificSaved, displayCurrency)}</strong>
            </div>
            {impact.bigCostsCoveredBySavings > 0 ? (
              <>
                <div className="plan-savings-breakdown-row">
                  <span>Planned big costs paid from savings</span>
                  <strong>-{formatCurrency(impact.bigCostsCoveredBySavings, displayCurrency)}</strong>
                </div>
                <div className="plan-savings-breakdown-row">
                  <span>Savings left after planned costs</span>
                  <strong>{formatCurrency(savingsLeftAfterPlannedCosts, displayCurrency)}</strong>
                </div>
              </>
            ) : null}
            {underfundedSavingsCosts.map((cost) => (
              <div key={`still-needed-${cost.id}`} className="plan-savings-breakdown-row">
                <span>Still needed for {cost.name}</span>
                <strong>{formatCurrency(cost.stillNeededAmount, displayCurrency)}</strong>
              </div>
            ))}
          </div>
          {costs.length && impact.totalCostSpecificSaved > 0 ? (
            <ul className="plan-savings-assigned-list">
              {costs.filter((cost) => (cost.amountAlreadySaved || 0) > 0).map((cost) => (
                <li key={`${cost.id}-saved`}>
                  <span>{cost.name}</span>
                  <strong>{formatCurrency(cost.amountAlreadySaved || 0, displayCurrency)} saved</strong>
                </li>
              ))}
            </ul>
          ) : null}
          <details className="plan-workings">
            <summary>Show workings</summary>
            <div className="plan-grid plan-workings-grid" style={{ marginTop: "14px" }}>
              <article className="plan-card">
                <span>Big costs total</span>
                <strong>{formatCurrency(impact.totalBigCosts, displayCurrency)}</strong>
              </article>
              <article className="plan-card">
                <span>Savings not assigned to a big cost</span>
                <strong>{formatCurrency(generalProtectedSavings, displayCurrency)}</strong>
              </article>
              <article className="plan-card">
                <span>Saved against specific costs</span>
                <strong>{formatCurrency(impact.totalCostSpecificSaved, displayCurrency)}</strong>
              </article>
              <article className="plan-card">
                <span>Savings now</span>
                <strong>{formatCurrency(impact.totalProtectedSavings, displayCurrency)}</strong>
              </article>
              <article className="plan-card">
                <span>Big costs hitting current account</span>
                <strong>{formatCurrency(impact.bigCostsHittingCurrentAccount, displayCurrency)}</strong>
              </article>
              <article className="plan-card">
                <span>Daily current-account impact</span>
                <strong>{formatCurrency(impact.requiredDailyAfterSavings, displayCurrency)}/day</strong>
              </article>
              <article className="plan-card">
                <span>Normal runway</span>
                <strong>{formatCurrency(impact.normalDailyBudget, displayCurrency)}/day</strong>
              </article>
              <article className="plan-card">
                <span>After current-account big costs</span>
                <strong>{formatCurrency(impact.safeDailyBudget, displayCurrency)}/day</strong>
              </article>
              <article className="plan-card">
                <span>Short by payday</span>
                <strong>{formatCurrency(impact.fundingNeededUntilPayday, displayCurrency)}</strong>
              </article>
              <article className="plan-card">
                <span>Days until payday</span>
                <strong>{dashboard.daysTillPayday || 0} day{dashboard.daysTillPayday === 1 ? "" : "s"}</strong>
              </article>
            </div>
            <p className="plan-copy" style={{ marginTop: "12px" }}>
              {savingsBreakdownCopy}
            </p>
          </details>
          {!showAddForm && costError ? <p className="error">{costError}</p> : null}
        </section>
      </div>
    </main>
  );
}
