import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const ALLOWED_STATES = new Set([
  "affordable_now",
  "affordable_by_due_date",
  "wait_until_payday",
  "unaffordable_by_due_date",
]);

export async function POST(request) {
  try {
    await verifyRequest(request);
    const body = await request.json().catch(() => ({}));
    const facts = normaliseFacts(body?.facts);

    if (!facts) {
      return NextResponse.json({ ok: false, error: "Invalid affordability facts." }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: true, explanation: null, nextAction: null, fallback: true });
    }

    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Explain a deterministic ClearTill Large Cost affordability plan in calm plain English.",
              "Return JSON with explanation and nextAction strings only.",
              "All arithmetic and dates are already final facts.",
              "Do not calculate, change, round, omit, or contradict any amount, date, allocation, state, or shortfall.",
              "Do not invent income or balances. If there is a shortfall, state it directly.",
              "Keep the explanation under 80 words and the action under 20 words.",
            ].join(" "),
          },
          { role: "user", content: JSON.stringify(facts) },
        ],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ ok: true, explanation: null, nextAction: null, fallback: true });
    }

    const payload = await response.json().catch(() => ({}));
    const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "{}");

    return NextResponse.json({
      ok: true,
      explanation: safeExplanation(parsed?.explanation, facts),
      nextAction: cleanText(parsed?.nextAction, 160),
      fallback: false,
    });
  } catch (error) {
    if (String(error?.code || "").startsWith("auth/")) {
      return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
    }
    // The deterministic client explanation is the product fallback. An AI
    // outage must never block or alter the affordability result.
    return NextResponse.json({ ok: true, explanation: null, nextAction: null, fallback: true });
  }
}

async function verifyRequest(request) {
  const match = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    const error = new Error("Unauthorized");
    error.code = "auth/missing-id-token";
    throw error;
  }
  try {
    return await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    const error = new Error("Unauthorized");
    error.code = "auth/invalid-id-token";
    throw error;
  }
}

function normaliseFacts(value) {
  if (!value || !ALLOWED_STATES.has(value.affordabilityState)) return null;
  const amountKeys = [
    "totalCost",
    "savingsContribution",
    "currentBalanceContribution",
    "currentPeriodAllocation",
    "safeDailyAmountBefore",
    "safeDailyAmountAfter",
    "shortfall",
  ];
  const facts = {
    dueDate: String(value.dueDate || "").slice(0, 10),
    daysUntilDue: Math.max(0, Number(value.daysUntilDue) || 0),
    futurePeriodAllocations: Array.isArray(value.futurePeriodAllocations)
      ? value.futurePeriodAllocations.slice(0, 24).map((entry) => ({
        periodStart: String(entry?.periodStart || "").slice(0, 10),
        periodEnd: String(entry?.periodEnd || "").slice(0, 10),
        amount: Number(entry?.amount) || 0,
      }))
      : [],
    affordabilityState: value.affordabilityState,
  };
  for (const key of amountKeys) facts[key] = Number(value[key]) || 0;
  return facts;
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength) || null;
}

function safeExplanation(value, facts) {
  const text = cleanText(value, 500);
  if (!text || /[£$€\d]/.test(text)) return null;
  const lower = text.toLowerCase();
  if (facts.affordabilityState === "unaffordable_by_due_date") {
    if (!lower.includes("shortfall") && !lower.includes("not affordable")) return null;
    if (/\bcan cover\b|\baffordable\b/.test(lower.replace("not affordable", ""))) return null;
  } else if (/not affordable|shortfall|cannot cover|can't cover/.test(lower)) {
    return null;
  }
  if (facts.affordabilityState === "wait_until_payday" && !lower.includes("payday")) return null;
  return text;
}
