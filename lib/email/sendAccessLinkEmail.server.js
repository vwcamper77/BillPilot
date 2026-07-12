import { sendEmail } from "@/lib/email/emailService.server";
import { buildAccessLinkEmail } from "@/lib/email/accessLinkTemplate";

/**
 * Sends the post-payment secure access-link email via Resend.
 *
 * Deliberately called *outside* any Firestore transaction — see
 * lib/entitlements.server.js's transactional-outbox pattern. Never throws
 * silently: callers must record the outcome (sent/failed) themselves.
 */
export async function sendAccessLinkEmail({ to, signInUrl, accessExpiresAt }) {
  const { subject, text, html } = buildAccessLinkEmail({ signInUrl, accessExpiresAt });
  return sendEmail({
    to,
    subject,
    text,
    html,
  });
}
