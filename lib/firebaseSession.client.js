"use client";

let activeSync = null;

function sessionError(message) {
  const error = new Error(message);
  error.code = "auth/session-cookie-failed";
  return error;
}

export async function syncFirebaseSession(user) {
  if (!user || user.isAnonymous) {
    await clearFirebaseSession();
    return;
  }

  const idToken = await user.getIdToken();
  if (activeSync?.idToken === idToken) return activeSync.promise;

  const promise = fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { Authorization: `Bearer ${idToken}` },
    cache: "no-store",
  }).then(async (response) => {
    if (response.ok) return;
    const body = await response.json().catch(() => ({}));
    throw sessionError(body?.error || "Could not establish a secure browser session.");
  }).finally(() => {
    if (activeSync?.promise === promise) activeSync = null;
  });

  activeSync = { idToken, promise };
  return promise;
}

export async function clearFirebaseSession() {
  const pending = activeSync?.promise;
  if (pending) await pending.catch(() => undefined);
  activeSync = null;

  await fetch("/api/auth/session", {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
  }).catch(() => undefined);
}
