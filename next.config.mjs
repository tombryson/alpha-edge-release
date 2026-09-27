import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  // Run `npm run analyze` to generate the report.
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false, // writes HTML files to .next/analyze/ instead of auto-opening
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ] }];
  },
  // Keep local previews same-origin without changing the deployed CORS policy.
  async rewrites() {
    const target = process.env.ALPHA_EDGE_DEV_API_PROXY_URL;
    if (process.env.APP_ACCESS_MODE === 'demo' || process.env.APP_ACCESS_MODE === 'owner' || process.env.NODE_ENV !== 'development' || !target) return [];
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('ALPHA_EDGE_DEV_API_PROXY_URL must be an HTTP API URL without credentials, query or fragment');
    }
    return [{
      source: '/api/trading/:path*',
      destination: `${url.href.replace(/\/+$/, '')}/:path*`,
    }];
  },
  images: {
    // Serve optimised WebP/AVIF images via Next's built-in pipeline.
    // Local /public assets are handled automatically; add remotePatterns
    // here if external image domains are needed in future.
    formats: ['image/avif', 'image/webp'],
  },
  output: 'standalone',
};

export default withBundleAnalyzer(nextConfig);
