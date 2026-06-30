export default function TrustShieldBadge({ className = "", compact = false }) {
  const classes = ["trust-shield-badge", compact ? "is-compact" : "is-feature", className].filter(Boolean).join(" ");
  const size = compact ? 76 : 136;

  return (
    <section className={classes} aria-label="ClearTill Trust Shield">
      <img
        className="trust-shield-badge__icon"
        src="/Shield.png?v=20260630-2314"
        alt=""
        width={size}
        height={size}
      />
    </section>
  );
}
