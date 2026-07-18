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
  availableCash: "",
  nextIncomeDate: "",
};

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

    if (Object.keys(nextErrors).length) {
      nextErrors.form = "Check the highlighted fields and calculate again.";
      setErrors(nextErrors);
      setResult(null);
      const firstInvalidName = Object.keys(nextErrors).find((name) => name !== "form");
      window.requestAnimationFrame(() => document.getElementById(firstInvalidName)?.focus());
      return;
    }

    const calculation = calculatePaydayCashflow({ availableCashPence });
    const pacing = getPacingFigures(availableCashPence, period.pacingDays);
    setErrors({});
    setResult({ ...calculation, ...period, ...pacing });
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
        <h2 id="calculator-form-title">Cash per day until payday</h2>
        <p>Enter the cash you have available now and your next payday. Nothing is saved or sent to ClearTill.</p>
      </div>

      <form className="calculator-form" onSubmit={calculate} noValidate>
        {errors.form ? <p className="calculator-form-error" role="alert">{errors.form}</p> : null}
        <MoneyField
          name="availableCash"
          label="Cash available now"
          value={values.availableCash}
          error={errors.availableCash}
          help="Enter only money you can use between now and payday. Do not include wages or other income that has not arrived yet."
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
          <p className="calculator-field-help" id="nextIncomeDate-help">The calculation includes today and ends on your selected payday.</p>
          {errors.nextIncomeDate ? <p className="calculator-field-error" id="nextIncomeDate-error">{errors.nextIncomeDate}</p> : null}
        </div>

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
  return (
    <section
      className="calculator-result is-clear"
      ref={resultRef}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <p className="calculator-result-label">Available per day until payday</p>
      <p className="calculator-result-amount">{formatGbp(result.dailyPence)}</p>
      <p className="calculator-result-period">
        {formatGbp(result.availableCashPence)} ÷ {result.planningDays} {result.planningDays === 1 ? "day" : "days"} = {formatGbp(result.dailyPence)} per day.
      </p>

      <div className="calculator-breakdown">
        <h3>Calculation</h3>
        <dl>
          <div><dt>Cash available now</dt><dd>{formatGbp(result.availableCashPence)}</dd></div>
          <div><dt>Days through payday</dt><dd>{result.planningDays}</dd></div>
          <div className="is-total"><dt>Available per day</dt><dd>{formatGbp(result.dailyPence)}</dd></div>
        </dl>
      </div>

      <div className="calculator-result-cta">
        <div><p className="eyebrow">Need to account for bills too?</p><h3>Try the full ClearTill preview</h3><p>Add bills and one-off costs to see a fuller position that you can keep updated.</p></div>
        <a className="primary-button" href="/start">Try the ClearTill preview</a>
      </div>
    </section>
  );
}
