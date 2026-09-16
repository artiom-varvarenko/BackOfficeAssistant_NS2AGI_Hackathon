import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/Node-only packages must not be bundled into the server build.
  serverExternalPackages: ["better-sqlite3", "unpdf", "pdfjs-dist"],
  // Proxy buffers bodies before route handlers. Keep its cap above the
  // validated 25 MiB PDF plus multipart metadata, not Next's 10 MiB default.
  experimental: { proxyClientMaxBodySize: 26 * 1024 * 1024 },
};

export default nextConfig;
