"use client";

import { useRef, useState } from "react";
import {
  calculatePaydayCashflow,
  formatGbp,
  getCalculationPeriod,
  getLondonTodayIso,
  getPacingFigures,
  parseMoneyToPence,
} from "@/lib/paydayCashflowCalculator";

const INITIAL_VALUES = {
  currentBalance: "",
  nextIncomeDate: "",
  confirmedIncome: "",
  bills: "",
  oneOffCosts: "",
  safetyBuffer: "",
};

const FIELD_CONFIG = [
  { name: "currentBalance", label: "Current balance", allowNegative: true, optional: false },
  { name: "confirmedIncome", label: "Confirmed income before that date", allowNegative: false, optional: true },
  { name: "bills", label: "Bills due on or before that date", allowNegative: false, optional: false },
  { name: "oneOffCosts", label: "One-off committed costs on or before that date", allowNegative: false, optional: false },
  { name: "safetyBuffer", label: "Safety buffer", allowNegative: false, optional: true },
];

export default function PaydayCashflowCalculator() {
  const [values, setValues] = useState(INITIAL_VALUES);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const resultRef = useRef(null);
  const todayIso = getLondonTodayIso();

  function updateValue(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined, form: undefined }));
  }

  function calculate(event) {
    event.preventDefault();
    const nextErrors = {};
    const parsed = {};

    for (const field of FIELD_CONFIG) {
      try {
        parsed[field.name] = parseMoneyToPence(values[field.name], field);
      } catch (error) {
        nextErrors[field.name] = error.message;
      }
    }

    let period;
    try {
      period = getCalculationPeriod(values.nextIncomeDate, todayIso);
    } catch (error) {
      nextErrors.nextIncomeDate = error.message;
    }

    if (Object.keys(nextErrors).length) {
      nextErrors.form = "Check the highlighted fields and calculate again.";
      setErrors(nextErrors);
      setResult(null);
      const firstInvalidName = Object.keys(nextErrors).find((name) => name !== "form");
      window.requestAnimationFrame(() => document.getElementById(firstInvalidName)?.focus());
      return;
    }

    const calculation = calculatePaydayCashflow({
      currentBalancePence: parsed.currentBalance,
      confirmedIncomeBeforeDatePence: parsed.confirmedIncome,
      billsDueBeforeDatePence: parsed.bills,
      oneOffCommittedCostsPence: parsed.oneOffCosts,
      safetyBufferPence: parsed.safetyBuffer,
    });
    const pacing = getPacingFigures(calculation.clearToSpendPence, period.pacingDays, period.daysUntilIncome);
    setErrors({});
    setResult({ ...calculation, ...period, ...pacing, parsed, nextIncomeDate: values.nextIncomeDate });
    window.requestAnimationFrame(() => resultRef.current?.focus());
  }

  function reset() {
    setValues(INITIAL_VALUES);
    setErrors({});
    setResult(null);
  }

  return (
    <section className="calculator-panel" aria-labelledby="calculator-form-title">
      <div className="calculator-panel-intro">
        <p className="eyebrow">Your figures stay on this page</p>
        <h2 id="calculator-form-title">Work out what remains</h2>
        <p>Enter totals only. Nothing here is saved, added to the address bar or sent to ClearTill.</p>
      </div>

      <form className="calculator-form" onSubmit={calculate} noValidate>
        {errors.form ? <p className="calculator-form-error" role="alert">{errors.form}</p> : null}
        <MoneyField
          name="currentBalance"
          label="Current balance"
          value={values.currentBalance}
          error={errors.currentBalance}
          help="This can be positive, zero or negative."
          onChange={updateValue}
        />
        <div className="calculator-field">
          <label htmlFor="nextIncomeDate">Next reliable income date</label>
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
          <p className="calculator-field-help" id="nextIncomeDate-help">This date ends the calculation period. Costs due today count. If the date is today, the result covers today before that income arrives.</p>
          {errors.nextIncomeDate ? <p className="calculator-field-error" id="nextIncomeDate-error">{errors.nextIncomeDate}</p> : null}
        </div>
        <MoneyField
          name="confirmedIncome"
          label="Confirmed income arriving before that date (optional)"
          value={values.confirmedIncome}
          error={errors.confirmedIncome}
          help="Do not include income arriving on the selected date. Leave out uncertain income so you do not double-count payday."
          onChange={updateValue}
        />
        <MoneyField
          name="bills"
          label="Bills due on or before that date"
          value={values.bills}
          error={errors.bills}
          help="Add rent, direct debits, standing orders and other dated bills due up to and including the selected date. Enter 0 if there are none."
          onChange={updateValue}
        />
        <MoneyField
          name="oneOffCosts"
          label="One-off committed costs on or before that date"
          value={values.oneOffCosts}
          error={errors.oneOffCosts}
          help="Include known costs already committed up to and including the selected date, even if they are not regular bills. Enter 0 if there are none."
          onChange={updateValue}
        />
        <MoneyField
          name="safetyBuffer"
          label="Safety buffer (optional)"
          value={values.safetyBuffer}
          error={errors.safetyBuffer}
          help="An amount you choose not to treat as available, for small omissions or surprises."
          onChange={updateValue}
        />

        <div className="calculator-actions">
          <button className="primary-button" type="submit">Calculate</button>
          <button className="secondary-button" type="button" onClick={reset}>Reset</button>
        </div>
      </form>

      {result ? <CalculatorResult result={result} resultRef={resultRef} /> : null}
    </section>
  );
}

