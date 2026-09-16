import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/Node-only packages must not be bundled into the server build.
  serverExternalPackages: ["better-sqlite3", "unpdf", "pdfjs-dist"],
  // Proxy clones request bodies; retain the full 25 MiB PDF plus multipart
  // metadata instead of truncating uploads at Next's default 10 MiB buffer.
  experimental: { proxyClientMaxBodySize: "26mb" },
};

export default nextConfig;
