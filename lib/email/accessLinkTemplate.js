/**
 * Pure template builder for the post-payment secure access-link email.
 * Kept free of Resend/Firestore imports so it can be unit tested directly.
 *
 * Deliberately excludes: Stripe session IDs, Firebase tokens/oobCodes as
 * visible text (only inside the link itself), amounts, and any other
 * financial detail — see CLAUDE.md's "calm, practical" voice rules and the
 * checkout-redesign spec's "no sensitive financial information in email
 * text" requirement.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatAccessExpiry(date) {
  const resolved = date instanceof Date ? date : new Date(date);
  return DATE_FORMAT.format(resolved);
}

export function buildAccessLinkEmail({ signInUrl, accessExpiresAt }) {
  if (!signInUrl) {
    throw new Error("buildAccessLinkEmail requires signInUrl.");
  }

  const expiryText = formatAccessExpiry(accessExpiresAt);
  const subject = "Your ClearTill access is ready";

  const text = [
    "Your ClearTill access is ready.",
    "",
    "90 days of founding-member access is set up on your account.",
    "",
    `Sign in: ${signInUrl}`,
    "",
    `Access runs until ${expiryText}.`,
    "",
    "Didn't request this? Just ignore this email.",
    "",
    "ClearTill — hello@cleartill.money",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; color: #0f172a;">
      <p style="font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; color: #0f766e; margin: 0 0 12px;">ClearTill</p>
      <h1 style="font-size: 20px; margin: 0 0 16px;">Your ClearTill access is ready</h1>
      <p style="font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
        90 days of founding-member access is set up on your account. Use the
        secure link below to sign in.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${signInUrl}" style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-size: 15px;">
          Sign in to ClearTill
        </a>
      </p>
      <p style="font-size: 14px; line-height: 1.5; color: #475569; margin: 0 0 8px;">
        Access runs until ${expiryText}.
      </p>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; margin: 24px 0 0;">
        Didn't request this? Just ignore this email.
      </p>
      <p style="font-size: 13px; color: #94a3b8; margin: 24px 0 0;">
        ClearTill — hello@cleartill.money
      </p>
    </div>
  `.trim();

  return { subject, text, html };
}
