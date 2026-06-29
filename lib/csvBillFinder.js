// Pure client-side CSV parsing and recurring bill detection.
// No external dependencies. No data leaves the browser.

const DATE_COLS = [
  "date", "transaction date", "posted date", "value date", "trans date",
  "transaction_date", "posting date", "booking date", "effective date",
];
const DESC_COLS = [
  "description", "merchant", "name", "payee", "details", "narrative",
  "reference", "memo", "particulars", "transaction description",
  "transaction details", "merchant name", "payment details", "beneficiary",
];
const AMOUNT_COLS = [
  "amount", "transaction amount", "value", "net amount", "sum",
];
const DEBIT_COLS = [
  "debit", "money out", "debit amount", "withdrawals", "out",
  "payment out", "payments out", "debit (gbp)", "debit(£)", "money out (£)",
  "paid out", "spent",
];
const CREDIT_COLS = [
  "credit", "money in", "credit amount", "deposits", "in",
  "payment in", "payments in", "credit (gbp)", "credit(£)", "money in (£)",
  "paid in", "received",
];

// Day-to-day spend: recurring patterns here get "low" confidence
const DAY_TO_DAY = [
  "tesco", "sainsbury", "asda", "morrisons", "waitrose", "lidl", "aldi",
  "co-op", "coop", "marks & spencer", "m&s food", "iceland food", "spar",
  "budgens", "costco", "whole foods", "ocado",
  "shell", "bp ", " bp", "texaco", "esso", "total petrol",
  "mcdonald", "kfc", "burger king", "subway", "pizza hut", "domino",
  "costa coffee", "starbucks", "caffe nero", "pret a manger", "pret ",
  "gregg", "nando", "wagamama", "five guys", "tim horton",
  "cash withdrawal", "cashpoint", "atm withdrawal", "cash machine",
  "paypal", "amazon.co", "amazon ", "ebay", "etsy", "asos",
  "deliveroo", "just eat", "uber eats", "stuart delivery",
  "wetherspoon", "greene king", "mitchells", "stonegate",
  "apple pay", "google pay",
];

// Noise patterns to strip from descriptions for grouping
const NOISE_RE = /\b(payment|direct debit|dd|standing order|so|ref|reference|inv|invoice|transaction|purchase|pos|card|contactless|online|internet)\b/gi;
const LONG_NUM_RE = /\b\d{5,}\b/g;
const SHORT_NUM_RE = /\b\d{1,4}\b/g;
const PUNCT_RE = /[*_\/\\|#@<>[\]{}()]+/g;

const MONTHS_SHORT = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseCSVText(text) {
  const clean = text.replace(/^﻿/, ""); // strip BOM
  const rows = [];
  let row = [];
  let field = "";
  let inQuote = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = "";
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && next === '\n') i++;
        row.push(field.trim());
        field = "";
        if (row.some((f) => f !== "")) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }

  // Last field / row
  row.push(field.trim());
  if (row.some((f) => f !== "")) rows.push(row);

  return rows;
}

