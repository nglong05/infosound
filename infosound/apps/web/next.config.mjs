import path from 'node:path';
export default {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../../..'),
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: { cpus: 1 },
  images: { unoptimized: true },
};
