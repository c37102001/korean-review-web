import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['app-icon.svg'],
      manifest: {
        name: '韓文筆記',
        short_name: '韓文筆記',
        description: '韓文單字、筆記、字幕與間隔複習工具',
        lang: 'zh-Hant',
        theme_color: '#f7faf7',
        background_color: '#f7faf7',
        display: 'standalone',
        start_url: '/korean-review-web/',
        scope: '/korean-review-web/',
        icons: [{ src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
  base: '/korean-review-web/',
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'vendor-firebase';
          if (id.includes('/lucide-react/')) return 'vendor-icons';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
});
