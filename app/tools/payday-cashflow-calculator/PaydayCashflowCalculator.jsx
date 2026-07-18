"use client";

import { useRef, useState } from "react";
import {
  buildCashRunway,
  calculatePaydayCashflow,
  calendarDaysBetween,
  formatGbp,
  getCalculationPeriod,
  getLondonTodayIso,
  getPacingFigures,
  parseIsoCalendarDate,
  parseMoneyToPence,
} from "@/lib/paydayCashflowCalculator";

const INITIAL_VALUES = { availableCash: "", nextIncomeDate: "" };
const INITIAL_BILLS = [1, 2, 3].map((id) => ({ id, name: "", amount: "", date: "" }));
const MAX_BILLS = 8;

export default function PaydayCashflowCalculator() {
  const [values, setValues] = useState(INITIAL_VALUES);
  const [bills, setBills] = useState(INITIAL_BILLS);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const nextBillId = useRef(4);
  const resultRef = useRef(null);
  const todayIso = getLondonTodayIso();

  function updateValue(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined, form: undefined }));
  }

  function updateBill(id, field, value) {
    setBills((current) => current.map((bill) => bill.id === id ? { ...bill, [field]: value } : bill));
    setErrors((current) => ({ ...current, [`bill-${id}-${field}`]: undefined, form: undefined }));
  }

  function addBill() {
    if (bills.length >= MAX_BILLS) return;
    const id = nextBillId.current;
    nextBillId.current += 1;
    setBills((current) => [...current, { id, name: "", amount: "", date: "" }]);
  }

  function removeBill(id) {
    setBills((current) => {
      const remaining = current.filter((bill) => bill.id !== id);
      return remaining.length ? remaining : [{ id: nextBillId.current++, name: "", amount: "", date: "" }];
    });
    setErrors((current) => {
      const next = { ...current };
      delete next[`bill-${id}-amount`];
      delete next[`bill-${id}-date`];
      return next;
    });
  }

  function calculate(event) {
    event.preventDefault();
    const nextErrors = {};
    let availableCashPence;
    let period;

    try {
      availableCashPence = parseMoneyToPence(values.availableCash);
    } catch (error) {
      nextErrors.availableCash = error.message;
    }

    try {
      period = getCalculationPeriod(values.nextIncomeDate, todayIso);
    } catch (error) {
      nextErrors.nextIncomeDate = error.message;
    }

    const parsedBills = [];
    bills.forEach((bill, index) => {
      const hasEntry = Boolean(bill.name.trim() || bill.amount.trim() || bill.date);
      if (!hasEntry) return;

      let amountPence;
      try {
        amountPence = parseMoneyToPence(bill.amount);
        if (amountPence === 0) throw new Error("Enter a bill amount greater than zero.");
      } catch (error) {
        nextErrors[`bill-${bill.id}-amount`] = error.message;
      }

      try {
        parseIsoCalendarDate(bill.date);
        if (period && (calendarDaysBetween(todayIso, bill.date) < 0 || calendarDaysBetween(bill.date, values.nextIncomeDate) < 0)) {
          throw new Error("Choose a date between today and payday.");
        }
      } catch (error) {
        nextErrors[`bill-${bill.id}-date`] = error.message;
      }

      if (Number.isSafeInteger(amountPence) && bill.date && !nextErrors[`bill-${bill.id}-date`]) {
        parsedBills.push({ name: bill.name.trim() || `Bill ${index + 1}`, amountPence, date: bill.date });
      }
    });

    if (Object.keys(nextErrors).length) {
      nextErrors.form = "Check the highlighted fields and calculate again.";
      setErrors(nextErrors);
      setResult(null);
      const firstInvalidName = Object.keys(nextErrors).find((name) => name !== "form");
      window.requestAnimationFrame(() => document.getElementById(firstInvalidName)?.focus());
      return;
    }

    const calculation = calculatePaydayCashflow({ availableCashPence, bills: parsedBills });
    const pacing = calculation.isShortfall
      ? { dailyPence: null }
      : getPacingFigures(calculation.netAvailablePence, period.pacingDays);
    const runway = buildCashRunway({
      availableCashPence,
      bills: parsedBills,
      todayIso,
      paydayIso: values.nextIncomeDate,
    });

    setErrors({});
    setResult({ ...calculation, ...period, ...pacing, bills: parsedBills, runway });
    window.requestAnimationFrame(() => resultRef.current?.focus());
  }

  function reset() {
    setValues(INITIAL_VALUES);
    setBills(INITIAL_BILLS);
    nextBillId.current = 4;
    setErrors({});
    setResult(null);
  }

  return (
    <section className="calculator-panel" aria-labelledby="calculator-form-title">
      <div className="calculator-panel-intro">
        <p className="eyebrow">Your figures stay on this page</p>
        <h2 id="calculator-form-title">Cash left per day until payday</h2>
        <p>Enter today&apos;s cash, your payday and any bills due before then. Future pay is never added.</p>
      </div>

      <form className="calculator-form" onSubmit={calculate} noValidate>
        {errors.form ? <p className="calculator-form-error" role="alert">{errors.form}</p> : null}
        <MoneyField
          name="availableCash"
          label="Cash available now"
          value={values.availableCash}
          error={errors.availableCash}
          help="Use the money currently available. Do not include wages or income that has not arrived."
          onChange={updateValue}
        />
        <div className="calculator-field">
          <label htmlFor="nextIncomeDate">Next payday date</label>
          <input
            id="nextIncomeDate"
            name="nextIncomeDate"
            type="date"
            min={todayIso}
            value={values.nextIncomeDate}
            onChange={updateValue}
            aria-invalid={Boolean(errors.nextIncomeDate)}
            aria-describedby={`nextIncomeDate-help${errors.nextIncomeDate ? " nextIncomeDate-error" : ""}`}
            required
          />
          <p className="calculator-field-help" id="nextIncomeDate-help">The runway includes today and ends on your selected payday.</p>
          {errors.nextIncomeDate ? <p className="calculator-field-error" id="nextIncomeDate-error">{errors.nextIncomeDate}</p> : null}
        </div>

        <fieldset className="calculator-bills">
          <legend>Bills due before payday</legend>
          <p>Add only bills that will leave this cash between today and payday. Blank rows are ignored.</p>
          <div className="calculator-bill-list">
            {bills.map((bill, index) => (
              <BillRow
                key={bill.id}
                bill={bill}
                index={index}
                todayIso={todayIso}
                paydayIso={values.nextIncomeDate}
                errors={errors}
                onChange={updateBill}
                onRemove={removeBill}
              />
            ))}
          </div>
          <button className="calculator-add-bill" type="button" onClick={addBill} disabled={bills.length >= MAX_BILLS}>+ Add another bill</button>
        </fieldset>

        <div className="calculator-actions">
          <button className="primary-button" type="submit">Calculate runway</button>
          <button className="secondary-button" type="button" onClick={reset}>Reset</button>
        </div>
      </form>

      {result ? <CalculatorResult result={result} resultRef={resultRef} /> : null}
    </section>
  );
}

