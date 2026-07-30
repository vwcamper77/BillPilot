import crypto from "node:crypto";
import { getAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VARIANTS = new Set(["master", "mobile", "svg"]);

export async function GET(request, { params }) {
  try {
    const { slug, versionId, variant } = await params;
    if (!VARIANTS.has(variant)) return new Response("Not found.", { status: 404 });
    const db = getAdminDb();
    const publicSnapshot = await db.collection("seoPublishedJournal").doc(slug).get();
    if (
      !publicSnapshot.exists
      || publicSnapshot.data()?.published !== true
      || publicSnapshot.data()?.versionId !== versionId
    ) return new Response("Not found.", { status: 404 });
    const assetSnapshot = await db.collection("seoPublishedJournalAssets")
      .doc(publicSnapshot.data().assetDocumentId)
      .get();
    if (!assetSnapshot.exists || assetSnapshot.data()?.versionId !== versionId) {
      return new Response("Not found.", { status: 404 });
    }
    const asset = assetSnapshot.data();
    const source = variant === "master"
      ? asset.pngBase64
      : variant === "mobile"
        ? asset.mobilePngBase64
        : asset.svg;
    if (!source) return new Response("Not found.", { status: 404 });
    const body = variant === "svg"
      ? Buffer.from(source)
      : Buffer.from(source, "base64");
    const etag = `"${crypto.createHash("sha256").update(body).digest("hex")}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304 });
    }
    return new Response(body, {
      headers: {
        "Content-Type": variant === "svg" ? "image/svg+xml; charset=utf-8" : "image/png",
        "Content-Length": String(body.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found.", { status: 404 });
  }
}
