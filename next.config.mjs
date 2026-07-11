const isDev = process.env.NODE_ENV !== "production";
const devDistDir = process.env.NEXT_DIST_DIR;

/** @type {import("next").NextConfig} */
const nextConfig = {
  ...(isDev && devDistDir ? { distDir: devDistDir } : {}),
  async headers() {
    // The claim journey's query string carries a one-time access token; the
    // success page's carries a Stripe session id. Neither should leak via
    // the Referer header if either page ever links out.
    return [
      {
        source: "/access/claim",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/billing/success",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
