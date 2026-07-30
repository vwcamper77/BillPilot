import crypto from "node:crypto";
import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
  isEncryptedPayload,
} from "@/lib/security/encryption";
import canvaCore from "@/lib/integrations/canvaCore.cjs";

const {
  CANVA_API_BASE_URL,
  buildAuthorizationUrl,
  createOAuthState,
  createPkce,
  expiresAtFromSeconds,
  getCanvaConfig,
  hashOAuthState,
  normalizeCapabilities,
  shouldRefreshToken,
  timestampToMillis,
} = canvaCore;

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_LEASE_MS = 30 * 1000;
const REFRESH_WAIT_ATTEMPTS = 10;
const REFRESH_WAIT_MS = 100;

export class CanvaIntegrationError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "CanvaIntegrationError";
    this.code = code;
    this.status = status;
  }
}

function requireConfig() {
  const runtime = getCanvaConfig();
  if (!runtime.ok) {
    throw new CanvaIntegrationError(
      runtime.code,
      runtime.message,
      runtime.code === "canva/disabled" ? 503 : 500,
    );
  }
  return runtime;
}

function canvaRootRef(db = getAdminDb()) {
  return db.collection("integrations").doc("canva");
}

export function canvaConnectionRef(uid, db = getAdminDb()) {
  return canvaRootRef(db).collection("connections").doc(String(uid));
}

function oauthStateRef(state, db = getAdminDb()) {
  return canvaRootRef(db).collection("oauthStates").doc(hashOAuthState(state));
}

function assertUid(uid) {
  const value = String(uid || "").trim();
  if (!value) {
    throw new CanvaIntegrationError(
      "auth/invalid-user",
      "Please sign in to ClearTill before connecting Canva.",
      401,
    );
  }
  return value;
}

