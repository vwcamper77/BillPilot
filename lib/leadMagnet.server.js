import { createHash, randomUUID } from "node:crypto";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { checkRateLimit } from "@/lib/security/rateLimit.server";
import { claimEmailDelivery, emailFailureStatus, markEmailDelivery } from "@/lib/email";
import { sendEmail } from "@/lib/email/emailService.server";
import { buildLeadMagnetEmail } from "@/lib/email/leadMagnetTemplate";
import { getAppBaseUrl } from "@/lib/billing/config";
import {
  LEAD_MAGNET_CONSENT_TEXT,
  LEAD_MAGNET_CONSENT_VERSION,
  normaliseLeadEmail,
  sanitiseLeadAttribution,
} from "@/lib/leadMagnet";

export class LeadMagnetValidationError extends Error {
  constructor(message, code = "invalid_request") {
    super(message);
    this.name = "LeadMagnetValidationError";
    this.code = code;
  }
}

export function hashLeadValue(value) {
  return createHash("sha256").update(String(value || "").trim().toLowerCase()).digest("hex");
}

export function validateLeadMagnetBody(body) {
  if (String(body?.company || "").trim()) return { bot: true };
  const email = normaliseLeadEmail(body?.email);
  if (!email) throw new LeadMagnetValidationError("Enter a valid email address.", "invalid_email");
  return {
    bot: false,
    email,
    emailHash: hashLeadValue(email),
    marketingConsent: body?.marketingConsent === true,
    attribution: sanitiseLeadAttribution(body?.attribution),
  };
}

export async function processLeadMagnetSubmission({ body, ip }, dependencies = {}) {
  const submission = validateLeadMagnetBody(body);
  if (submission.bot) return { ok: true, accepted: true };

  const rateLimit = dependencies.checkRateLimit || checkRateLimit;
  const ipHash = hashLeadValue(ip || "unknown");
  await Promise.all([
    rateLimit("lead-magnet-ip", ipHash, { max: 8, windowSeconds: 3600 }),
    rateLimit("lead-magnet-email", submission.emailHash, { max: 3, windowSeconds: 86400 }),
  ]);

  const fulfil = dependencies.fulfil || fulfilLeadMagnet;
  await fulfil(submission);
  return { ok: true };
}

export async function fulfilLeadMagnet(submission) {
  const db = getAdminDb();
  const leadRef = db.collection("leadMagnetLeads").doc(submission.emailHash);
  const suppressionRef = db.collection("emailSuppressions").doc(submission.emailHash);
  const marketingRef = db.collection("marketingSubscribers").doc(submission.emailHash);
  const submissionId = randomUUID();
  const suppression = await suppressionRef.get();

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(leadRef);
    transaction.set(leadRef, {
      email: submission.email,
      emailHash: submission.emailHash,
      offer: "cash-position-sheet",
      lastSubmissionId: submissionId,
      lastSubmittedAt: FieldValue.serverTimestamp(),
      submissionCount: FieldValue.increment(1),
      marketingConsentSelectedAtSubmission: submission.marketingConsent,
      consentTextVersion: LEAD_MAGNET_CONSENT_VERSION,
      consentText: LEAD_MAGNET_CONSENT_TEXT,
      consentRecordedAt: FieldValue.serverTimestamp(),
      lastAttribution: submission.attribution,
      ...(existing.exists ? {} : {
        createdAt: FieldValue.serverTimestamp(),
        firstAttribution: submission.attribution,
      }),
      ...(submission.marketingConsent ? {
        marketingConsentGrantedAt: FieldValue.serverTimestamp(),
        marketingConsentVersion: LEAD_MAGNET_CONSENT_VERSION,
      } : {}),
    }, { merge: true });

    if (submission.marketingConsent && !suppression.exists) {
      transaction.set(marketingRef, {
        email: submission.email,
        emailHash: submission.emailHash,
        status: "subscribed",
        source: "cash-position-sheet",
        consentTextVersion: LEAD_MAGNET_CONSENT_VERSION,
        consentText: LEAD_MAGNET_CONSENT_TEXT,
        consentAt: FieldValue.serverTimestamp(),
        attribution: submission.attribution,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  const claim = await claimEmailDelivery({
    userId: submission.emailHash,
    type: "cash_position_lead_magnet",
    period: "v1",
    transactional: true,
  });
  if (!claim.ok) return { delivered: claim.reason === "duplicate", reason: claim.reason };

  const baseUrl = getAppBaseUrl();
  const landingPageUrl = `${baseUrl}/free-cash-position-sheet`;
  const spreadsheetUrl = `${baseUrl}/downloads/cleartill-free-cash-position-sheet.xlsx`;
  const guideUrl = `${baseUrl}/guides/cleartill-bank-balance-reset-guide.pdf`;
  const message = buildLeadMagnetEmail({ landingPageUrl, spreadsheetUrl, guideUrl });

  try {
    const result = await sendEmail({
      to: submission.email,
      ...message,
      idempotencyKey: claim.idempotencyKey,
    });
    await Promise.all([
      markEmailDelivery(claim.ref, {
        status: "sent",
        providerMessageId: result.providerId || null,
        sentAt: FieldValue.serverTimestamp(),
      }, { claimToken: claim.claimToken }),
      leadRef.set({ fulfilmentStatus: "sent", fulfilledAt: FieldValue.serverTimestamp() }, { merge: true }),
    ]);
    return { delivered: true };
  } catch (error) {
    await markEmailDelivery(claim.ref, {
      status: emailFailureStatus(claim.attempts),
      failureCode: "provider_error",
    }, { claimToken: claim.claimToken });
    await leadRef.set({ fulfilmentStatus: "failed", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
}
