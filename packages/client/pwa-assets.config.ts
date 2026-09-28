import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#4a6b2a' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#4a6b2a' } },
  },
  images: ['public/logo.svg'],
});
