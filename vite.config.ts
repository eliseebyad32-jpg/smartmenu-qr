import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
        manifest: {
          id: '/',
          name: 'SMARTMENU QR',
          short_name: 'SMARTMENU',
          description:
            'Plateforme de menus numériques par QR code multi-restaurants avec mode hors ligne.',
          lang: 'fr',
          categories: ['food', 'restaurant'],
          orientation: 'any',
          theme_color: '#09090B',
          background_color: '#09090B',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Precache lightweight shell + crisp dish thumbnails (~1.5 MB total vs 36 MB raw JPGs)
          // so slow mobile connections never saturate bandwidth on first install.
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}', '**/*-thumb.webp'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/local-uploads\//,
            /^\/local-cache\//,
            /^\/assets\//,
            /\/[^/?]+\.[a-zA-Z0-9]{1,8}$/,
          ],
          ignoreURLParametersMatching: [/^restaurant$/, /^table$/, /^mode$/, /^wifi$/, /^utm_/, /^fbclid$/],
          runtimeCaching: [
            {
              urlPattern: /\/src\/assets\/images\/.*\.(?:webp|jpg|jpeg|avif|png)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'smartmenu-local-images-v1',
                expiration: {
                  maxEntries: 300,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /\/(?:local-uploads|local-cache)\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'smartmenu-local-uploads-v1',
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'smartmenu-supabase-images-v1',
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'smartmenu-supabase-api-v1',
                networkTimeoutSeconds: 4,
                expiration: {
                  maxEntries: 40,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      // Copies src/assets into dist/ during writeBundle (before VitePWA closeBundle)
      // so all *-thumb.webp files are discovered for precaching even on clean builds.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        writeBundle(outputOptions): void {
          const outDir = outputOptions.dir
            ? path.resolve(outputOptions.dir)
            : path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(outDir, 'src/assets');
          if (fs.existsSync(outDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
      {
        name: 'serve-project-export-zip',
        configureServer(server) {
          server.middlewares.use('/export/smartmenu-qr-complet.zip', (_req, res, next) => {
            const zipPath = path.resolve(import.meta.dirname, 'exports/smartmenu-qr-complet.zip');
            if (!fs.existsSync(zipPath)) {
              next();
              return;
            }
            const stat = fs.statSync(zipPath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="smartmenu-qr-complet.zip"');
            res.setHeader('Content-Length', String(stat.size));
            fs.createReadStream(zipPath).pipe(res);
          });
        },
      },
    ],
    build: {
      rolldownOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
              return 'react-vendor';
            }
            if (id.includes('node_modules/@supabase/')) {
              return 'supabase-vendor';
            }
            if (id.includes('node_modules/lucide-react/')) {
              return 'icons-vendor';
            }
            if (id.includes('node_modules/qrcode/')) {
              return 'qrcode-vendor';
            }
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
