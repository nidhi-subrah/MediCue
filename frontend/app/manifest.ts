import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SilentSignal — Communication that adapts to you',
    short_name: 'SilentSignal',
    description:
      'SilentSignal helps people communicate when speaking, typing, seeing, or touching a screen becomes difficult.',
    start_url: '/home',
    display: 'standalone',
    background_color: '#f7f6f3',
    theme_color: '#f7f6f3',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }
}
