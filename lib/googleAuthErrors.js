export function friendlyGoogleAuthError(error) {
  const code = String(error?.code || "");

  if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
    return "Your browser blocked the Google sign-in window. Allow pop-ups for ClearTill, then try again.";
  }

  if (code === "auth/popup-closed-by-user") {
    return "The Google sign-in window was closed before you finished. Try again when you're ready.";
  }

  if (code === "auth/unauthorized-domain") {
    return "Google sign-in is not available on this web address yet. Please use email sign-in or contact support.";
  }

  if (code === "auth/operation-not-allowed") {
    return "Google sign-in is not enabled right now. Please use email sign-in or contact support.";
  }

  if (code === "auth/network-request-failed") {
    return "Check your internet connection, then try Google sign-in again.";
  }

  if (code === "auth/credential-already-in-use") {
    return "This Google account already has a ClearTill login. Select Continue with Google again to sign in.";
  }

  return "We couldn't sign you in with Google right now. Please try again, or use email sign-in.";
}

export function logGoogleAuthError(error, context) {
  const code = String(error?.code || "unknown");
  console.error("[ClearTill Google auth]", { code, context });
}
