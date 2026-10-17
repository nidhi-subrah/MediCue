const backend = process.env.BACKEND_URL ?? 'http://localhost:8000'

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
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
