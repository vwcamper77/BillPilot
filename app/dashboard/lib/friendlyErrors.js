export function friendlyAuthError(error) {
  const code = error?.code || "";

  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (
    code === "auth/user-not-found" ||
    code === "auth/wrong-password" ||
    code === "auth/invalid-credential"
  ) return "That email or password doesn't look right.";
  if (code === "auth/email-already-in-use") return "This email is already registered. Try signing in instead.";
  if (code === "auth/weak-password") return "Use a password of at least 6 characters.";
  if (code === "auth/too-many-requests") return "Too many attempts. Try again in a few minutes.";
  if (code === "auth/popup-closed-by-user") return "Google sign-in was cancelled. Try again or use email.";
  if (code === "auth/unauthorized-domain") return "Google sign-in was blocked. Try again or use email.";
  if (code === "auth/network-request-failed") return "Network error. Check your connection and try again.";
  if (code === "auth/operation-not-allowed") return "This sign-in method isn't enabled. Try another option.";
  if (code === "auth/user-disabled") return "This account has been disabled. Contact support.";

  return "Something went wrong. Try again.";
}

export function friendlyGoogleAuthError(error) {
  const code = error?.code || "";

  if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
    return "Google sign-in was blocked by the browser. Please try again, or use email sign-in.";
  }

  if (code === "auth/unauthorized-domain") {
    return "Google sign-in was blocked for this domain. Add this Vercel domain in Firebase Authentication > Settings > Authorized domains.";
  }

  if (code === "auth/operation-not-allowed") {
    return "Google sign-in is not enabled in Firebase Authentication yet.";
  }

  const message = friendlyAuthError(error);

  if (message !== "Something went wrong. Try again.") {
    return message;
  }

  return "Google sign-in failed. Check Firebase Google sign-in and Authorized domains, then try again.";
}

export function friendlyServerErrorMessage(message) {
  if (!message) return "";
  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return "Check your internet connection and try again.";
  }
  // Raw SDK/runtime errors aren't useful to show verbatim; anything else
  // (server validation text, our own timeout messages) is safe to surface.
  if (/^(firebaseerror|typeerror|referenceerror):/i.test(message)) {
    return "";
  }
  return message;
}

export function friendlySettingsError(error, fallbackMessage) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (code === "permission-denied" || message.toLowerCase().includes("insufficient permissions")) {
    return "ClearTill could not save that setting right now. Please sign in again and try once more.";
  }

  if (code === "auth/id-token-expired" || code === "auth/invalid-id-token") {
    return "Please sign in again before updating that setting.";
  }

  return friendlyServerErrorMessage(message) || fallbackMessage;
}

export function friendlyBillSaveError(error, fallbackMessage) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (code === "permission-denied" || message.toLowerCase().includes("insufficient permissions")) {
    return "ClearTill could not save that bill right now. Please sign in again and try once more.";
  }

  if (code === "auth/id-token-expired" || code === "auth/invalid-id-token") {
    return "Please sign in again before saving that bill.";
  }

  return friendlyServerErrorMessage(message) || fallbackMessage;
}
