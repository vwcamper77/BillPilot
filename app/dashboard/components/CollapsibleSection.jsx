"use client";

import { useEffect, useRef, useState } from "react";

export default function CollapsibleSection({
  title,
  summaryValue,
  children,
  defaultCollapsed = true,
  storageKey,
  className = "",
}) {
  const storageId = storageKey ? `ct.ui.sections.${storageKey}` : null;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const bodyRef = useRef(null);

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
    }

    window.addEventListener("ct:open-section", handleOpenRequest);
    return () => window.removeEventListener("ct:open-section", handleOpenRequest);
  }, [storageKey]);

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
    <section className={`collapsible-section ${className}`.trim()}>
      <button
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
    </section>
  );
}