function BillRow({ bill, index, todayIso, paydayIso, errors, onChange, onRemove }) {
  const amountId = `bill-${bill.id}-amount`;
  const dateId = `bill-${bill.id}-date`;
  return (
    <div className="calculator-bill-row">
      <div className="calculator-field">
        <label htmlFor={`bill-${bill.id}-name`}>Bill {index + 1} name <span>(optional)</span></label>
        <input id={`bill-${bill.id}-name`} type="text" maxLength={40} autoComplete="off" value={bill.name} onChange={(event) => onChange(bill.id, "name", event.target.value)} placeholder="e.g. Council tax" />
      </div>
      <MoneyField name={amountId} label="Amount" value={bill.amount} error={errors[amountId]} onChange={(event) => onChange(bill.id, "amount", event.target.value)} />
      <div className="calculator-field">
        <label htmlFor={dateId}>Due date</label>
        <input id={dateId} type="date" min={todayIso} max={paydayIso || undefined} value={bill.date} onChange={(event) => onChange(bill.id, "date", event.target.value)} aria-invalid={Boolean(errors[dateId])} aria-describedby={errors[dateId] ? `${dateId}-error` : undefined} />
        {errors[dateId] ? <p className="calculator-field-error" id={`${dateId}-error`}>{errors[dateId]}</p> : null}
      </div>
      <button className="calculator-remove-bill" type="button" onClick={() => onRemove(bill.id)} aria-label={`Remove bill ${index + 1}`}>Remove</button>
    </div>
  );
}

