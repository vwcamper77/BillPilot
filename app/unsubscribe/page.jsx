export default async function UnsubscribePage({ searchParams }) {
  const params = await searchParams;
  const success = params?.success === "1";

  return (
    <main className="account-shell">
      <section className="account-panel">
        <h1>{success ? "Optional reminders turned off" : "Unsubscribe link expired"}</h1>
        <p className="helper-text">
          {success
            ? "Optional ClearTill reminder emails have been switched off for this account. Essential account and preview-state emails will still be sent."
            : "Open a fresh email from ClearTill and use the latest unsubscribe link."}
        </p>
      </section>
    </main>
  );
}
