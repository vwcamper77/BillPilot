"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildBillDocument,
  formatCurrency,
  formatDisplayDate,
  formatOrdinal,
  isValidDueDay,
  sanitiseBillDisplayName,
  composeBillDisplayName,
  splitBillDisplayName,
  getTodayIso,
} from "@/lib/billMath";
import { analyseCsvText } from "@/lib/csvBillFinder";
import { logSecurityEventClient, storeImportArchive } from "@/lib/security/clientSecurity";
import { safeError, safeWarn } from "@/lib/security/safeLog";
import { trackEvent } from "@/lib/analytics/track";
import { getSupplierNames } from "@/lib/supplierCatalog";
import {
  applyParsedActions,
  fetchImageImport,
  postDashboardBillAction,
  runWithTimeout,
  withTimeout,
} from "../lib/dashboardApi";
import { friendlyBillSaveError } from "../lib/friendlyErrors";
import {
  CATEGORY_META,
  applyQuickAddContext,
  billFingerprint,
  buildBillReviewDraft,
  buildBillReviewDrafts,
  buildLooseBillReviewDraft,
  buildOutcomeMessage,
  classifyBill,
  getScrollBehavior,
  mergeOutcomeBills,
  normaliseVoiceBillText,
  parseDueDayFromText,
  prettifySubCategory,
  scoreAndClassifyBill,
} from "../lib/billHelpers";

const SUPPLIER_NAME_OPTIONS = getSupplierNames();
const BILL_CATEGORY_KEYS = ["household", "subscription", "vehicle", "debt", "family", "work_side_project", "other"];

