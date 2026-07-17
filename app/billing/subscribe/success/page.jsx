import Logo from "@/components/Logo";
import SubscriptionActivation from "./SubscriptionActivation";

export const metadata = {
  title: "Subscription started | ClearTill",
};

export default async function SubscriptionSuccessPage({ searchParams }) {
  const params = await searchParams;
  const sessionId = String(params?.session_id || "").trim();

  return (
    <main className="account-shell">
      <section className="account-panel">
        <Logo className="eyebrow-logo" />
        <SubscriptionActivation sessionId={sessionId} />
      </section>
    </main>
  );
}