function basicAuthorization(config) {
  return `Basic ${Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
    "utf8",
  ).toString("base64")}`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function canvaApiError(payload, response, fallback) {
  const code = String(
    payload?.error
      || payload?.code
      || payload?.error_code
      || `http_${response.status}`,
  ).slice(0, 100);
  const detail = String(
    payload?.error_description
      || payload?.message
      || payload?.error?.message
      || "",
  ).trim();
  const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502;
  const error = new CanvaIntegrationError(
    response.status === 401
      ? "canva/unauthorized"
      : response.status === 403
        ? "canva/forbidden"
        : "canva/api-error",
    detail || fallback,
    status,
  );
  error.canvaCode = code;
  return error;
}

async function exchangeToken(params) {
  const config = requireConfig();
  const response = await fetch(`${CANVA_API_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthorization(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw canvaApiError(payload, response, "Canva could not complete authentication.");
  }
  if (!payload.access_token || !payload.refresh_token) {
    throw new CanvaIntegrationError(
      "canva/invalid-token-response",
      "Canva returned an incomplete token response. Please reconnect.",
      502,
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: expiresAtFromSeconds(payload.expires_in),
  };
}

async function fetchCanva(path, accessToken, { method = "GET", body } = {}) {
  const response = await fetch(`${CANVA_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw canvaApiError(payload, response, "Canva could not load account details.");
  }
  return payload;
}

export async function createCanvaAuthorization(uid) {
  const userId = assertUid(uid);
  const config = requireConfig();
  const state = createOAuthState();
  const { verifier, challenge } = createPkce();
  const stateRef = oauthStateRef(state);
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

  await getAdminDb().runTransaction(async (transaction) => {
    const existing = await transaction.get(stateRef);
    if (existing.exists) {
      throw new CanvaIntegrationError(
        "canva/state-collision",
        "Could not start Canva authentication. Please try again.",
        409,
      );
    }
    transaction.create(stateRef, {
      uid: userId,
      codeVerifier: encryptSensitiveValue(verifier, userId),
      expiresAt,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return buildAuthorizationUrl(config, { state, challenge });
}

export async function consumeCanvaOAuthState(state) {
  const suppliedState = String(state || "").trim();
  if (!suppliedState) {
    throw new CanvaIntegrationError(
      "canva/invalid-state",
      "The Canva sign-in request is missing its security state. Please reconnect.",
      400,
    );
  }

  const stateRef = oauthStateRef(suppliedState);
  const record = await getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(stateRef);
    if (!snapshot.exists) {
      throw new CanvaIntegrationError(
        "canva/invalid-state",
        "This Canva sign-in request is invalid or has already been used.",
        400,
      );
    }
    transaction.delete(stateRef);
    return snapshot.data();
  });

  const uid = assertUid(record.uid);
  if (timestampToMillis(record.expiresAt) <= Date.now()) {
    throw new CanvaIntegrationError(
      "canva/expired-state",
      "This Canva sign-in request has expired. Please reconnect.",
      400,
    );
  }

  const verifier = decryptSensitiveValue(record.codeVerifier, uid);
  if (
    isEncryptedPayload(verifier)
    || typeof verifier !== "string"
    || verifier.length < 43
    || verifier.length > 128
  ) {
    throw new CanvaIntegrationError(
      "canva/invalid-state",
      "The Canva sign-in request could not be verified. Please reconnect.",
      400,
    );
  }

  return { uid, verifier };
}

export async function completeCanvaAuthorization({ code, state }) {
  const { uid, verifier } = await consumeCanvaOAuthState(state);
  const authorizationCode = String(code || "").trim();
  if (!authorizationCode) {
    throw new CanvaIntegrationError(
      "canva/missing-code",
      "Canva did not return an authorization code. Please reconnect.",
      400,
    );
  }

  const config = requireConfig();
  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    code: authorizationCode,
    code_verifier: verifier,
    redirect_uri: config.redirectUri,
  });
  const [user, capabilityResponse] = await Promise.all([
    fetchCanva("/users/me", tokens.accessToken),
    fetchCanva("/users/me/capabilities", tokens.accessToken),
  ]);
  const workspaceId = String(user?.team_user?.team_id || "").trim();
  if (!workspaceId) {
    throw new CanvaIntegrationError(
      "canva/invalid-user-response",
      "Canva did not return a workspace for this account.",
      502,
    );
  }

  const connectionRef = canvaConnectionRef(uid);
  const capabilities = normalizeCapabilities(capabilityResponse?.capabilities);
  const capabilitiesCheckedAt = new Date();
  await getAdminDb().runTransaction(async (transaction) => {
    const current = await transaction.get(connectionRef);
    transaction.set(connectionRef, {
      accessToken: tokens.accessToken,
      refreshToken: encryptSensitiveValue(tokens.refreshToken, uid),
      expiresAt: tokens.expiresAt,
      workspaceId,
      capabilities,
      capabilitiesCheckedAt,
      connectedAt: current.exists
        ? current.data()?.connectedAt || FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    connected: true,
    workspace: workspaceId,
    expires: tokens.expiresAt.toISOString(),
    capabilities,
    lastChecked: capabilitiesCheckedAt.toISOString(),
  };
}

async function readConnection(uid) {
  const snapshot = await canvaConnectionRef(uid).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function clearFailedConnection(uid, leaseId) {
  const db = getAdminDb();
  const connectionRef = canvaConnectionRef(uid, db);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(connectionRef);
    if (snapshot.exists && snapshot.data()?.refreshLeaseId === leaseId) {
      transaction.delete(connectionRef);
    }
  });
}

async function releaseRefreshLease(uid, leaseId) {
  const db = getAdminDb();
  const connectionRef = canvaConnectionRef(uid, db);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(connectionRef);
    if (snapshot.exists && snapshot.data()?.refreshLeaseId === leaseId) {
      transaction.update(connectionRef, {
        refreshLeaseId: FieldValue.delete(),
        refreshLeaseExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
}

async function claimRefresh(uid, forceRefresh, staleAccessToken) {
  const db = getAdminDb();
  const connectionRef = canvaConnectionRef(uid, db);
  const leaseId = crypto.randomUUID();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(connectionRef);
    if (!snapshot.exists) return { kind: "missing" };
    const connection = snapshot.data();

    const anotherRequestAlreadyRefreshed = Boolean(
      forceRefresh
      && staleAccessToken
      && connection.accessToken !== staleAccessToken,
    );
    if (
      anotherRequestAlreadyRefreshed
      || (!forceRefresh && !shouldRefreshToken(connection.expiresAt))
    ) {
      return { kind: "ready", connection };
    }

    if (timestampToMillis(connection.refreshLeaseExpiresAt) > Date.now()) {
      return { kind: "wait" };
    }

    transaction.update(connectionRef, {
      refreshLeaseId: leaseId,
      refreshLeaseExpiresAt: new Date(Date.now() + REFRESH_LEASE_MS),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: "claimed", connection, leaseId };
  });
}

async function refreshConnection(
  uid,
  { forceRefresh = false, staleAccessToken = null } = {},
) {
  for (let attempt = 0; attempt <= REFRESH_WAIT_ATTEMPTS; attempt += 1) {
    const claim = await claimRefresh(uid, forceRefresh, staleAccessToken);
    if (claim.kind === "missing") return null;
    if (claim.kind === "ready") return claim.connection;
    if (claim.kind === "wait") {
      if (attempt === REFRESH_WAIT_ATTEMPTS) {
        throw new CanvaIntegrationError(
          "canva/refresh-busy",
          "Canva is reconnecting. Please try again in a moment.",
          503,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));
      continue;
    }

    const refreshToken = decryptSensitiveValue(claim.connection.refreshToken, uid);
    if (
      isEncryptedPayload(refreshToken)
      || typeof refreshToken !== "string"
      || !refreshToken
    ) {
      await clearFailedConnection(uid, claim.leaseId);
      throw new CanvaIntegrationError(
        "canva/invalid-refresh-token",
        "The saved Canva connection cannot be refreshed. Please reconnect.",
        401,
      );
    }

    let tokens;
    try {
      tokens = await exchangeToken({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
    } catch (error) {
      if (error?.status === 401 || error?.canvaCode === "invalid_grant") {
        await clearFailedConnection(uid, claim.leaseId);
      } else {
        await releaseRefreshLease(uid, claim.leaseId);
      }
      throw error;
    }

    const db = getAdminDb();
    const connectionRef = canvaConnectionRef(uid, db);
    const updated = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(connectionRef);
      if (!snapshot.exists) return null;
      const current = snapshot.data();
      if (current.refreshLeaseId !== claim.leaseId) return current;
      const next = {
        ...current,
        accessToken: tokens.accessToken,
        refreshToken: encryptSensitiveValue(tokens.refreshToken, uid),
        expiresAt: tokens.expiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      };
      delete next.refreshLeaseId;
      delete next.refreshLeaseExpiresAt;
      transaction.set(connectionRef, next);
      return next;
    });
    return updated;
  }

  return null;
}

async function fetchCapabilitiesWithRefresh(uid, connection) {
  try {
    return await fetchCanva("/users/me/capabilities", connection.accessToken);
  } catch (error) {
    if (error?.code !== "canva/unauthorized") throw error;
    const refreshed = await refreshConnection(uid, {
      forceRefresh: true,
      staleAccessToken: connection.accessToken,
    });
    if (!refreshed) throw error;
    return fetchCanva("/users/me/capabilities", refreshed.accessToken);
  }
}

async function requestCanvaForUser(uid, path, options = {}) {
  const userId = assertUid(uid);
  requireConfig();
  let connection = await refreshConnection(userId);
  if (!connection?.accessToken) {
    throw new CanvaIntegrationError(
      "canva/not-connected",
      "Connect Canva before using this feature.",
      401,
    );
  }
  try {
    return await fetchCanva(path, connection.accessToken, options);
  } catch (error) {
    if (error?.code !== "canva/unauthorized") throw error;
    connection = await refreshConnection(userId, {
      forceRefresh: true,
      staleAccessToken: connection.accessToken,
    });
    if (!connection?.accessToken) throw error;
    return fetchCanva(path, connection.accessToken, options);
  }
}

export async function getCanvaStatus(uid) {
  const userId = assertUid(uid);
  const runtime = getCanvaConfig();
  if (!runtime.enabled) {
    return {
      enabled: false,
      connected: false,
      workspace: null,
      expires: null,
      capabilities: normalizeCapabilities([]),
      lastChecked: null,
    };
  }
  if (!runtime.ok) {
    throw new CanvaIntegrationError(runtime.code, runtime.message, 500);
  }

  let connection = await readConnection(userId);
  if (!connection) {
    return {
      enabled: true,
      connected: false,
      workspace: null,
      expires: null,
      capabilities: normalizeCapabilities([]),
      lastChecked: null,
    };
  }

  if (shouldRefreshToken(connection.expiresAt)) {
    connection = await refreshConnection(userId);
  }
  if (!connection) {
    return {
      enabled: true,
      connected: false,
      workspace: null,
      expires: null,
      capabilities: normalizeCapabilities([]),
      lastChecked: null,
    };
  }

  const response = await fetchCapabilitiesWithRefresh(userId, connection);
  const capabilities = normalizeCapabilities(response?.capabilities);
  const capabilitiesCheckedAt = new Date();
  const connectionRef = canvaConnectionRef(userId);
  await getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(connectionRef);
    if (!snapshot.exists) return;
    transaction.update(connectionRef, {
      capabilities,
      capabilitiesCheckedAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const latest = await readConnection(userId);
  const expiryMs = timestampToMillis(latest?.expiresAt || connection.expiresAt);

  return {
    enabled: true,
    connected: true,
    workspace: String(latest?.workspaceId || connection.workspaceId || ""),
    expires: expiryMs ? new Date(expiryMs).toISOString() : null,
    capabilities,
    lastChecked: capabilitiesCheckedAt.toISOString(),
  };
}

export async function listCanvaBrandTemplates(uid, { limit = 100, query = "" } = {}) {
  const parameters = new URLSearchParams({
    continuation: "",
    dataset: "default",
  });
  parameters.delete("continuation");
  parameters.delete("dataset");
  parameters.set("limit", String(Math.min(100, Math.max(1, Number(limit) || 100))));
  if (String(query).trim()) parameters.set("query", String(query).trim());
  const payload = await requestCanvaForUser(
    uid,
    `/brand-templates?${parameters.toString()}`,
  );
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    continuation: payload?.continuation || null,
  };
}

export async function createCanvaDesign(
  uid,
  { brandTemplateId = null, designId = null, title = "" } = {},
) {
  const source = brandTemplateId
    ? { type: "brand_template", brand_template_id: String(brandTemplateId) }
    : designId
      ? { type: "design", design_id: String(designId) }
      : null;
  if (!source) {
    throw new CanvaIntegrationError(
      "canva/missing-design-source",
      "Choose a Canva brand template or design to copy.",
      400,
    );
  }
  return requestCanvaForUser(uid, "/designs", {
    method: "POST",
    body: { ...source, ...(String(title).trim() ? { title: String(title).trim() } : {}) },
  });
}

export async function resizeCanvaDesign(uid, { designId, width, height }) {
  if (!designId || !Number(width) || !Number(height)) {
    throw new CanvaIntegrationError(
      "canva/invalid-resize",
      "A design, width, and height are required for resize.",
      400,
    );
  }
  return requestCanvaForUser(uid, "/resizes", {
    method: "POST",
    body: {
      design_id: String(designId),
      design_type: {
        type: "custom",
        width: Number(width),
        height: Number(height),
      },
    },
  });
}

export async function exportCanvaDesign(uid, { designId, width, height }) {
  if (!designId) {
    throw new CanvaIntegrationError(
      "canva/missing-design",
      "Choose a Canva design to export.",
      400,
    );
  }
  return requestCanvaForUser(uid, "/exports", {
    method: "POST",
    body: {
      design_id: String(designId),
      format: {
        type: "png",
        ...(Number(width) ? { width: Number(width) } : {}),
        ...(Number(height) ? { height: Number(height) } : {}),
      },
    },
  });
}

export async function getValidCanvaAccessToken(uid) {
  const userId = assertUid(uid);
  requireConfig();
  const connection = await refreshConnection(userId);
  if (!connection?.accessToken) {
    throw new CanvaIntegrationError(
      "canva/not-connected",
      "Connect Canva before using this feature.",
      401,
    );
  }
  return connection.accessToken;
}

export async function disconnectCanva(uid) {
  const userId = assertUid(uid);
  const db = getAdminDb();
  const connectionRef = canvaConnectionRef(userId, db);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(connectionRef);
    if (snapshot.exists) transaction.delete(connectionRef);
    return snapshot.exists;
  });
}

export function canvaErrorResponse(error) {
  if (error instanceof CanvaIntegrationError || error?.code?.startsWith?.("canva/")) {
    return {
      status: Number(error.status) || 500,
      body: {
        ok: false,
        connected: false,
        code: error.code,
        error: error.message,
      },
    };
  }
  if (error?.code?.startsWith?.("auth/")) {
    return {
      status: 401,
      body: {
        ok: false,
        connected: false,
        code: "auth/unauthorized",
        error: "Please sign in to ClearTill and try again.",
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      connected: false,
      code: "canva/unavailable",
      error: "The Canva integration is temporarily unavailable. Please try again.",
    },
  };
}
