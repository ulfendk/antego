import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { linesPlugin } from './build/lines.js';

const SERVER = `http://localhost:${process.env.VITE_SERVER_PORT ?? 2567}`;
const content = resolve(__dirname, '../../content');

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
  },
  server: {
    host: true,
    proxy: { '/version.json': SERVER },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  plugins: [
    linesPlugin(resolve(content, 'lines'), resolve(__dirname, 'src/generated/lines.ts')),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // We register the service worker ourselves (src/pwa/updater.ts) to control when updates apply.
      injectRegister: false,
      registerType: 'prompt',
      pwaAssets: { config: true },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,glb,json,mp3}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'Antego – myresoldater',
        short_name: 'Antego',
        description: 'Myresoldater og Stratego i en god blanding.',
        lang: 'da',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#3b4a22',
        theme_color: '#4a6b2a',
        categories: ['games', 'kids'],
      },
      devOptions: { enabled: false },
    }),
  ],
});
