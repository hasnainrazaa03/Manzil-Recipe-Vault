import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './src/test/mswServer';

/**
 * Firebase is stubbed wholesale: the tests are about this app's behaviour, not
 * about Google's SDK, and initialising it for real needs live credentials.
 * `mockAuth.currentUser` is mutable so a test can act as a signed-in user —
 * see `signIn()` / `signOut()` in src/test/auth.ts.
 */
export const mockAuth: {
  currentUser: { uid: string; email: string; getIdToken: () => Promise<string> } | null;
} = { currentUser: null };

vi.mock('./src/firebase', () => ({
  app: {},
  auth: mockAuth,
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    callback(mockAuth.currentUser);
    return () => {};
  },
  signOut: async () => {
    mockAuth.currentUser = null;
  },
  GoogleAuthProvider: class {},
  signInWithPopup: async () => ({}),
  signInWithEmailAndPassword: async () => ({}),
  createUserWithEmailAndPassword: async () => ({}),
  sendPasswordResetEmail: async () => {},
  getAuth: () => mockAuth,
}));

afterEach(() => {
  mockAuth.currentUser = null;
});

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  installFetchSignalShim();
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => server.close());

/**
 * Vitest's jsdom environment does not expose `localStorage`, so persistence
 * code under test sees `undefined` and silently no-ops — which would make every
 * storage assertion vacuously pass rather than fail loudly.
 *
 * This is an in-memory `Storage` whose methods are writable, so
 * `vi.spyOn(localStorage, …)` can replace them for the quota and private-mode
 * tests.
 */
if (typeof localStorage === 'undefined') {
  const store = new Map<string, string>();

  // Writable and configurable so `vi.spyOn(localStorage, …)` can replace them
  // in the quota and private-mode tests.
  const method = (value: unknown) => ({ value, writable: true, configurable: true });

  const storage: Storage = Object.create(Storage.prototype, {
    length: { get: () => store.size, configurable: true },
    getItem: method((key: string) => store.get(String(key)) ?? null),
    setItem: method((key: string, value: string) => void store.set(String(key), String(value))),
    removeItem: method((key: string) => void store.delete(String(key))),
    clear: method(() => store.clear()),
    key: method((index: number) => [...store.keys()][index] ?? null),
  }) as Storage;

  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

// jsdom has no layout engine, so scrolling an element into view is a no-op it
// simply does not define. Every real browser has it.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom implements neither, and both are used by components under test.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
}

// Tiptap's ProseMirror view calls this during layout in jsdom.
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
}

/**
 * Under Vitest's jsdom environment, `globalThis.AbortSignal` is jsdom's class,
 * but `fetch` is Node's — and Node's validates with `instanceof` against its
 * own. So any request carrying a signal fails before it is sent:
 *
 *   TypeError: Expected signal ("AbortSignal {}") to be an instance of AbortSignal
 *
 * The app passes a signal on every query, so without this shim every one of
 * those requests surfaces as a generic network error and the whole data layer
 * becomes untestable — worse, silently so.
 *
 * Installed *after* `server.listen()`, because MSW replaces `globalThis.fetch`
 * when it starts; shimming first would just leave MSW's wrapper on the outside,
 * still handing the incompatible signal to Node.
 *
 * The signal is kept out of the request and its semantics reproduced around it,
 * so an abort still rejects with a real `AbortError`.
 */
function installFetchSignalShim(): void {
  const nativeFetch = globalThis.fetch;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    if (!signal) return nativeFetch(input, init);

    const { signal: _dropped, ...rest } = init ?? {};

    if (signal.aborted) {
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    }

    return Promise.race([
      nativeFetch(input, rest),
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true },
        );
      }),
    ]);
  }) as typeof fetch;
}
