/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * Firebase and the editor are large and change rarely, so they belong
         * in their own chunks — a deploy that only touches app code then leaves
         * them cached.
         *
         * The function form rather than the object form: the object form silently
         * produced no split here, because these packages are reached through
         * subpath entries (`firebase/auth`, `@tiptap/pm/*`) that do not match
         * the bare specifiers listed against each chunk name.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('firebase') || id.includes('@firebase')) return 'firebase';
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('react-router')) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Without an explicit origin jsdom runs on `about:blank`, which is an
    // opaque origin — and an opaque origin has no `localStorage` at all, so
    // every persistence test sees `undefined` rather than a working store.
    environmentOptions: {
      jsdom: { url: 'http://localhost:5173' },
    },
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
