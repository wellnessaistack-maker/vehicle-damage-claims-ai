import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships native binaries; keep it out of the server bundle.
  serverExternalPackages: ["sharp"],
  // The evaluation runner reads the labelled cases and photos from disk.
  outputFileTracingIncludes: {
    "/api/eval-run/**": ["./eval/**/*", "./demo-images/**/*"],
    "/api/eval-cases": ["./eval/cases.csv", "./eval/claims.json"],
  },
};

export default nextConfig;
