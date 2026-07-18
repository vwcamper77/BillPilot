import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";
import { verifyEmailActionToken } from "@/lib/email";

export const metadata = { title: "Email preferences", robots: PRIVATE_PAGE_ROBOTS };

export default async function UnsubscribePage({ searchParams }) {
  const params = await searchParams;
  const status = String(params?.status || "");
  const fields = { uid: String(params?.uid || ""), type: String(params?.type || ""), exp: String(params?.exp || ""), token: String(params?.token || "") };
  const valid = verifyEmailActionToken({ userId: fields.uid, type: fields.type, expiresAt: Number(fields.exp), token: fields.token });
  const complete = ["success", "used", "expired"].includes(status);
  const title = status === "success" ? "Optional reminders turned off" : status === "used" ? "This link has already been used" : status === "expired" || (!valid && !complete) ? "Unsubscribe link expired" : "Turn off optional reminders?";
  const copy = status === "success"
    ? "Optional ClearTill balance and bill reminder emails have been switched off. Essential account and billing messages are unchanged."
    : status === "used" ? "This preference link was already used. Sign in to ClearTill to review your current reminder settings."
      : status === "expired" || (!valid && !complete) ? "Open a fresh ClearTill email or sign in to manage your reminder settings."
        : "Confirm to turn off optional balance and bill reminder emails. Essential account and billing messages will remain enabled.";
  return (
    <main className="account-shell"><section className="account-panel">
      <h1>{title}</h1><p className="helper-text">{copy}</p>
      {valid && !complete ? <form action="/api/email/unsubscribe" method="post">
        {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <button className="primary-button" type="submit">Turn off optional reminders</button>
      </form> : null}
    </section></main>
  );
}
