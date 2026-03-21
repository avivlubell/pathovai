import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/chat': ['./app/api/chat/prompt.txt'],
  },
  serverExternalPackages: [],
};

export default nextConfig;
