"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trackClientAnalyticsEvent } from "@/lib/clientAnalytics";
import { formatCurrency, getTodayIso } from "@/lib/billMath";

const GBP = "GBP";

export default function HomeTryNow() {
  const panelRef = useRef(null);
  const firstResultTrackedRef = useRef(false);
  const trialOfferTrackedRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [balance, setBalance] = useState(500);
  const [payInfo, setPayInfo] = useState(() => ({ payDate: defaultPayDate(), amount: 2300 }));
  const [bills, setBills] = useState(() => buildDefaultBills(defaultPayDate()));
  const [largeCosts, setLargeCosts] = useState(() => buildDefaultLargeCosts(defaultPayDate()));
  const [editingId, setEditingId] = useState("");
  const [openDatePicker, setOpenDatePicker] = useState("");

  const result = useMemo(() => {
    const payDateIso = payInfo.payDate;
    const dueBills = bills.filter((bill) => bill.dueDate <= payDateIso);
    const dueLargeCosts = largeCosts.filter((cost) => cost.dueDate <= payDateIso);
    const billsTotal = dueBills.reduce((sum, bill) => sum + bill.amount, 0);
    const largeCostTotal = dueLargeCosts.reduce((sum, cost) => sum + cost.amount, 0);
    const allBillsTotal = bills.reduce((sum, bill) => sum + bill.amount, 0);
    const allLargeCostTotal = largeCosts.reduce((sum, cost) => sum + cost.amount, 0);
    const sampleOutgoingsTotal = allBillsTotal + allLargeCostTotal;
    const totalCommitted = billsTotal + largeCostTotal;
    const availableBeforePay = balance - totalCommitted;
    const forecastAfterPay = availableBeforePay + payInfo.amount;
    const daysToPay = Math.max(1, daysBetween(getTodayIso(), payDateIso));
    const safeDaily = Math.max(0, availableBeforePay / daysToPay);

    return {
      billsTotal,
      largeCostTotal,
      sampleOutgoingsTotal,
      totalCommitted,
      availableBeforePay,
      forecastAfterPay,
      safeDaily,
      daysToPay,
      shortfall: availableBeforePay < 0 ? Math.abs(availableBeforePay) : 0,
    };
  }, [balance, bills, largeCosts, payInfo]);

  useEffect(() => {
    if (expanded && !firstResultTrackedRef.current) {
      firstResultTrackedRef.current = true;
      void trackClientAnalyticsEvent("first_clear_result_viewed", {});
    }
  }, [expanded]);

  useEffect(() => {
    if (expanded && !trialOfferTrackedRef.current) {
      trialOfferTrackedRef.current = true;
      void trackClientAnalyticsEvent("trial_offer_viewed", {});
    }
  }, [expanded]);

  function openDemo() {
    setExpanded(true);
    void trackClientAnalyticsEvent("try_now_clicked", {});
  }

  function closeDemo() {
    setExpanded(false);
    setEditingId("");
    setOpenDatePicker("");
    void trackClientAnalyticsEvent("try_now_closed", {});
  }

  function updateBill(id, patch) {
    setBills((current) => current.map((bill) => (bill.id === id ? normaliseItem({ ...bill, ...patch }) : bill)));
    void trackClientAnalyticsEvent("result_edited", { action: "edit_bill" });
  }

  function updateLargeCost(id, patch) {
    setLargeCosts((current) => current.map((cost) => (cost.id === id ? normaliseItem({ ...cost, ...patch }) : cost)));
    void trackClientAnalyticsEvent("result_edited", { action: "edit_large_cost" });
  }

  function removeLargeCost(id) {
    setLargeCosts((current) => current.filter((cost) => cost.id !== id));
    setEditingId("");
    void trackClientAnalyticsEvent("result_edited", { action: "remove_large_cost" });
  }

  function startTrial() {
    void trackClientAnalyticsEvent("trial_checkout_started", { source: "sample_demo" });
    window.location.href = "/dashboard";
  }

  return (
    <>
      <button className="primary-button pulse-button" type="button" onClick={openDemo}>Sample Instantly</button>

      <section
        ref={panelRef}
        className={`try-now-panel instant-demo${expanded ? " is-open" : ""}`}
        aria-live="polite"
        aria-modal={expanded ? "true" : undefined}
        role={expanded ? "dialog" : undefined}
      >
        {expanded ? (
          <>
            <div className="try-now-header">
              <div>
                <p className="eyebrow">Sample account</p>
                <h2>See what is left before payday</h2>
              </div>
              <div className="instant-demo-header-actions">
                <button className="secondary-button" type="button" onClick={closeDemo}>Close sample</button>
              </div>
            </div>

            <section className={`try-result-panel try-result-panel-prominent${result.shortfall ? " is-short" : " is-clear"}`}>
              <p className="eyebrow">Your sample result</p>
              <h2>
                {result.availableBeforePay >= 0
                  ? `You're clear: ${formatCurrency(result.availableBeforePay, GBP)} left till payday`
                  : `Short before pay date: ${formatCurrency(result.shortfall, GBP)}`}
              </h2>
              <div className="try-result-grid">
                <Metric label="Current balance" value={formatCurrency(balance, GBP)} />
                <Metric label="Due before pay" value={formatCurrency(result.totalCommitted, GBP)} />
                <Metric label="Safe daily before payday" value={formatCurrency(result.safeDaily, GBP)} />
              </div>
              <p className="helper-text payday-countdown">
                Payday in {result.daysToPay} days. Pay arriving: {formatCurrency(payInfo.amount, GBP)}.
              </p>
              <p className="helper-text result-maths-line">
                {result.shortfall
                  ? `${formatCurrency(balance, GBP)} minus ${formatCurrency(result.totalCommitted, GBP)} due before pay = ${formatCurrency(result.shortfall, GBP)} short.`
                  : `${formatCurrency(balance, GBP)} minus ${formatCurrency(result.totalCommitted, GBP)} due before pay = ${formatCurrency(result.availableBeforePay, GBP)} left.`}
              </p>
              {result.shortfall ? (
                <p className="page-notice is-error">This sample account may go below £0 before pay date.</p>
              ) : null}
              <SampleTimeline
                payInfo={payInfo}
                bills={bills}
                largeCosts={largeCosts}
              />
            </section>

            <div className="instant-demo-edit-column">
              <section className="editable-pill-section">
                <h3>Edit the sample</h3>
                <p className="helper-text instant-demo-note">Nothing here is saved. Change the balance, expected pay, date, or tap a bill.</p>
                <div className="editable-pill-list">
                  <ValuePill
                    id="balance"
                    label="Balance"
                    value={balance}
                    onChange={setBalance}
                  />
                  <PayPill
                    payInfo={payInfo}
                    onChange={setPayInfo}
                    openDatePicker={openDatePicker}
                    setOpenDatePicker={setOpenDatePicker}
                  />
                </div>
              </section>

              <section className="editable-pill-section">
                <h3>Automatically included bills</h3>
                <div className="editable-pill-list">
                  {bills.map((bill) => (
                    <EditableItemPill
                      key={bill.id}
                      item={bill}
                      editing={editingId === bill.id}
                      payDate={payInfo.payDate}
                      openDatePicker={openDatePicker}
                      setOpenDatePicker={setOpenDatePicker}
                      onEdit={() => {
                        setOpenDatePicker("");
                        setEditingId(bill.id);
                      }}
                      onDone={() => {
                        setOpenDatePicker("");
                        setEditingId("");
                      }}
                      onChange={(patch) => updateBill(bill.id, patch)}
                    />
                  ))}
                  {largeCosts.map((cost) => (
                    <EditableItemPill
                      key={cost.id}
                      item={cost}
                      editing={editingId === cost.id}
                      payDate={payInfo.payDate}
                      openDatePicker={openDatePicker}
                      setOpenDatePicker={setOpenDatePicker}
                      onEdit={() => {
                        setOpenDatePicker("");
                        setEditingId(cost.id);
                      }}
                      onDone={() => {
                        setOpenDatePicker("");
                        setEditingId("");
                      }}
                      onChange={(patch) => updateLargeCost(cost.id, patch)}
                      onRemove={() => removeLargeCost(cost.id)}
                      accent="Large cost"
                      highlighted
                    />
                  ))}
                </div>
                <p className="helper-text large-cost-hint">Large costs are highlighted because you may be able to move or remove them before pay date.</p>
              </section>

              <section className="try-subscription-offer try-subscription-offer-compact">
                <p className="eyebrow">Keep your real ClearTill up to date</p>
                <h3>7 days free, then £1.99*</h3>
                <p>Start free today. Cancel anytime.</p>
                <button className="primary-button" type="button" onClick={startTrial}>Start my free 7-day trial</button>
                <p className="helper-text">* Founding member monthly price. This sample is not saved unless you start your trial.</p>
              </section>
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}

function Metric({ label, value }) {
  return (
    <div className="try-result-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ValuePill({ label, value, onChange }) {
  return (
    <article className="editable-pill is-input-pill">
      <div className="editable-pill-label-block">
        <small>{label}</small>
      </div>
      <div className="money-input">
        <span>£</span>
        <input
          aria-label={label}
          inputMode="decimal"
          value={String(value)}
          onChange={(event) => onChange(parseMoney(event.target.value))}
          onFocus={selectAllMoneyInput}
          onMouseUp={preserveMoneySelection}
        />
      </div>
    </article>
  );
}

function PayPill({ payInfo, onChange, openDatePicker, setOpenDatePicker }) {
  return (
    <article className="editable-pill is-input-pill pay-input-pill">
      <div className="editable-pill-label-block">
        <small>Pay</small>
      </div>
      <div className="pay-inline-fields">
        <div className="money-input">
          <span>£</span>
          <input
            aria-label="Pay amount"
            inputMode="decimal"
            value={String(payInfo.amount)}
            onChange={(event) => onChange({ ...payInfo, amount: parseMoney(event.target.value) })}
            onFocus={selectAllMoneyInput}
            onMouseUp={preserveMoneySelection}
          />
        </div>
        <DateChooser
          id="pay-date"
          label="Pay date"
          value={payInfo.payDate}
          onChange={(payDate) => onChange({ ...payInfo, payDate })}
          openDatePicker={openDatePicker}
          setOpenDatePicker={setOpenDatePicker}
          quickOptions={[
            { label: "1 week", value: dateAfter(getTodayIso(), 7) },
            { label: "2 weeks", value: dateAfter(getTodayIso(), 14) },
            { label: "4 weeks", value: dateAfter(getTodayIso(), 28) },
          ]}
        />
      </div>
    </article>
  );
}

function DateChooser({ id, label, value, onChange, openDatePicker, setOpenDatePicker, quickOptions = [] }) {
  const open = openDatePicker === id;
  const days = buildDateOptions(35);

  function choose(nextValue) {
    onChange(nextValue);
    setOpenDatePicker("");
  }

  return (
    <div className="sample-date-picker">
      <button
        className="date-picker-button"
        type="button"
        aria-expanded={open}
        onClick={() => setOpenDatePicker(open ? "" : id)}
      >
        <span>
          <small>{label}</small>
          {formatSampleDate(value)}
        </span>
        <strong aria-hidden="true">⌄</strong>
      </button>
      {open ? (
        <div className="sample-date-menu">
          <div className="sample-date-menu-head">
            <strong>{formatSampleDate(value)}</strong>
            <button type="button" onClick={() => setOpenDatePicker("")}>Close</button>
          </div>
          <div className="sample-date-quick">
            {quickOptions.map((option) => (
              <button key={`${option.label}-${option.value}`} type="button" onClick={() => choose(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
          <div className="sample-date-grid" aria-label={label}>
            {days.map((day) => (
              <button
                className={day.value === value ? "is-selected" : ""}
                key={day.value}
                type="button"
                onClick={() => choose(day.value)}
              >
                <span>{day.weekday}</span>
                <strong>{day.day}</strong>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SampleTimeline({ payInfo, bills, largeCosts }) {
  const todayIso = getTodayIso();
  const allOutgoings = buildTimelineItems(todayIso, bills, largeCosts);
  const rows = buildWeeklyBillRows(todayIso, payInfo.payDate, allOutgoings);
  const sixWeekTotal = rows.reduce((sum, row) => sum + row.amount, 0);
  const maxAmount = Math.max(1, ...rows.map((row) => row.amount));

  return (
    <section className="sample-timeline" aria-label="Sample bill spending over the next six weeks">
      <div className="sample-timeline-head">
        <strong>Next 6 weeks</strong>
        <span>Total bills: {formatCurrency(sixWeekTotal, GBP)}</span>
      </div>
      <div className="sample-timeline-bars">
        {rows.map((row) => (
          <article className={`sample-timeline-row${row.isPayWeek ? " is-pay-week" : ""}`} key={row.id}>
            <div className="sample-timeline-row-main">
              <strong>{row.label}</strong>
              <small>{row.detail}</small>
            </div>
            <div
              className="sample-timeline-bar-wrap"
              aria-label={`${row.label}: ${row.billNamesText || "No bills due"} totaling ${formatCurrency(row.amount, GBP)}`}
              role="img"
            >
              <span className="sample-timeline-bar" style={{ "--bar-width": row.amount > 0 ? `${Math.max(10, (row.amount / maxAmount) * 100)}%` : "0%" }} />
            </div>
            <strong className="sample-timeline-amount">{formatCurrency(row.amount, GBP)}</strong>
            {row.billSummary.length ? (
              <div className="sample-timeline-bill-list" aria-label={`${row.label} bills`}>
                {row.billSummary.map((item) => (
                  <span className="sample-timeline-bill-chip" key={`${row.id}-${item.id}`}>
                    {item.name} {formatCurrency(item.amount, GBP)}
                  </span>
                ))}
              </div>
            ) : (
              <div className="sample-timeline-empty">No bills due</div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function buildTimelineItems(todayIso, bills, largeCosts) {
  const timelineEnd = dateAfter(todayIso, 41);
  return [
    ...expandRecurringBills(bills, todayIso, timelineEnd),
    ...largeCosts.map((cost) => ({ ...cost })),
  ];
}

function expandRecurringBills(bills, rangeStartIso, rangeEndIso) {
  return bills.flatMap((bill) => {
    const occurrences = [];
    let occurrenceDate = bill.dueDate;

    while (occurrenceDate <= rangeEndIso) {
      if (occurrenceDate >= rangeStartIso) {
        occurrences.push({
          ...bill,
          id: `${bill.id}-${occurrenceDate}`,
          dueDate: occurrenceDate,
        });
      }
      occurrenceDate = addMonthsKeepingDay(occurrenceDate, 1);
    }

    return occurrences;
  });
}

function buildWeeklyBillRows(todayIso, payDateIso, items) {
  const today = parseIsoDate(todayIso);
  const payWeekIndex = Math.max(0, Math.min(5, Math.floor(daysBetween(todayIso, payDateIso) / 7)));

  return Array.from({ length: 6 }, (_, index) => {
    const start = new Date(today);
    start.setDate(start.getDate() + index * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startIso = toIsoDate(start);
    const endIso = toIsoDate(end);
    const weekItems = items.filter((item) => item.dueDate >= startIso && item.dueDate <= endIso);
    const amount = weekItems.reduce((sum, item) => sum + item.amount, 0);

    return {
      id: `week-${index}`,
      label: weeklyLabel(index, payWeekIndex),
      detail: `${formatShortSampleDate(startIso)} - ${formatShortSampleDate(endIso)}${weekItems.length ? `, ${weekItems.length} bill${weekItems.length === 1 ? "" : "s"}` : ""}`,
      amount,
      billSummary: weekItems.map((item) => ({ id: item.id, name: item.name, amount: item.amount })),
      billNamesText: weekItems.map((item) => `${item.name} ${formatCurrency(item.amount, GBP)}`).join(", "),
      isPayWeek: index === payWeekIndex,
    };
  });
}

function weeklyLabel(index, payWeekIndex) {
  if (index === 0) {
    return "This week";
  }
  if (index === 1 && index !== payWeekIndex) {
    return "Next week";
  }
  if (index === payWeekIndex) {
    return "Pay week";
  }
  if (index === payWeekIndex + 1) {
    return "Week after pay";
  }
  return `Week ${index + 1}`;
}

function EditableItemPill({ item, editing, payDate, openDatePicker, setOpenDatePicker, onEdit, onDone, onChange, onRemove, accent = "Bill", highlighted = false }) {
  if (editing) {
    return (
      <article className={`editable-pill is-editing bill-dropdown-card${highlighted ? " is-large-cost" : ""}`}>
        <div className="bill-dropdown-head">
          <strong>{highlighted ? "Large cost" : "Bill details"}</strong>
          <button type="button" onClick={onDone}>Done</button>
        </div>
        <label className="bill-field bill-field-name">
          <span>Name</span>
          <input aria-label={`${accent} name`} value={item.name} onChange={(event) => onChange({ name: event.target.value })} />
        </label>
        <label className="bill-field bill-field-amount">
          <span>Amount</span>
          <div className="money-input">
            <span>£</span>
            <input
              aria-label={`${accent} amount`}
              inputMode="decimal"
              value={String(item.amount)}
              onChange={(event) => onChange({ amount: event.target.value })}
              onFocus={selectAllMoneyInput}
              onMouseUp={preserveMoneySelection}
            />
          </div>
        </label>
        <div className="bill-field bill-field-date">
          <span>Due date</span>
          <DateChooser
            id={`item-date-${item.id}`}
            label="Due date"
            value={item.dueDate}
            onChange={(dueDate) => onChange({ dueDate })}
            openDatePicker={openDatePicker}
            setOpenDatePicker={setOpenDatePicker}
            quickOptions={[
              { label: "Before pay", value: dateBefore(payDate, 3) },
              { label: "Pay week", value: dateAfter(payDate, 2) },
              { label: "Week after", value: dateAfter(payDate, 7) },
            ]}
          />
        </div>
        {onRemove ? <button className="secondary-button delete-button" type="button" onClick={onRemove}>Remove large cost</button> : null}
      </article>
    );
  }

  return (
    <button className={`editable-pill${highlighted ? " is-large-cost" : ""}`} type="button" onClick={onEdit}>
      <strong>{item.name}</strong>
      <span>{formatCurrency(item.amount, GBP)}</span>
      <span>{formatSampleDate(item.dueDate)}</span>
      <span aria-hidden="true">⌄</span>
    </button>
  );
}

function formatSampleDate(isoDate) {
  if (!isoDate) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function formatShortSampleDate(isoDate) {
  if (!isoDate) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function buildDateOptions(daysAhead) {
  const start = parseIsoDate(getTodayIso());
  return Array.from({ length: daysAhead }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const value = toIsoDate(date);
    return {
      value,
      day: new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)),
      weekday: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)),
    };
  });
}

function buildDefaultBills(payDate) {
  return [
    { id: "rent", name: "Rent / mortgage", amount: 800, dueDate: dateAfter(payDate, 2) },
    { id: "phone", name: "Phone", amount: 35, dueDate: dateBefore(payDate, 8) },
    { id: "gas", name: "Gas", amount: 65, dueDate: dateBefore(payDate, 6) },
    { id: "electric", name: "Electric", amount: 90, dueDate: dateAfter(payDate, 3) },
    { id: "water", name: "Water", amount: 35, dueDate: dateAfter(payDate, 4) },
    { id: "broadband", name: "Broadband", amount: 30, dueDate: dateAfter(payDate, 4) },
    { id: "council-tax", name: "Council tax", amount: 100, dueDate: dateAfter(payDate, 5) },
    { id: "insurance", name: "Insurance", amount: 45, dueDate: dateAfter(payDate, 7) },
  ];
}

function buildDefaultLargeCosts(payDate) {
  return [
    { id: "large", name: "Car fix / holiday", amount: 100, dueDate: dateBefore(payDate, 7) },
  ];
}

function parseMoney(value) {
  const amount = Number(String(value || "").replace(/[£,\s]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function normaliseItem(item) {
  return {
    ...item,
    name: String(item.name || "").slice(0, 80),
    amount: parseMoney(item.amount),
    dueDate: isValidDate(item.dueDate) ? item.dueDate : getTodayIso(),
  };
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function defaultPayDate() {
  const date = new Date(`${getTodayIso()}T00:00:00`);
  date.setDate(date.getDate() + 14);
  return toIsoDate(date);
}

function dateBefore(dateIso, daysBefore) {
  const payDate = new Date(`${dateIso}T00:00:00`);
  const date = new Date(payDate);
  date.setDate(date.getDate() - Math.max(1, Number(daysBefore) || 1));
  const today = new Date(`${getTodayIso()}T00:00:00`);
  if (date < today) {
    const fallback = new Date(today);
    fallback.setDate(fallback.getDate() + 1);
    return toIsoDate(fallback);
  }
  return toIsoDate(date);
}

function dateAfter(dateIso, daysAfter) {
  const payDate = new Date(`${dateIso}T00:00:00`);
  payDate.setDate(payDate.getDate() + Math.max(1, Number(daysAfter) || 1));
  return toIsoDate(payDate);
}

function parseIsoDate(dateIso) {
  return new Date(`${dateIso}T00:00:00`);
}

function daysBetween(startIso, endIso) {
  return Math.floor((parseIsoDate(endIso) - parseIsoDate(startIso)) / 86400000);
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonthsKeepingDay(dateIso, monthsToAdd) {
  const date = parseIsoDate(dateIso);
  const originalDay = date.getDate();
  const targetMonth = date.getMonth() + monthsToAdd;
  const targetYear = date.getFullYear();
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  return toIsoDate(new Date(targetYear, targetMonth, Math.min(originalDay, lastDayOfTargetMonth)));
}

function selectAllMoneyInput(event) {
  requestAnimationFrame(() => {
    event.target.select();
  });
}

function preserveMoneySelection(event) {
  event.preventDefault();
  event.currentTarget.select();
}
