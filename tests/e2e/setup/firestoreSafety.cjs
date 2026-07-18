const PRODUCTION_FIREBASE_PROJECT_ALIASES = new Set([
  "cleartill",
  "projects/cleartill",
  "cleartill.firebaseapp.com",
  "cleartill.appspot.com",
]);

const REQUIRED_E2E_ENV = [
  "E2E_FIREBASE_PROJECT_ID",
  "E2E_FIREBASE_CLIENT_EMAIL",
  "E2E_FIREBASE_PRIVATE_KEY",
  "E2E_NEXT_PUBLIC_FIREBASE_API_KEY",
  "E2E_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "E2E_NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "E2E_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "E2E_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "E2E_NEXT_PUBLIC_FIREBASE_APP_ID",
];

const DIRECT_PROJECT_ID_SOURCES = [
  "FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "E2E_FIREBASE_PROJECT_ID",
  "E2E_NEXT_PUBLIC_FIREBASE_PROJECT_ID",
];

const JSON_CREDENTIAL_SOURCES = [
  "FIREBASE_CONFIG",
  "FIREBASE_SERVICE_ACCOUNT",
  "FIREBASE_ADMIN_SERVICE_ACCOUNT",
  "FIREBASE_SERVICE_ACCOUNT_KEY",
  "SERVICE_ACCOUNT_JSON",
];

function normalizeProjectId(value) {
  return String(value || "").trim().toLowerCase();
}

function parseJsonProjectId(rawValue, source) {
  if (!String(rawValue || "").trim()) return "";
  try {
    const parsed = JSON.parse(rawValue);
    return normalizeProjectId(parsed?.project_id || parsed?.projectId);
  } catch {
    throw new Error(`Refusing to run Playwright: ${source} is not valid JSON.`);
  }
}

function collectConfiguredProjectIds(env, { readFileSync } = {}) {
  const sources = [];

  for (const source of DIRECT_PROJECT_ID_SOURCES) {
    const projectId = normalizeProjectId(env[source]);
    if (projectId) sources.push({ source, projectId });
  }

  for (const source of JSON_CREDENTIAL_SOURCES) {
    const projectId = parseJsonProjectId(env[source], source);
    if (projectId) sources.push({ source: `${source}.project_id`, projectId });
  }

  const credentialsPath = String(env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (credentialsPath) {
    if (typeof readFileSync !== "function") {
      throw new Error("Refusing to run Playwright: cannot inspect GOOGLE_APPLICATION_CREDENTIALS.");
    }
    let contents;
    try {
      contents = readFileSync(credentialsPath, "utf8");
    } catch {
      throw new Error("Refusing to run Playwright: cannot read GOOGLE_APPLICATION_CREDENTIALS.");
    }
    const projectId = parseJsonProjectId(contents, "GOOGLE_APPLICATION_CREDENTIALS");
    if (!projectId) {
      throw new Error("Refusing to run Playwright: GOOGLE_APPLICATION_CREDENTIALS has no project_id.");
    }
    sources.push({ source: "GOOGLE_APPLICATION_CREDENTIALS.project_id", projectId });
  }

  return sources;
}

function resolveSafeFirebaseTestConfig(env = process.env, options = {}) {
  const missing = REQUIRED_E2E_ENV.filter((name) => !String(env[name] || "").trim());
  if (missing.length) {
    throw new Error(`Refusing to run Playwright: missing explicit test Firebase configuration: ${missing.join(", ")}.`);
  }

  const projectId = normalizeProjectId(env.E2E_FIREBASE_PROJECT_ID);
  const publicProjectId = normalizeProjectId(env.E2E_NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  if (projectId !== publicProjectId) {
    throw new Error(`Refusing to run Playwright: E2E Firebase project mismatch (${projectId} !== ${publicProjectId}).`);
  }

  const configuredSources = collectConfiguredProjectIds(env, options);
  for (const { source, projectId: configuredProjectId } of configuredSources) {
    if (PRODUCTION_FIREBASE_PROJECT_ALIASES.has(configuredProjectId)) {
      throw new Error(`Refusing to run Playwright: ${source} selects production Firebase project "${configuredProjectId}".`);
    }
    if (configuredProjectId !== projectId) {
      throw new Error(`Refusing to run Playwright: ${source} selects conflicting Firebase project "${configuredProjectId}" (expected "${projectId}").`);
    }
  }

  return {
    projectId,
    clientEmail: String(env.E2E_FIREBASE_CLIENT_EMAIL).trim(),
    privateKey: String(env.E2E_FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n"),
    publicConfig: {
      apiKey: String(env.E2E_NEXT_PUBLIC_FIREBASE_API_KEY).trim(),
      authDomain: String(env.E2E_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN).trim(),
      projectId: publicProjectId,
      storageBucket: String(env.E2E_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET).trim(),
      messagingSenderId: String(env.E2E_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID).trim(),
      appId: String(env.E2E_NEXT_PUBLIC_FIREBASE_APP_ID).trim(),
      measurementId: String(env.E2E_NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "").trim(),
    },
    emulator: {
      firestore: String(env.E2E_FIRESTORE_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST || "").trim(),
      auth: String(env.E2E_FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || "").trim(),
    },
  };
}

function applySafeFirebaseTestConfig(env = process.env, options = {}) {
  const config = resolveSafeFirebaseTestConfig(env, options);

  env.FIREBASE_PROJECT_ID = config.projectId;
  env.GCLOUD_PROJECT = config.projectId;
  env.GOOGLE_CLOUD_PROJECT = config.projectId;
  env.FIREBASE_CLIENT_EMAIL = config.clientEmail;
  env.FIREBASE_PRIVATE_KEY = config.privateKey;
  env.NEXT_PUBLIC_FIREBASE_API_KEY = config.publicConfig.apiKey;
  env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = config.publicConfig.authDomain;
  env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = config.publicConfig.projectId;
  env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = config.publicConfig.storageBucket;
  env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = config.publicConfig.messagingSenderId;
  env.NEXT_PUBLIC_FIREBASE_APP_ID = config.publicConfig.appId;
  env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID = config.publicConfig.measurementId;
  env.FIREBASE_CONFIG = JSON.stringify({ projectId: config.projectId });
  delete env.GOOGLE_APPLICATION_CREDENTIALS;

  if (config.emulator.firestore) env.FIRESTORE_EMULATOR_HOST = config.emulator.firestore;
  if (config.emulator.auth) env.FIREBASE_AUTH_EMULATOR_HOST = config.emulator.auth;

  return config;
}

module.exports = {
  applySafeFirebaseTestConfig,
  collectConfiguredProjectIds,
  resolveSafeFirebaseTestConfig,
};