function MoneyField({ name, label, value, error, help, onChange }) {
  const helpId = `${name}-help`;
  const errorId = `${name}-error`;
  return (
    <div className="calculator-field">
      <label htmlFor={name}>{label}</label>
      <div className="calculator-money-input">
        <span aria-hidden="true">£</span>
        <input
          id={name}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={onChange}
          aria-invalid={Boolean(error)}
          aria-describedby={`${helpId}${error ? ` ${errorId}` : ""}`}
        />
      </div>
      <p className="calculator-field-help" id={helpId}>{help}</p>
      {error ? <p className="calculator-field-error" id={errorId}>{error}</p> : null}
    </div>
  );
}

function CalculatorResult({ result, resultRef }) {
  const resultAmount = result.isShortfall ? result.shortfallPence : result.clearToSpendPence;
  return (
    <section
      className={`calculator-result${result.isShortfall ? " is-shortfall" : " is-clear"}`}
      ref={resultRef}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <p className="calculator-result-label">
        {result.isShortfall ? "Expected shortfall from the figures entered" : "Estimated amount left after the figures entered"}
      </p>
      <p className="calculator-result-amount">{formatGbp(resultAmount)}</p>
      <p className="calculator-result-period">
        {result.isSameDay
          ? "The selected income date is today. Bills and committed costs due today are included, and the income arriving today is not."
          : `${result.planningDays} calendar days in the inclusive planning period, ending on the selected income date.`}
        {" "}Omitted, variable or unexpected costs can change this estimate.
      </p>

      {!result.isShortfall ? (
        <div className="calculator-pacing" aria-label="Rough pacing figures">
          <div><span>Rough daily pacing</span><strong>{formatGbp(result.dailyPence)}</strong></div>
          {result.weeklyPence !== null ? <div><span>Rough weekly pacing</span><strong>{formatGbp(result.weeklyPence)}</strong></div> : null}
          <p>These are rough pacing figures, not spending targets. Real spending rarely happens evenly.</p>
        </div>
      ) : (
        <p className="calculator-shortfall-note">The costs entered are greater than the balance and confirmed income entered. This is a gap to address, not negative spending money.</p>
      )}

      <div className="calculator-breakdown">
        <h3>Calculation breakdown</h3>
        <dl>
          <BreakdownRow label="Current balance" value={result.parsed.currentBalance} />
          <BreakdownRow label="Confirmed income before the selected date" value={result.parsed.confirmedIncome} positive />
          <BreakdownRow label="Bills due on or before the selected date" value={result.parsed.bills} subtract />
          <BreakdownRow label="One-off committed costs on or before the selected date" value={result.parsed.oneOffCosts} subtract />
          <BreakdownRow label="Safety buffer" value={result.parsed.safetyBuffer} subtract />
          <BreakdownRow
            label={result.isShortfall ? "Expected shortfall" : "Estimated amount left"}
            value={resultAmount}
            total
          />
        </dl>
      </div>

      <div className="calculator-result-cta">
        <div><p className="eyebrow">Want to keep the position updated?</p><h3>Try the full ClearTill preview</h3><p>The free calculator works on its own. The preview lets you build and update a fuller position.</p></div>
        <a className="primary-button" href="/start">Try the ClearTill preview</a>
      </div>
    </section>
  );
}

function BreakdownRow({ label, value, positive = false, subtract = false, total = false }) {
  const prefix = positive && value > 0 ? "+" : subtract && value > 0 ? "−" : "";
  const displayValue = positive || subtract || total ? Math.abs(value) : value;
  return <div className={total ? "is-total" : ""}><dt>{label}</dt><dd>{prefix}{formatGbp(displayValue)}</dd></div>;
}
