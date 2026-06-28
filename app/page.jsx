import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-panel">
        <p className="eyebrow">ClearTill</p>
        <p className="helper-text">cleartill.money</p>
        <h1>Know you&apos;re clear till payday.</h1>
        <p>
          Tell ClearTill your bills.
          <br />
          Tell ClearTill your payday.
          <br />
          See what&apos;s coming before you get paid.
        </p>
        <Link className="primary-link" href="/dashboard">
          Open dashboard
        </Link>
      </section>
    </main>
  );
}
