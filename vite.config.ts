import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import mkcert from 'vite-plugin-mkcert';
import express from 'express';

import { execSync } from 'child_process';
import pkg from './package.json' with { type: 'json' };

const gitHash = execSync('git rev-parse --short HEAD 2>/dev/null || echo "dev"').toString().trim();
const buildVersion = `v${pkg.version}-${gitHash}`;

export default defineConfig(({ command }) => ({
    define: {
        'import.meta.env.PUBLIC_APP_VERSION': JSON.stringify(buildVersion)
    },	
    server: {
        watch: {
            ignored: [
                '**/.git/**',
                '**/node_modules/**',
                '**/data/images/**',
                '**/data/plugins/**',
                '**/services/**',
                '**/dev-dist/**',
                '**/dist/**',
                '**/old/**',
                '**/build/**',
                '**/*.db*',
                '**/*.log'
            ]
        },
        allowedHosts: true
    },
	ssr: {
        external: ['canvas', 'crop-node', 'get-pixels/node-pixels', 'pdf-parse', 'bcrypt', 'sharp', 'exif-reader']
    },
    
    // completely exclude them from Vite's pre-bundler:
    optimizeDeps: {
        exclude: ['canvas', 'crop-node', 'get-pixels/node-pixels', 'bcrypt', 'sharp', 'exif-reader']
    },

	plugins: [
        // Mount our out-of-band data directory during development
        {
            name: 'serve-data',
            configureServer(server) {
                server.middlewares.use('/images', express.static('data/images'));
            }
        },

        // Only run mkcert during local dev server
        command === 'serve' && mkcert({
            hosts: ['localhost', '127.0.0.1', '192.168.178.104']
        }),

		sveltekit(),
		SvelteKitPWA({
			srcDir: './src',
            mode: command === 'serve' ? 'development' : 'production',
			scope: '/',
			base: '/',
			selfDestroying: process.env.SELF_DESTROYING_SW === 'true',
			manifest: {
				short_name: 'Troves',
				name: 'Troves',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				// theme_color: "#ffffff",
				// background_color: "#ffffff",
                theme_color: "#1d232a",
                background_color: "#1d232a",
				"icons": [
					{
					  "src": "images/pwa-64x64.png",
					  "sizes": "64x64",
					  "type": "image/png"
					},
					{
					  "src": "images/pwa-192x192.png",
					  "sizes": "192x192",
					  "type": "image/png"
					},
					{
					  "src": "images/troves512.png",
					  "sizes": "512x512",
					  "type": "image/png"
					},
					{
					  "src": "images/troves512.png",
					  "sizes": "512x512",
					  "type": "image/png",
					  "purpose": "maskable"
					}
				],
				share_target: {
					action: "/timeline?/capture",
					method: "POST",
					enctype: "multipart/form-data",
					params: {
						title: "title",
						text: "text",
						url: "url",
						files: [
							{ name: "images", accept: ["image/*", "video/*"] }
						]
					}
				}				  
			},
			workbox: {
				globIgnores: ['**/client/images/u/**', '**/client/images/tests/**', '**/troves.png'],
				globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff,woff2}'],
                navigateFallback: null, // CRITICAL: Stop SW from serving poisoned HTML shells on Ctrl+R
				cleanupOutdatedCaches: true,
                skipWaiting: true,      // Kills the old Service Worker instantly on update
                clientsClaim: true,     // Takes control of the open tab immediately
				runtimeCaching: [
					{
						// Cache API calls and __data.json with NetworkFirst.
						// CRITICAL: Exclude /api/events! Caching an SSE stream crashes Workbox.
						urlPattern: ({ request, url }) => {
							if (url.pathname.includes('/api/events')) return false;
							return url.pathname.startsWith('/api/') ||
							       url.pathname.endsWith('__data.json') ||
							       url.search.includes('__data.json');
						},						
						handler: 'NetworkFirst',
						options: {
							cacheName: 'app-dynamic-data',
							networkTimeoutSeconds: 10,
							expiration: {
								maxEntries: 200,
								maxAgeSeconds: 7 * 24 * 60 * 60 // 1 week
							},
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					}
				]				
			},
			devOptions: {
				enabled: true,
				suppressWarnings: process.env.SUPPRESS_WARNING === 'true',
				type: 'module',
                // navigateFallback: '/',
			},
			// if you have shared info in svelte config file put in a separate module and use it also here
			kit: {
				includeVersionFile: true,
			},
		}),

	],
}));
