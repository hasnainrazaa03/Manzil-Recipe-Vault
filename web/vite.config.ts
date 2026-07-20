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

    /**
     * No `manualChunks`. Deliberately.
     *
     * Hand-splitting vendors into `react` / `editor` / `firebase` chunks took
     * the whole site down with a blank page and
     * `Cannot set properties of undefined (setting 'Children')`.
     *
     * React and react-dom are CommonJS, so Rollup synthesises interop helper
     * modules for them. Those helpers are virtual — they match no path rule —
     * so they landed in whichever chunk Rollup felt like, which turned out to
     * be `editor`. That made `react` import `editor` while `editor` imported
     * `react`: a circular chunk dependency, so the editor chunk evaluated
     * first and assigned onto a React namespace that did not exist yet.
     *
     * Rollup's automatic chunking already gets this right, and the actual win
     * was never here — it comes from route-level `lazy()` and from deferring
     * the editor until the recipe dialog opens, which keeps ~357 kB out of the
     * initial load regardless of how vendors are grouped.
     *
     * If vendor splitting is ever revisited, the rule is: every module a chunk
     * needs, including Rollup's generated helpers, must be assigned with it —
     * and the built output must be checked for cycles, because the build
     * succeeds either way.
     */
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
