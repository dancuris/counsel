import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default (1MB) is too small for recruiter attachments (PDFs, docx).
      // Capped under 4.5MB since that's Vercel's own hard serverless request
      // body limit - a higher value here wouldn't actually be reachable.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
