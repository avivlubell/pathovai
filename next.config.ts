import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/chat': ['./app/api/chat/prompt.txt'],
  },
  serverExternalPackages: ['pdf-parse'],
};

export default nextConfig;
