import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships native binaries; keep it out of the server bundle.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
