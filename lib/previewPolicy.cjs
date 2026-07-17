const PREVIEW_DAY_MS = 24 * 60 * 60 * 1000;

function asDate(value) {
  if (!value) return null;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePreviewRecord(record = null, now = new Date()) {
  if (!record) {
    return { status: "not_started", startedAt: null, endsAt: null, daysRemaining: null, used: false, active: false };
  }
  const startedAt = asDate(record.startedAt);
  const endsAt = asDate(record.endsAt);
  const storedStatus = String(record.status || "active").toLowerCase();
  const active = storedStatus === "active" && Boolean(endsAt) && endsAt.getTime() > now.getTime();
  const status = storedStatus === "active" && endsAt && !active ? "expired" : storedStatus;
  return {
    ...record,
    status,
    startedAt: startedAt?.toISOString() || null,
    endsAt: endsAt?.toISOString() || null,
    daysRemaining: active ? Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / PREVIEW_DAY_MS)) : 0,
    used: true,
    active,
  };
}

function overlayPreviewAccess({ decision, preview, isAuthenticated, hasPriorCommercialAccess }) {
  const paidOrGrantedAccess = decision.hasAccess === true;
  const canStartPreview = Boolean(isAuthenticated && !preview.used && !hasPriorCommercialAccess && !paidOrGrantedAccess);
  const hasAccess = paidOrGrantedAccess || preview.active;
  return {
    paidOrGrantedAccess,
    canStartPreview,
    hasAccess,
    canEdit: paidOrGrantedAccess || preview.active || canStartPreview,
    accessType: paidOrGrantedAccess ? decision.accessType
      : preview.active ? "no_card_preview"
        : preview.used || hasPriorCommercialAccess ? "read_only" : "preview_available",
    reason: paidOrGrantedAccess ? decision.reason
      : preview.active ? "preview_active"
        : preview.used ? `preview_${preview.status}` : decision.reason,
  };
}

module.exports = { asDate, normalizePreviewRecord, overlayPreviewAccess };
