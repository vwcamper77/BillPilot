import {
  readSeoHeroAsset,
  verifySeoHeroAssetToken,
} from "@/lib/seoArticles/admin.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VARIANTS = new Set(["master", "mobile", "svg"]);

export async function GET(request, { params }) {
  try {
    const { articleId, variant } = await params;
    if (!VARIANTS.has(variant)) return new Response("Asset not found.", { status: 404 });
    const token = new URL(request.url).searchParams.get("token");
    verifySeoHeroAssetToken(token, { articleId, variant });
    const asset = await readSeoHeroAsset(articleId, variant);
    if (request.headers.get("if-none-match") === asset.etag) {
      return new Response(null, { status: 304 });
    }
    return new Response(asset.body, {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.body.length),
        "Cache-Control": "private, max-age=300, must-revalidate",
        ETag: asset.etag,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response("Hero asset link is invalid or expired.", {
      status: 403,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
}
