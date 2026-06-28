import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-panel">
        <p className="eyebrow">Billie</p>
        <p className="helper-text">billie.money</p>
        <h1>Your payday heads-up for bills.</h1>
        <p>
          Tell Billie your bills.
          <br />
          Tell Billie your payday.
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
