# ClearTill Security

This document describes ClearTill's application-level security controls and how
to configure them. It is intended for developers and operators.

## Honest claims only

ClearTill may honestly say:

- No bank login
- No Open Banking
- You control your data
- Server-processed import text is encrypted before storage
- Sensitive import data is encrypted where supported
- Built around ISO 27001-aligned security principles
- ClearTill is not currently ISO 27001 certified

Do NOT use overclaiming wording, including:

- "All financial data is encrypted"
- "Bank-grade security"
- "Military-grade encryption"
- "ISO compliant" / "ISO certified"
- "Fully encrypted"
- "100% secure"

> **Do not claim ISO 27001 certification unless ClearTill has completed external
> certification.** "ISO 27001-aligned principles" describes how we work; it is
> not a certification claim. Saying "ISO 27001 certified" or "ISO 27001
> compliant" without a completed external audit is false.
>
> **Do not claim full at-rest encryption** until the dashboard numeric data
> moves behind a server-side data layer (see "Current encryption scope").

## `DATA_ENCRYPTION_MASTER_KEY` setup

Field-level encryption uses a single server-only master key.

1. Generate a strong key:

   ```bash
   openssl rand -base64 32
   ```

2. Add it to your environment (e.g. `.env.local` for local dev, or your hosting
   provider's secret manager in production):

   ```
   DATA_ENCRYPTION_MASTER_KEY=<the generated value>
   ```

3. The value may be base64, hex, or a raw passphrase. A 32-byte base64/hex value
   is used directly; anything else is hashed to a stable 256-bit key.

### Rules

- **Never commit env files.** `.env.local` and any file with a real key must
  stay out of git. Only `.env.example` (with empty values) is committed.
- **Never expose the key to the client.** The key is read only inside server
  code (`lib/security/encryption.js`, API routes). It must never appear in a
  `NEXT_PUBLIC_*` variable or any `"use client"` module.
- **Rotating the key** invalidates existing ciphertext. Because decryption
  fails gracefully (returns the stored payload rather than throwing), a rotation
  without re-encryption will leave old encrypted records unreadable. Plan a
  migration before rotating in production.

## How encryption works

- Algorithm: **AES-256-GCM** (authenticated encryption) via Node `crypto`.
- A **per-user key** is derived from the master key + `userId` using
  HKDF-SHA256, so ciphertext is bound to a single user.
- The `userId` is also used as **Additional Authenticated Data (AAD)**, so a
  record cannot be replayed under another user.
- Stored payload shape:

  ```json
  { "__enc": true, "v": 1, "t": "string|json", "iv": "...", "tag": "...", "ct": "..." }
  ```

  The `__enc` marker lets read paths tell encrypted payloads apart from legacy
  plaintext, which is what makes backwards compatibility possible.

### Backwards compatibility

`decryptSensitiveValue` / `decryptObjectFields` return plaintext (legacy)
values unchanged, and return the raw payload if decryption fails. A single bad
record never breaks a read path, and pre-encryption records keep working.

## Current encryption scope

This is the single most important thing to understand before writing any
security/marketing copy:

- **`secureImports` is encrypted server-side.** Import provenance text (AI / CSV
  / upload extracted content) is encrypted with AES-256-GCM before it is written
  to Firestore, using a key held only on the server.
- **Dashboard numeric fields are currently plaintext.** Bills, balances, income,
  savings and large-cost numeric fields are read and written directly by the
  browser via Firestore realtime listeners (`onSnapshot`). They must stay
  readable client-side for the live forecast to work, so they are not encrypted
  at rest today.
- **Full numeric encryption would require a server-side data-layer migration.**
  Moving all reads/writes behind server API routes (so the server can decrypt
  before responding) is the prerequisite for encrypting amounts at rest. The
  field lists in `lib/security/sensitiveFields.js` already exist for that day.
- **Do not claim full at-rest encryption** (e.g. "all financial data is
  encrypted", "fully encrypted") until that migration is complete. Until then,
  the honest claim is "server-processed import text is encrypted before storage"
  and "sensitive import data is encrypted where supported".

## What fields are encrypted

See `lib/security/sensitiveFields.js` for the authoritative lists.

**Encrypted at rest today** — the server-only `secureImports` archive, which is
written by the server and never read by the client realtime listeners:

- `rawText` / `extractedText` / `csvText` — raw OCR / CSV / AI parsed text
- `notes` — free-text attached to an upload
- `payload` — structured parsed result kept for audit / re-import

**Not encrypted today (by design)** — balance, bill/income amounts, large-cost
and savings values. These are written and read directly by the browser via
Firestore realtime listeners (`onSnapshot`), so they must remain plaintext for
the live dashboard to calculate and display them. The field lists and helpers
(`BALANCE_SENSITIVE_FIELDS`, etc.) are in place so these can be encrypted if/when
those collections move behind a server-side data layer.

IDs, dates (`dueDay`, `payDay`, `nextDueDate`, `reminderDate`), `userId`,
`currency`, `category`, `source` and `createdAt` are intentionally never
encrypted so they remain queryable and usable for scheduling.

## Audit logging

`lib/security/auditLog.js` writes sanitised events to the `securityAuditEvents`
Firestore collection. **No financial values are ever logged** — a backstop in
`sanitiseMetadata` drops money-like keys and values. Events recorded:

- `bill_created`, `bill_updated`, `bill_deleted`
- `balance_updated`
- `csv_uploaded`, `ai_import_used`
- `data_export_requested`, `data_reset_requested`, `account_delete_requested`

Client actions call the server `/api/security` route (see
`lib/security/clientSecurity.js`); server-side account actions log directly.

## User data controls

From `/account` users can:

- **Export my data** — download a JSON copy (server decrypts `secureImports`).
- **Reset ClearTill data** — clear budgeting data, keep the login account.
- **Delete all ClearTill data** / **Delete account** — permanent removal.

Destructive actions require confirmation:

> This permanently removes your ClearTill budgeting data. This cannot be undone.
