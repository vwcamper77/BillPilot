import { FieldValue, getAdminDb } from "@/lib/firebaseAdmin";
import { sendGa4Event } from "@/lib/analytics/ga4.server";

export async function recordFirstSaveAndTutorial({ uid, saveEvent }) {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const markerRef = userRef.collection("analytics").doc("ga4_onboarding");
  const [balance, income, bills] = await Promise.all([
    userRef.collection("settings").doc("balance").get(),
    userRef.collection("income").doc("main").get(),
    userRef.collection("bills").limit(1).get(),
  ]);
  const tutorialReady = balance.exists
    && Number.isFinite(Number(balance.data()?.currentBalance))
    && income.exists
    && Number.isFinite(Number(income.data()?.amount))
    && Number.isInteger(Number(income.data()?.payDay))
    && !bills.empty;

  const claimed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(markerRef);
    const data = snapshot.exists ? snapshot.data() : {};
    const patch = { updatedAt: FieldValue.serverTimestamp() };
    const events = [];
    if (!data?.[saveEvent]) {
      patch[saveEvent] = true;
      events.push(saveEvent);
    }
    if (tutorialReady && !data?.tutorial_complete) {
      patch.tutorial_complete = true;
      events.push("tutorial_complete");
    }
    if (events.length) transaction.set(markerRef, patch, { merge: true });
    return events;
  });

  await Promise.all(claimed.map((eventName) => sendGa4Event({ eventName, userId: uid })
    .catch((error) => console.error("[ga4-onboarding] send failed", { eventName, uid }, error))));
  return claimed;
}
