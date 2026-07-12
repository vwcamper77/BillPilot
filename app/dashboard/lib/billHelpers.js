import {
  isValidDueDay,
  resolveBillTitle,
  sanitiseBillDisplayName,
  splitBillDisplayName,
} from "@/lib/billMath";

export const CATEGORY_META = {
  household: { icon: "🏠", label: "Household" },
  subscription: { icon: "🔁", label: "Subscription" },
  work_side_project: { icon: "💼", label: "Work / side project" },
  vehicle: { icon: "🚗", label: "Vehicle" },
  debt: { icon: "💳", label: "Debt / repayment" },
  family: { icon: "🧒", label: "Children / family" },
  other: { icon: "📌", label: "Other" },
};

// Browser speech recognition commonly hears "Council Tax" as phrases such as
// "cancer tax" or "counsel tax". In the voice-bill context those phrases are
// unambiguous enough to clean before parsing and showing the review draft.
export function normaliseVoiceBillText(value) {
  return String(value || "")
    .replace(
      /\b(?:cance(?:r|l)?|cancel|counsel|council)\s+(?:tax(?:es)?|tacks?|tacx|attacks?)\b/gi,
      "Council Tax",
    )
    .replace(/\bwater\s*water\b/gi, "Wastewater")
    .replace(/\bhome\s+ins[a-z]*nce\b/gi, "Home insurance")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyBill(bill) {
  const raw = normaliseVoiceBillText(`${bill.name || ""} ${bill.description || ""}`).toLowerCase();

  function has(kw) {
    if (kw.length <= 3) {
      return new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(raw);
    }
    return raw.includes(kw);
  }

  function any(kws) { return kws.some(has); }

  if (any(["google workspace"])) return { category: "work_side_project", subCategory: "software_subscription", confidence: "medium", needsReview: true, reason: "google workspace" };

  if (any(["octopus", "british gas", "e.on", "edf", "ovo energy", "shell energy", "scottish power"])) return { category: "household", subCategory: "energy", confidence: "high", needsReview: false, reason: "energy supplier" };
  if (has("eon")) return { category: "household", subCategory: "energy", confidence: "high", needsReview: false, reason: "eon energy" };
  if (any(["electricity", "electric", "energy bill", "gas bill"])) return { category: "household", subCategory: "energy", confidence: "high", needsReview: false, reason: "energy keyword" };
  if (any(["energy", "gas", "electric"])) return { category: "household", subCategory: "energy", confidence: "medium", needsReview: false, reason: "energy keyword" };

  if (any(["southern water", "thames water", "severn trent", "united utilities", "yorkshire water", "affinity water", "south east water"])) return { category: "household", subCategory: "water", confidence: "high", needsReview: false, reason: "water supplier" };
  if (any(["wastewater", "waste water", "sewerage", "sewage", "drainage"])) return { category: "household", subCategory: "wastewater", confidence: "high", needsReview: false, reason: "wastewater keyword" };
  if (any(["water"])) return { category: "household", subCategory: "water", confidence: "medium", needsReview: false, reason: "water keyword" };

  if (any(["council tax", "council rates"])) return { category: "household", subCategory: "council_tax", confidence: "high", needsReview: false, reason: "council tax" };
  if (any(["council"])) return { category: "household", subCategory: "council_tax", confidence: "medium", needsReview: false, reason: "council keyword" };

  if (any(["broadband", "wifi", "wi-fi", "internet", "virgin media", "sky broadband", "talktalk", "plusnet", "vodafone broadband", "ee broadband"])) return { category: "household", subCategory: "broadband", confidence: "high", needsReview: false, reason: "broadband keyword" };
  if (has("bt")) return { category: "household", subCategory: "broadband", confidence: "medium", needsReview: false, reason: "bt broadband" };

  if (any(["home insurance", "contents insurance", "buildings insurance", "compare the market"])) return { category: "household", subCategory: "home_insurance", confidence: "high", needsReview: false, reason: "insurance keyword" };
  if (any(["aviva", "direct line", "admiral", "churchill"])) return { category: "household", subCategory: "home_insurance", confidence: "high", needsReview: false, reason: "insurance provider" };

  if (any(["mortgage", "landlord", "letting agent", "santander mortgage", "barclays mortgage"])) return { category: "household", subCategory: "rent_mortgage", confidence: "high", needsReview: false, reason: "mortgage/rent keyword" };
  if (any(["rent"])) return { category: "household", subCategory: "rent_mortgage", confidence: "high", needsReview: false, reason: "rent keyword" };
  if (any(["halifax", "nationwide"])) return { category: "household", subCategory: "rent_mortgage", confidence: "low", needsReview: true, reason: "bank could be mortgage" };

  if (any(["giffgaff", "lebara", "voxi"])) return { category: "household", subCategory: "mobile", confidence: "high", needsReview: false, reason: "mobile provider" };
  if (has("o2")) return { category: "household", subCategory: "mobile", confidence: "high", needsReview: false, reason: "o2 mobile" };
  if (any(["three mobile", "three network", "three sim"])) return { category: "household", subCategory: "mobile", confidence: "high", needsReview: false, reason: "three mobile" };
  if (any(["mobile", "phone plan", "sim plan", "sim only"])) return { category: "household", subCategory: "mobile", confidence: "medium", needsReview: false, reason: "mobile keyword" };
  if (has("ee")) return { category: "household", subCategory: "mobile", confidence: "medium", needsReview: true, reason: "ee could be mobile or broadband" };
  if (any(["vodafone"])) return { category: "household", subCategory: "mobile", confidence: "medium", needsReview: true, reason: "vodafone could be mobile or broadband" };

  if (any(["netflix"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "netflix" };
  if (any(["spotify"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "spotify" };
  if (any(["disney+", "disney plus", "disney"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "disney" };
  if (any(["youtube premium", "youtube music"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "youtube" };
  if (any(["amazon prime", "prime video"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "prime streaming" };
  if (any(["prime"])) return { category: "subscription", subCategory: "streaming", confidence: "high", needsReview: false, reason: "prime subscription" };

  if (any(["apple storage", "icloud"])) return { category: "subscription", subCategory: "cloud_storage", confidence: "high", needsReview: false, reason: "apple storage/icloud" };
  if (any(["apple"])) return { category: "subscription", subCategory: "cloud_storage", confidence: "high", needsReview: false, reason: "apple subscription" };

  if (any(["audible"])) return { category: "subscription", subCategory: "audiobook", confidence: "high", needsReview: false, reason: "audible" };
  if (any(["microsoft 365", "office 365"])) return { category: "subscription", subCategory: "software_subscription", confidence: "high", needsReview: false, reason: "microsoft 365" };
  if (any(["adobe", "canva", "figma"])) return { category: "subscription", subCategory: "software_subscription", confidence: "high", needsReview: false, reason: "software subscription" };
  if (any(["chatgpt", "openai"])) return { category: "subscription", subCategory: "software_subscription", confidence: "high", needsReview: false, reason: "ai subscription" };
  if (any(["puregym", "david lloyd", "anytime fitness"])) return { category: "subscription", subCategory: "gym", confidence: "high", needsReview: false, reason: "gym membership" };
  if (any(["gym", "fitness"])) return { category: "subscription", subCategory: "gym", confidence: "high", needsReview: false, reason: "gym keyword" };
  if (any(["amazon"])) return { category: "subscription", subCategory: "amazon_unknown", confidence: "low", needsReview: true, reason: "amazon (unclear type)" };

  if (any(["car insurance", "vehicle insurance", "motor insurance"])) return { category: "vehicle", subCategory: "car_insurance", confidence: "high", needsReview: false, reason: "vehicle insurance" };
  if (any(["dvla", "vehicle tax", "road tax", "mot"])) return { category: "vehicle", subCategory: "vehicle", confidence: "high", needsReview: false, reason: "vehicle keyword" };
  if (any(["car finance", "car loan", "parking", "congestion"])) return { category: "vehicle", subCategory: "vehicle", confidence: "medium", needsReview: false, reason: "vehicle keyword" };

  if (any(["credit card", "loan repayment", "personal loan", "barclaycard", "capital one", "klarna"])) return { category: "debt", subCategory: "loan", confidence: "high", needsReview: false, reason: "debt keyword" };
  if (any(["nursery", "childcare", "child maintenance", "school fees"])) return { category: "family", subCategory: "childcare", confidence: "high", needsReview: false, reason: "family keyword" };

  return { category: "other", subCategory: null, confidence: "low", needsReview: false, reason: "no match" };
}

export function isRecentlyAdded(bill) {
  if (!bill?.createdAt) return false;
  const t = typeof bill.createdAt.toMillis === "function"
    ? bill.createdAt.toMillis()
    : new Date(bill.createdAt).getTime();
  return Date.now() - t < 48 * 60 * 60 * 1000;
}

export function isPaidBill(bill) {
  return Boolean(bill?.paidThroughDate);
}

export function parseDueDayFromText(value) {
  if (!value) {
    return null;
  }

  const text = String(value).toLowerCase();
  const patterns = [
    /\b([1-9]|[12][0-9]|3[01])\s*(st|nd|rd|th)\b/,
    /\bmonthly\s+on\s+([1-9]|[12][0-9]|3[01])\b/,
    /\bdue\s+([1-9]|[12][0-9]|3[01])\b/,
    /\bon\s+the\s+([1-9]|[12][0-9]|3[01])\b/,
    /\b([1-9]|[12][0-9]|3[01])\s+(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      const day = Number(match[1]);

      if (day >= 1 && day <= 31) {
        return day;
      }
    }
  }

  return null;
}

export function scoreImportedBillQuality(bill) {
  let score = 0;
  if (bill.name && bill.name.trim().length >= 2) score += 1;
  if (Number.isFinite(Number(bill.amount)) && Number(bill.amount) > 0) score += 1;
  if (isValidDueDay(bill.dueDay) || parseDueDayFromText(bill.dateText || bill.rawText || "")) score += 1;
  if (bill.confidence && bill.confidence >= 0.75) score += 1;
  return score;
}

export function scoreAndClassifyBill(bill) {
  const score = scoreImportedBillQuality(bill);
  const hasName = Boolean(bill.name && bill.name.trim().length >= 2);
  const hasAmount = Number.isFinite(Number(bill.amount)) && Number(bill.amount) > 0;
  const shouldImport = score >= 3 || (score === 2 && hasName && hasAmount);

  if (shouldImport) {
    return { bill, shouldImport: true, skipReason: null };
  }

  let skipReason = "unreadable row";
  if (!hasName) skipReason = "missing name";
  else if (!hasAmount) skipReason = "missing amount";
  else skipReason = "low confidence";

  return { bill, shouldImport: false, skipReason };
}

export function billFingerprint(bill) {
  return [
    String(bill.name || "").trim().toLowerCase(),
    Number(bill.amount || 0).toFixed(2),
    Number(bill.dueDay || 0),
  ].join("|");
}

export function dedupeBillItems(items, existingBills) {
  const existingKeys = new Set(existingBills.map((bill) => billFingerprint(bill)));
  const seen = new Set();
  const toCreate = [];
  let skipped = 0;

  items.forEach((item) => {
    const key = billFingerprint(item);

    if (existingKeys.has(key) || seen.has(key)) {
      skipped += 1;
      return;
    }

    seen.add(key);
    toCreate.push(item);
  });

  return { toCreate, skipped };
}

export function mergeOutcomeBills(existingBills, parsed) {
  const nextBills = [...existingBills];
  const items = parsed.action === "batch" ? parsed.items || [] : [parsed];

  items.forEach((item) => {
    if (item.action !== "create_bill") {
      return;
    }

    if (nextBills.some((bill) => billFingerprint(bill) === billFingerprint(item))) {
      return;
    }

    nextBills.push(item);
  });

  return nextBills;
}

export function buildOutcomeMessage(parsed, outcome) {
  if (parsed.action === "unknown") {
    return parsed.responseMessage;
  }

  const hasDraftBill = Boolean(parsed?.needsDueDay);
  const parts = [];

  if (outcome.createdBills > 0) {
    if (hasDraftBill && outcome.createdBills === 1) {
      parts.push("Saved 1 bill draft.");
    } else {
      parts.push(
        outcome.createdBills === 1
          ? "Logged 1 new bill."
          : `Logged ${outcome.createdBills} new bills.`,
      );
    }
  }

  if (outcome.skippedBills > 0) {
    parts.push(
      outcome.skippedBills === 1
        ? "Skipped 1 duplicate."
        : `Skipped ${outcome.skippedBills} duplicates.`,
    );
  }

  if (outcome.savedIncome) {
    parts.push("Payday updated.");
  }

  if (parsed.responseMessage) {
    parts.push(parsed.responseMessage);
  }

  return parts.join(" ") || parsed.responseMessage;
}

export function buildBatchOutcomeMessage(outcome, sourceCount) {
  const parts = [];

  if (outcome.createdBills > 0) {
    parts.push(
      outcome.createdBills === 1
        ? "Imported 1 bill."
        : `Imported ${outcome.createdBills} bills.`,
    );
  }

  if (outcome.skippedBills > 0) {
    parts.push(
      outcome.skippedBills === 1
        ? "Skipped 1 duplicate."
        : `Skipped ${outcome.skippedBills} duplicates.`,
    );
  }

  if (outcome.savedIncome) {
    parts.push("Payday updated.");
  }

  if (sourceCount > 1 && parts.length) {
    parts.push(`Read across ${sourceCount} screenshots.`);
  }

  return parts.join(" ");
}

export function applyQuickAddContext(parsed, quickAddContext) {
  if (!quickAddContext?.name || !parsed) {
    return parsed;
  }

  const normalisedHintName = quickAddContext.name.trim().toLowerCase();

  const attachHint = (item) => {
    if (item?.action !== "create_bill") {
      return item;
    }

    const itemName = String(item.name || "").trim().toLowerCase();

    const matchesHint =
      itemName === normalisedHintName ||
      itemName.includes(normalisedHintName) ||
      normalisedHintName.includes(itemName);

    if (item.category || !matchesHint) {
      return item;
    }

    return {
      ...item,
      category: quickAddContext.category || "household",
    };
  };

  if (parsed.action === "batch") {
    return {
      ...parsed,
      items: (parsed.items || []).map(attachHint),
    };
  }

  return attachHint(parsed);
}

export function prettifySubCategory(value) {
  return String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function canonicalisePreviewBillName(name, classified) {
  if (/\s+[—-]\s+/.test(String(name || ""))) {
    return name;
  }

  const rawName = String(name || "");

  if (rawName.includes(" - ") || rawName.includes("â€”")) {
    return name;
  }

  const text = rawName.trim().toLowerCase();

  if (text.includes("electricity") || text.includes("water")) {
    return name;
  }

  if (!text) {
    return "";
  }

  const canonicalMap = [
    [/octopus/, "Octopus Energy"],
    [/british gas/, "British Gas"],
    [/\be\.?on\b/, "E.ON"],
    [/\bovo\b/, "OVO Energy"],
    [/shell energy/, "Shell Energy"],
    [/vodafone/, "Vodafone"],
    [/\bo2\b/, "O2"],
    [/\bee\b/, "EE"],
    [/giffgaff/, "giffgaff"],
  ];

  const matched = canonicalMap.find(([pattern]) => pattern.test(text));
  if (matched) {
    return matched[1];
  }

  if (!/[a-z]/i.test(text) && classified?.subCategory) {
    return prettifySubCategory(classified.subCategory);
  }

  if (classified?.subCategory && ["energy", "water", "wastewater", "council_tax", "broadband", "mobile"].includes(classified.subCategory)) {
    const genericNames = {
      energy: "Gas",
      water: "Water",
      wastewater: "Wastewater",
      council_tax: "Council Tax",
      broadband: "Broadband",
      mobile: "Mobile",
    };
    const plainWords = ["bill", "payment", "direct debit", "standing order"];
    if (plainWords.some((word) => text === word || text.includes(`${word} `))) {
      return genericNames[classified.subCategory];
    }
  }

  return name;
}

export function buildBillReviewDraft(item, { sourceText = "", quickAddContext = null, importJobId = "", importJobName = "", draftIndex = 0 } = {}) {
  if (!item?.name) {
    return null;
  }

  const resolvedName = sanitiseBillDisplayName(resolveBillTitle(item.name, sourceText));
  const splitName = splitBillDisplayName(resolvedName);
  const inferred = classifyBill({ name: resolvedName, description: sourceText });
  const canonicalName = sanitiseBillDisplayName(canonicalisePreviewBillName(resolvedName, inferred));

  return {
    id: `${importJobId || "draft"}-${draftIndex}-${canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "bill"}`,
    name: canonicalName,
    supplierName: splitName.supplierName || "",
    billName: splitName.billName || canonicalName,
    amount: Number.isFinite(Number(item.amount)) && Number(item.amount) > 0 ? Number(item.amount) : null,
    dueDay: isValidDueDay(item.dueDay) ? Number(item.dueDay) : null,
    frequency: item.frequency || "monthly",
    category: item.category || quickAddContext?.category || inferred.category || "other",
    subCategory: inferred.subCategory || null,
    confidence: Number(item.confidence ?? inferred.confidence ?? 0.65),
    sourceText: sourceText || "",
    sourceLabel: importJobName || "",
    missingFields: [
      ...(Number.isFinite(Number(item.amount)) && Number(item.amount) > 0 ? [] : ["amount"]),
      ...(isValidDueDay(item.dueDay) ? [] : ["dueDay"]),
    ],
  };
}

export function buildBillReviewDrafts(parsed, { sourceText = "", quickAddContext = null } = {}) {
  const items = parsed?.action === "batch" ? parsed.items || [] : [parsed];

  return items
    .filter((item) => item?.action === "create_bill")
    .map((item, index) => buildBillReviewDraft(item, {
      sourceText: item?.sourceText || item?.rawText || sourceText,
      quickAddContext,
      draftIndex: index,
    }))
    .filter(Boolean);
}

export function buildLooseBillReviewDraft(sourceText, quickAddContext) {
  const text = String(sourceText || "").trim();
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();
  const amountMatch = lower.match(/(?:£|\bgbp\b|\bpounds?\b|\bquid\b)\s*(\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)/i)
    || lower.match(/\b(\d{1,4}(?:\.\d{1,2})?)\s*(?:pounds?|quid)\b/i);
  const dueMatch = lower.match(/\b([12]?\d|3[01])(st|nd|rd|th)\b/i)
    || lower.match(/\b(?:on|due(?:\s+on)?|comes out)\s+(?:the\s+)?([12]?\d|3[01])\b/i);
  const roughName = text
    .replace(/(?:£|\bgbp\b|\bpounds?\b|\bquid\b)\s*\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?/gi, " ")
    .replace(/\b\d{1,5}(?:\.\d{1,2})?\b/g, " ")
    .replace(/\b(my|i|have|its|it's|that|this|comes out|comes|out|around|about|approximately|every|month|each|of|on|the|due)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!roughName) {
    return null;
  }

  return buildBillReviewDraft({
    action: "create_bill",
    name: roughName,
    amount: amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null,
    dueDay: dueMatch ? Number(dueMatch[1]) : null,
    frequency: "monthly",
    category: quickAddContext?.category || null,
    confidence: 0.52,
  }, { sourceText: text, quickAddContext });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getScrollBehavior() {
  if (typeof window === "undefined") return "smooth";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
}
