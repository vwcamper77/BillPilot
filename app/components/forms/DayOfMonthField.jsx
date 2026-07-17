"use client";

import { forwardRef, useId } from "react";

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

function ordinal(day) {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

const DayOfMonthField = forwardRef(function DayOfMonthField({
  id,
  label,
  value,
  onChange,
  helpText,
  error,
  disabled = false,
  required = false,
  emptyLabel = "Select a day",
  className = "",
  selectClassName = "",
  "aria-describedby": ariaDescribedBy,
  ...selectProps
}, ref) {
  const generatedId = useId();
  const fieldId = id || `day-of-month-${generatedId.replaceAll(":", "")}`;
  const helpId = helpText ? `${fieldId}-help` : "";
  const errorId = error ? `${fieldId}-error` : "";
  const describedBy = [ariaDescribedBy, helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`field-row day-of-month-field${className ? ` ${className}` : ""}`}>
      <label className="field-label" htmlFor={fieldId}>{label}</label>
      <select
        {...selectProps}
        ref={ref}
        id={fieldId}
        className={selectClassName || undefined}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={onChange}
        disabled={disabled}
        required={required}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
      >
        <option value="">{emptyLabel}</option>
        {DAYS.map((day) => <option key={day} value={day}>{ordinal(day)}</option>)}
      </select>
      {helpText ? <span id={helpId} className="field-help">{helpText}</span> : null}
      {error ? <span id={errorId} className="field-error" role="alert">{error}</span> : null}
    </div>
  );
});

export default DayOfMonthField;
