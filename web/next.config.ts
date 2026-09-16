import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/Node-only packages must not be bundled into the server build.
  serverExternalPackages: ["better-sqlite3", "unpdf", "pdfjs-dist"],
};

export default nextConfig;
