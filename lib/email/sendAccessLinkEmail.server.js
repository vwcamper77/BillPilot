import { getResendClient } from "@/lib/resend";
import { buildAccessLinkEmail } from "@/lib/email/accessLinkTemplate";

/**
 * Sends the post-payment secure access-link email via Resend.
 *
 * Deliberately called *outside* any Firestore transaction — see
 * lib/entitlements.server.js's transactional-outbox pattern. Never throws
 * silently: callers must record the outcome (sent/failed) themselves.
 */
export async function sendAccessLinkEmail({ to, signInUrl, accessExpiresAt }) {
  const from = process.env.RESEND_FROM_EMAIL;

  if (!from) {
    throw new Error("Missing RESEND_FROM_EMAIL.");
  }

  const { subject, text, html } = buildAccessLinkEmail({ signInUrl, accessExpiresAt });

  const result = await getResendClient().emails.send({
    from,
    to,
    subject,
    text,
    html,
  });

  if (result?.error) {
    throw new Error(result.error?.message || "Resend rejected the send.");
  }

  return { providerId: result?.data?.id || null };
}
