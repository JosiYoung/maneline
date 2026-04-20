import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Mane Line SPA.
// Worker serves this bundle via the `[assets]` binding in wrangler.toml.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // R3F Canvas uses react-reconciler, which Vite's pre-bundler can
    // accidentally give a second copy of React to — causing "Invalid hook
    // call" errors. Force-dedupe.
    dedupe: ['react', 'react-dom', 'scheduler'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@react-three/fiber', '@react-three/drei'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: true,
    // In local dev the SPA talks to the deployed Worker for /api/* and
    // the Supabase auth callback under /auth/v1/*. Prevents CORS
    // headaches and keeps the feature-flag + chat endpoints honest.
    proxy: {
      '/api': {
        target: 'https://maneline-coming-soon.josi-c5b.workers.dev',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
