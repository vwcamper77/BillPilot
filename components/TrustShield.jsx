export default function TrustShield({ className = "", compact = false, showTitle = true, showNote = true }) {
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
          No bank login &bull; No Open Banking &bull; You control your data
        </span>
        {showNote ? <span className="trust-shield__note">Sensitive data encrypted where supported</span> : null}
      </span>
    </div>
  );
}