function MoneyField({ name, label, value, error, help, onChange }) {
  const helpId = `${name}-help`;
  const errorId = `${name}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="calculator-field">
      <label htmlFor={name}>{label}</label>
      <div className="calculator-money-input">
        <span aria-hidden="true">£</span>
        <input id={name} name={name} type="text" inputMode="decimal" autoComplete="off" value={value} onChange={onChange} aria-invalid={Boolean(error)} aria-describedby={describedBy} />
      </div>
      {help ? <p className="calculator-field-help" id={helpId}>{help}</p> : null}
      {error ? <p className="calculator-field-error" id={errorId}>{error}</p> : null}
    </div>
  );
}

function CalculatorResult({ result, resultRef }) {
  const headlineAmount = result.isShortfall ? result.shortfallPence : result.dailyPence;
  return (
    <section className={`calculator-result${result.isShortfall ? " is-shortfall" : " is-clear"}`} ref={resultRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">
      <p className="calculator-result-label">{result.isShortfall ? "Bills exceed today’s cash by" : "Available per day after bills"}</p>
      <p className="calculator-result-amount">{formatGbp(headlineAmount)}</p>
      <p className="calculator-result-period">
        {formatGbp(result.availableCashPence)} cash − {formatGbp(result.totalBillsPence)} bills = {formatGbp(result.netAvailablePence)} left through payday.
        {!result.isShortfall ? ` ${formatGbp(result.netAvailablePence)} ÷ ${result.planningDays} days = ${formatGbp(result.dailyPence)} per day.` : " There is no positive daily amount until the gap is addressed."}
      </p>

      <div className="calculator-breakdown">
        <h3>Calculation</h3>
        <dl>
          <div><dt>Cash available now</dt><dd>{formatGbp(result.availableCashPence)}</dd></div>
          <div><dt>Bills through payday</dt><dd>− {formatGbp(result.totalBillsPence)}</dd></div>
          <div><dt>Net cash left</dt><dd>{formatGbp(result.netAvailablePence)}</dd></div>
          <div><dt>Days through payday</dt><dd>{result.planningDays}</dd></div>
          <div className="is-total"><dt>{result.isShortfall ? "Shortfall" : "Available per day"}</dt><dd>{formatGbp(headlineAmount)}</dd></div>
        </dl>
      </div>

      <RunwayChart result={result} />

      <div className="calculator-result-cta">
        <div><p className="eyebrow">Want to keep it updated?</p><h3>Try the full ClearTill preview</h3><p>Save a fuller position with recurring bills, one-off costs and balance updates.</p></div>
        <a className="primary-button" href="/start">Try the ClearTill preview</a>
      </div>
    </section>
  );
}

function RunwayChart({ result }) {
  const scalePence = Math.max(result.availableCashPence, ...result.runway.map((point) => Math.max(0, point.remainingPence)), 1);
  return (
    <section className="calculator-runway" aria-labelledby="calculator-runway-title">
      <div className="calculator-runway-heading">
        <div><p className="eyebrow">Today to payday</p><h3 id="calculator-runway-title">Your cash runway</h3></div>
        <p>Bars show cash remaining after bills due that day.</p>
      </div>
      <div className="calculator-runway-scroll" tabIndex={0} aria-label="Cash runway chart; scroll horizontally if needed">
        <div className="calculator-runway-chart" style={{ "--runway-days": result.runway.length }}>
          {result.runway.map((point, index) => {
            const height = `${Math.max(4, (Math.max(0, point.remainingPence) / scalePence) * 100)}%`;
            return (
              <article className={`calculator-runway-day${point.remainingPence < 0 ? " is-negative" : ""}${point.bills.length ? " has-bill" : ""}`} key={point.date}>
                <div className="calculator-runway-value">{formatGbp(point.remainingPence)}</div>
                <div className="calculator-runway-bar-track"><div className="calculator-runway-bar" style={{ height }} /></div>
                <strong>{index === 0 ? "Today" : index === result.runway.length - 1 ? "Payday" : formatRunwayDate(point.date)}</strong>
                {point.bills.length ? <div className="calculator-runway-bills">{point.bills.map((bill) => <span key={`${point.date}-${bill.name}`}>{bill.name} −{formatGbp(bill.amountPence)}</span>)}</div> : <span className="calculator-runway-no-bill">No bills</span>}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function formatRunwayDate(isoDate) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}
