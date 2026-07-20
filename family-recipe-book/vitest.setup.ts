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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => server.close());

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
