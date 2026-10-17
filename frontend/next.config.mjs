const backend = process.env.BACKEND_URL ?? 'http://localhost:8000'

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Dev-only route indicator; disabled because it overlaps the mobile bottom
  // nav bar at narrow widths. Compile/runtime errors still surface without it.
  devIndicators: false,
  images: {
    unoptimized: true,
  },
  experimental: {
    externalDir: true,
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }]
  },
  env: {
    NEXT_PUBLIC_BACKEND_WS: backend.replace(/^http/, 'ws'),
  },
}

export default nextConfig
