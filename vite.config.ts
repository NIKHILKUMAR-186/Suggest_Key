import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('.', import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        output: {
          /**
           * Group the long-lived third-party code into stable, separately
           * cacheable chunks.
           *
           * Without this, every app change invalidates the one shared vendor
           * blob, so a returning user re-downloads React, Supabase and the icon
           * set on every deploy. Splitting them means an app-only release ships
           * a small app chunk and these stay byte-identical in the browser cache.
           *
           * `lucide-react` is grouped deliberately: it is ~300 tiny modules, and
           * left to default splitting it produced ~60 separate sub-kilobyte icon
           * chunks. Fetching dozens of sub-1 KB files costs more in round trips
           * than the bytes saved, so one icon chunk is strictly better here.
           */
          advancedChunks: {
            groups: [
              { name: 'vendor-icons', test: /node_modules[\\/]lucide-react/ },
              { name: 'vendor-supabase', test: /node_modules[\\/]@supabase/ },
              { name: 'vendor-motion', test: /node_modules[\\/](motion|framer-motion)/ },
              { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'vendor', test: /node_modules/ },
            ],
          },
        },
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
