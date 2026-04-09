import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  // Ensure pdfjs worker file is included in Vercel deployment bundle.
  // The parse-pdf route references it via createRequire.resolve() which
  // output file tracing cannot detect statically.
  outputFileTracingIncludes: {
    '/api/services/parse-pdf': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
  turbopack: {},
};

export default nextConfig;
