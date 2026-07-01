import path from "node:path";
import { NextResponse } from "next/server";
import { recognize } from "tesseract.js";
import { formatGBP, formatOrdinal, isValidDueDay, normaliseBillName, normaliseEntityName } from "@/lib/billMath";

export const runtime = "nodejs";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000;
const MAX_IMAGE_COUNT = 8;
const TESSERACT_WORKER_PATH = path.join(
  process.cwd(),
  "node_modules",
  "tesseract.js",
  "src",
  "worker-script",
  "node",
  "index.js",
);

export async function POST(request) {
  const contentType = request.headers.get("content-type") || "";
  const isMultipartImageImport = contentType.includes("multipart/form-data");
  let message;
  let imageDataUrls;
  let imageNames;
  let imageDataUrl;
  let imageName;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("image");

    message = form?.get("message") || "";

    if (file instanceof File) {
      imageDataUrl = await fileToDataUrl(file);
      imageName = file.name;
    }
  } else {
    ({ message, imageDataUrls, imageNames, imageDataUrl, imageName } = await request.json().catch(() => ({})));
  }

  const safeMessage = typeof message === "string" ? message : "";
  const safeImages = normaliseImageInputs({
    imageDataUrls,
    imageNames,
    imageDataUrl,
    imageName,
  });

  if (!safeMessage.trim() && !safeImages.length) {
    return NextResponse.json(
      isMultipartImageImport
        ? buildImageImportFailure("Add a screenshot or bill image and I'll read it.")
        : {
          action: "unknown",
          missingFields: ["message"],
          responseMessage: "Add a bill note, a screenshot, or a bill image and I'll read it.",
        },
      { status: isMultipartImageImport ? 400 : 200 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      isMultipartImageImport
        ? buildImageImportFailure("OpenAI is not configured yet. Add OPENAI_API_KEY and try again.")
        : {
          action: "unknown",
          responseMessage: "OpenAI is not configured yet. Add OPENAI_API_KEY and try again.",
        },
      { status: 500 },
    );
  }

  if (safeImages.length > MAX_IMAGE_COUNT) {
    return NextResponse.json(
      isMultipartImageImport
        ? buildImageImportFailure(`Add up to ${MAX_IMAGE_COUNT} images at a time for v1.`)
        : {
          action: "unknown",
          responseMessage: `Add up to ${MAX_IMAGE_COUNT} images at a time for v1.`,
        },
      { status: 400 },
    );
  }

  if (safeImages.some((image) => !isSupportedImageDataUrl(image.dataUrl))) {
    return NextResponse.json(
      isMultipartImageImport
        ? buildImageImportFailure("That file does not look like a supported image. Try a PNG, JPG, WEBP, or GIF screenshot.")
        : {
          action: "unknown",
          responseMessage: "That file does not look like a supported image. Try a PNG, JPG, WEBP, or GIF screenshot.",
        },
      { status: 400 },
    );
  }

  if (safeImages.some((image) => image.dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH)) {
    return NextResponse.json(
      isMultipartImageImport
        ? buildImageImportFailure("That image is a bit large for v1. Try a smaller screenshot or crop it first.")
        : {
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
    if (isMultipartImageImport) {
      const imageResult = await parseImageImportWithOpenAI({
        message: safeMessage,
        image: safeImages[0],
      });
      let bills = imageResult?.bills || [];
      let ocrInsight = null;

      if (bills.length <= 1) {
        ocrInsight = await collectOcrInsights(safeImages).catch(() => null);
        bills = mergeImageImportBills(bills, ocrInsight?.bills || []);

        if (bills.length === 1 && (ocrInsight?.amountHintCount || 0) > 1) {
          console.warn("[api/parse] possible under-extraction: multiple amounts found but only one bill returned");
        }
      }

      if (bills.length) {
        return NextResponse.json(buildImageImportSuccess(bills), { status: 200 });
      }

      return NextResponse.json(
        buildImageImportFailure(imageResult?.error || "Could not read this screenshot."),
        { status: 200 },
      );
    }

    const parsed = await parseMessageWithOpenAI({
      message: safeMessage,
      images: safeImages,
    });
    const normalised = normaliseParsedResult(parsed, safeMessage, safeImages.length > 0);

    if (safeImages.length && normalised.action === "unknown") {
      const ocrFallback = await parseImagesWithOcr(safeImages);

      if (ocrFallback) {
        if (isMultipartImageImport) {
          return NextResponse.json(buildImageImportResponse(ocrFallback), { status: 200 });
        }
        return NextResponse.json(ocrFallback);
      }

      if (isMultipartImageImport) {
        return NextResponse.json(
          buildImageImportFailure(normalised.responseMessage || "Could not read this screenshot."),
          { status: 200 },
        );
      }
    }

    if (isMultipartImageImport) {
      return NextResponse.json(
        buildImageImportFailure(normalised.responseMessage || "Could not read this screenshot."),
        { status: 200 },
      );
    }

    return NextResponse.json(normalised);
  } catch (error) {
    if (safeImages.length) {
      const ocrFallback = await parseImagesWithOcr(safeImages).catch(() => null);

      if (ocrFallback) {
        if (isMultipartImageImport) {
          return NextResponse.json(buildImageImportResponse(ocrFallback), { status: 200 });
        }
        return NextResponse.json(ocrFallback);
      }
    }

    const openAiError = normaliseOpenAiError(error, safeImages.length > 0);

    if (openAiError) {
      if (isMultipartImageImport) {
        return NextResponse.json(buildImageImportFailure(openAiError.message), { status: openAiError.status || 200 });
      }
      return NextResponse.json(
        {
          action: "unknown",
          responseMessage: openAiError.message,
        },
        { status: openAiError.status },
      );
    }

    return NextResponse.json(
      isMultipartImageImport
        ? buildImageImportFailure("Could not read this screenshot.")
        : {
          action: "unknown",
          responseMessage: buildClarifyingResponse(safeMessage, safeImages.length > 0),
        },
      { status: isMultipartImageImport ? 200 : 502 },
    );
  }
}

async function fileToDataUrl(file) {
  const bytes = Buffer.from(await file.arrayBuffer());
  return `data:${file.type || "image/jpeg"};base64,${bytes.toString("base64")}`;
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
            "You parse natural language bill and payday messages for Billie.",
            "Return JSON only. Do not use markdown.",
            "Supported actions are create_bill, set_income, update_bill, mark_paid, unknown, and batch.",
            "For v1, only create_bill, set_income, and batch are supported.",
            "Monthly UK bills and monthly UK payday only.",
            "Use GBP by default. Use reminderOffsetDays 1 by default.",
            "If one message contains both bill and payday details, return action batch and items as an array of supported actions.",
            "For a bill, extract name, amount, dueDay, currency, frequency, reminderOffsetDays.",
            "For income/payday, extract name, amount, payDay, currency, frequency.",
            "Bill names must contain only the merchant or bill name.",
            "Do not include recurrence words, date words, or payment timing words in bill names.",
            "Remove words or phrases like each, monthly, month, every month, each month, due, on, the, per month, on the 27th, and of each month from the bill name.",
            "Extract a recurring bill from this messy user input. Return only JSON. Do not use filler words as the bill name.",
            "Prefer a known supplier if present. If no supplier is present, use the utility type such as Gas, Electricity, Water, Council tax, Broadband, Mobile.",
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

async function parseImageImportWithOpenAI({ message, image }) {
  const userContent = [
    {
      type: "text",
      text: [
        "You are reading a screenshot of bills, direct debits, payments, subscriptions, or upcoming charges.",
        "Extract every visible bill/payment row from the screenshot.",
        "Do not stop after the first item.",
        "Return all rows you can read.",
        "If a row contains a name and an amount, include it even if the due date is uncertain.",
        "If the date is visible, extract the due day/month.",
        "For every visible bill/payment row, extract the date from the same row.",
        "The date may look like: 1st, 2nd, 13th, 22nd, Monthly on 13th, Due 13 Jul, 13 July, on the 20th of each month.",
        "If a date is visible in the row, dueDay must be a number from 1 to 31.",
        "If the date is not visible, set dueDay to null and dateText to the visible text or null.",
        "Examples of list rows include: BT £31.99 - 13th, OpenAI £43.20 - 14th, Sendinblue £4.27 - 16th, Canva £18 - 19th.",
        "Return strict JSON only.",
      ].join(" "),
    },
  ];

  if (message?.trim()) {
    userContent.push({
      type: "text",
      text: `Extra user note: ${message.trim()}`,
    });
  }

  userContent.push({
    type: "image_url",
    image_url: {
      url: image.dataUrl,
    },
  });

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
            "You extract bill rows from screenshots for Billie.",
            "Return JSON only.",
            "Use this exact shape: {\"bills\":[{\"name\":\"BT\",\"amount\":31.99,\"currency\":\"GBP\",\"dueDay\":13,\"dateText\":\"13th\",\"rawText\":\"BT £31.99 - 13th\",\"confidence\":0.9}]}",
            "All image import rows must be inside bills: [].",
            "Do not return top-level name, amount, dueDay, action, or batch fields for image imports.",
            "Return every visible bill row you can read, not just the first one.",
            "For every row, extract the date from that same row whenever it is visible.",
            "Bill names must contain only the merchant or bill name.",
            "Do not include recurrence words, date words, or payment timing words in bill names.",
            "If a date is visible, dueDay must be a number from 1 to 31.",
            "If you are uncertain, keep the visible date string in dateText and rawText so the client can repair it.",
            "Include rows with name and amount even when dueDay is uncertain; set dueDay null in that case.",
            "Use GBP by default.",
            "Ignore yearly, annual, every 2 months, every 6 months, quarterly, and last paid rows when clearly labelled that way.",
            "Extract all visible rows but do not invent missing values. If a row has a name but no visible amount, return it with amount null and confidence 0.3.",
            "If a row has amount but no visible date, set dueDay null and dateText null.",
            "The client will decide whether to import or skip each row based on quality.",
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
  const parsed = JSON.parse(content);
  const bills = normaliseImageImportBills(parsed?.bills);

  return {
    ok: bills.length > 0,
    mode: "image_import",
    bills,
    error: bills.length ? null : "Could not read this screenshot.",
  };
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
      if (
        item.name &&
        (
          (item.amount !== undefined && item.amount !== null && item.amount !== "")
          || (item.dueDay !== undefined && item.dueDay !== null && item.dueDay !== "")
        )
      ) {
        const cleanedName = normaliseBillName(item.name);
        const responseMessage = missingFields.includes("amount") && missingFields.includes("dueDay")
          ? "I found the bill name, but need the amount and due date."
          : missingFields.includes("amount")
            ? "I found the bill name and due date, but need the amount."
            : "I found the bill name and amount, but need the due date.";

        return {
          action: "create_bill",
          name: cleanedName,
          amount: item.amount === undefined || item.amount === null || item.amount === "" ? null : Number(item.amount),
          currency: item.currency || "GBP",
          frequency: "monthly",
          dueDay: item.dueDay === undefined || item.dueDay === null || item.dueDay === "" ? null : Number(item.dueDay),
          reminderOffsetDays: Number(item.reminderOffsetDays ?? 1),
          needsReview: true,
          missingFields,
          confidence: Number(item.confidence ?? 0.6),
          sourceText: item.rawText || "",
          responseMessage,
        };
      }

      return missingResponse(missingFields);
    }

    const cleanedName = normaliseBillName(item.name);

    return {
      action: "create_bill",
      name: cleanedName,
      amount: Number(item.amount),
      currency: item.currency || "GBP",
      frequency: "monthly",
      dueDay: Number(item.dueDay),
      reminderOffsetDays: Number(item.reminderOffsetDays ?? 1),
      confidence: Number(item.confidence ?? 0.85),
      sourceText: item.rawText || "",
      needsReview: false,
      responseMessage: `Logged. ${cleanedName} - ${formatGBP(item.amount)} - due on the ${formatOrdinal(item.dueDay)}. Reminder set for the day before.`,
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
  return `bill:${normaliseBillName(item.name).toLowerCase()}|${Number(item.amount).toFixed(2)}|${Number(item.dueDay)}`;
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

  if (!name || (!amount && !dueDay)) {
    return null;
  }

  return {
    action: "create_bill",
    name,
    amount: amount || null,
    currency: "GBP",
    frequency: "monthly",
    dueDay: dueDay || null,
    reminderOffsetDays: 1,
    confidence: amount && dueDay ? 0.82 : 0.62,
    rawText: trimmed,
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
  return normaliseBillName(
    text
      .replace(/\b(and there(?:'|’)s|there(?:'|’)s|there is|there are|around|about|approximately|approx|roughly)\b.*$/i, " ")
      .replace(/\b(of every month|of each month)\b/gi, " ")
      .replace(/(?:£|\bgbp\b|\bpounds?\b)\s*\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?/gi, " ")
      .replace(/\b\d{1,5}(?:\.\d{1,2})?\b/g, " ")
      .replace(/\b([12]?\d|3[01])(st|nd|rd|th)\b/gi, " ")
      .replace(/\b(my|the|is|due|on|every|month|monthly|each|bill|please|log|it|get|paid|payday|of|there|s|are|amount)\b/gi, " ")
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

async function parseImagesWithOcr(images) {
  const textChunks = [];

  for (const image of images) {
    const buffer = dataUrlToBuffer(image.dataUrl);

    if (!buffer) {
      continue;
    }

    const result = await recognize(buffer, "eng", {
      logger: () => undefined,
      workerPath: TESSERACT_WORKER_PATH,
    });
    const text = String(result?.data?.text || "").trim();

    if (text) {
      textChunks.push(text);
    }
  }

  if (!textChunks.length) {
    return null;
  }

  const items = extractBillsFromRecurringText(textChunks.join("\n"));

  if (!items.length) {
    return null;
  }

  return {
    action: "batch",
    items,
    responseMessage:
      items.length === 1
        ? `Logged 1 bill from the screenshot.`
        : `Logged ${items.length} bills from the screenshots.`,
  };
}

function buildImageImportResponse(parsed) {
  const bills = extractBillsForImageImport(parsed);

  if (bills.length) {
    return buildImageImportSuccess(bills);
  }

  return buildImageImportFailure(
    parsed?.responseMessage || "Could not read this screenshot.",
  );
}

function buildImageImportSuccess(bills) {
  return {
    ok: true,
    mode: "image_import",
    bills,
    importedCount: 0,
    skippedCount: 0,
    message: bills.length === 1 ? "Extracted 1 bill." : `Extracted ${bills.length} bills.`,
  };
}

function buildImageImportFailure(message) {
  return {
    ok: false,
    mode: "image_import",
    bills: [],
    importedCount: 0,
    skippedCount: 0,
    error: message || "Could not read this screenshot.",
  };
}

function extractBillsForImageImport(parsed) {
  if (!parsed) {
    return [];
  }

  if (parsed.action === "create_bill") {
    return [toImportBill(parsed)];
  }

  if (parsed.action === "batch") {
    return (parsed.items || [])
      .filter((item) => item.action === "create_bill")
      .map(toImportBill);
  }

  return [];
}

function toImportBill(item) {
  const repairedDueDay = isValidDueDay(item?.dueDay)
    ? Number(item.dueDay)
    : parseDueDayFromText(
      [
        item?.dateText,
        item?.rawText,
        item?.name,
      ].filter(Boolean).join(" "),
    );

  const cleanedName = normaliseBillName(item.name);

  return {
    name: cleanedName,
    amount: Number(item.amount),
    dueDay: isValidDueDay(repairedDueDay) ? Number(repairedDueDay) : null,
    currency: item.currency || "GBP",
    dateText: item.dateText || (isValidDueDay(repairedDueDay) ? formatOrdinal(repairedDueDay) : null),
    rawText: item.rawText || `${cleanedName} ${formatGBP(item.amount)}`,
    confidence: Number(item.confidence ?? 0.85),
  };
}

function normaliseImageImportBills(items) {
  return dedupeImageImportBills(
    (Array.isArray(items) ? items : [])
      .map((item) => {
        const rawAmount = item?.amount;
        const amount = rawAmount === null || rawAmount === undefined ? null : Number(rawAmount);
        const name = normaliseBillName(item?.name);
        const repairedDueDay = isValidDueDay(item?.dueDay)
          ? Number(item.dueDay)
          : parseDueDayFromText(
            [
              item?.dateText,
              item?.rawText,
              item?.name,
            ].filter(Boolean).join(" "),
          );

        if (!name || name.trim().length < 2) {
          return null;
        }

        const validAmount = amount !== null && Number.isFinite(amount) ? amount : null;

        return {
          name,
          amount: validAmount,
          currency: item?.currency || "GBP",
          dueDay: isValidDueDay(repairedDueDay) ? Number(repairedDueDay) : null,
          dateText: item?.dateText || (isValidDueDay(repairedDueDay) ? formatOrdinal(repairedDueDay) : null),
          rawText: item?.rawText || `${name}${validAmount !== null ? ` ${formatGBP(validAmount)}` : ""}`,
          confidence: clampConfidence(item?.confidence),
        };
      })
      .filter(Boolean),
  );
}

function parseDueDayFromText(value) {
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

function dedupeImageImportBills(bills) {
  const seen = new Set();
  const result = [];

  for (const bill of bills) {
    const key = [
      String(bill.name || "").toLowerCase(),
      bill.amount !== null && bill.amount !== undefined ? Number(bill.amount).toFixed(2) : "null",
      bill.dueDay ?? "null",
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(bill);
  }

  return result;
}

function clampConfidence(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return 0.8;
  }

  return Math.max(0, Math.min(1, num));
}

async function collectOcrInsights(images) {
  const textChunks = [];

  for (const image of images) {
    const buffer = dataUrlToBuffer(image.dataUrl);

    if (!buffer) {
      continue;
    }

    const result = await recognize(buffer, "eng", {
      logger: () => undefined,
      workerPath: TESSERACT_WORKER_PATH,
    });
    const text = String(result?.data?.text || "").trim();

    if (text) {
      textChunks.push(text);
    }
  }

  const text = textChunks.join("\n").trim();

  return {
    text,
    amountHintCount: countAmountHints(text),
    bills: extractImageImportBillsFromRecurringText(text),
  };
}

function countAmountHints(text) {
  if (!text) {
    return 0;
  }

  const matches = text.match(/(?:£|\bGBP\b)\s*\d{1,4}(?:\.\d{2})?/gi) || [];
  return matches.length;
}

function mergeImageImportBills(primaryBills, fallbackBills) {
  return dedupeImageImportBills([...(primaryBills || []), ...(fallbackBills || [])]);
}

function extractImageImportBillsFromRecurringText(text) {
  const items = extractBillsFromRecurringText(text);
  return items.map(toImportBill);
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);

  if (!match) {
    return null;
  }

  return Buffer.from(match[1], "base64");
}

function extractBillsFromRecurringText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const items = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1] || "";
    const nextTwo = lines[index + 2] || "";
    const candidate = parseRecurringLineGroup([current, next, nextTwo]);

    if (!candidate) {
      continue;
    }

    items.push(candidate.item);
    index += candidate.linesUsed - 1;
  }

  return dedupeParsedItems(items);
}

function parseRecurringLineGroup(lines) {
  const joined = lines.filter(Boolean).join(" ");
  const monthlyMatch = joined.match(/\bMonthly on ([12]?\d|3[01])(st|nd|rd|th)\b/i);

  if (!monthlyMatch) {
    return null;
  }

  if (/\bQuarterly\b|\bEvery 2 months\b|\bEvery 6 months\b|\bLast paid\b/i.test(joined)) {
    return null;
  }

  const dueDay = Number(monthlyMatch[1]);
  const amount = extractAmountFromRecurringText(joined);
  const name = extractNameFromRecurringText(lines[0], joined);

  if (!name || !amount || !dueDay) {
    return null;
  }

  return {
    linesUsed: 3,
    item: {
      action: "create_bill",
      name,
      amount,
      currency: "GBP",
      frequency: "monthly",
      dueDay,
      reminderOffsetDays: 1,
      responseMessage: `Logged. ${name} - ${formatGBP(amount)} - due on the ${formatOrdinal(dueDay)}. Reminder set for the day before.`,
    },
  };
}

function extractAmountFromRecurringText(text) {
  const matches = [...String(text || "").matchAll(/(?:£)?\s*(\d{1,4}\.\d{2}|\d{2,4})\b/g)];
  const amounts = matches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!amounts.length) {
    return null;
  }

  return amounts.at(-1);
}

function extractNameFromRecurringText(firstLine, joined) {
  const line = String(firstLine || "").replace(/\s+/g, " ").trim();
  const cleaned = line
    .replace(/^[A-Z]{1,3}\s+/, "")
    .replace(/\b\d+(?:\.\d{2})?\b.*$/, "")
    .replace(/[£$€].*$/, "")
    .trim();

  if (cleaned && cleaned.length > 1 && !/^Scheduled Payments$/i.test(cleaned)) {
    return normaliseBillName(cleaned);
  }

  const fallback = String(joined || "")
    .replace(/\bMonthly on [12]?\d(?:st|nd|rd|th)\b.*$/i, "")
    .replace(/[£$€].*$/, "")
    .trim();

  return fallback ? normaliseBillName(fallback) : "";
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
