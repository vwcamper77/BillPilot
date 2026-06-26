import { NextResponse } from "next/server";
import { formatGBP, formatOrdinal } from "@/lib/billMath";

export const runtime = "nodejs";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

export async function POST(request) {
  const { message } = await request.json().catch(() => ({}));

  if (!message || typeof message !== "string") {
    return NextResponse.json({
      action: "unknown",
      missingFields: ["message"],
      responseMessage: "I can log that, but I need the bill or payday details.",
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        action: "unknown",
        responseMessage: "OpenAI is not configured yet. Add OPENAI_API_KEY and try again.",
      },
      { status: 500 },
    );
  }

  try {
    const parsed = await parseMessageWithOpenAI(message);
    return NextResponse.json(normaliseParsedResult(parsed, message));
  } catch {
    return NextResponse.json(
      {
        action: "unknown",
        responseMessage: buildClarifyingResponse(message),
      },
      { status: 502 },
    );
  }
}

async function parseMessageWithOpenAI(message) {
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
            "You parse natural language bill and payday messages for BillPilot.",
            "Return JSON only. Do not use markdown.",
            "Supported actions are create_bill, set_income, update_bill, mark_paid, unknown, and batch.",
            "For v1, only create_bill, set_income, and batch are supported.",
            "Monthly UK bills and monthly UK payday only.",
            "Use GBP by default. Use reminderOffsetDays 1 by default.",
            "If one message contains both bill and payday details, return action batch and items as an array of supported actions.",
            "For a bill, extract name, amount, dueDay, currency, frequency, reminderOffsetDays.",
            "For income/payday, extract name, amount, payDay, currency, frequency.",
            "If required information is missing, return action unknown, missingFields, and a calm responseMessage.",
          ].join(" "),
        },
        {
          role: "user",
          content: message,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI parse failed with status ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  return JSON.parse(content);
}

function normaliseParsedResult(parsed, message) {
  if (parsed?.action === "batch") {
    const items = Array.isArray(parsed?.items)
      ? parsed.items.map(normaliseItem).filter(Boolean)
      : [];

    if (!items.length) {
      return {
        action: "unknown",
        missingFields: parsed?.missingFields || [],
        responseMessage:
          parsed?.responseMessage ||
          buildClarifyingResponse(message),
      };
    }

    return {
      action: "batch",
      items,
      responseMessage: parsed?.responseMessage || items.map((item) => item.responseMessage).join(" "),
    };
  }

  const item = normaliseItem(parsed);

  if (item) {
    return item;
  }

  return {
    action: "unknown",
    missingFields: parsed?.missingFields || [],
    responseMessage:
      parsed?.responseMessage ||
      buildClarifyingResponse(message),
  };
}

function normaliseItem(item) {
  if (item?.action === "create_bill") {
    const missingFields = getMissingFields(item, ["name", "amount", "dueDay"]);

    if (missingFields.length) {
      return missingResponse(missingFields);
    }

    return {
      action: "create_bill",
      name: String(item.name),
      amount: Number(item.amount),
      currency: item.currency || "GBP",
      frequency: "monthly",
      dueDay: Number(item.dueDay),
      reminderOffsetDays: Number(item.reminderOffsetDays ?? 1),
      responseMessage: `Logged. ${item.name} - ${formatGBP(item.amount)} - due on the ${formatOrdinal(item.dueDay)}. Reminder set for the day before.`,
    };
  }

  if (item?.action === "set_income") {
    const missingFields = getMissingFields(item, ["amount", "payDay"]);

    if (missingFields.length) {
      return missingResponse(missingFields);
    }

    return {
      action: "set_income",
      name: item.name || "Payday",
      amount: Number(item.amount),
      currency: item.currency || "GBP",
      frequency: "monthly",
      payDay: Number(item.payDay),
      responseMessage: `Logged. Payday is the ${formatOrdinal(item.payDay)}. I'll show what is due before then.`,
    };
  }

  return null;
}

function getMissingFields(parsed, fields) {
  return fields.filter((field) => {
    const value = parsed?.[field];
    return value === undefined || value === null || value === "";
  });
}

function missingResponse(missingFields) {
  return {
    action: "unknown",
    missingFields,
    responseMessage: `I can log that, but I need ${formatMissingFields(missingFields)}.`,
  };
}

function formatMissingFields(fields) {
  if (fields.length === 1) {
    return `the ${fieldLabel(fields[0])}`;
  }

  const labels = fields.map(fieldLabel);
  return `the ${labels.slice(0, -1).join(", ")} and the ${labels.at(-1)}`;
}

function fieldLabel(field) {
  return {
    amount: "amount",
    dueDay: "day it is due",
    payDay: "payday",
    name: "name",
    message: "message",
  }[field] || field;
}

function buildClarifyingResponse(message = "") {
  const text = message.toLowerCase();
  const soundsTemporary =
    text.includes("until") ||
    text.includes("then") ||
    text.includes("first month") ||
    text.includes("for the months") ||
    text.includes("every month until") ||
    text.includes("february");

  if (soundsTemporary) {
    return "I can log that, but this sounds like a temporary or stepped bill. What should I call it, how many months does it run for, and is the first month a different amount?";
  }

  return "I can log bills and payday for now. Tell me the amount and the day it is due.";
}
