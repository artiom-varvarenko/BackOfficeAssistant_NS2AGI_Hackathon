import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: at('./frontend/'),
  publicDir: at('../web/public/'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^next\/link$/, replacement: at('./frontend/link.tsx') },
      { find: /^next\/navigation$/, replacement: at('./frontend/navigation.ts') },
      { find: '@', replacement: at('../web/src/') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  // Tailwind is handled by the Vite plugin, not the separate Next PostCSS config.
  css: { postcss: { plugins: [] } },
  server: {
    fs: { allow: [at('../')] },
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: {
    outDir: at('./dist/client/'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
        warn(warning);
      },
    },
  },
});
