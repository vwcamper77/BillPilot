"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import Logo from "@/components/Logo";
import { auth, authPersistenceReady, isFirebaseClientConfigured } from "@/lib/firebase";
import { getStoredAttribution } from "@/lib/analytics/attribution";
import { trackEvent } from "@/lib/analytics/track";
import {
  isDismissalSuppressed,
  isLeadMagnetExcludedRoute,
  isValidGoogleSheetCopyUrl,
  LEAD_MAGNET_EXPERIMENT_VARIANT,
  LEAD_MAGNET_STORAGE_KEYS,
  LEAD_MAGNET_TIMING,
} from "@/lib/leadMagnet";
import styles from "./LeadMagnetCapture.module.css";

const ACTION_EVENTS = {
  pdf: "lead_magnet_pdf_downloaded",
  sheet: "lead_magnet_sheet_downloaded",
  google: "lead_magnet_google_copy_clicked",
  preview: "lead_magnet_to_preview_clicked",
};

function safeStorage(kind) {
  try { return kind === "session" ? window.sessionStorage : window.localStorage; } catch { return null; }
}

function trackingMetadata(surface) {
  return { experiment_variant: LEAD_MAGNET_EXPERIMENT_VARIANT, surface };
}

function isDesktopPointer() {
  return typeof window !== "undefined"
    && window.innerWidth >= 768
    && window.matchMedia("(pointer: fine)").matches;
}