function BillReviewCard({
  draft,
  displayCurrency,
  isEditing,
  isSaving,
  form,
  onFormChange,
  onEdit,
  onSave,
  onAdd,
  onCancelEdit,
  onCancel,
}) {
  const categoryMeta = CATEGORY_META[draft.category] || CATEGORY_META.other;
  const dueLabel = draft.dueDay ? `${formatOrdinal(draft.dueDay)} of each month` : "Missing";
  const amountLabel = Number.isFinite(Number(draft.amount)) && Number(draft.amount) > 0
    ? formatCurrency(Number(draft.amount), displayCurrency)
    : "Missing";
  const frequencyLabel = draft.frequency === "monthly" ? "Monthly" : draft.frequency || "Monthly";
  const subCategoryLabel = draft.subCategory ? prettifySubCategory(draft.subCategory) : categoryMeta.label;
  const hasMissingFields = Boolean(draft.missingFields?.length);
  const showEditMode = isEditing || hasMissingFields;

  return (
    <div className="bill-review-card">
      {showEditMode ? (
        <div className="bill-review-edit-grid">
          <div className="field-row">
            <label className="field-label" htmlFor={`review-supplier-${draft.id}`}>Supplier name</label>
            <input
              id={`review-supplier-${draft.id}`}
              list="supplier-name-options"
              value={form?.supplierName || ""}
              onChange={(event) => onFormChange((current) => ({ ...current, supplierName: event.target.value }))}
              placeholder="Supplier name"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor={`review-name-${draft.id}`}>Bill name</label>
            <input
              id={`review-name-${draft.id}`}
              value={form?.billName || form?.name || ""}
              onChange={(event) => onFormChange((current) => ({ ...current, billName: event.target.value, name: event.target.value }))}
              placeholder="Bill name"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor={`review-amount-${draft.id}`}>Amount</label>
            <input
              id={`review-amount-${draft.id}`}
              inputMode="decimal"
              value={form?.amount || ""}
              onChange={(event) => onFormChange((current) => ({ ...current, amount: event.target.value }))}
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor={`review-dueDay-${draft.id}`}>Due day</label>
            <input
              id={`review-dueDay-${draft.id}`}
              inputMode="numeric"
              value={form?.dueDay || ""}
              onChange={(event) => onFormChange((current) => ({ ...current, dueDay: event.target.value }))}
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor={`review-category-${draft.id}`}>Category</label>
            <select
              id={`review-category-${draft.id}`}
              className="category-select"
              value={form?.category || ""}
              onChange={(event) => onFormChange((current) => ({ ...current, category: event.target.value }))}
            >
              {BILL_CATEGORY_KEYS.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_META[category].icon} {CATEGORY_META[category].label}
                </option>
              ))}
            </select>
          </div>
          <div className="bill-review-actions">
            <button className="primary-button small-button" type="button" onClick={onSave}>
              {hasMissingFields ? "Save details" : "Save changes"}
            </button>
            <button
              className="secondary-button small-button"
              type="button"
              onClick={hasMissingFields ? onCancel : onCancelEdit}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="bill-review-head">
            <div>
              <h3>{draft.name || "Bill name needed"}</h3>
              <p className="helper-text">
                Confidence {Math.round((draft.confidence || 0.65) * 100)}%
                {draft.sourceText ? " • cleaned from your input" : ""}
              </p>
            </div>
            <span className="bill-review-category">{categoryMeta.icon} {subCategoryLabel}</span>
          </div>
          <div className="bill-review-grid">
            <div className="bill-review-item">
              <span>Supplier</span>
              <strong>{draft.supplierName || "Not set"}</strong>
            </div>
            <div className="bill-review-item">
              <span>Bill name</span>
              <strong>{draft.billName || draft.name || "Not set"}</strong>
            </div>
            <div className="bill-review-item">
              <span>Amount</span>
              <strong>{amountLabel}</strong>
            </div>
            <div className="bill-review-item">
              <span>Due day</span>
              <strong>{dueLabel}</strong>
            </div>
            <div className="bill-review-item">
              <span>Frequency</span>
              <strong>{frequencyLabel}</strong>
            </div>
            <div className="bill-review-item">
              <span>Category</span>
              <strong>{categoryMeta.label}</strong>
            </div>
          </div>
          {draft.missingFields?.length ? (
            <p className="helper-text helper-tooltip bill-review-helper">
              {draft.missingFields.includes("amount") && draft.missingFields.includes("dueDay")
                ? "I found the bill name, but need the amount and due date."
                : draft.missingFields.includes("amount")
                  ? "I found the bill name and due date, but need the amount."
                  : "I found the bill name and amount, but need the due date."}
            </p>
          ) : null}
          <div className="bill-review-actions">
            <button className="primary-button small-button" type="button" onClick={onAdd} disabled={isSaving}>
              {isSaving ? "Adding..." : "Add bill"}
            </button>
            <button className="secondary-button small-button" type="button" onClick={onEdit} disabled={isSaving}>Edit</button>
            <button className="secondary-button small-button" type="button" onClick={onCancel} disabled={isSaving}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function AddBills({
  bills,
  onBillsChange,
  hasIncome,
  hasBalanceSnapshot,
  hasPayday,
  displayCurrency,
  onImportingChange,
  autoFocusOnMount,
}) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [chatError, setChatError] = useState("");
  const [billReviewDrafts, setBillReviewDrafts] = useState([]);
  const [editingReviewId, setEditingReviewId] = useState("");
  const [billReviewForm, setBillReviewForm] = useState({ supplierName: "", billName: "", name: "", amount: "", dueDay: "", category: "", frequency: "monthly" });
  const [savingReviewDraftId, setSavingReviewDraftId] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [importJobs, setImportJobs] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [currentImportJobId, setCurrentImportJobId] = useState(null);
  const [currentImportStep, setCurrentImportStep] = useState("idle");
  const [importSummary, setImportSummary] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [csvPhase, setCsvPhase] = useState("idle");
  const [csvSuggestions, setCsvSuggestions] = useState([]);
  const [csvIgnored, setCsvIgnored] = useState(new Set());
  const [csvEditingId, setCsvEditingId] = useState(null);
  const [csvEditForm, setCsvEditForm] = useState({ name: "", amount: "", dueDay: "", category: "" });
  const [csvSavingId, setCsvSavingId] = useState(null);
  const [csvSavedCount, setCsvSavedCount] = useState(0);
  const [csvError, setCsvError] = useState("");
  const [quickAddContext, setQuickAddContext] = useState(null);

  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const voiceCapturedTextRef = useRef("");
  const voiceReviewRequestedRef = useRef(false);
  const voiceReviewRef = useRef(null);
  const uploadInputRef = useRef(null);
  const wrapperRef = useRef(null);
  const messageInputRef = useRef(null);
  const billInputStartedRef = useRef(false);
  const billsRef = useRef(bills);

  useEffect(() => {
    billsRef.current = bills;
  }, [bills]);

  useEffect(() => {
    onImportingChange?.(isImporting);
  }, [isImporting, onImportingChange]);

  useEffect(() => {
    if (!autoFocusOnMount) return;
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleQuickAdd(event) {
      const detail = event.detail || {};
      if (detail.target !== "add-bills") return;

      if (detail.name) {
        setQuickAddContext({ name: detail.name, category: detail.category || "household" });
        setMessage(detail.name);
        setAssistantMessage("");
        setChatError("");
      }

      window.requestAnimationFrame(() => {
        wrapperRef.current?.scrollIntoView({ behavior: getScrollBehavior(), block: "center" });
        messageInputRef.current?.focus();
        messageInputRef.current?.setSelectionRange?.(
          messageInputRef.current.value.length,
          messageInputRef.current.value.length,
        );
      });
    }

    window.addEventListener("ct:focus-quick-action", handleQuickAdd);
    return () => window.removeEventListener("ct:focus-quick-action", handleQuickAdd);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceMessage("Voice input is not supported in this browser. You can still type your bill.");
      return undefined;
    }

    setVoiceSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = "en-GB";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setVoiceMessage("Listening...");
      setChatError("");
      transcriptRef.current = "";
      voiceCapturedTextRef.current = "";
      voiceReviewRequestedRef.current = false;
    };

    recognition.onresult = (event) => {
      let finalTranscript = transcriptRef.current;
      let interimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim() || "";

        if (!text) {
          continue;
        }

        if (result.isFinal) {
          finalTranscript = `${finalTranscript} ${text}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }

      transcriptRef.current = finalTranscript;
      const capturedText = normaliseVoiceBillText(`${finalTranscript} ${interimTranscript}`);
      voiceCapturedTextRef.current = capturedText;
      setMessage(capturedText);
    };

    recognition.onerror = (event) => {
      setListening(false);
      voiceReviewRequestedRef.current = false;

      if (event.error === "not-allowed") {
        setVoiceMessage("Microphone access was blocked. You can still type your bill.");
        return;
      }

      if (event.error === "no-speech") {
        setVoiceMessage("I did not catch that. Try again, or type your bill.");
        return;
      }

      setVoiceMessage("Voice input is not supported in this browser. You can still type your bill.");
    };

    recognition.onend = () => {
      setListening(false);
      const shouldReview = voiceReviewRequestedRef.current;
      const capturedText = voiceCapturedTextRef.current.trim();
      voiceReviewRequestedRef.current = false;

      if (shouldReview && capturedText) {
        setVoiceMessage("Reviewing voice input...");
        void voiceReviewRef.current?.(capturedText);
        return;
      }

      setVoiceMessage((current) =>
        shouldReview && !capturedText
          ? "I did not catch that. Try again, or type your bill."
          : current === "Listening..."
          ? "Voice captured. Review it, then add it."
          : current,
      );
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      recognitionRef.current = null;
    };
  }, []);

  const importLocked = isImporting;

  async function handleSubmit(event, messageOverride) {
    event.preventDefault();
    const isVoiceSubmission = typeof messageOverride === "string";
    const submittedMessage = isVoiceSubmission ? messageOverride : message;

    if (!submittedMessage.trim() && !importJobs.length) {
      return;
    }

    setChatError("");
    setAssistantMessage("");

    try {
      setSubmitting(true);
      if (importJobs.length && !isVoiceSubmission) {
        await reviewImportQueue();
      } else {
        const response = await runWithTimeout(fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: submittedMessage }),
        }), "The parser is taking too long. Try again.");
        const parsed = await response.json();

        if (!response.ok) {
          throw new Error(parsed.responseMessage || "I could not read that yet.");
        }

        const parsedWithContext = applyQuickAddContext(parsed, quickAddContext);
        const reviewDrafts = buildBillReviewDrafts(parsedWithContext, {
          sourceText: submittedMessage,
          quickAddContext,
        });

        if (reviewDrafts.length) {
          setBillReviewDrafts(reviewDrafts);
          trackEvent("bill_reviewed", { draftCount: reviewDrafts.length, source: "chat" });
          setEditingReviewId("");
          setAssistantMessage(
            reviewDrafts.some((draft) => draft.missingFields?.length)
              ? "Review bill before adding. I found a likely match but still need any missing fields."
              : "Review bill before adding.",
          );
          return;
        }

        if (parsedWithContext.action === "set_income") {
          const outcome = await applyParsedActions(parsedWithContext, hasIncome, bills);
          setAssistantMessage(buildOutcomeMessage(parsedWithContext, outcome));
          return;
        }

        const fallbackDraft = buildLooseBillReviewDraft(submittedMessage, quickAddContext);

        if (fallbackDraft) {
          setBillReviewDrafts([fallbackDraft]);
          trackEvent("bill_reviewed", { draftCount: 1, source: "chat" });
          setEditingReviewId("");
          setAssistantMessage("Review bill before adding. I found the bill name, but need the amount and due date.");
          return;
        }

        setAssistantMessage(parsedWithContext.responseMessage || "I could not turn that into a clean bill yet.");
      }
    } catch (submitError) {
      if (submitError?.message === "Failed to fetch") {
        setChatError("That image did not upload properly. Try the screenshot again, or type the bill in the box.");
      } else {
        setChatError(submitError.message);
      }
    } finally {
      setSubmitting(false);
      if (isVoiceSubmission) setVoiceMessage("");
    }
  }

  voiceReviewRef.current = (capturedText) => handleSubmit({ preventDefault() {} }, capturedText);

  async function reviewImportQueue() {
    if (isImporting) return;

    setIsImporting(true);
    setImportSummary(null);
    setCurrentImportStep("idle");

    const jobsToRun = importJobs.filter((job) => job.status === "queued");

    let skippedTotal = 0;
    const collectedDrafts = [];

    try {
      for (const job of jobsToRun) {
        setCurrentImportJobId(job.id);
        setCurrentImportStep("uploading_image");

        updateJob(job.id, {
          status: "uploading",
          progressText: "Uploading screenshot…",
          errorMessage: "",
          totalBillsFound: 0,
          billsSaved: 0,
          billsSkipped: 0,
          currentBillIndex: 0,
        });

        try {
          const result = await importSingleImage(job, { saveBills: false });

          skippedTotal += result.skippedCount || 0;
          collectedDrafts.push(...(result.reviewDrafts || []));

          {
            const extractedCount = (result.bills || []).length || result.totalBillsFound || 0;
            const qualitySkipped = (result.skippedRows || []).length;
            const queueFinalStatus =
              (result.reviewCount || 0) > 0 || (extractedCount > 0 && (result.skippedCount || 0) > 0)
                ? "done"
                : "failed";
            updateJob(job.id, {
              status: queueFinalStatus,
              progressText: (result.reviewCount || 0) > 0
                ? `${result.reviewCount || 0} bill${result.reviewCount === 1 ? "" : "s"} ready to review.`
                : buildImportDoneMessage(
                  result.reviewCount || 0,
                  result.skippedCount || 0,
                  extractedCount,
                  qualitySkipped,
                ),
              importedCount: result.reviewCount || 0,
              skippedCount: result.skippedCount || 0,
              totalBillsFound: result.totalBillsFound || 0,
              billsSaved: result.reviewCount || 0,
              billsSkipped: result.skippedCount || 0,
              currentBillIndex: result.totalBillsFound || 0,
              errorMessage: "",
              skippedRows: result.skippedRows || [],
            });
          }
          setCurrentImportStep("job_done");
        } catch (error) {
          const errMsg = error?.message || "Unknown import error";
          const isTimeout = errMsg.toLowerCase().includes("timed out");

          updateJob(job.id, {
            status: "failed",
            progressText: isTimeout
              ? "Timed out. Try a clearer screenshot."
              : "Couldn't read enough from this screenshot.",
            totalBillsFound: 0,
            billsSaved: 0,
            billsSkipped: 0,
            currentBillIndex: 0,
            errorMessage: errMsg,
          });
          setCurrentImportStep("job_failed");

          safeError("[import-queue] job failed", { reason: isTimeout ? "timeout" : "import_error" });
        } finally {
          setCurrentImportJobId(null);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } finally {
      const summary = { importedCount: collectedDrafts.length, skippedCount: skippedTotal };
      setImportSummary(summary);

      if (collectedDrafts.length) {
        setBillReviewDrafts(collectedDrafts);
        trackEvent("bill_reviewed", { draftCount: collectedDrafts.length, source: "import" });
        setAssistantMessage(
          collectedDrafts.length === 1
            ? "Review bill before adding."
            : `Review ${collectedDrafts.length} bills before adding.`,
        );
      } else {
        const parts = [];
        parts.push("I could not cleanly extract a bill to review from those screenshots.");
        if (skippedTotal > 0) parts.push(`${skippedTotal} row${skippedTotal === 1 ? "" : "s"} were unclear or incomplete.`);
        setAssistantMessage(parts.join(" "));
      }

      setIsImporting(false);
      setCurrentImportStep("idle");
    }
  }

  async function importSingleImage(job, { saveBills = true } = {}) {
    setCurrentImportStep("uploading_image");
    updateJob(job.id, {
      status: "uploading",
      progressText: "Uploading screenshot…",
      currentBillIndex: 0,
    });

    const formData = new FormData();
    formData.append("image", job.file, job.name);
    if (message.trim()) {
      formData.append("message", message);
    }

    const response = await fetchImageImport(formData, job.name);

    setCurrentImportStep("reading_response");
    updateJob(job.id, {
      status: "identifying",
      progressText: "Identifying bills…",
    });
    const json = await response.json();
    setCurrentImportStep("json_received");
    if (!response.ok || json.ok === false) {
      throw new Error(json.error || json.message || "Image import failed");
    }

    const jobBills = Array.isArray(json.bills) ? json.bills : [];
    if (!jobBills.length) {
      throw new Error(json.error || json.message || "No bills found in this screenshot.");
    }

    logSecurityEventClient("ai_import_used", { billCount: jobBills.length });
    storeImportArchive({
      source: "ai_image",
      rawText: jobBills.map((bill) => bill?.rawText).filter(Boolean).join("\n"),
      payload: { billCount: jobBills.length },
    });

    const qualityResults = jobBills.map(scoreAndClassifyBill);
    const billsToSave = qualityResults.filter((r) => r.shouldImport).map((r) => r.bill);
    const skippedRows = qualityResults
      .filter((r) => !r.shouldImport)
      .map((r) => ({ name: r.bill.name || "", rawText: r.bill.rawText || r.bill.name || "", reason: r.skipReason }));

    if (!saveBills) {
      const reviewDrafts = billsToSave
        .map((bill) => buildBillReviewDraft(bill, {
          sourceText: bill?.rawText || message,
          importJobId: job.id,
          importJobName: job.name,
        }))
        .filter(Boolean);

      return {
        reviewCount: reviewDrafts.length,
        skippedCount: skippedRows.length,
        totalBillsFound: jobBills.length,
        skippedRows,
        bills: jobBills,
        reviewDrafts,
      };
    }

    updateJob(job.id, {
      status: "rationalising",
      progressText: "Rationalising bill names…",
      totalBillsFound: jobBills.length,
      billsSaved: 0,
      billsSkipped: 0,
      currentBillIndex: 0,
      skippedRows,
    });
    let importedCount = 0;
    let skippedCount = skippedRows.length;

    if (!billsToSave.length) {
      return {
        importedCount: 0,
        skippedCount,
        totalBillsFound: jobBills.length,
        skippedRows,
        bills: jobBills,
      };
    }

    for (let index = 0; index < billsToSave.length; index += 1) {
      const bill = billsToSave[index];

      try {
        setCurrentImportStep(`saving_bill_${index + 1}_of_${billsToSave.length}`);
        updateJob(job.id, {
          status: "saving",
          progressText: `Adding bill ${index + 1} of ${billsToSave.length}…`,
          totalBillsFound: billsToSave.length,
          billsSaved: importedCount,
          billsSkipped: skippedCount,
          currentBillIndex: index + 1,
        });
        const result = await withTimeout(
          saveImportedBill(bill),
          10000,
          `save ${bill.name}`,
        );

        if (result?.skipped) {
          skippedCount += 1;
        } else {
          importedCount += 1;
        }
        updateJob(job.id, {
          status: "saving",
          progressText: `Adding bill ${index + 1} of ${billsToSave.length}…`,
          totalBillsFound: billsToSave.length,
          billsSaved: importedCount,
          billsSkipped: skippedCount,
          currentBillIndex: index + 1,
        });
      } catch {
        safeError("[import-single] bill save failed", { reason: "save_error" });
        skippedCount += 1;
        updateJob(job.id, {
          status: "saving",
          progressText: `Adding bill ${index + 1} of ${billsToSave.length}…`,
          totalBillsFound: billsToSave.length,
          billsSaved: importedCount,
          billsSkipped: skippedCount,
          currentBillIndex: index + 1,
        });
      }
    }

    setCurrentImportStep("save_complete");
    const finalStatus = importedCount > 0 || (jobBills.length > 0 && skippedCount > 0) ? "done" : "failed";
    updateJob(job.id, {
      status: finalStatus,
      progressText: buildImportDoneMessage(importedCount, skippedCount, jobBills.length, skippedRows.length),
      totalBillsFound: jobBills.length,
      billsSaved: importedCount,
      billsSkipped: skippedCount,
      currentBillIndex: jobBills.length,
      skippedRows,
    });
    setCurrentImportStep("returning_result");

    return {
      importedCount,
      skippedCount,
      totalBillsFound: jobBills.length,
      skippedRows,
      bills: jobBills,
    };
  }

  function updateJob(jobId, patch) {
    setImportJobs((jobs) =>
      jobs.map((job) =>
        job.id === jobId ? { ...job, ...patch } : job,
      ),
    );
  }

  async function saveImportedBill(bill) {
    const repairedDueDay = isValidDueDay(bill?.dueDay)
      ? Number(bill?.dueDay)
      : parseDueDayFromText(
        [bill?.dateText, bill?.rawText, bill?.name].filter(Boolean).join(" "),
      );

    const parsedBill = {
      action: "create_bill",
      name: String(bill?.name || "").trim(),
      amount: Number(bill?.amount),
      currency: bill?.currency || "GBP",
      frequency: "monthly",
      dueDay: isValidDueDay(repairedDueDay) ? Number(repairedDueDay) : null,
      reminderOffsetDays: 1,
      dateText: bill?.dateText || null,
      rawText: bill?.rawText || null,
    };

    if (!parsedBill.name || !Number.isFinite(parsedBill.amount)) {
      return { skipped: true, reason: "invalid" };
    }

    const currentBills = billsRef.current || [];
    const duplicate = currentBills.some((existingBill) => billFingerprint(existingBill) === billFingerprint(parsedBill));

    if (duplicate) {
      return { skipped: true, reason: "duplicate" };
    }

    const billDocument = buildBillDocument(parsedBill);
    const payload = {
      ...billDocument,
      dateText: parsedBill.dateText,
      rawText: parsedBill.rawText,
    };

    try {
      const result = await postDashboardBillAction("create_bill", { fields: payload });
      logSecurityEventClient("bill_created", { source: "import" });
      trackEvent("bill_added", { source: "import" });
      const savedBill = { ...billDocument, id: result.billId };

      billsRef.current = [...currentBills, savedBill];
      onBillsChange?.((current) => (
        current.some((existingBill) => existingBill.id === savedBill.id) ? current : [...current, savedBill]
      ));

      return { skipped: false };
    } catch (error) {
      safeError("[dashboard-bills-save] failed", { code: error?.code });
      throw error;
    }
  }

  function handleVoiceToggle() {
    if (!voiceSupported || !recognitionRef.current) {
      setVoiceMessage("Voice input is not supported in this browser. You can still type your bill.");
      return;
    }

    if (listening) {
      voiceReviewRequestedRef.current = true;
      recognitionRef.current.stop();
      return;
    }

    setAssistantMessage("");
    setVoiceMessage("Listening...");
    recognitionRef.current.start();
  }

  async function handleImageFiles(fileList) {
    if (importLocked) {
      return;
    }

    const imageFiles = Array.from(fileList || []).filter((entry) => entry?.type?.startsWith("image/"));

    if (!imageFiles.length) {
      setChatError("Add a PNG, JPG, WEBP, or GIF screenshot.");
      return;
    }

    setChatError("");
    setAssistantMessage("");

    try {
      const nextJobs = await Promise.all(
        imageFiles.slice(0, 8).map(async (file) => ({
          id: buildImportJobId(file),
          file,
          name: file.name || "bill-screenshot.png",
          previewUrl: URL.createObjectURL(file),
          status: "queued",
          progressText: "Waiting",
          importedCount: 0,
          skippedCount: 0,
          totalBillsFound: 0,
          billsSaved: 0,
          billsSkipped: 0,
          currentBillIndex: 0,
          errorMessage: "",
          skippedRows: [],
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      setImportJobs((current) => mergeImportJobs(current, nextJobs));
    } catch {
      setChatError("I could not read that image. Try a different screenshot or file.");
    }
  }

  function handleImagePickerChange(event) {
    if (importLocked) {
      event.target.value = "";
      return;
    }

    void handleImageFiles(event.target.files);
    event.target.value = "";
  }

  function isImageUploadFile(file) {
    const fileName = (file?.name || "").toLowerCase();

    return file?.type?.startsWith("image/")
      || [".png", ".jpg", ".jpeg", ".webp", ".gif"].some((ext) => fileName.endsWith(ext));
  }

  function isCsvUploadFile(file) {
    const fileName = (file?.name || "").toLowerCase();
    const fileType = String(file?.type || "").toLowerCase();

    return fileName.endsWith(".csv") || fileType === "text/csv" || fileType.includes("comma");
  }

  function handleImportedFiles(fileList) {
    if (importLocked) {
      return;
    }

    const files = Array.from(fileList || []).filter(Boolean);

    if (!files.length) {
      return;
    }

    const imageFiles = files.filter(isImageUploadFile);

    if (imageFiles.length) {
      void handleImageFiles(imageFiles);
      return;
    }

    const csvFile = files.find(isCsvUploadFile);

    if (csvFile) {
      handleCsvFile(csvFile);
      return;
    }

    setChatError("Please upload a CSV, PNG, JPG, WEBP, or GIF file.");
  }

  function handleUploadChange(event) {
    handleImportedFiles(event.target.files);
    event.target.value = "";
  }

  function handleCsvFile(file) {
    setCsvError("");
    setCsvPhase("parsing");
    setCsvSuggestions([]);
    setCsvIgnored(new Set());
    setCsvEditingId(null);
    setCsvSavedCount(0);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target.result || "";
        const result = analyseCsvText(csvText);
        if (result.error === "no_columns") {
          setCsvError("We could not find date, description and amount columns in this CSV.");
          setCsvPhase("error");
        } else if (result.error) {
          setCsvError("We could not read this CSV. Try exporting it again from your banking app.");
          setCsvPhase("error");
        } else if (!result.suggestions || result.suggestions.length === 0) {
          setCsvPhase("empty");
        } else {
          setCsvSuggestions(result.suggestions);
          setCsvPhase("reviewing");
          logSecurityEventClient("csv_uploaded", { suggestionCount: result.suggestions.length });
          storeImportArchive({ source: "csv", csvText: String(csvText).slice(0, 100000) });
        }
      } catch {
        setCsvError("We could not read this CSV. Try exporting it again from your banking app.");
        setCsvPhase("error");
      }
    };
    reader.onerror = () => {
      setCsvError("We could not read this CSV. Try exporting it again from your banking app.");
      setCsvPhase("error");
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleCsvAddBill(suggestion) {
    setCsvSavingId(suggestion.id);
    setCsvError("");
    try {
      const todayIso = getTodayIso();
      const billDoc = buildBillDocument({
        name: suggestion.merchantName,
        amount: suggestion.averageAmount,
        dueDay: suggestion.usualPaymentDay,
        currency: "GBP",
      }, todayIso);
      const result = await postDashboardBillAction("create_bill", {
        fields: { ...billDoc, source: "csv_detected" },
      });
      const saved = { ...billDoc, id: result.billId, source: "csv_detected" };
      onBillsChange?.((current) => (current.some((b) => b.id === saved.id) ? current : [...current, saved]));
      billsRef.current = [...(billsRef.current || []), saved];
      setCsvSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setCsvSavedCount((n) => n + 1);
      logSecurityEventClient("bill_created", { source: "csv" });
      trackEvent("bill_added", { source: "csv" });
    } catch (saveError) {
      setCsvError(friendlyBillSaveError(saveError, "We could not add this bill."));
    } finally {
      setCsvSavingId(null);
    }
  }

  function startCsvEdit(suggestion) {
    setCsvEditingId(suggestion.id);
    setCsvError("");
    setCsvEditForm({
      name: suggestion.merchantName,
      amount: String(suggestion.averageAmount),
      dueDay: String(suggestion.usualPaymentDay),
      category: "",
    });
  }

  async function handleCsvEditSave(suggestion) {
    const amount = parseFloat(csvEditForm.amount);
    const dueDay = parseInt(csvEditForm.dueDay, 10);
    if (!csvEditForm.name.trim() || !Number.isFinite(amount) || amount <= 0) {
      setCsvError("Enter a valid name and amount before saving.");
      return;
    }
    setCsvSavingId(suggestion.id);
    setCsvError("");
    try {
      const todayIso = getTodayIso();
      const billDoc = buildBillDocument({
        name: csvEditForm.name.trim(),
        amount,
        dueDay: isValidDueDay(dueDay) ? dueDay : null,
        currency: "GBP",
        category: csvEditForm.category || null,
      }, todayIso);
      const result = await postDashboardBillAction("create_bill", {
        fields: { ...billDoc, source: "csv_detected" },
      });
      const saved = { ...billDoc, id: result.billId, source: "csv_detected" };
      onBillsChange?.((current) => (current.some((b) => b.id === saved.id) ? current : [...current, saved]));
      billsRef.current = [...(billsRef.current || []), saved];
      setCsvSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      setCsvEditingId(null);
      setCsvSavedCount((n) => n + 1);
      logSecurityEventClient("bill_created", { source: "csv" });
      trackEvent("bill_added", { source: "csv" });
    } catch (saveError) {
      setCsvError(friendlyBillSaveError(saveError, "We could not add this bill."));
    } finally {
      setCsvSavingId(null);
    }
  }

  function resetCsv() {
    setCsvPhase("idle");
    setCsvSuggestions([]);
    setCsvIgnored(new Set());
    setCsvEditingId(null);
    setCsvSavedCount(0);
    setCsvError("");
  }

  function hasDraggedFiles(dataTransfer) {
    if (!dataTransfer) {
      return false;
    }

    return Array.from(dataTransfer.items || []).some((item) => item.kind === "file")
      || Array.from(dataTransfer.types || []).includes("Files");
  }

  function handleDragOver(event) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setDragActive(false);
  }

  function handleDrop(event) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    setDragActive(false);
    handleImportedFiles(event.dataTransfer.files);
  }

  function handlePaste(event) {
    if (importLocked) {
      return;
    }

    const imageItem = Array.from(event.clipboardData?.items || []).find((item) =>
      item.type?.startsWith("image/"));

    if (!imageItem) {
      return;
    }

    const file = imageItem.getAsFile();

    if (!file) {
      return;
    }

    event.preventDefault();
    void handleImageFiles([file]);
  }

  function removeSelectedImage(imageKey) {
    setImportJobs((current) => {
      const removed = current.find((job) => job.id === imageKey);

      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }

      return current.filter((job) => job.id !== imageKey);
    });
  }

  function clearImports({ preserveAssistantMessage = false } = {}) {
    setImportJobs((current) => {
      current.forEach((job) => {
        if (job.previewUrl) {
          URL.revokeObjectURL(job.previewUrl);
        }
      });

      return [];
    });
    if (!preserveAssistantMessage) {
      setAssistantMessage("");
    }
    setChatError("");
    setImportSummary(null);
    setCurrentImportJobId(null);
  }

  function startManualBillDraft() {
    const draftId = `manual-${Date.now()}`;

    setBillReviewDrafts([{
      id: draftId,
      name: "",
      supplierName: "",
      billName: "",
      amount: null,
      dueDay: null,
      frequency: "monthly",
      category: "household",
      subCategory: null,
      confidence: 1,
      missingFields: ["name", "amount", "dueDay"],
      sourceText: "",
      importJobId: "",
      importJobName: "",
    }]);
    setBillReviewForm({
      supplierName: "",
      billName: "",
      name: "",
      amount: "",
      dueDay: "",
      category: "household",
      frequency: "monthly",
    });
    setEditingReviewId(draftId);
    setAssistantMessage("Manual bill entry ready. Add the supplier, bill name, amount, and due day.");
    setChatError("");
  }

  function startBillReviewEdit(draft) {
    setEditingReviewId(draft.id);
    setBillReviewForm({
      supplierName: draft.supplierName || "",
      billName: draft.billName || "",
      name: draft.name || "",
      amount: draft.amount === null || draft.amount === undefined ? "" : String(draft.amount),
      dueDay: draft.dueDay === null || draft.dueDay === undefined ? "" : String(draft.dueDay),
      category: draft.category || "",
      frequency: draft.frequency || "monthly",
    });
    setChatError("");
  }

  function cancelBillReviewDraft(draftId) {
    setBillReviewDrafts((current) => current.filter((draft) => draft.id !== draftId));
    if (editingReviewId === draftId) {
      setEditingReviewId("");
    }
  }

  function saveBillReviewEdit(draftId) {
    const amount = Number(billReviewForm.amount);
    const dueDay = Number(billReviewForm.dueDay);
    const displayName = sanitiseBillDisplayName(composeBillDisplayName({
      supplierName: billReviewForm.supplierName,
      billName: billReviewForm.billName,
      fallbackName: billReviewForm.name,
    })).trim();

    if (!displayName.trim()) {
      setChatError("Add a bill name before continuing.");
      return;
    }

    setBillReviewDrafts((current) => current.map((draft) => {
      if (draft.id !== draftId) {
        return draft;
      }

      const cleanedName = sanitiseBillDisplayName(displayName);
      const classified = classifyBill({ name: cleanedName });
      const splitName = splitBillDisplayName(cleanedName);

      return {
        ...draft,
        name: cleanedName,
        supplierName: splitName.supplierName || "",
        billName: splitName.billName || cleanedName,
        amount: Number.isFinite(amount) && amount > 0 ? amount : null,
        dueDay: Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 ? dueDay : null,
        category: billReviewForm.category || classified.category || "other",
        frequency: billReviewForm.frequency || "monthly",
        subCategory: classified.subCategory || draft.subCategory || null,
        confidence: draft.confidence || classified.confidence || 0.6,
        missingFields: [
          ...(Number.isFinite(amount) && amount > 0 ? [] : ["amount"]),
          ...(Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 ? [] : ["dueDay"]),
        ],
      };
    }));
    setEditingReviewId("");
    setChatError("");
  }

  async function confirmBillReviewDraft(draftId) {
    const draft = billReviewDrafts.find((entry) => entry.id === draftId);

    if (!draft) {
      return;
    }

    if (!draft.name?.trim()) {
      setChatError("Add a bill name before saving.");
      return;
    }

    if (!Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0) {
      setChatError("I found the bill name, but need the amount and due date.");
      startBillReviewEdit(draft);
      return;
    }

    if (!Number.isInteger(Number(draft.dueDay)) || Number(draft.dueDay) < 1 || Number(draft.dueDay) > 31) {
      setChatError("I found the bill name, but need the amount and due date.");
      startBillReviewEdit(draft);
      return;
    }

    setSavingReviewDraftId(draftId);
    setChatError("");

    try {
      const parsedDraft = {
        action: "create_bill",
        name: draft.name,
        supplierName: draft.supplierName || null,
        billName: draft.billName || null,
        amount: Number(draft.amount),
        dueDay: Number(draft.dueDay),
        frequency: draft.frequency || "monthly",
        currency: "GBP",
        category: draft.category || null,
        rawText: draft.sourceText || null,
      };
      const outcome = await applyParsedActions(parsedDraft, hasIncome, billsRef.current || bills);

      if (outcome.savedBills?.length) {
        onBillsChange?.((current) => {
          const next = [...current];
          outcome.savedBills.forEach((savedBill) => {
            if (!next.some((existingBill) => existingBill.id === savedBill.id)) {
              next.push(savedBill);
            }
          });
          return next;
        });
        billsRef.current = mergeOutcomeBills(billsRef.current || bills, {
          action: "batch",
          items: outcome.savedBills.map((savedBill) => ({
            action: "create_bill",
            ...savedBill,
          })),
        });
      }

      if (!outcome.savedBills?.length) {
        throw new Error("Could not save that bill yet.");
      }

      trackEvent("bill_added", { source: "chat" });
      cancelBillReviewDraft(draftId);
      setAssistantMessage(`Added ${draft.name}.`);

      const remainingDrafts = billReviewDrafts.filter((entry) => entry.id !== draftId);
      if (remainingDrafts.length === 0) {
        setMessage("");
        billInputStartedRef.current = false;
        setQuickAddContext(null);
        setVoiceMessage("");
        transcriptRef.current = "";
        clearImports({ preserveAssistantMessage: true });
      }
    } catch (saveError) {
      setChatError(friendlyBillSaveError(saveError, "Could not save that bill yet."));
    } finally {
      setSavingReviewDraftId("");
    }
  }

  async function handleRetryImport(jobId) {
    const job = importJobs.find((j) => j.id === jobId);
    if (!job || isImporting) return;

    if (!job.file) {
      updateJob(jobId, { progressText: "Please choose this screenshot again." });
      return;
    }

    setIsImporting(true);
    setCurrentImportJobId(jobId);

    try {
      updateJob(jobId, {
        status: "uploading",
        progressText: "Uploading screenshot…",
        importedCount: 0,
        skippedCount: 0,
        totalBillsFound: 0,
        billsSaved: 0,
        skippedRows: [],
        errorMessage: "",
      });

      const result = await importSingleImage(job);

      {
        const retryExtractedCount = (result.bills || []).length || result.totalBillsFound || 0;
        const retryQualitySkipped = (result.skippedRows || []).length;
        const retryFinalStatus =
          (result.importedCount || 0) > 0 || (retryExtractedCount > 0 && (result.skippedCount || 0) > 0)
            ? "done"
            : "failed";
        updateJob(jobId, {
          status: retryFinalStatus,
          progressText: buildImportDoneMessage(
            result.importedCount || 0,
            result.skippedCount || 0,
            retryExtractedCount,
            retryQualitySkipped,
          ),
          importedCount: result.importedCount || 0,
          skippedCount: result.skippedCount || 0,
          totalBillsFound: result.totalBillsFound || 0,
          billsSaved: result.importedCount || 0,
          skippedRows: result.skippedRows || [],
        });
      }
    } catch (error) {
      const errMsg = error?.message || "Unknown import error";
      const isTimeout = errMsg.toLowerCase().includes("timed out");
      updateJob(jobId, {
        status: "failed",
        progressText: isTimeout
          ? "Timed out. Try a clearer screenshot."
          : "Couldn't read enough from this screenshot.",
        errorMessage: errMsg,
      });
    } finally {
      setIsImporting(false);
      setCurrentImportJobId(null);
      setCurrentImportStep("idle");
    }
  }

  const importQueueFinished = importJobs.length > 0 && !isImporting && importJobs.some((job) => job.status !== "queued");

  return (
    <section
      ref={wrapperRef}
      className={`chat-panel add-bills-card${dragActive ? " is-dragging" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <datalist id="supplier-name-options">
        {SUPPLIER_NAME_OPTIONS.map((supplierName) => (
          <option key={supplierName} value={supplierName} />
        ))}
      </datalist>
      <h2>Add bills</h2>
      {!hasBalanceSnapshot || !hasPayday ? (
        <p className="helper-text helper-tooltip">
          {!hasBalanceSnapshot
            ? "Bills can be added now, but the forecast works best after your balance and payday are set."
            : "You can add bills now, but ClearTill needs your payday to show what lands before payday."}
        </p>
      ) : null}
      <p className="helper-text helper-tooltip">Type it, say it, or drop in a banking-app screenshot. ClearTill will pull out the bill name, amount, and usual due day.</p>
      <p className="helper-text add-bills-drop-hint">
        Best for screenshots of a bank transaction, bill payment, or statement line that shows the merchant, amount, and date.
      </p>
      {quickAddContext ? (
        <div className="quick-add-note" role="status" aria-live="polite">
          <div className="quick-add-copy">
            <strong>Smart add ready: {quickAddContext.name}</strong>
            <span>We have already set the category to Household. Add the amount and due day, then review it.</span>
          </div>
          <button className="quick-add-clear" type="button" onClick={() => setQuickAddContext(null)}>
            Clear
          </button>
        </div>
      ) : null}
      {billReviewDrafts.length ? (
        <div className="bill-review-panel">
          <div className="bill-review-panel-head">
            <div>
              <h3>Review bill before adding</h3>
              <p className="helper-text">
                We cleaned the input into bill fields. Confirm or edit it before anything is saved.
              </p>
            </div>
          </div>
          <div className="bill-review-list">
            {billReviewDrafts.map((draft) => (
              <BillReviewCard
                key={draft.id}
                draft={draft}
                displayCurrency={displayCurrency}
                isEditing={editingReviewId === draft.id}
                isSaving={savingReviewDraftId === draft.id}
                form={editingReviewId === draft.id ? billReviewForm : null}
                onFormChange={setBillReviewForm}
                onEdit={() => startBillReviewEdit(draft)}
                onSave={() => saveBillReviewEdit(draft.id)}
                onAdd={() => confirmBillReviewDraft(draft.id)}
                onCancelEdit={() => setEditingReviewId("")}
                onCancel={() => cancelBillReviewDraft(draft.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
      <form className="chat-form" onSubmit={handleSubmit} onPaste={handlePaste}>
        <textarea
          ref={messageInputRef}
          value={message}
          disabled={submitting || importLocked}
          onChange={(event) => setMessage(event.target.value)}
          onFocus={() => {
            if (!billInputStartedRef.current) {
              billInputStartedRef.current = true;
              trackEvent("bill_input_started");
            }
          }}
          placeholder={
            quickAddContext
              ? `Example: ${quickAddContext.name} is £28 due on the 14th each month.`
              : "My rent is £1,100 on the 26th every month."
          }
        />
        <div className="add-bills-actions">
          <button className="primary-button" type="submit" disabled={submitting || importLocked}>
            {submitting ? "Reviewing..." : importJobs.length ? "Review bills" : "Review bill"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={submitting || importLocked}
            onClick={startManualBillDraft}
          >
            Add manually
          </button>
          <button
            className={`secondary-button${listening ? " is-listening" : ""}`}
            type="button"
            disabled={submitting || importLocked}
            onClick={handleVoiceToggle}
            aria-pressed={listening}
          >
            {listening ? "Finish & review" : "Speak"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={submitting || importLocked || csvPhase === "parsing"}
            onClick={() => uploadInputRef.current?.click()}
          >
            Upload
          </button>
        </div>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,.csv,text/csv"
          hidden
          onChange={handleUploadChange}
        />
      </form>

      {importJobs.length ? (
        <div className="selected-image-list">
          {importJobs.map((job) => (
            <div key={job.id} className={`selected-image-card${getImportJobClass(job)}`}>
              <div>
                <div className="selected-image-head">
                  <img className="selected-image-preview" src={job.previewUrl} alt="" />
                  <strong>{job.name}</strong>
                </div>
                <p className="helper-text image-meta">
                  {job.status === "queued" ? "Ready to scan" : job.progressText}
                </p>
                {job.status !== "queued" ? (
                  <div className="image-progress" aria-hidden="true">
                    <span className="image-progress-bar" style={{ width: `${getImportJobProgress(job)}%` }} />
                  </div>
                ) : null}
                {(job.skippedRows || []).length > 0 ? (
                  <div className="skipped-rows-panel">
                    <p className="helper-text">
                      Skipped {job.skippedRows.length} unclear row{job.skippedRows.length === 1 ? "" : "s"}
                    </p>
                    <ul className="skipped-rows-list">
                      {job.skippedRows.map((row, i) => (
                        <li key={i} className="helper-text">{row.name || row.rawText} — {row.reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <div className="import-card-actions">
                {job.status === "failed" ? (
                  <button className="secondary-button small-button" type="button" disabled={isImporting} onClick={() => handleRetryImport(job.id)}>
                    Retry
                  </button>
                ) : null}
                <button className="secondary-button small-button" type="button" disabled={importLocked} onClick={() => removeSelectedImage(job.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {importQueueFinished ? (
        <button className="secondary-button small-button" type="button" onClick={() => clearImports()}>Clear imports</button>
      ) : null}
      {importSummary ? (
        <p className="assistant-message">{buildImportSummaryMessage(importSummary)}</p>
      ) : null}

      {csvPhase === "parsing" ? (
        <p className="helper-text" style={{ marginTop: "12px" }}>Checking your CSV...</p>
      ) : null}
      {csvPhase === "empty" ? (
        <div style={{ marginTop: "12px" }}>
          <p className="helper-text">We could not find clear regular payments in this CSV. You can still type a bill above.</p>
          <button className="secondary-button small-button" type="button" style={{ marginTop: "10px" }} onClick={resetCsv}>Try another file</button>
        </div>
      ) : null}
      {(csvPhase === "error") && csvError ? (
        <p className="error" style={{ marginTop: "10px" }}>{csvError}</p>
      ) : null}
      {csvPhase === "reviewing" ? (() => {
        const visibleSuggestions = csvSuggestions.filter((s) => !csvIgnored.has(s.id));
        const CONF_LABEL = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };
        return (
          <div className="csv-review-section">
            <div className="csv-review-header">
              <p><strong>We found {csvSuggestions.length} possible regular payment{csvSuggestions.length === 1 ? "" : "s"}.</strong></p>
              <p className="helper-text">Review each one before adding it to your bills.</p>
              {csvSavedCount > 0 ? <p className="helper-text">{csvSavedCount} bill{csvSavedCount === 1 ? "" : "s"} added so far.</p> : null}
            </div>
            {visibleSuggestions.length === 0 ? (
              <div>
                <p className="helper-text">All suggestions reviewed.</p>
                <div className="csv-suggestion-actions" style={{ marginTop: "10px" }}>
                  <button className="secondary-button small-button" type="button" onClick={() => uploadInputRef.current?.click()}>Try another file</button>
                  <button className="secondary-button small-button" type="button" onClick={resetCsv}>Start over</button>
                </div>
              </div>
            ) : (
              <>
                <div className="csv-suggestions-list">
                  {visibleSuggestions.map((s) => (
                    <div key={s.id} className="csv-suggestion-card">
                      <div className="csv-suggestion-head">
                        <div>
                          <strong className="csv-suggestion-name">{s.merchantName}</strong>
                          <span className={`csv-confidence-pill csv-pill-${s.confidence}`}>{CONF_LABEL[s.confidence]}</span>
                        </div>
                        <div className="csv-suggestion-amount">
                          <strong>{formatCurrency(s.averageAmount, displayCurrency)}</strong>
                          <span className="csv-suggestion-freq">{s.frequency}</span>
                        </div>
                      </div>
                      <div className="csv-suggestion-meta">
                        <span>Last paid {formatDisplayDate(s.lastPaidDate)}</span>
                        <span>Next {formatDisplayDate(s.nextExpectedDate)}</span>
                        <span>{s.detectedTransactionsCount} found</span>
                      </div>
                      {csvEditingId === s.id ? (
                        <div className="csv-edit-form">
                          <div className="field-row">
                            <label className="field-label" htmlFor={`csv-name-${s.id}`}>Bill name</label>
                            <input id={`csv-name-${s.id}`} value={csvEditForm.name} onChange={(e) => setCsvEditForm((f) => ({ ...f, name: e.target.value }))} placeholder="Bill name" />
                          </div>
                          <div className="field-row">
                            <label className="field-label" htmlFor={`csv-amount-${s.id}`}>Amount</label>
                            <input id={`csv-amount-${s.id}`} inputMode="decimal" value={csvEditForm.amount} onChange={(e) => setCsvEditForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                          </div>
                          <div className="field-row">
                            <label className="field-label" htmlFor={`csv-day-${s.id}`}>Due day (1–31)</label>
                            <input id={`csv-day-${s.id}`} inputMode="numeric" value={csvEditForm.dueDay} onChange={(e) => setCsvEditForm((f) => ({ ...f, dueDay: e.target.value }))} placeholder="e.g. 1" />
                          </div>
                          <div className="field-row">
                            <label className="field-label" htmlFor={`csv-cat-${s.id}`}>Category</label>
                            <select id={`csv-cat-${s.id}`} className="category-select" value={csvEditForm.category} onChange={(e) => setCsvEditForm((f) => ({ ...f, category: e.target.value }))}>
                              <option value="">Auto-detect</option>
                              {BILL_CATEGORY_KEYS.map((category) => (
                                <option key={category} value={category}>
                                  {CATEGORY_META[category].icon} {CATEGORY_META[category].label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="csv-suggestion-actions">
                            <button className="primary-button small-button" type="button" disabled={csvSavingId === s.id} onClick={() => handleCsvEditSave(s)}>
                              {csvSavingId === s.id ? "Saving..." : "Save bill"}
                            </button>
                            <button className="secondary-button small-button" type="button" onClick={() => setCsvEditingId(null)}>Cancel</button>
                          </div>
                          {csvError ? <p className="error">{csvError}</p> : null}
                        </div>
                      ) : (
                        <div className="csv-suggestion-actions">
                          <button className="secondary-button small-button" type="button" disabled={!!csvSavingId} onClick={() => handleCsvAddBill(s)}>
                            {csvSavingId === s.id ? "Adding..." : "Add as bill"}
                          </button>
                          <button className="secondary-button small-button" type="button" disabled={!!csvSavingId} onClick={() => startCsvEdit(s)}>Edit</button>
                          <button className="secondary-button small-button" type="button" onClick={() => setCsvIgnored((prev) => new Set([...prev, s.id]))}>Ignore</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="csv-suggestion-actions" style={{ marginTop: "12px" }}>
                  <button className="secondary-button small-button" type="button" onClick={resetCsv}>Start over</button>
                </div>
                {csvError ? <p className="error">{csvError}</p> : null}
              </>
            )}
          </div>
        );
      })() : null}

      {voiceMessage ? <p className="helper-text voice-status">{voiceMessage}</p> : null}
      {assistantMessage ? <p className="assistant-message">{assistantMessage}</p> : null}
      {chatError ? <p className="error">{chatError}</p> : null}
    </section>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async () => {
      const originalDataUrl = String(reader.result || "");

      try {
        if (!file.type.startsWith("image/")) {
          resolve(originalDataUrl);
          return;
        }

        const compressed = await compressImageDataUrl(originalDataUrl, file.type);
        resolve(compressed);
      } catch {
        resolve(originalDataUrl);
      }
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl, mimeType) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const maxDimension = 1600;
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");

      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Canvas is not available"));
        return;
      }

      context.drawImage(image, 0, 0, width, height);

      const outputType = mimeType === "image/png" ? "image/png" : "image/jpeg";
      const quality = outputType === "image/jpeg" ? 0.82 : undefined;
      const nextDataUrl = canvas.toDataURL(outputType, quality);

      resolve(nextDataUrl);
    };

    image.onerror = () => reject(new Error("Could not process image"));
    image.src = dataUrl;
  });
}

function buildImportJobId(file) {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

function mergeImportJobs(current, next) {
  const seen = new Set(current.map((job) => job.id));
  const merged = [...current];

  for (const job of next) {
    if (seen.has(job.id)) {
      continue;
    }

    seen.add(job.id);
    merged.push(job);
  }

  return merged.slice(0, 8);
}

function getImportJobClass(job) {
  if (job.status === "done") {
    return " is-done";
  }

  if (["uploading", "identifying", "rationalising", "saving", "processing"].includes(job.status)) {
    return " is-processing";
  }

  if (job.status === "failed") {
    return " is-error";
  }

  return "";
}

function getImportJobProgress(job) {
  switch (job.status) {
    case "queued":
      return 0;
    case "uploading":
      return 20;
    case "identifying":
      return 45;
    case "rationalising":
      return 65;
    case "saving": {
      const total = Math.max(Number(job.totalBillsFound) || 0, 1);
      const current = Math.min(Number(job.currentBillIndex) || 0, total);
      return 65 + ((current / total) * 30);
    }
    case "done":
    case "failed":
      return 100;
    default:
      return 0;
  }
}

function buildImportDoneMessage(importedCount, skippedCount, extractedCount = 0, qualitySkippedCount = 0) {
  const ic = importedCount || 0;
  const sc = skippedCount || 0;
  const ec = extractedCount || 0;
  const qsc = qualitySkippedCount || 0;
  const dupSkipped = Math.max(0, sc - qsc);

  if (ic > 0 && sc > 0) {
    const skipLabel = dupSkipped > qsc ? "duplicate" : "unclear row";
    return `Imported ${ic} bill${ic === 1 ? "" : "s"}. Skipped ${sc} ${skipLabel}${sc === 1 ? "" : "s"}.`;
  }

  if (ic > 0) {
    return `Imported ${ic} bill${ic === 1 ? "" : "s"}.`;
  }

  if (ec > 0 && sc > 0) {
    const skipLabel = dupSkipped > qsc ? "duplicate" : "unclear row";
    return `Read this screenshot. No new bills added. Skipped ${sc} ${skipLabel}${sc === 1 ? "" : "s"}.`;
  }

  if (ec > 0) {
    return "Read this screenshot. No new bills added.";
  }

  return "Couldn't read enough from this screenshot.";
}

function buildImportSummaryMessage(summary) {
  if (!summary) {
    return "";
  }

  const imported = summary.importedCount || 0;
  const skipped = summary.skippedCount || 0;

  if (imported > 0 && skipped > 0) {
    return `Import completed. Added ${imported} bill${imported === 1 ? "" : "s"}. Skipped ${skipped} unclear row${skipped === 1 ? "" : "s"}.`;
  }

  if (imported > 0) {
    return `Import completed. Added ${imported} bill${imported === 1 ? "" : "s"}.`;
  }

  if (skipped > 0) {
    return `Import completed. No new bills added. ${skipped} row${skipped === 1 ? "" : "s"} were already imported or skipped.`;
  }

  return "Import completed. No new bills added.";
}
