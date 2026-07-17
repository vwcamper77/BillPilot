import { resolveEntitlementForUid } from "@/lib/entitlementResolver.server";
import { inspectCompletePosition } from "@/lib/previewLifecycle.server";

export async function assertCanEditFinancialData(uid, { accountEmail = null } = {}) {
  const access = await resolveEntitlementForUid(uid, { accountEmail });
  if (access.canStartPreview) {
    const position = await inspectCompletePosition(uid);
    if (position.complete) {
      const error = new Error("Your first position is ready. Start the live preview before making more changes.");
      error.code = "preview/finalization-required";
      error.access = access;
      throw error;
    }
  }
  if (access.canEdit) return access;
  const error = new Error("Your live ClearTill position is paused. Choose a plan to make updates again.");
  error.code = "access/read-only";
  error.access = access;
  throw error;
}

export function isReadOnlyAccessError(error) {
  return error?.code === "access/read-only" || error?.code === "preview/finalization-required";
}
