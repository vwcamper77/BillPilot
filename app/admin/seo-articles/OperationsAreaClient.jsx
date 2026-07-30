"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Logo from "@/components/Logo";
import { auth, authPersistenceReady } from "@/lib/firebase";
import styles from "./operationsArea.module.css";

const AREA_COPY = {
  calendar: ["Content calendar", "Plan, reschedule and follow 156 publication slots across the next 12 months."],
  generate: ["Content generation", "Prepare and queue controlled batches without making the browser wait."],
  review: ["Review queue", "Review up to 10 complete, immutable article versions as one batch."],
  publishing: ["Publishing pipeline", "Schedule or explicitly publish the exact approved version."],
  distribution: ["Buffer distribution", "Prepare social packs and send only approved, live links to explicitly enabled channels."],
  performance: ["Performance", "Use stored operational aggregates without scanning raw analytics."],
  settings: ["SEO settings", "Control planning, approval and automation defaults in Europe/London time."],
};

const STATUS_LABELS = {
  planned: "Planned",
  research_ready: "Research ready",
  generating: "Generating",
  generation_failed: "Generation failed",
  review_ready: "Review ready",
  changes_requested: "Changes requested",
  approved: "Approved",
  scheduled: "Scheduled",
  publication_ready: "Publication ready",
  publishing: "Publishing",
  published: "Published",
  distribution_ready: "Distribution ready",
  buffer_idea_created: "Buffer Idea",
  buffer_scheduled: "Buffer scheduled",
  cancelled: "Cancelled",
  partially_cancelled: "Partially cancelled",
  promoted: "Promoted",
  measurement_pending: "Measurement pending",
  refresh_due: "Refresh due",
  archived: "Archived",
  rejected: "Rejected",
};

function label(value) {
  return STATUS_LABELS[value] || String(value || "Not recorded")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateTime(value) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function dateOnly(value) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function score(value) {
  return Number.isFinite(Number(value)) ? `${Number(value)}/100` : "Not available";
}

function londonLocalToIso(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let instant = desired;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const rendered = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    instant += desired - rendered;
  }
  return new Date(instant).toISOString();
}

function useAdminArea(area) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState(null);
  const [state, setState] = useState({ loading: true, forbidden: false, error: "", message: "" });

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }
    let mounted = true;
    let unsubscribe = () => undefined;
    authPersistenceReady.finally(() => {
      if (!mounted) return;
      unsubscribe = onAuthStateChanged(auth, (current) => {
        setUser(current);
        setAuthReady(true);
      });
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const request = useCallback(async (path, options = {}) => {
    if (!user) throw new Error("Please sign in again.");
    const token = await user.getIdToken();
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if ([401, 403].includes(response.status)) {
      setState((current) => ({ ...current, loading: false, forbidden: true }));
      throw new Error("Access denied.");
    }
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "The operation failed.");
    return payload;
  }, [user]);

  const reload = useCallback(async () => {
    if (!user) return;
    setState((current) => ({ ...current, loading: true, error: "", message: "" }));
    try {
      const payload = await request(`/api/admin/seo-articles/operations/${area}`);
      setData(payload);
      setState({ loading: false, forbidden: false, error: "", message: "" });
    } catch (error) {
      if (error.message !== "Access denied.") {
        setState((current) => ({ ...current, loading: false, error: error.message }));
      }
    }
  }, [area, request, user]);

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setState({ loading: false, forbidden: true, error: "", message: "" });
      return;
    }
    reload();
  }, [authReady, reload, user]);

  const mutate = useCallback(async (path, body, successMessage) => {
    setState((current) => ({ ...current, loading: true, error: "", message: "" }));
    try {
      const payload = await request(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await reload();
      setState((current) => ({
        ...current,
        loading: false,
        message: successMessage || "Operation completed.",
      }));
      return payload;
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
      return null;
    }
  }, [reload, request]);

  return { authReady, data, mutate, reload, state, user };
}