function getFocusable(container) {
  return [...(container?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
    .filter((element) => !element.hasAttribute("hidden") && element.getClientRects().length > 0);
}

export default function LeadMagnetCapture() {
  const pathname = usePathname();
  const [authReady, setAuthReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [surface, setSurface] = useState("desktop_modal");
  const [eligible, setEligible] = useState(false);
  const [mobileTimeReady, setMobileTimeReady] = useState(false);
  const [mobileScrolled, setMobileScrolled] = useState(false);
  const [email, setEmail] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [company, setCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const emailRef = useRef(null);
  const previousFocusRef = useRef(null);
  const startedRef = useRef(false);
  const viewedRef = useRef(false);
  const eligibleTrackedRef = useRef(false);
  const googleSheetUrl = process.env.NEXT_PUBLIC_CASH_POSITION_GOOGLE_SHEET_URL || "";
  const hasGoogleSheet = isValidGoogleSheetCopyUrl(googleSheetUrl);
  const excluded = isLeadMagnetExcludedRoute(pathname);

  useEffect(() => {
    if (!isFirebaseClientConfigured || !auth) {
      setAuthReady(true);
      return undefined;
    }
    let active = true;
    let unsubscribe = () => undefined;
    authPersistenceReady.catch(() => undefined).then(() => {
      if (!active) return;
      unsubscribe = onAuthStateChanged(auth, (user) => {
        if (!active) return;
        setLoggedIn(Boolean(user && !user.isAnonymous));
        setAuthReady(true);
      });
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    const session = safeStorage("session");
    if (pathname === "/start" && session?.getItem(LEAD_MAGNET_STORAGE_KEYS.previewPending) === "1") {
      session.removeItem(LEAD_MAGNET_STORAGE_KEYS.previewPending);
      trackEvent("lead_magnet_preview_started", trackingMetadata("preview_onboarding"));
    }
  }, [pathname]);

  useEffect(() => {
    const onClick = (event) => {
      const actionElement = event.target.closest?.("[data-lead-magnet-action]");
      const action = actionElement?.dataset.leadMagnetAction;
      if (action && ACTION_EVENTS[action]) {
        trackEvent(ACTION_EVENTS[action], trackingMetadata(actionElement.dataset.leadMagnetSurface || "page"));
      }
      const href = event.target.closest?.("a[href]")?.getAttribute("href") || "";
      if (action === "preview" || href === "/start" || href.startsWith("/start?")) {
        safeStorage("session")?.setItem(LEAD_MAGNET_STORAGE_KEYS.primaryCtaUsed, "1");
        if (action === "preview") safeStorage("session")?.setItem(LEAD_MAGNET_STORAGE_KEYS.previewPending, "1");
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    setEligible(false);
    setMobileTimeReady(false);
    setMobileScrolled(false);
    eligibleTrackedRef.current = false;
    if (!authReady || loggedIn || excluded) return undefined;
    const local = safeStorage("local");
    const session = safeStorage("session");
    if (local?.getItem(LEAD_MAGNET_STORAGE_KEYS.completed) === "1"
      || isDismissalSuppressed(local?.getItem(LEAD_MAGNET_STORAGE_KEYS.dismissedAt))
      || session?.getItem(LEAD_MAGNET_STORAGE_KEYS.shownThisSession) === "1"
      || session?.getItem(LEAD_MAGNET_STORAGE_KEYS.primaryCtaUsed) === "1") return undefined;

    const desktopTimer = window.setTimeout(() => {
      if (isDesktopPointer()) setEligible(true);
    }, LEAD_MAGNET_TIMING.desktopEligibleMs);
    const mobileTimer = window.setTimeout(() => setMobileTimeReady(true), LEAD_MAGNET_TIMING.mobileEligibleMs);
    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setMobileScrolled(scrollable > 0 && window.scrollY / scrollable >= LEAD_MAGNET_TIMING.mobileScrollRatio);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.clearTimeout(desktopTimer);
      window.clearTimeout(mobileTimer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [authReady, excluded, loggedIn, pathname]);

  useEffect(() => {
    if (!eligible || loggedIn || excluded || eligibleTrackedRef.current) return;
    eligibleTrackedRef.current = true;
    trackEvent("lead_magnet_popup_eligible", trackingMetadata("desktop_modal"));
  }, [eligible, excluded, loggedIn]);

  const show = (nextSurface) => {
    const local = safeStorage("local");
    const session = safeStorage("session");
    if (open || loggedIn || excluded
      || session?.getItem(LEAD_MAGNET_STORAGE_KEYS.shownThisSession) === "1"
      || session?.getItem(LEAD_MAGNET_STORAGE_KEYS.primaryCtaUsed) === "1"
      || local?.getItem(LEAD_MAGNET_STORAGE_KEYS.completed) === "1"
      || isDismissalSuppressed(local?.getItem(LEAD_MAGNET_STORAGE_KEYS.dismissedAt))) return;
    session?.setItem(LEAD_MAGNET_STORAGE_KEYS.shownThisSession, "1");
    previousFocusRef.current = document.activeElement;
    setSurface(nextSurface);
    setOpen(true);
  };

  useEffect(() => {
    if (!eligible || loggedIn || excluded) return undefined;
    const onMouseOut = (event) => {
      if (isDesktopPointer() && event.relatedTarget === null && event.clientY <= 0) show("desktop_modal");
    };
    document.addEventListener("mouseout", onMouseOut);
    return () => document.removeEventListener("mouseout", onMouseOut);
  }, [eligible, excluded, loggedIn, open]);

  useEffect(() => {
    if (!mobileTimeReady || !mobileScrolled || loggedIn || excluded || window.innerWidth >= 768) return;
    if (!eligibleTrackedRef.current) {
      eligibleTrackedRef.current = true;
      trackEvent("lead_magnet_popup_eligible", trackingMetadata("mobile_sheet"));
    }
    show("mobile_sheet");
  }, [mobileTimeReady, mobileScrolled, excluded, loggedIn, open]);

  useEffect(() => {
    if (!open) return undefined;
    if (!viewedRef.current) {
      viewedRef.current = true;
      trackEvent("lead_magnet_popup_viewed", trackingMetadata(surface));
    }
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => (submitted ? dialogRef.current?.querySelector("a") : emailRef.current)?.focus());
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); return; }
      if (event.key !== "Tab") return;
      const focusable = getFocusable(dialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, submitted, surface]);

  const dismiss = () => {
    if (!open) return;
    safeStorage("local")?.setItem(LEAD_MAGNET_STORAGE_KEYS.dismissedAt, String(Date.now()));
    trackEvent("lead_magnet_popup_dismissed", trackingMetadata(surface));
    setOpen(false);
    window.requestAnimationFrame(() => previousFocusRef.current?.focus?.());
  };

  const startForm = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent("lead_magnet_form_started", trackingMetadata(surface));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const attribution = getStoredAttribution();
    try {
      const response = await fetch("/api/lead-magnet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          marketingConsent,
          company,
          attribution: {
            sourceRoute: pathname,
            referrer: document.referrer || null,
            utmSource: attribution?.utm_source || null,
            utmMedium: attribution?.utm_medium || null,
            utmCampaign: attribution?.utm_campaign || null,
            utmContent: attribution?.utm_content || null,
            utmTerm: attribution?.utm_term || null,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Please try again.");
      safeStorage("local")?.setItem(LEAD_MAGNET_STORAGE_KEYS.completed, "1");
      trackEvent("lead_magnet_submitted", trackingMetadata(surface));
      if (marketingConsent) trackEvent("lead_magnet_marketing_opt_in", trackingMetadata(surface));
      setSubmitted(true);
    } catch (submissionError) {
      setError(submissionError.message || "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="lead-magnet-title" aria-describedby="lead-magnet-description">
        <button className={styles.close} type="button" aria-label="Close free guide offer" onClick={dismiss}>×</button>
        <aside className={styles.visual} aria-hidden="true">
          <Logo className={styles.wordmark} height={38} />
          <div className={styles.calculation}><span>The calculation</span><strong>Balance − bills − one-offs − buffer = what is actually clear</strong></div>
          <p className={styles.trust}>No bank login<br />No Open Banking<br />No card required</p>
        </aside>
        <div className={styles.content}>
          <p className={styles.eyebrow}>Free 10-minute cash check</p>
          <h2 id="lead-magnet-title">Before you go, work out what your balance still has to cover.</h2>
          <p className={styles.lead} id="lead-magnet-description">Get the ClearTill Bank Balance Reset guide and free cash-position spreadsheet. Use it to see what is genuinely left before payday.</p>
          <ul className={styles.benefits}><li>Excel and Google Sheets</li><li>No bank connection</li><li>One-payday calculation</li><li>Immediate access</li></ul>
          {submitted ? (
            <div className={styles.success} role="status">
              <h3>Check your inbox. Your guide and spreadsheet link are on their way.</h3>
              <p>You can also use the resources immediately.</p>
              <div className={styles.actions}>
                <a href="/downloads/cleartill-free-cash-position-sheet.xlsx" data-lead-magnet-action="sheet" data-lead-magnet-surface={surface}>Download the spreadsheet</a>
                <a href="/guides/cleartill-bank-balance-reset-guide.pdf" data-lead-magnet-action="pdf" data-lead-magnet-surface={surface}>Read the guide</a>
                {hasGoogleSheet ? <a href={googleSheetUrl} target="_blank" rel="noopener noreferrer" data-lead-magnet-action="google" data-lead-magnet-surface={surface}>Make a Google Sheets copy</a> : <span className={styles.unavailable}>Google Sheets copy unavailable</span>}
                <a href="/start" data-lead-magnet-action="preview" data-lead-magnet-surface={surface}>Check my position free</a>
              </div>
            </div>
          ) : (
            <form className={styles.form} onSubmit={submit} noValidate={false}>
              <label htmlFor="lead-magnet-email">Email address</label>
              <div className={styles.formRow}>
                <input ref={emailRef} id="lead-magnet-email" name="email" type="email" autoComplete="email" required value={email} onFocus={startForm} onChange={(event) => { startForm(); setEmail(event.target.value); }} />
                <button className={styles.submit} type="submit" disabled={submitting}>{submitting ? "Sending…" : "Send the free guide"}</button>
              </div>
              <div className={styles.honeypot} aria-hidden="true"><label htmlFor="lead-magnet-company">Company</label><input id="lead-magnet-company" name="company" tabIndex={-1} autoComplete="off" value={company} onChange={(event) => setCompany(event.target.value)} /></div>
              <p className={styles.delivery}>We will email the guide and spreadsheet link requested. No card and no bank login.</p>
              <label className={styles.consent}><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /><span>Email me occasional ClearTill money-planning tips and product updates. I can unsubscribe at any time. This is optional.</span></label>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}
              <p className={styles.privacy}>ClearTill is a product from GMBF Ventures Ltd. See the <a href="/privacy">Privacy Policy</a>.</p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
