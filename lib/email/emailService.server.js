import { Resend } from "resend";

export const CANONICAL_EMAIL_SENDER = "ClearTill <no-reply@cleartill.money>";
export const LEAD_MAGNET_EMAIL_SENDER = "ClearTill <hello@cleartill.money>";

const ALLOWED_SENDERS = {
  service: CANONICAL_EMAIL_SENDER,
  lead_magnet: LEAD_MAGNET_EMAIL_SENDER,
};

let resendClient;
const mockDeliveries = [];

function isMockMode() {
  return process.env.EMAIL_SERVICE_MODE === "mock" || process.env.NODE_ENV === "test";
}

function isBlockedTestAddress(address) {
  return String(address || "").trim().toLowerCase().endsWith("@cleartill.test");
}

function getResendClient() {
  if (!process.env.RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY.");
  resendClient ||= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export async function sendEmail(message) {
  if (isBlockedTestAddress(message?.to)) {
    return { providerId: null, skipped: true, reason: "blocked_test_address" };
  }

  const { idempotencyKey, senderType = "service", ...emailMessage } = message;
  const protectedMessage = {
    ...emailMessage,
    from: ALLOWED_SENDERS[senderType] || CANONICAL_EMAIL_SENDER,
  };
  if (isMockMode()) {
    const delivery = { ...protectedMessage, providerId: `mock-email-${mockDeliveries.length + 1}` };
    mockDeliveries.push(delivery);
    return { providerId: delivery.providerId, mocked: true };
  }

  const result = await getResendClient().emails.send(
    protectedMessage,
    idempotencyKey ? { idempotencyKey } : undefined,
  );
  if (result?.error) throw new Error(result.error.message || "Resend rejected the send.");
  return { providerId: result?.data?.id || null };
}

export function getMockEmailDeliveries() {
  return [...mockDeliveries];
}

export function resetMockEmailDeliveries() {
  mockDeliveries.length = 0;
}
