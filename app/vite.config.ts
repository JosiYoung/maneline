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
    // Split heavy vendor libs into their own long-lived chunks. Each one
    // gets a content-hashed filename, so when the app code changes but
    // (say) recharts hasn't, the user's browser keeps the cached vendor
    // chunk and only re-fetches the small app chunk. Without this every
    // deploy invalidates all 2.1 MB.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'three-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
          'motion-vendor': ['framer-motion', 'gsap'],
          'chart-vendor': ['recharts'],
          'pdf-vendor': ['@react-pdf/renderer'],
          'radix-vendor': [
            '@radix-ui/react-avatar',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slot',
            '@radix-ui/react-tabs',
          ],
          'heroui-vendor': ['@heroui/react'],
          'supabase-vendor': ['@supabase/supabase-js'],
          'stripe-vendor': ['@stripe/react-stripe-js', '@stripe/stripe-js'],
          'query-vendor': ['@tanstack/react-query', '@tanstack/react-table'],
          'form-vendor': ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
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
