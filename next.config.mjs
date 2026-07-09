const isDev = process.env.NODE_ENV !== "production";
const devDistDir = process.env.NEXT_DIST_DIR;

/** @type {import("next").NextConfig} */
const nextConfig = {
  ...(isDev && devDistDir ? { distDir: devDistDir } : {}),
};

export default nextConfig;
