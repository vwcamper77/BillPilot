const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  CANVA_SCOPES,
  buildAuthorizationUrl,
  createOAuthState,
  createPkce,
  expiresAtFromSeconds,
  getCanvaConfig,
  hashOAuthState,
  normalizeCapabilities,
  shouldRefreshToken,
} = require("../lib/integrations/canvaCore.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("PKCE and OAuth state use high-entropy URL-safe values", () => {
  const first = createPkce();
  const second = createPkce();
  const state = createOAuthState();

  assert.match(first.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(first.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.verifier, second.verifier);
  assert.notEqual(hashOAuthState(state), state);
  assert.equal(hashOAuthState(state), hashOAuthState(state));
});

test("authorization URL contains Canva OAuth, PKCE, redirect and required scopes", () => {
  const config = {
    clientId: "client-id",
    clientSecret: "secret",
    redirectUri: "https://example.test/api/integrations/canva/callback",
  };
  const url = buildAuthorizationUrl(config, {
    state: "test-state",
    challenge: "test-challenge",
  });

  assert.equal(url.origin, "https://www.canva.com");
  assert.equal(url.pathname, "/api/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), config.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("state"), "test-state");
  assert.equal(url.searchParams.get("code_challenge"), "test-challenge");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  for (const scope of CANVA_SCOPES) {
    assert.ok(url.searchParams.get("scope").split(" ").includes(scope));
  }
});

test("Canva config fails closed when disabled, missing or malformed", () => {
  assert.equal(getCanvaConfig({ CANVA_INTEGRATION_ENABLED: "false" }).code, "canva/disabled");
  assert.equal(getCanvaConfig({ CANVA_INTEGRATION_ENABLED: "true" }).code, "canva/misconfigured");
  assert.equal(getCanvaConfig({
    CANVA_INTEGRATION_ENABLED: "true",
    CANVA_CLIENT_ID: "id",
    CANVA_CLIENT_SECRET: "secret",
    CANVA_REDIRECT_URI: "javascript:alert(1)",
  }).code, "canva/misconfigured");
  assert.equal(getCanvaConfig({
    CANVA_INTEGRATION_ENABLED: "true",
    CANVA_CLIENT_ID: "id",
    CANVA_CLIENT_SECRET: "secret",
    CANVA_REDIRECT_URI: "https://example.test/callback",
  }).ok, true);
});

test("token expiry refreshes early and validates Canva expiry values", () => {
  const now = Date.now();
  assert.equal(shouldRefreshToken(new Date(now + 59_000), now), true);
  assert.equal(shouldRefreshToken(new Date(now + 61_000), now), false);
  assert.equal(expiresAtFromSeconds(3600, now).getTime(), now + 3_600_000);
  assert.throws(() => expiresAtFromSeconds(0, now), /invalid token expiry/i);
});

test("capability response is narrowed to friendly booleans", () => {
  assert.deepEqual(
    normalizeCapabilities(["autofill", "resize", "analytics"]),
    { brand_template: false, autofill: true, resize: true },
  );
  assert.deepEqual(
    normalizeCapabilities(),
    { brand_template: false, autofill: false, resize: false },
  );
});

test("server integration uses encrypted refresh tokens and transaction-safe storage", () => {
  const server = read("lib/integrations/canva.server.js");
  assert.match(server, /collection\("integrations"\)\.doc\("canva"\)/);
  assert.match(server, /collection\("connections"\)\.doc\(String\(uid\)\)/);
  assert.match(server, /encryptSensitiveValue\(tokens\.refreshToken, uid\)/);
  assert.match(server, /decryptSensitiveValue\(claim\.connection\.refreshToken, uid\)/);
  assert.match(server, /runTransaction/);
  assert.match(server, /refreshLeaseId/);
  assert.match(server, /\/users\/me\/capabilities/);
  assert.match(server, /\/users\/me/);
  assert.match(server, /grant_type: "refresh_token"/);
  assert.match(server, /getValidCanvaAccessToken/);
  assert.match(server, /anotherRequestAlreadyRefreshed/);
  assert.match(server, /transaction\.delete\(connectionRef\)/);
});

test("documented Canva configuration uses only the required existing environment variables", () => {
  const example = read(".env.example");
  for (const variable of [
    "CANVA_CLIENT_ID",
    "CANVA_CLIENT_SECRET",
    "CANVA_REDIRECT_URI",
    "CANVA_INTEGRATION_ENABLED",
  ]) {
    assert.match(example, new RegExp(`^${variable}=`, "m"));
  }
  assert.doesNotMatch(example, /NEXT_PUBLIC_CANVA_CLIENT_SECRET/);
});

test("all Canva routes authenticate or consume one-time callback state and return friendly JSON", () => {
  const connect = read("app/api/integrations/canva/connect/route.js");
  const callback = read("app/api/integrations/canva/callback/route.js");
  const status = read("app/api/integrations/canva/status/route.js");
  const disconnect = read("app/api/integrations/canva/disconnect/route.js");

  assert.match(connect, /verifyRequestUser/);
  assert.match(connect, /NextResponse\.redirect/);
  assert.match(status, /verifyRequestUser/);
  assert.match(status, /getCanvaStatus/);
  assert.match(disconnect, /verifyRequestUser/);
  assert.match(disconnect, /export async function DELETE/);
  assert.match(callback, /completeCanvaAuthorization/);
  assert.match(callback, /consumeCanvaOAuthState/);
  for (const route of [connect, callback, status, disconnect]) {
    assert.match(route, /NextResponse\.json/);
  }
});
