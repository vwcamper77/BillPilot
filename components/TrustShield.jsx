export default function TrustShield({
  className = "",
  compact = false,
  showTitle = true,
  showNote = true,
  subtext = "No bank login • No Open Banking • You control your data",
  note = "Sensitive data encrypted where supported",
}) {
  const classes = ["trust-shield", compact ? "trust-shield--compact" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="note" aria-label="ClearTill Trust">
      <span className="trust-shield__text">
        {showTitle ? (
          <span className="trust-shield__heading">
            <strong className="trust-shield__title">ClearTill Trust</strong>
          </span>
        ) : null}
        <span className="trust-shield__subtext">
          {subtext}
        </span>
        {showNote ? <span className="trust-shield__note">{note}</span> : null}
      </span>
    </div>
  );
}
