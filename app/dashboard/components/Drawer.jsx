"use client";

import { useEffect, useId, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function Drawer({ open, title, description, onClose, onAfterClose, children, size = "standard", closeDisabled = false }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const returnFocusRef = useRef(null);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  const onAfterCloseRef = useRef(onAfterClose);
  const closeDisabledRef = useRef(closeDisabled);

  openRef.current = open;
  onCloseRef.current = onClose;
  onAfterCloseRef.current = onAfterClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!open) return undefined;

    returnFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      const preferred = panelRef.current?.querySelector("[data-drawer-initial-focus]");
      (preferred || closeRef.current)?.focus();
    });

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!closeDisabledRef.current) onCloseRef.current?.();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll(FOCUSABLE)]
        .filter((element) => !element.hasAttribute("inert") && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const returnTarget = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (openRef.current) return;
        if (returnTarget?.isConnected) returnTarget.focus?.();
        onAfterCloseRef.current?.();
      });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !closeDisabled) onClose();
    }}>
      <aside
        ref={panelRef}
        className={`drawer-panel drawer-panel-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="drawer-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button ref={closeRef} className="drawer-close" type="button" onClick={onClose} aria-label={`Close ${title}`} disabled={closeDisabled}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
