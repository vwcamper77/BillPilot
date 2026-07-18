const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applySafeFirebaseTestConfig,
  resolveSafeFirebaseTestConfig,
} = require("./e2e/setup/firestoreSafety.cjs");

function safeEnv(overrides = {}) {
  return {
    E2E_FIREBASE_PROJECT_ID: "cleartill-e2e",
    E2E_FIREBASE_CLIENT_EMAIL: "test@example.invalid",
    E2E_FIREBASE_PRIVATE_KEY: "test-private-key",
    E2E_NEXT_PUBLIC_FIREBASE_API_KEY: "test-api-key",
    E2E_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "cleartill-e2e.firebaseapp.com",
    E2E_NEXT_PUBLIC_FIREBASE_PROJECT_ID: "cleartill-e2e",
    E2E_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "cleartill-e2e.appspot.com",
    E2E_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123456789",
    E2E_NEXT_PUBLIC_FIREBASE_APP_ID: "1:123456789:web:e2e",
    ...overrides,
  };
}

test("Playwright fails closed when explicit E2E Firebase configuration is missing", () => {
  assert.throws(
    () => resolveSafeFirebaseTestConfig({}),
    /missing explicit test Firebase configuration/,
  );
  assert.throws(
    () => resolveSafeFirebaseTestConfig({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }),
    /missing explicit test Firebase configuration/,
  );
});

test("every direct Firebase project source rejects production aliases despite whitespace, case or emulators", () => {
  for (const source of [
    "FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT",
  ]) {
    assert.throws(
      () => resolveSafeFirebaseTestConfig(safeEnv({
        [source]: "  ClearTill  ",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      })),
      new RegExp(`${source} selects production Firebase project`),
    );
  }
});

test("known production project aliases are rejected", () => {
  for (const alias of [
    "cleartill",
    "projects/cleartill",
    "cleartill.firebaseapp.com",
    "cleartill.appspot.com",
  ]) {
    assert.throws(
      () => resolveSafeFirebaseTestConfig(safeEnv({
        E2E_FIREBASE_PROJECT_ID: alias,
        E2E_NEXT_PUBLIC_FIREBASE_PROJECT_ID: alias,
      })),
      /selects production Firebase project/,
    );
  }
});

test("FIREBASE_CONFIG and service-account project_id sources reject production", () => {
  for (const source of [
    "FIREBASE_CONFIG",
    "FIREBASE_SERVICE_ACCOUNT",
    "FIREBASE_ADMIN_SERVICE_ACCOUNT",
    "FIREBASE_SERVICE_ACCOUNT_KEY",
    "SERVICE_ACCOUNT_JSON",
  ]) {
    assert.throws(
      () => resolveSafeFirebaseTestConfig(safeEnv({ [source]: JSON.stringify({ project_id: "cleartill" }) })),
      /selects production Firebase project/,
    );
  }

  assert.throws(
    () => resolveSafeFirebaseTestConfig(
      safeEnv({ GOOGLE_APPLICATION_CREDENTIALS: "/tmp/production-service-account.json" }),
      { readFileSync: () => JSON.stringify({ project_id: "cleartill" }) },
    ),
    /GOOGLE_APPLICATION_CREDENTIALS\.project_id selects production Firebase project/,
  );
});

test("conflicting non-production project sources fail closed", () => {
  assert.throws(
    () => resolveSafeFirebaseTestConfig(safeEnv({ GCLOUD_PROJECT: "different-test-project" })),
    /selects conflicting Firebase project/,
  );
  assert.throws(
    () => resolveSafeFirebaseTestConfig(safeEnv({ E2E_NEXT_PUBLIC_FIREBASE_PROJECT_ID: "different-test-project" })),
    /E2E Firebase project mismatch/,
  );
});

test("safe explicit configuration replaces generic Firebase fallbacks", () => {
  const env = safeEnv();
  const config = applySafeFirebaseTestConfig(env);
  assert.equal(config.projectId, "cleartill-e2e");
  assert.equal(env.FIREBASE_PROJECT_ID, "cleartill-e2e");
  assert.equal(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, "cleartill-e2e");
  assert.equal(env.GCLOUD_PROJECT, "cleartill-e2e");
  assert.equal(env.GOOGLE_CLOUD_PROJECT, "cleartill-e2e");
  assert.deepEqual(JSON.parse(env.FIREBASE_CONFIG), { projectId: "cleartill-e2e" });
});
