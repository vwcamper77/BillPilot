"use client";

import { forwardRef, useId } from "react";

const DateField = forwardRef(function DateField({
  id,
  label,
  value,
  onChange,
  helpText,
  error,
  disabled = false,
  required = false,
  min,
  max,
  className = "",
  inputClassName = "",
  onPointerDown,
  "aria-describedby": ariaDescribedBy,
  ...inputProps
}, ref) {
  const generatedId = useId();
  const fieldId = id || `date-field-${generatedId.replaceAll(":", "")}`;
  const helpId = helpText ? `${fieldId}-help` : "";
  const errorId = error ? `${fieldId}-error` : "";
  const describedBy = [ariaDescribedBy, helpId, errorId].filter(Boolean).join(" ") || undefined;

  function openNativePicker(event) {
    onPointerDown?.(event);
    if (event.defaultPrevented || disabled || event.button !== 0) return;

    const input = event.currentTarget;
    input.focus({ preventScroll: true });
    if (typeof input.showPicker !== "function") return;

    try {
      input.showPicker();
    } catch {
      // The native input remains fully usable when the browser blocks showPicker().
    }
  }

  return (
    <div className={`field-row date-field${className ? ` ${className}` : ""}`}>
      <label className="field-label" htmlFor={fieldId}>{label}</label>
      <div className="date-field-control">
        <input
          {...inputProps}
          ref={ref}
          id={fieldId}
          className={`date-field-input${inputClassName ? ` ${inputClassName}` : ""}`}
          type="date"
          value={value || ""}
          onChange={onChange}
          onPointerDown={openNativePicker}
          disabled={disabled}
          required={required}
          min={min}
          max={max}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
        />
        <span className="date-field-icon" aria-hidden="true">▦</span>
      </div>
      {helpText ? <span id={helpId} className="field-help">{helpText}</span> : null}
      {error ? <span id={errorId} className="field-error" role="alert">{error}</span> : null}
    </div>
  );
});

export default DateField;
