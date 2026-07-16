"use client";

import { useEffect, useRef, useState } from "react";

export default function CollapsibleSection({
  title,
  summaryValue,
  children,
  defaultCollapsed = true,
  storageKey,
}) {
  const storageId = storageKey ? `ct.ui.sections.${storageKey}` : null;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [highlighted, setHighlighted] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const sectionRef = useRef(null);
  const headerRef = useRef(null);
  const bodyRef = useRef(null);
  const highlightTimerRef = useRef(null);

  useEffect(() => {
    if (!storageId || typeof window === "undefined") return;
    const stored = window.localStorage.getItem(storageId);
    if (stored === "open") setCollapsed(false);
    if (stored === "closed") setCollapsed(true);
  }, [storageId]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return undefined;

    function handleOpenRequest(event) {
      if (event.detail?.key !== storageKey) return;
      // Programmatic open (from a quick action or the hero) is transient —
      // it must not overwrite the user's own collapse preference.
      setCollapsed(false);

      if (event.detail?.focusHeading) {
        // Clear first so repeated activations announce again in live regions.
        setAnnouncement("");
        window.requestAnimationFrame(() => {
          setAnnouncement(event.detail.announcement || `${title} opened.`);
          window.requestAnimationFrame(() => {
            headerRef.current?.focus({ preventScroll: true });
            sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        });
      }

      if (event.detail?.highlight) {
        setHighlighted(true);
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = window.setTimeout(() => setHighlighted(false), 1800);
      }
    }

    window.addEventListener("ct:open-section", handleOpenRequest);
    return () => window.removeEventListener("ct:open-section", handleOpenRequest);
  }, [storageKey, title]);

  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), []);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      if (storageId && typeof window !== "undefined") {
        window.localStorage.setItem(storageId, next ? "closed" : "open");
      }
      return next;
    });
  }

  return (
    <section
      ref={sectionRef}
      className={`collapsible-section${highlighted ? " is-targeted" : ""}`}
      data-section-key={storageKey || undefined}
    >
      <button
        ref={headerRef}
        type="button"
        className="collapsible-section-header"
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <span className="collapsible-section-title">{title}</span>
        {summaryValue ? <span className="collapsible-section-summary">{summaryValue}</span> : null}
        <span className={`collapsible-section-chevron${collapsed ? "" : " is-open"}`} aria-hidden="true">
          ⌄
        </span>
      </button>
      <div
        ref={bodyRef}
        className={`collapsible-section-body${collapsed ? " is-collapsed" : ""}`}
        inert={collapsed}
      >
        <div className="collapsible-section-inner">{children}</div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </section>
  );
}
