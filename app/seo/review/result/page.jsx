export const metadata = {
  title: "Review recorded | ClearTill",
  robots: { index: false, follow: false },
};

export default async function SeoReviewResultPage({ searchParams }) {
  const query = await searchParams;
  const approved = query?.action === "approve";
  return (
    <main style={{ maxWidth: 680, margin: "64px auto", padding: 24, fontFamily: "Arial, sans-serif", color: "#143c3a" }}>
      <h1>{approved ? "Publication-ready export created." : "Review decision recorded."}</h1>
      <p>{approved
        ? "The article has not been published. Its article data, sources, quality report and any image that passed QA are ready for the separate publication step."
        : `The draft status is now ${String(query?.status || "updated").replaceAll("_", " ")}.`}</p>
    </main>
  );
}
