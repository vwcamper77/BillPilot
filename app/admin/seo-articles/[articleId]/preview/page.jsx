import PreviewClient from "./PreviewClient";

export const metadata = {
  title: "Unpublished Journal preview | ClearTill admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SeoArticlePreviewPage({ params, searchParams }) {
  const { articleId } = await params;
  const query = await searchParams;
  return <PreviewClient articleId={articleId} initialMode={query?.mode || "desktop"} />;
}
