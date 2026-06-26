import { NextResponse } from "next/server";
import { formatGBP, formatOrdinal, normaliseEntityName } from "@/lib/billMath";

export const runtime = "nodejs";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000;
const MAX_IMAGE_COUNT = 8;

export async function POST(request) {
  const { message, imageDataUrls, imageNames, imageDataUrl, imageName } = await request.json().catch(() => ({}));

  const safeMessage = typeof message === "string" ? message : "";
  const safeImages = normaliseImageInputs({
    imageDataUrls,
    imageNames,
    imageDataUrl,
    imageName,
  });

  if (!safeMessage.trim() && !safeImages.length) {
    return NextResponse.json({
      action: "unknown",
      missingFields: ["message"],
      responseMessage: "Add a bill note, a screenshot, or a bill image and I'll read it.",
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

  if (safeImages.length > MAX_IMAGE_COUNT) {
    return NextResponse.json(
      {
        action: "unknown",
        responseMessage: `Add up to ${MAX_IMAGE_COUNT} images at a time for v1.`,
      },
      { status: 400 },
    );
  }

  if (safeImages.some((image) => !isSupportedImageDataUrl(image.dataUrl))) {
    return NextResponse.json(
      {
        action: "unknown",
        responseMessage: "That file does not look like a supported image. Try a PNG, JPG, WEBP, or GIF screenshot.",
      },
      { status: 400 },
    );
  }

  if (safeImages.some((image) => image.dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH)) {
    return NextResponse.json(
      {
        action: "unknown",
        responseMessage: "That image is a bit large for v1. Try a smaller screenshot or crop it first.",
      },
      { status: 400 },
    );
  }

  const quickParsed = safeImages.length ? null : parseQuickEntry(safeMessage);

  if (quickParsed) {
    return NextResponse.json(normaliseParsedResult(quickParsed, safeMessage));
  }

  try {
    const parsed = await parseMessageWithOpenAI({
      message: safeMessage,
      images: safeImages,
    });
    return NextResponse.json(normaliseParsedResult(parsed, safeMessage, safeImages.length > 0));
  } catch (error) {
    const openAiError = normaliseOpenAiError(error, safeImages.length > 0);

    if (openAiError) {
      return NextResponse.json(
        {
          action: "unknown",
          responseMessage: openAiError.message,
        },
        { status: openAiError.status },
      );
    }

    return NextResponse.json(
      {
        action: "unknown",
        responseMessage: buildClarifyingResponse(safeMessage, safeImages.length > 0),
      },
      { status: 502 },
    );
  }
}

async function parseMessageWithOpenAI({ message, images }) {
  const userContent = [];

  if (message?.trim()) {
    userContent.push({
      type: "text",
      text: message.trim(),
    });
  }

  if (images.length) {
    userContent.push({
      type: "text",
      text: [
        "Attached screenshots show scheduled payments or bills.",
        "Read all visible recurring rows across all screenshots.",
        "For v1, only return monthly GBP bills or a monthly payday when clearly shown.",
        "Ignore one-off items, paid-history rows, annual, quarterly, every 2 months, every 6 months, and unclear rows.",
        "If the same monthly bill appears in more than one screenshot, return it only once.",
      ].join(" "),
    });
    images.forEach((image, index) => {
      userContent.push({
        type: "text",
        text: image.name
          ? `Screenshot ${index + 1}: ${image.name}`
          : `Screenshot ${index + 1}`,
      });
      userContent.push({
        type: "image_url",
        image_url: {
          url: image.dataUrl,
        },
      });
    });
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
            "You parse natural language bill and payday messages for BillPilot.",
            "Return JSON only. Do not use markdown.",
            "Supported actions are create_bill, set_income, update_bill, mark_paid, unknown, and batch.",
            "For v1, only create_bill, set_income, and batch are supported.",
            "Monthly UK bills and monthly UK payday only.",
            "Use GBP by default. Use reminderOffsetDays 1 by default.",
            "If one message contains both bill and payday details, return action batch and items as an array of supported actions.",
            "For a bill, extract name, amount, dueDay, currency, frequency, reminderOffsetDays.",
            "For income/payday, extract name, amount, payDay, currency, frequency.",
            "If images are attached, read visible recurring payments and return one batch with all clear monthly bills.",
            "Do not invent amounts or due days. Ignore rows without both.",
            "Ignore duplicates across screenshots using name, amount, and due day.",
            "Ignore rows marked quarterly, every 2 months, every 6 months, yearly, annual, or last paid.",
            "If required information is missing, return action unknown, missingFields, and a calm responseMessage.",
          ].join(" "),
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`OpenAI parse failed with status ${response.status}`);

    error.status = response.status;
    error.responseText = errorText;
    throw error;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  return JSON.parse(content);
}

function normaliseParsedResult(parsed, message, hasImage = false) {
  if (parsed?.action === "batch") {
    const items = Array.isArray(parsed?.items)
      ? dedupeParsedItems(parsed.items.map(normaliseItem).filter(Boolean))
      : [];

    if (!items.length) {
      return {
        action: "unknown",
        missingFields: parsed?.missingFields || [],
        responseMessage:
          sanitiseAssistantMessage(parsed?.responseMessage) ||
          buildClarifyingResponse(message, hasImage),
      };
    }

    return {
      action: "batch",
      items,
      responseMessage:
        sanitiseAssistantMessage(parsed?.responseMessage) ||
        items.map((item) => item.responseMessage).join(" "),
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
      sanitiseAssistantMessage(parsed?.responseMessage) ||
      buildClarifyingResponse(message, hasImage),
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
      name: normaliseEntityName(item.name),
      amount: Number(item.amount),
      currency: item.currency || "GBP",
      frequency: "monthly",
      dueDay: Number(item.dueDay),
      reminderOffsetDays: Number(item.reminderOffsetDays ?? 1),
      responseMessage: `Logged. ${normaliseEntityName(item.name)} - ${formatGBP(item.amount)} - due on the ${formatOrdinal(item.dueDay)}. Reminder set for the day before.`,
    };
  }

  if (item?.action === "set_income") {
    const missingFields = getMissingFields(item, ["amount", "payDay"]);

    if (missingFields.length) {
      return missingResponse(missingFields);
    }

    return {
      action: "set_income",
      name: normaliseEntityName(item.name || "Payday"),
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

function buildClarifyingResponse(message = "", hasImage = false) {
  const text = message.toLowerCase();
  const amount = extractAmount(text);
  const day = extractOrdinalDay(text);
  const looksLikeBillName = extractCompactName(text);
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

  if (hasImage && !message.trim()) {
    return "I can see the screenshots, but I could not cleanly lift monthly bills from them yet. Add a short note like rent, broadband, or payday and I'll tighten it up.";
  }

  if (amount && day && !looksLikeBillName) {
    return "I can see the amount and day of month. What should I call this bill?";
  }

  if (looksLikeBillName && day && !amount) {
    return "I can see the bill name and day of month. What is the amount?";
  }

  if (looksLikeBillName && amount && !day) {
    return "I can see the bill name and amount. What day of month is it due?";
  }

  return "I can log bills and payday for now. Tell me the amount and the day it is due.";
}

function isSupportedImageDataUrl(value) {
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value);
}

function normaliseImageInputs({ imageDataUrls, imageNames, imageDataUrl, imageName }) {
  if (Array.isArray(imageDataUrls)) {
    return imageDataUrls
      .map((dataUrl, index) => ({
        dataUrl: typeof dataUrl === "string" ? dataUrl : "",
        name: Array.isArray(imageNames) && typeof imageNames[index] === "string"
          ? imageNames[index]
          : `image-${index + 1}.png`,
      }))
      .filter((image) => image.dataUrl);
  }

  if (typeof imageDataUrl === "string" && imageDataUrl) {
    return [{
      dataUrl: imageDataUrl,
      name: typeof imageName === "string" && imageName ? imageName : "image-1.png",
    }];
  }

  return [];
}

function dedupeParsedItems(items) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const key = item.action === "create_bill"
      ? buildBillKey(item)
      : item.action === "set_income"
        ? buildIncomeKey(item)
        : "";

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function buildBillKey(item) {
  return `bill:${normaliseEntityName(item.name).toLowerCase()}|${Number(item.amount).toFixed(2)}|${Number(item.dueDay)}`;
}

function buildIncomeKey(item) {
  return `income:${Number(item.amount).toFixed(2)}|${Number(item.payDay)}`;
}

function parseQuickEntry(message) {
  const trimmed = String(message || "").trim();

  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();

  if (looksLikeIncome(lower)) {
    const payDay = extractOrdinalDay(lower);
    const amount = extractAmount(lower);

    if (!payDay || !amount) {
      return null;
    }

    return {
      action: "set_income",
      name: "Payday",
      amount,
      currency: "GBP",
      frequency: "monthly",
      payDay,
    };
  }

  const dueDay = extractOrdinalDay(lower);
  const amount = extractAmount(lower);
  const name = extractCompactName(trimmed);

  if (!name || !amount || !dueDay) {
    return null;
  }

  return {
    action: "create_bill",
    name,
    amount,
    currency: "GBP",
    frequency: "monthly",
    dueDay,
    reminderOffsetDays: 1,
  };
}

function looksLikeIncome(text) {
  return (
    text.includes("payday") ||
    text.includes("paid on") ||
    text.includes("get paid") ||
    text.includes("my pay is")
  );
}

function extractAmount(text) {
  const currencyMatch = text.match(/(?:£|\bgbp\b|\bpounds?\b)\s*(\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)/i);

  if (currencyMatch) {
    return Number(currencyMatch[1].replace(/,/g, ""));
  }

  const candidates = [...text.matchAll(/\b(\d{2,5}(?:\.\d{1,2})?)\b/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

  return candidates.find((value) => value > 31) || null;
}

function extractOrdinalDay(text) {
  const ordinalMatch = text.match(/\b([12]?\d|3[01])(st|nd|rd|th)\b/i);

  if (ordinalMatch) {
    return Number(ordinalMatch[1]);
  }

  const dueMatch = text.match(/\bdue(?:\s+on)?(?:\s+the)?\s+([12]?\d|3[01])\b/i);

  if (dueMatch) {
    return Number(dueMatch[1]);
  }

  const onMatch = text.match(/\bon(?:\s+the)?\s+([12]?\d|3[01])\b/i);

  if (onMatch) {
    return Number(onMatch[1]);
  }

  return null;
}

function extractCompactName(text) {
  return normaliseEntityName(
    text
      .replace(/(?:£|\bgbp\b|\bpounds?\b)\s*\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?/gi, " ")
      .replace(/\b\d{1,5}(?:\.\d{1,2})?\b/g, " ")
      .replace(/\b([12]?\d|3[01])(st|nd|rd|th)\b/gi, " ")
      .replace(/\b(my|the|is|due|on|every|month|monthly|bill|please|log|it|get|paid|payday)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function sanitiseAssistantMessage(message) {
  if (!message) {
    return "";
  }

  if (/please provide/i.test(message) || /information is missing/i.test(message)) {
    return "";
  }

  return message;
}

function normaliseOpenAiError(error, hasImage) {
  const status = Number(error?.status) || 0;
  const responseText = String(error?.responseText || "");

  if (!status) {
    return null;
  }

  if (responseText.includes("Missing scopes: model.request")) {
    return {
      status: 502,
      message: hasImage
        ? "OpenAI blocked the screenshot read because this API key does not have model request permission. Use a project API key with `model.request` access, then try again."
        : "OpenAI blocked the parser because this API key does not have model request permission. Use a project API key with `model.request` access, then try again.",
    };
  }

  if (status === 401) {
    return {
      status: 502,
      message: "OpenAI rejected the API key. Check that `OPENAI_API_KEY` is valid for this project and model.",
    };
  }

  if (status === 429) {
    return {
      status: 502,
      message: "OpenAI is rate limiting this parser right now. Wait a moment and try again.",
    };
  }

  return {
    status: 502,
    message: "OpenAI could not read that just now. Check the model access on this API key and try again.",
  };
}
