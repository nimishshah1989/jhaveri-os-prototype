import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — it must stay a real require at runtime
  // rather than being bundled, or the .node binary never ships.
  serverExternalPackages: ['better-sqlite3'],

  // The seeded database is opened by path, not imported, so Next's file tracing
  // cannot see it. Without this it is missing from the serverless bundle and every
  // page 500s on a deploy that built perfectly.
  outputFileTracingIncludes: {
    '/**': ['./mockdb/jhaveri.db'],
  },
};

export default nextConfig;
