/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Demo mode swaps the Firebase SDK for local stubs, so the app can be run and
 * explored without a Firebase project. It is opt-in via `VITE_DEMO=1`
 * (`npm run demo`), and the aliases are absent from every other build — no
 * production code branches on it.
 */
const isDemo = process.env.VITE_DEMO === '1';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: isDemo
      ? {
          'firebase/app': fileURLToPath(new URL('./dev/firebase-app.stub.ts', import.meta.url)),
          'firebase/auth': fileURLToPath(new URL('./dev/firebase-auth.stub.ts', import.meta.url)),
        }
      : {},
  },
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