export default function OperationsAreaClient({ area }) {
  const admin = useAdminArea(area);
  const copy = AREA_COPY[area] || [label(area), "ClearTill SEO operations"];
  if (!admin.authReady || (admin.state.loading && !admin.data)) {
    return <main className={styles.state}><p>Loading {copy[0].toLowerCase()}…</p></main>;
  }
  if (admin.state.forbidden) {
    return (
      <main className={styles.state}>
        <Logo height={40} />
        <h1>Access denied</h1>
        <p>This SEO operations area is restricted to authorised ClearTill administrators.</p>
        <Link href="/dashboard">Return to dashboard</Link>
      </main>
    );
  }
  return (
    <main className={styles.shell}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>ClearTill SEO operating system</p>
          <h1>{copy[0]}</h1>
          <p>{copy[1]}</p>
        </div>
        <div>
          <span className={styles.offPill}>Recurring generation off</span>
          <button type="button" onClick={admin.reload} disabled={admin.state.loading}>
            {admin.state.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>
      {admin.state.error ? <p className={styles.error} role="alert">{admin.state.error}</p> : null}
      {admin.state.message ? <p className={styles.success} role="status">{admin.state.message}</p> : null}
      {area === "calendar" ? <CalendarArea admin={admin} /> : null}
      {area === "generate" ? <GenerationArea admin={admin} /> : null}
      {area === "review" ? <ReviewArea admin={admin} /> : null}
      {area === "publishing" ? <PublishingArea admin={admin} /> : null}
      {area === "distribution" ? <DistributionArea admin={admin} /> : null}
      {area === "performance" ? <PerformanceArea admin={admin} /> : null}
      {area === "settings" ? <SettingsArea admin={admin} /> : null}
    </main>
  );
}

function CalendarArea({ admin }) {
  const [view, setView] = useState("month");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [adaptiveOnly, setAdaptiveOnly] = useState(false);
  const [month, setMonth] = useState("2026-08");
  const [dragged, setDragged] = useState("");
  const calendar = admin.data?.calendar || [];
  const categories = [...new Set(calendar.map((item) => item.category))];
  const filtered = calendar.filter((item) => (
    (statusFilter === "all" || item.status === statusFilter)
    && (categoryFilter === "all" || item.category === categoryFilter)
    && (!adaptiveOnly || item.evergreenOrAdaptive === "adaptive")
    && (view !== "month" || item.proposedPublicationDate.startsWith(month))
  ));
  const months = [...new Set(calendar.map((item) => item.proposedPublicationDate.slice(0, 7)))];
  const initialise = () => admin.mutate(
    "/api/admin/seo-articles/operations/calendar",
    { action: "initialise_plan" },
    "The rolling 12-month plan is ready.",
  );
  const reschedule = (item, value) => admin.mutate(
    "/api/admin/seo-articles/operations/calendar",
    {
      action: "reschedule",
      calendarItemId: item.calendarItemId,
      proposedPublicationDate: `${value}:00`,
    },
    "Publication slot rescheduled.",
  );
  const swap = (target) => {
    if (!dragged || dragged === target.calendarItemId) return;
    admin.mutate(
      "/api/admin/seo-articles/operations/calendar",
      {
        action: "swap_slots",
        firstCalendarItemId: dragged,
        secondCalendarItemId: target.calendarItemId,
        idempotencyKey: crypto.randomUUID(),
      },
      "Publication slots swapped.",
    );
    setDragged("");
  };
  const publishFromCalendar = (item) => {
    if (!window.confirm(`Publish the exact ${item.versionId} version of “${item.provisionalTitle}” now?`)) {
      return;
    }
    admin.mutate(
      "/api/admin/seo-articles/publication",
      {
        action: "publish_now",
        articleId: item.articleId,
        versionId: item.versionId,
        calendarItemId: item.calendarItemId,
        idempotencyKey: crypto.randomUUID(),
        confirm: true,
      },
      "The exact approved article version was published.",
    );
  };

  if (!calendar.length) {
    return (
      <section className={styles.empty}>
        <span>156 planned publication slots</span>
        <h2>No rolling content plan has been created.</h2>
        <p>Initialisation creates 52 weeks at three slots per week. It does not enable generation or publication.</p>
        <button type="button" onClick={initialise}>Create 12-month plan</button>
      </section>
    );
  }

  return (
    <>
      <section className={styles.stats}>
        {Object.entries(admin.data.capacity || {}).map(([key, value]) => (
          <Metric label={label(key)} value={value} key={key} />
        ))}
      </section>
      <section className={styles.controls}>
        <div className={styles.segmented}>
          {["month", "quarter", "year", "list", "pipeline"].map((value) => (
            <button type="button" aria-pressed={view === value} onClick={() => setView(value)} key={value}>{label(value)}</button>
          ))}
        </div>
        {view === "month" ? (
          <select value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Calendar month">
            {months.map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        ) : null}
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Status filter">
          <option value="all">All statuses</option>
          {[...new Set(calendar.map((item) => item.status))].map((value) => <option value={value} key={value}>{label(value)}</option>)}
        </select>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Category filter">
          <option value="all">All categories</option>
          {categories.map((value) => <option value={value} key={value}>{label(value)}</option>)}
        </select>
        <label className={styles.check}><input type="checkbox" checked={adaptiveOnly} onChange={(event) => setAdaptiveOnly(event.target.checked)} /> Adaptive only</label>
      </section>
      {view === "pipeline" ? (
        <div className={styles.kanban}>
          {(admin.data.pipeline || []).map((column) => (
            <section key={column.status}>
              <header><strong>{label(column.status)}</strong><span>{column.items.length}</span></header>
              {column.items.map((item) => (
                <article key={item.calendarItemId}>
                  <strong>{item.title}</strong>
                  <span>{dateOnly(item.publicationDate)}</span>
                  <small>{item.primaryKeyword}</small>
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : view === "year" || view === "quarter" ? (
        <div className={styles.monthGrid}>
          {months.slice(0, view === "quarter" ? 3 : 12).map((value) => {
            const items = filtered.filter((item) => item.proposedPublicationDate.startsWith(value));
            return (
              <button type="button" onClick={() => { setMonth(value); setView("month"); }} key={value}>
                <span>{value}</span><strong>{items.length} slots</strong>
                <small>{items.filter((item) => item.articleId).length} generated · {items.filter((item) => item.evergreenOrAdaptive === "adaptive").length} adaptive</small>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={view === "list" ? styles.calendarList : styles.calendarGrid}>
          {filtered.map((item) => (
            <article
              draggable
              onDragStart={() => setDragged(item.calendarItemId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => swap(item)}
              key={item.calendarItemId}
              className={item.evergreenOrAdaptive === "adaptive" ? styles.adaptiveCard : ""}
            >
              <header><span>{dateOnly(item.proposedPublicationDate)}</span><Status value={item.status} /></header>
              <h3>{item.provisionalTitle}</h3>
              <p>{item.primaryKeyword}</p>
              <div><span>{label(item.category)}</span><span>{item.articleType}</span></div>
              <small>{item.rationale}</small>
              <footer>
                <input
                  type="datetime-local"
                  defaultValue={item.proposedPublicationDate.slice(0, 16)}
                  aria-label={`Reschedule ${item.provisionalTitle}`}
                  onChange={(event) => reschedule(item, event.target.value)}
                />
                {item.articleId
                  ? <Link href={`/admin/seo-articles/${item.articleId}/preview`}>Open article</Link>
                  : <Link href={`/admin/seo-articles/generate?slot=${item.calendarItemId}`}>Generate this slot</Link>}
                {item.articleId && ["approved", "scheduled", "publication_ready"].includes(item.status)
                  ? <button type="button" onClick={() => publishFromCalendar(item)}>Publish now</button>
                  : null}
              </footer>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function GenerationArea({ admin }) {
  const preview = admin.data?.preview;
  const [selected, setSelected] = useState([]);
  const [ordered, setOrdered] = useState([]);
  const [cancelConfirmation, setCancelConfirmation] = useState(null);
  const [cancellationResult, setCancellationResult] = useState(null);
  useEffect(() => {
    const items = preview?.selected || [];
    setOrdered(items);
    setSelected(items.map((item) => item.calendarItemId));
  }, [preview]);
  const toggle = (id) => setSelected((current) => (
    current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
  ));
  const move = (index, direction) => {
    const next = [...ordered];
    const destination = index + direction;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    setOrdered(next);
  };
  const queue = (ids) => admin.mutate(
    "/api/admin/seo-articles/operations/generate",
    {
      action: "create_batch",
      batchSize: ids.length,
      calendarItemIds: ids,
      idempotencyKey: crypto.randomUUID(),
    },
    "Generation batch queued. The browser is not waiting for completion.",
  );
  const processNext = () => admin.mutate(
    "/api/admin/seo-articles/jobs/process",
    { action: "process_next" },
    "One background generation job was processed.",
  );
  const queuedJobsFor = (batch) => {
    const batchId = batch.batchId || batch.id;
    return (admin.data?.jobs || []).filter((job) => (
      job.batchId === batchId && job.status === "queued"
    )).length;
  };
  const requestCancellation = (batch) => {
    const queuedJobs = queuedJobsFor(batch);
    setCancellationResult(null);
    setCancelConfirmation({
      batch,
      batchId: batch.batchId || batch.id,
      queuedJobs,
      partial: ["running", "in_progress"].includes(batch.status),
    });
  };
  const confirmCancellation = async () => {
    if (!cancelConfirmation) return;
    const result = await admin.mutate(
      `/api/admin/seo-articles/batches/${encodeURIComponent(cancelConfirmation.batchId)}/cancel`,
      {
        reason: "Cancelled before generation due to invalid topic composition",
      },
      "Batch cancellation recorded.",
    );
    if (result) {
      setCancellationResult(result);
      setCancelConfirmation(null);
    }
  };
  const editBrief = (item, replace = false) => {
    const title = window.prompt(
      replace ? "Replacement provisional title" : "Edit provisional title",
      item.provisionalTitle,
    );
    if (title === null) return;
    const keyword = window.prompt("Primary keyword", replace ? "" : item.primaryKeyword);
    if (keyword === null) return;
    admin.mutate(
      "/api/admin/seo-articles/operations/generate",
      {
        action: "update_brief",
        calendarItemId: item.calendarItemId,
        provisionalTitle: title,
        primaryKeyword: keyword,
        secondaryKeywords: item.secondaryKeywords || [],
        rationale: item.rationale,
        replace,
      },
      replace ? "Topic replaced in the planning queue." : "Article brief updated.",
    );
  };
  return (
    <>
      <section className={styles.notice}>
        <div><strong>Generation is {admin.data?.settings.generationEnabled ? "enabled" : "disabled"}</strong><p>Default batch size {admin.data?.settings.batchSize}. Maximum 10.</p></div>
        <span>No recurring trigger exists</span>
      </section>
      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <div><p className={styles.eyebrow}>Pre-generation summary</p><h2>Next eligible batch</h2></div>
          <div className={styles.buttonRow}>
            <button type="button" disabled={!admin.data?.settings.generationEnabled || !selected.length} onClick={() => queue(selected)}>Generate selected</button>
            <button type="button" disabled={!admin.data?.settings.generationEnabled || !ordered.length} onClick={() => queue(ordered.map((item) => item.calendarItemId))}>Generate all {ordered.length}</button>
            <button type="button" disabled={!admin.data?.settings.generationEnabled} onClick={processNext}>Process next queued job</button>
          </div>
        </header>
        <div className={styles.estimate}>
          <Metric label="Estimated input + output range" value={`${(preview?.estimatedOpenAi.lowerTokens || 0).toLocaleString()}–${(preview?.estimatedOpenAi.upperTokens || 0).toLocaleString()} tokens`} />
          <Metric label="Monetary estimate" value="Awaiting model pricing" />
          <Metric label="Hero assets" value={`${ordered.length} master + mobile pairs`} />
        </div>
        <div className={styles.batchList}>
          {ordered.map((item, index) => (
            <article key={item.calendarItemId}>
              <input type="checkbox" checked={selected.includes(item.calendarItemId)} onChange={() => toggle(item.calendarItemId)} aria-label={`Select ${item.provisionalTitle}`} />
              <span>{index + 1}</span>
              <div><strong>{item.provisionalTitle}</strong><p>{item.primaryKeyword} · {label(item.category)}</p><small>Duplicate risk: {item.duplicateRisk?.passed ? "passed" : "blocked"} · {dateOnly(item.proposedPublicationDate)}</small></div>
              <div className={styles.compactActions}>
                <button type="button" onClick={() => move(index, -1)} aria-label="Move topic earlier">↑</button>
                <button type="button" onClick={() => move(index, 1)} aria-label="Move topic later">↓</button>
                <button type="button" onClick={() => toggle(item.calendarItemId)}>Skip topic</button>
                <button type="button" onClick={() => editBrief(item)}>Edit brief</button>
                <button type="button" onClick={() => editBrief(item, true)}>Replace topic</button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>Background progress</p><h2>Recent batches</h2></div></div>
        {cancellationResult ? (
          <div className={styles.cancelSuccess} role="status">
            <p className={styles.eyebrow}>Generation stopped safely</p>
            <h3>{cancellationResult.messageTitle}</h3>
            <p>{cancellationResult.message}</p>
            <div className={styles.stats}>
              <Metric label="Completed" value={cancellationResult.completedJobs} />
              <Metric label="Failed" value={cancellationResult.failedJobs} />
              <Metric label="Cancelled" value={cancellationResult.cancelledJobs} />
              <Metric label="Tokens" value={Number(cancellationResult.tokenUsage || 0).toLocaleString()} />
            </div>
          </div>
        ) : null}
        {cancelConfirmation ? (
          <div className={styles.cancelDialog} role="alertdialog" aria-modal="true" aria-labelledby="cancel-batch-title">
            <p className={styles.eyebrow}>Emergency stop</p>
            <h3 id="cancel-batch-title">Cancel batch {cancelConfirmation.batchId.slice(0, 8)}?</h3>
            <p>{cancelConfirmation.queuedJobs} queued jobs will be cancelled.</p>
            <p>No generated articles will be deleted.</p>
            {cancelConfirmation.partial
              ? <p>The in-flight job will finish safely. No remaining queued job will start.</p>
              : null}
            <div className={styles.buttonRow}>
              <button type="button" className={styles.dangerButton} disabled={admin.state.loading} onClick={confirmCancellation}>
                {cancelConfirmation.partial ? "Stop after the current job" : "Cancel batch"}
              </button>
              <button type="button" disabled={admin.state.loading} onClick={() => setCancelConfirmation(null)}>Keep batch</button>
            </div>
          </div>
        ) : null}
        {(admin.data?.batches || []).length ? (
          <div className={styles.tableWrap}><table><thead><tr><th>Batch</th><th>Status</th><th>Progress</th><th>Failed</th><th>Cancelled</th><th>Tokens</th><th>Action</th></tr></thead><tbody>
            {admin.data.batches.map((batch) => {
              const queuedJobs = queuedJobsFor(batch);
              const cancellable = ["queued", "running", "in_progress"].includes(batch.status)
                && queuedJobs > 0;
              const batchId = batch.batchId || batch.id;
              return (
                <tr key={batch.id}>
                  <td><code className={styles.batchId}>{batchId}</code></td>
                  <td>{label(batch.status)}</td>
                  <td>{batch.completed || 0}/{batch.total || 0}</td>
                  <td>{batch.failed || 0}</td>
                  <td>{batch.cancelled || 0}</td>
                  <td>{Number(batch.tokenUsage?.totalTokens || batch.tokenUsage?.total || 0).toLocaleString()}</td>
                  <td>{cancellable
                    ? <button type="button" className={styles.dangerButton} onClick={() => requestCancellation(batch)}>Cancel batch</button>
                    : "No queued jobs"}</td>
                </tr>
              );
            })}
          </tbody></table></div>
        ) : <p>No batches have been queued.</p>}
        {(admin.data?.jobs || []).length ? (
          <>
            <h3>Article job stages</h3>
            <div className={styles.jobStages}>
              {admin.data.jobs.slice(0, 30).map((job) => (
                <article key={job.id}>
                  <Status value={job.status} />
                  <strong>{job.brief?.provisionalTitle || job.id}</strong>
                  <span>Attempt {job.attempts || 0}</span>
                  <small>{job.articleId ? `Article ${job.articleId}` : "No article persisted yet"}</small>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}

function ReviewArea({ admin }) {
  const queue = admin.data?.queue || [];
  const [selected, setSelected] = useState([]);
  const [scheduleConfirmation, setScheduleConfirmation] = useState(null);
  const eligibleIds = queue.filter((item) => item.eligibility.eligible).map((item) => item.articleId);
  const toggle = (id) => setSelected((current) => (
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  ));
  const act = (reviewAction, ids = selected) => admin.mutate(
    "/api/admin/seo-articles/operations/review",
    {
      action: "bulk_review",
      reviewAction,
      articleIds: ids,
      idempotencyKey: crypto.randomUUID(),
    },
    `${label(reviewAction)} recorded for ${ids.length} article${ids.length === 1 ? "" : "s"}.`,
  );
  const selectionKey = (ids) => [...ids].sort().join("|");
  const previewSchedule = async (ids = selected) => {
    const payload = await admin.mutate(
      "/api/admin/seo-articles/operations/review",
      { action: "preview_schedule", articleIds: ids },
      "Exact publication dates previewed. Confirm to schedule.",
    );
    if (payload) {
      setSelected(ids);
      setScheduleConfirmation({
        key: selectionKey(ids),
        assignments: payload.assignments || [],
      });
    }
  };
  const approveAndSchedule = (ids = selected) => {
    if (scheduleConfirmation?.key !== selectionKey(ids)) return;
    const dates = scheduleConfirmation.assignments.map((item) => dateTime(item.scheduledFor)).join("\n");
    if (!window.confirm(`Approve the exact versions and assign these dates?\n\n${dates}`)) return;
    setScheduleConfirmation(null);
    act("approve_and_schedule", ids);
  };
  const movePublicationDate = (item) => {
    const selectedDate = window.prompt(
      "New Europe/London publication date and time (YYYY-MM-DDTHH:MM)",
      String(item.plannedDate || "").slice(0, 16),
    );
    if (!selectedDate) return;
    admin.mutate(
      "/api/admin/seo-articles/operations/calendar",
      {
        action: "reschedule",
        calendarItemId: item.calendarItemId,
        proposedPublicationDate: `${selectedDate}:00`,
      },
      "Publication date moved.",
    );
  };
  return (
    <>
      <section className={styles.notice}>
        <div><strong>{queue.length} of 10 review positions filled</strong><p>Bulk approval never overrides quality, editorial, source, hero or cannibalisation blocks.</p></div>
        <div className={styles.buttonRow}>
          <button type="button" disabled={!selected.length} onClick={() => act("approve")}>Approve selected</button>
          <button type="button" disabled={!eligibleIds.length} onClick={() => act("approve", eligibleIds)}>Approve all eligible</button>
          <button type="button" disabled={!selected.length} onClick={() => previewSchedule()}>Preview selected dates</button>
          <button type="button" disabled={!selected.length || scheduleConfirmation?.key !== selectionKey(selected)} onClick={() => approveAndSchedule()}>Approve and schedule selected</button>
          <button type="button" disabled={!selected.length} onClick={() => act("request_changes")}>Request changes</button>
          <button type="button" disabled={!selected.length} className={styles.danger} onClick={() => act("reject")}>Reject selected</button>
        </div>
      </section>
      <section className={styles.schedulePreview}>
        <p className={styles.eyebrow}>Next available publication dates</p>
        {(scheduleConfirmation?.assignments || []).length
          ? scheduleConfirmation.assignments.map((item) => <span key={item.calendarItemId}>{dateTime(item.scheduledFor)}</span>)
          : <p>Select articles and preview their exact dates before approval.</p>}
      </section>
      <div className={styles.reviewGrid}>
        {queue.map((item) => (
          <article key={item.articleId} className={!item.eligibility.eligible ? styles.blocked : ""}>
            <header>
              <input type="checkbox" checked={selected.includes(item.articleId)} onChange={() => toggle(item.articleId)} aria-label={`Select ${item.title}`} />
              <Status value={item.currentStatus} />
              <span>{item.versionId}</span>
            </header>
            {item.hero.thumbnailUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={item.hero.thumbnailUrl} alt={item.title} />
              : <div className={styles.imagePlaceholder}>Approved hero unavailable</div>}
            <h2>{item.title}</h2>
            <p>{item.primaryKeyword} · {label(item.category)}</p>
            <div className={styles.scoreGrid}>
              <Metric label="Article" value={score(item.qualityScore)} />
              <Metric label="Editorial" value={score(item.editorialScore)} />
              <Metric label="Hero" value={score(item.heroScore)} />
              <Metric label="Sources" value={item.sourceCount} />
              <Metric label="Words" value={item.wordCount} />
              <Metric label="Reading" value={`${item.readingMinutes || "—"} min`} />
            </div>
            {!item.eligibility.eligible ? <ul>{item.eligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
            <footer>
              <Link href={`/admin/seo-articles/${item.articleId}/preview`}>Open full preview</Link>
              <button type="button" disabled={!item.eligibility.eligible} onClick={() => act("approve", [item.articleId])}>Approve</button>
              <button type="button" disabled={!item.eligibility.eligible} onClick={() => previewSchedule([item.articleId])}>Preview schedule</button>
              <button type="button" onClick={() => act("request_changes", [item.articleId])}>Request changes</button>
              <button type="button" onClick={() => act("replace_article", [item.articleId])}>Replace article</button>
              <button type="button" disabled={!item.calendarItemId} onClick={() => movePublicationDate(item)}>Move publication date</button>
              <button type="button" className={styles.danger} onClick={() => act("reject", [item.articleId])}>Reject</button>
            </footer>
          </article>
        ))}
      </div>
      {!queue.length ? <section className={styles.empty}><h2>No finished articles are awaiting review.</h2><p>Generation remains disabled until an administrator explicitly enables it.</p></section> : null}
    </>
  );
}

function PublishingArea({ admin }) {
  const [scheduleDates, setScheduleDates] = useState({});
  const bufferAction = (item, action) => admin.mutate(
    "/api/admin/seo-articles/buffer",
    { action, articleId: item.articleId, versionId: item.versionId },
    action === "generate_pack"
      ? "A local social pack was generated. Nothing was sent to Buffer."
      : "The article social pack was approved.",
  );
  const publishAction = (item, action) => {
    const destructive = ["publish_now", "republish", "unpublish"].includes(action);
    if (destructive && !window.confirm(`${label(action)} the exact ${item.versionId} version?`)) return;
    admin.mutate(
      "/api/admin/seo-articles/publication",
      {
        articleId: item.articleId,
        calendarItemId: item.calendarItemId,
        versionId: item.versionId,
        action,
        scheduledFor: action === "schedule"
          ? londonLocalToIso(scheduleDates[item.articleId])
          : "",
        idempotencyKey: crypto.randomUUID(),
        confirm: destructive,
      },
      `${label(action)} completed. Article published: ${["publish_now", "republish"].includes(action) ? "yes" : "no"}.`,
    );
  };
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}><div><p className={styles.eyebrow}>Explicit publication boundary</p><h2>Approved exports</h2></div><span className={styles.offPill}>Automatic publication off</span></header>
      <div className={styles.pipelineList}>
        {(admin.data?.items || []).map((item) => (
          <article key={item.articleId}>
            <div><Status value={item.published ? "published" : item.status} /><span>{item.versionId}</span></div>
            <h3>{item.title}</h3>
            <p>/blog/{item.slug}</p>
            <dl>
              <dt>Hero</dt><dd>{item.heroPassed ? "QA passed" : "Blocked"}</dd>
              <dt>Sources</dt><dd>{item.sourceCount}</dd>
              <dt>Approved</dt><dd>{dateTime(item.approvedAt)}</dd>
              <dt>Scheduled</dt><dd>{dateTime(item.scheduledFor)}</dd>
              <dt>Published</dt><dd>{item.published ? dateTime(item.publishedAt) : "No"}</dd>
            </dl>
            <div className={styles.buttonRow}>
              <input type="datetime-local" value={scheduleDates[item.articleId] || ""} onChange={(event) => setScheduleDates((current) => ({ ...current, [item.articleId]: event.target.value }))} aria-label={`Schedule ${item.title}`} />
              <button type="button" disabled={item.published || !scheduleDates[item.articleId]} onClick={() => publishAction(item, "schedule")}>Schedule publication</button>
              <button type="button" disabled={!item.scheduledFor || item.published} onClick={() => publishAction(item, "pause")}>Pause schedule</button>
              <button type="button" disabled={item.published || !item.heroPassed || !item.sourceCount} onClick={() => publishAction(item, "publish_now")}>Publish now</button>
              <button type="button" disabled={!item.published} className={styles.danger} onClick={() => publishAction(item, "unpublish")}>Unpublish</button>
              <button type="button" disabled={item.published || !item.publishedAt} onClick={() => publishAction(item, "republish")}>Republish</button>
              <button type="button" onClick={() => bufferAction(item, "generate_pack")}>Generate social pack</button>
              <button type="button" onClick={() => bufferAction(item, "approve_pack")}>Approve social pack</button>
              {item.liveUrl ? <Link href={item.liveUrl}>Open live URL</Link> : null}
            </div>
          </article>
        ))}
      </div>
      {!(admin.data?.items || []).length ? <p>No publication-ready exports are available.</p> : null}
    </section>
  );
}

function DistributionArea({ admin }) {
  const connection = admin.data?.connection || {};
  const [dueDates, setDueDates] = useState({});
  const call = (body, message) => admin.mutate(
    "/api/admin/seo-articles/buffer",
    { ...body, idempotencyKey: body.idempotencyKey || crypto.randomUUID() },
    message,
  );
  return (
    <>
      <section className={styles.notice}>
        <div>
          <strong>Buffer {connection.configured ? "API key configured" : "not configured"}</strong>
          <p>{connection.organisationId || "No organisation selected"} · {connection.channels?.length || 0} explicitly enabled channels</p>
        </div>
        <div>
          <Status value={connection.syncEnabled ? "buffer_scheduled" : "archived"} />
          <button type="button" onClick={() => call({ action: "discover" }, "Buffer organisations and channels refreshed.")}>Discover account</button>
          <button type="button" disabled={!connection.syncEnabled} onClick={() => call({ action: "sync" }, "Buffer post statuses synchronised.")}>Sync statuses</button>
        </div>
      </section>
      <section className={styles.stats}>
        <Metric label="Queue size" value={admin.data?.queue?.scheduledCount || 0} />
        <Metric label="Queue remaining" value={admin.data?.queue?.remaining ?? "Not recorded"} />
        <Metric label="Rate limited" value={connection.rateLimit?.limited ? "Yes" : "No"} />
        <Metric label="Last checked" value={dateTime(connection.lastCheckedAt)} />
        <Metric label="Last successful sync" value={dateTime(connection.lastSuccessfulSyncAt)} />
      </section>
      <section className={styles.panel}>
        <header className={styles.panelHeader}><div><p className={styles.eyebrow}>Approved social content</p><h2>Distribution queue</h2></div></header>
        <div className={styles.socialGrid}>
          {(admin.data?.socialItems || []).map((item) => (
            <article key={item.id}>
              <header><Status value={item.status} /><span>{label(item.platform)}</span></header>
              <p>{item.copy}</p>
              <small>{item.articleUrl || "Final article URL pending — scheduling blocked"}</small>
              <dl><dt>Buffer ID</dt><dd>{item.bufferId || "None"}</dd><dt>Due</dt><dd>{dateTime(item.scheduledAt)}</dd></dl>
              <div className={styles.buttonRow}>
                <input
                  type="datetime-local"
                  value={dueDates[item.id] || ""}
                  onChange={(event) => setDueDates((current) => ({ ...current, [item.id]: event.target.value }))}
                  aria-label={`Buffer date for ${item.platform}`}
                />
                <button type="button" disabled={item.status !== "draft"} onClick={() => call({ action: "approve_pack", articleId: item.articleId, versionId: item.versionId }, "Social pack approved.")}>Approve social pack</button>
                <button type="button" disabled={!connection.syncEnabled || item.status !== "approved"} onClick={() => call({ action: "create_idea", socialItemId: item.id }, "Buffer Idea created.")}>Send to Ideas</button>
                <button type="button" disabled={!connection.syncEnabled || !item.articleUrl || !dueDates[item.id] || !["approved", "failed", "buffer_idea_created"].includes(item.status)} onClick={() => call({ action: "schedule", socialItemId: item.id, dueAt: londonLocalToIso(dueDates[item.id]) }, item.status === "failed" ? "Failed Buffer post retried." : "Post scheduled in Buffer.")}>{item.status === "failed" ? "Retry failed post" : "Schedule in Buffer"}</button>
                <button type="button" disabled={!connection.syncEnabled || !dueDates[item.id] || item.status !== "buffer_scheduled"} onClick={() => call({ action: "reschedule", socialItemId: item.id, dueAt: londonLocalToIso(dueDates[item.id]) }, "Buffer post rescheduled.")}>Reschedule</button>
                <button type="button" disabled={!connection.syncEnabled || item.status !== "buffer_scheduled"} onClick={() => call({ action: "cancel", socialItemId: item.id }, "Scheduled Buffer post cancelled.")}>Cancel</button>
                {item.bufferId ? <a href="https://publish.buffer.com" rel="noreferrer">Open Buffer</a> : null}
              </div>
            </article>
          ))}
        </div>
        {!(admin.data?.socialItems || []).length ? <p>No social packs have been generated. Create one from an approved article after selecting channels.</p> : null}
      </section>
    </>
  );
}

function PerformanceArea({ admin }) {
  const metrics = admin.data?.metrics || {};
  const metricLabels = {
    plannedArticles: "Planned articles",
    generatedDrafts: "Generated drafts",
    generationFailures: "Generation failures",
    awaitingReview: "Awaiting review",
    changesRequested: "Changes requested",
    approved: "Approved",
    scheduled: "Scheduled",
    published: "Published",
    bufferIdeas: "Buffer Ideas",
    bufferScheduled: "Buffer scheduled",
    bufferFailed: "Buffer failed",
    averageArticleQuality: "Average article score",
    averageHeroScore: "Average hero score",
    estimatedOpenAiCostToday: "Estimated OpenAI cost today",
    estimatedOpenAiCostMonth: "Estimated OpenAI cost this month",
    openAiTotalTokens: "OpenAI tokens recorded",
    publicationCapacity: "Publication capacity",
  };
  return (
    <>
      <section className={styles.stats}>
        {Object.entries(metricLabels).map(([key, value]) => <Metric label={value} value={metrics[key] ?? "Not recorded"} key={key} />)}
      </section>
      <section className={styles.integrationGrid}>
        {Object.values(admin.data?.external || {}).map((item) => (
          <article key={item.label}><span>○</span><div><strong>{item.label}</strong><p>Connect explicitly when credentials and access are approved.</p></div></article>
        ))}
      </section>
    </>
  );
}

function SettingsArea({ admin }) {
  const [form, setForm] = useState(admin.data?.settings || {});
  const [bufferOrganisationId, setBufferOrganisationId] = useState("");
  const [bufferChannelIds, setBufferChannelIds] = useState([]);
  useEffect(() => setForm(admin.data?.settings || {}), [admin.data]);
  useEffect(() => {
    const configuration = admin.data?.buffer?.configuration || {};
    setBufferOrganisationId(configuration.organisationId || "");
    setBufferChannelIds((configuration.channels || []).filter((item) => item.enabled).map((item) => item.id));
  }, [admin.data]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = () => admin.mutate(
    "/api/admin/seo-articles/operations/settings",
    { action: "save", settings: form },
    "SEO settings saved.",
  );
  const organisations = admin.data?.buffer?.configuration?.discoveredOrganisations || [];
  const availableChannels = organisations.find((item) => item.id === bufferOrganisationId)?.channels || [];
  const toggleBufferChannel = (id) => setBufferChannelIds((current) => (
    current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
  ));
  const toggleWeekday = (day) => update(
    "publicationWeekdays",
    (form.publicationWeekdays || [1, 3, 5]).includes(day)
      ? (form.publicationWeekdays || []).filter((value) => value !== day)
      : [...(form.publicationWeekdays || []), day].sort((left, right) => left - right),
  );
  const updateCategoryTarget = (category, value) => update("categoryTargets", {
    ...(form.categoryTargets || {}),
    [category]: Number(value),
  });
  const saveBuffer = () => admin.mutate(
    "/api/admin/seo-articles/operations/distribution",
    {
      action: "save_configuration",
      organisationId: bufferOrganisationId,
      channels: availableChannels,
      enabledChannelIds: bufferChannelIds,
      explicitlyApprovedPersonalLinkedInIds: availableChannels
        .filter((channel) => (
          bufferChannelIds.includes(channel.id)
          && String(channel.service).toLowerCase() === "linkedin"
        ))
        .map((channel) => channel.id),
      enabled: form.bufferSyncEnabled === true,
      timezone: "Europe/London",
      postingPolicy: "manual_approval",
    },
    "Buffer organisation and exact channel selection saved.",
  );
  return (
    <>
      <section className={styles.notice}>
        <div><strong>Safe defaults</strong><p>Generation, automatic publication and Buffer sync remain disabled until explicitly enabled.</p></div>
        <button type="button" onClick={save}>Save settings</button>
      </section>
      <section className={styles.settingsGrid}>
        <fieldset>
          <legend>Planning</legend>
          <Field label="Batch size (1–10)"><input type="number" min="1" max="10" value={form.batchSize || 10} onChange={(event) => update("batchSize", Number(event.target.value))} /></Field>
          <Field label="Articles per week"><input type="number" value={form.articlesPerWeek || 3} disabled /></Field>
          <Field label="Publication time"><input type="time" value={form.publicationTime || "09:30"} onChange={(event) => update("publicationTime", event.target.value)} /></Field>
          <Field label="Timezone"><input value={form.timezone || "Europe/London"} disabled /></Field>
          <Field label="Annual-plan start"><input type="date" value={form.annualPlanStartDate || "2026-08-03"} onChange={(event) => update("annualPlanStartDate", event.target.value)} /></Field>
          <Field label="Adaptive slots"><input value={`${form.adaptiveSlotPercentage || 19.87}%`} disabled /></Field>
          <div className={styles.channelList}>
            <span>Publication weekdays</span>
            {[["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5]].map(([name, day]) => (
              <label className={styles.toggle} key={day}>
                <input type="checkbox" checked={(form.publicationWeekdays || [1, 3, 5]).includes(day)} onChange={() => toggleWeekday(day)} />
                {name}
              </label>
            ))}
          </div>
          {Object.entries(form.categoryTargets || {}).map(([category, target]) => (
            <Field label={`${label(category)} annual slots`} key={category}>
              <input type="number" min="0" max="156" value={target} onChange={(event) => updateCategoryTarget(category, event.target.value)} />
            </Field>
          ))}
        </fieldset>
        <fieldset>
          <legend>Approval requirements</legend>
          <Field label="Minimum article score"><input type="number" min="0" max="100" value={form.minimumArticleScore || 90} onChange={(event) => update("minimumArticleScore", Number(event.target.value))} /></Field>
          <Field label="Minimum editorial score"><input type="number" min="0" max="100" value={form.minimumEditorialScore || 90} onChange={(event) => update("minimumEditorialScore", Number(event.target.value))} /></Field>
          <Field label="Minimum hero score"><input type="number" min="0" max="100" value={form.minimumHeroScore || 90} onChange={(event) => update("minimumHeroScore", Number(event.target.value))} /></Field>
          <label className={styles.toggle}><input type="checkbox" checked={form.approvalRequirements?.sourcesRequired !== false} onChange={(event) => update("approvalRequirements", { ...(form.approvalRequirements || {}), sourcesRequired: event.target.checked })} /> Require claim sources</label>
          <label className={styles.toggle}><input type="checkbox" checked={form.approvalRequirements?.heroQaPassed !== false} onChange={(event) => update("approvalRequirements", { ...(form.approvalRequirements || {}), heroQaPassed: event.target.checked })} /> Require hero QA</label>
          <label className={styles.toggle}><input type="checkbox" checked={form.approvalRequirements?.deterministicPassed !== false} onChange={(event) => update("approvalRequirements", { ...(form.approvalRequirements || {}), deterministicPassed: event.target.checked })} /> Require deterministic gates</label>
          <label className={styles.toggle}><input type="checkbox" checked={form.approvalRequirements?.criticalEditorialIssuesResolved !== false} onChange={(event) => update("approvalRequirements", { ...(form.approvalRequirements || {}), criticalEditorialIssuesResolved: event.target.checked })} /> Require critical editorial issues resolved</label>
        </fieldset>
        <fieldset>
          <legend>Automation</legend>
          <label className={styles.toggle}><input type="checkbox" checked={form.generationEnabled === true} onChange={(event) => update("generationEnabled", event.target.checked)} /> Enable manual batch generation</label>
          <label className={styles.toggle}><input type="checkbox" checked={form.publicationAutomationEnabled === true} onChange={(event) => update("publicationAutomationEnabled", event.target.checked)} /> Enable publication automation</label>
          <label className={styles.toggle}><input type="checkbox" checked={form.bufferSyncEnabled === true} onChange={(event) => update("bufferSyncEnabled", event.target.checked)} /> Enable Buffer sync</label>
          <p>Environment Buffer switch: <strong>{admin.data?.buffer.environmentSyncEnabled ? "enabled" : "disabled"}</strong></p>
          <p>Buffer API key: <strong>{admin.data?.buffer.apiKeyConfigured ? "configured" : "missing"}</strong></p>
          <Field label="Social timing offsets (days)"><input value={(form.socialPostTimingOffsetsDays || [0, 4, 28]).join(", ")} onChange={(event) => update("socialPostTimingOffsetsDays", event.target.value.split(",").map((value) => Number(value.trim())).filter(Number.isFinite))} /></Field>
        </fieldset>
      </section>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>Buffer channel policy</p>
        <h2>Explicit channel selection required</h2>
        <p>No channel is selected automatically. A personal LinkedIn profile requires its exact channel ID to be separately approved by an administrator.</p>
        {organisations.length ? (
          <>
            <Field label="Buffer organisation">
              <select value={bufferOrganisationId} onChange={(event) => { setBufferOrganisationId(event.target.value); setBufferChannelIds([]); }}>
                <option value="">Select an organisation</option>
                {organisations.map((organisation) => <option value={organisation.id} key={organisation.id}>{organisation.name}</option>)}
              </select>
            </Field>
            <div className={styles.channelList}>
              {availableChannels.map((channel) => (
                <label className={styles.toggle} key={channel.id}>
                  <input type="checkbox" checked={bufferChannelIds.includes(channel.id)} onChange={() => toggleBufferChannel(channel.id)} />
                  {channel.name} · {label(channel.service)}
                  {String(channel.service).toLowerCase() === "linkedin" ? " · exact LinkedIn channel approval" : ""}
                </label>
              ))}
            </div>
            <button type="button" disabled={!bufferOrganisationId} onClick={saveBuffer}>Save exact Buffer channels</button>
          </>
        ) : <Link href="/admin/seo-articles/distribution">Discover Buffer organisations and channels first</Link>}
      </section>
    </>
  );
}

function Status({ value }) {
  return <span className={styles.status}>{label(value)}</span>;
}

function Metric({ label: metricLabel, value }) {
  return <div className={styles.metric}><span>{metricLabel}</span><strong>{value}</strong></div>;
}

function Field({ label: fieldLabel, children }) {
  return <label className={styles.field}><span>{fieldLabel}</span>{children}</label>;
}
