import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-panel">
        <p className="eyebrow">BillPilot</p>
        <h1>Tell it your bills. It tells you what&apos;s coming before payday.</h1>
        <Link className="primary-link" href="/dashboard">
          Open dashboard
        </Link>
      </section>
    </main>
  );
}
