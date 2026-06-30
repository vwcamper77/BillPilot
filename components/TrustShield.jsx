/**
 * TrustShield — a compact, official-looking trust mark for ClearTill.
 *
 * Renders an honest, calm summary of ClearTill's security posture as a rounded
 * pill/card with a dark-green border and a shield/lock glyph. No heavy
 * background, mobile friendly. Styling lives in app/globals.css (.trust-shield).
 *
 * Honest wording only — never claim ISO certification.
 */

export default function TrustShield({ className = "", compact = false }) {
  const classes = ["trust-shield", compact ? "trust-shield--compact" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="note" aria-label="ClearTill Trust Shield">
      <span className="trust-shield__icon" aria-hidden="true">🛡️</span>
      <span className="trust-shield__text">
        <strong className="trust-shield__title">ClearTill Trust Shield</strong>
        <span className="trust-shield__subtext">
          No bank login • No Open Banking • Sensitive import data encrypted • You control your data
        </span>
      </span>
    </div>
  );
}