function normaliseHeader(h) {
  return (h || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function detectColumns(rawHeaders) {
  const headers = rawHeaders.map(normaliseHeader);

  function find(candidates) {
    for (const c of candidates) {
      const exact = headers.indexOf(c);
      if (exact >= 0) return exact;
    }
    // Partial match (header contains candidate or vice-versa)
    for (const c of candidates) {
      const partial = headers.findIndex((h) => h.includes(c) || c.includes(h));
      if (partial >= 0) return partial;
    }
    return -1;
  }

  return {
    dateCol: find(DATE_COLS),
    descCol: find(DESC_COLS),
    amountCol: find(AMOUNT_COLS),
    debitCol: find(DEBIT_COLS),
    creditCol: find(CREDIT_COLS),
  };
}

function parseDate(str) {
  if (!str) return null;
  const s = str.trim();

  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (prefer UK)
  const numericDate = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (numericDate) {
    let [, a, b, c] = numericDate;
    const year = c.length === 2 ? (Number(c) > 50 ? `19${c}` : `20${c}`) : c;
    const day = Number(a) > 12 ? a : a; // if a > 12 must be DD; assume DD/MM
    const month = Number(a) > 12 ? b : b;
    return `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  }

  // "1 Jan 2024" or "Jan 1, 2024"
  const textA = s.match(/^(\d{1,2})\s+([a-z]{3,})\s+(\d{4})$/i);
  if (textA) {
    const [, day, mon, year] = textA;
    const m = MONTHS_SHORT[mon.slice(0, 3).toLowerCase()];
    if (m) return `${year}-${String(m).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  }
  const textB = s.match(/^([a-z]{3,})\s+(\d{1,2})[,\s]+(\d{4})$/i);
  if (textB) {
    const [, mon, day, year] = textB;
    const m = MONTHS_SHORT[mon.slice(0, 3).toLowerCase()];
    if (m) return `${year}-${String(m).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  }

  return null;
}

function parseAmount(str) {
  if (!str || str.trim() === "") return null;
  const s = str.trim().replace(/[£$€,\s]/g, "");
  if (!s) return null;
  // Parentheses = negative: (100.00) = -100
  if (s.startsWith("(") && s.endsWith(")")) {
    const n = parseFloat(s.slice(1, -1));
    return Number.isFinite(n) ? -Math.abs(n) : null;
  }
  if (/DR$/i.test(s)) {
    const n = parseFloat(s.replace(/DR$/i, ""));
    return Number.isFinite(n) ? -Math.abs(n) : null;
  }
  if (/CR$/i.test(s)) {
    const n = parseFloat(s.replace(/CR$/i, ""));
    return Number.isFinite(n) ? Math.abs(n) : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function cleanMerchantKey(raw) {
  return (raw || "")
    .toLowerCase()
    .replace(NOISE_RE, " ")
    .replace(LONG_NUM_RE, " ")
    .replace(SHORT_NUM_RE, " ")
    .replace(PUNCT_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isDayToDay(cleanedKey) {
  return DAY_TO_DAY.some((p) => cleanedKey.includes(p));
}

function daysBetween(isoA, isoB) {
  return Math.round((new Date(isoB) - new Date(isoA)) / 86400000);
}

function classifyFrequency(avgDays) {
  if (avgDays >= 6 && avgDays <= 8) return "weekly";
  if (avgDays >= 13 && avgDays <= 16) return "fortnightly";
  if (avgDays >= 25 && avgDays <= 35) return "monthly";
  return null;
}

function nextExpectedDate(lastIso, frequency) {
  const d = new Date(lastIso);
  if (frequency === "weekly") {
    d.setDate(d.getDate() + 7);
  } else if (frequency === "fortnightly") {
    d.setDate(d.getDate() + 14);
  } else {
    // monthly: add one month
    const originalDay = d.getDate();
    d.setMonth(d.getMonth() + 1);
    // Clamp to end of month if needed (e.g. Jan 31 → Feb 28)
    if (d.getDate() !== originalDay) d.setDate(0);
  }
  return d.toISOString().slice(0, 10);
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function mode(values) {
  const counts = new Map();
  let maxCount = 0;
  let modeVal = values[0];
  for (const v of values) {
    const count = (counts.get(v) || 0) + 1;
    counts.set(v, count);
    if (count > maxCount) { maxCount = count; modeVal = v; }
  }
  return modeVal;
}

// ─── main export ──────────────────────────────────────────────────────────────

export function analyseCsvText(text) {
  let rows;
  try {
    rows = parseCSVText(text);
  } catch {
    return { error: "parse_failed", suggestions: [] };
  }

  if (rows.length < 2) return { error: "too_few_rows", suggestions: [] };

  const headers = rows[0];
  const cols = detectColumns(headers);

  if (cols.dateCol < 0 || cols.descCol < 0) {
    return { error: "no_columns", suggestions: [] };
  }

  // Need at least one amount source
  const hasAmount = cols.amountCol >= 0;
  const hasDebitCredit = cols.debitCol >= 0;
  if (!hasAmount && !hasDebitCredit) {
    return { error: "no_columns", suggestions: [] };
  }

  // Parse transactions
  const transactions = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rawDate = r[cols.dateCol] || "";
    const rawDesc = r[cols.descCol] || "";
    const dateIso = parseDate(rawDate);
    if (!dateIso || !rawDesc.trim()) continue;

    let amount;
    if (hasAmount) {
      amount = parseAmount(r[cols.amountCol]);
    } else {
      // Debit column = outgoing (we want negative)
      const debitVal = parseAmount(r[cols.debitCol]);
      if (debitVal !== null && debitVal > 0) {
        amount = -debitVal; // mark as outgoing
      } else {
        continue; // skip credit/incoming rows
      }
    }

    if (amount === null || amount >= 0) continue; // only outgoing (negative)

    transactions.push({
      dateIso,
      description: rawDesc.trim(),
      amount: Math.abs(amount),
    });
  }

  if (transactions.length === 0) {
    return { error: "no_transactions", suggestions: [] };
  }

  // Only keep last 90 days of transactions
  const dates = transactions.map((t) => t.dateIso).sort();
  const latestDate = dates[dates.length - 1];
  const cutoffDate = (() => {
    const d = new Date(latestDate);
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  })();
  const recent = transactions.filter((t) => t.dateIso >= cutoffDate);

  if (recent.length === 0) {
    return { suggestions: [] };
  }

  // Group by cleaned merchant key
  const groups = new Map();
  for (const tx of recent) {
    const key = cleanMerchantKey(tx.description);
    if (!key || key.length < 2) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }

  const suggestions = [];

  for (const [key, txs] of groups) {
    if (txs.length < 2) continue;

    const sorted = txs.slice().sort((a, b) => a.dateIso.localeCompare(b.dateIso));

    // Intervals between consecutive transactions
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i - 1].dateIso, sorted[i].dateIso));
    }
    const avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length;
    const frequency = classifyFrequency(avgInterval);
    if (!frequency) continue;

    // Amount variance check (allow up to 10%)
    const amounts = sorted.map((t) => t.amount);
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const maxAmount = Math.max(...amounts);
    const minAmount = Math.min(...amounts);
    const amountVariance = avgAmount > 0 ? (maxAmount - minAmount) / avgAmount : 1;
    if (amountVariance > 0.1) continue;

    const dayToDay = isDayToDay(key);
    let confidence;
    if (dayToDay) {
      // Day-to-day: only show as low confidence
      if (txs.length >= 3 && amountVariance < 0.02) {
        confidence = "low";
      } else {
        continue; // skip weak day-to-day patterns entirely
      }
    } else if (txs.length >= 3 && amountVariance < 0.05) {
      confidence = "high";
    } else {
      confidence = "medium";
    }

    // Usual payment day (mode of day-of-month)
    const dayNums = sorted.map((t) => Number(t.dateIso.split("-")[2]));
    const usualPaymentDay = mode(dayNums);

    // Best display name: most common raw description in the group
    const descCounts = new Map();
    for (const t of sorted) {
      const d = t.description;
      descCounts.set(d, (descCounts.get(d) || 0) + 1);
    }
    const rawName = [...descCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // Clean the display name: remove obvious noise but keep recognisable words
    const displayName = toTitleCase(
      rawName
        .toLowerCase()
        .replace(NOISE_RE, " ")
        .replace(LONG_NUM_RE, " ")
        .replace(PUNCT_RE, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );

    const lastTx = sorted[sorted.length - 1];

    suggestions.push({
      id: key,
      merchantName: displayName || toTitleCase(key),
      cleanedKey: key,
      averageAmount: Math.round(avgAmount * 100) / 100,
      frequency,
      usualPaymentDay,
      lastPaidDate: lastTx.dateIso,
      nextExpectedDate: nextExpectedDate(lastTx.dateIso, frequency),
      confidence,
      detectedTransactionsCount: txs.length,
    });
  }

  // Sort: high → medium → low, then by amount descending
  const CONF_ORDER = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => {
    const cd = CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence];
    if (cd !== 0) return cd;
    return b.averageAmount - a.averageAmount;
  });

  return { suggestions };
}
