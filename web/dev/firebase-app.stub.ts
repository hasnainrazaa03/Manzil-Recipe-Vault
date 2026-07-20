/**
 * Stands in for `firebase/app` in demo mode only, aliased by `vite.config.ts`
 * when `VITE_DEMO` is set. Production code is untouched.
 */
export function initializeApp(config: unknown): unknown {
  return { name: 'demo', options: config };
}
