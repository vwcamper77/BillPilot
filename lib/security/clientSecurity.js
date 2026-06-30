"use client";

/**
 * Client-safe helpers for ClearTill security features.
 *
 * These post to the server `/api/security` route, which is where all encryption
 * and audit writes actually happen. NOTHING sensitive is encrypted in the
 * browser and the master key never reaches the client — this module only
 * forwards events/provenance to the server with the user's ID token.
 *
 * All calls are fire-and-forget: they must never block or break the user-facing
 * action they accompany, so failures are swallowed.
 */

import { auth } from "@/lib/firebase";

async function postSecurity(payload) {
  try {
    const currentUser = auth?.currentUser;

    if (!currentUser) {
      return;
    }

    const idToken = await currentUser.getIdToken();

    await fetch("/api/security", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Security telemetry must never disrupt the app.
  }
}

/**
 * Record a non-sensitive audit event (e.g. "bill_created").
 * `metadata` must not contain financial values — the server strips them anyway.
 */
export function logSecurityEventClient(event, metadata = {}) {
  void postSecurity({ action: "log_event", event, metadata });
}

/**
 * Send import provenance to the server to be encrypted and archived.
 * Use for AI parsed text, CSV extracted text, or uploaded document notes.
 */
export function storeImportArchive({ source = "import", rawText, extractedText, csvText, notes, payload } = {}) {
  void postSecurity({
    action: "store_import",
    source,
    rawText,
    extractedText,
    csvText,
    notes,
    payload,
  });
}
