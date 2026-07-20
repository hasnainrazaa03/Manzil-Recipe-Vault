/**
 * Stands in for `firebase/auth` in demo mode only, aliased by `vite.config.ts`
 * when `VITE_DEMO` is set. Production code is untouched.
 *
 * Mints tokens of the form `demo|<uid>`, which the demo API accepts in place of
 * real Firebase verification — see `server/dev/demo.ts`. The signed-in user is
 * remembered in `sessionStorage`, so a page refresh keeps you logged in but
 * closing the tab does not.
 */

const STORAGE_KEY = 'manzil-demo-user';

export interface DemoUser {
  uid: string;
  email: string;
  displayName: string;
  getIdToken: () => Promise<string>;
}

/** The accounts the seeded database knows about. */
export const DEMO_ACCOUNTS = [
  { uid: 'demo-user', email: 'you@example.com', displayName: 'You' },
  { uid: 'amina-uid', email: 'amina@example.com', displayName: 'Amina Raza' },
  { uid: 'bilal-uid', email: 'bilal@example.com', displayName: 'Bilal Khan' },
  { uid: 'sara-uid', email: 'sara@example.com', displayName: 'Sara Ahmed' },
];

function hydrate(uid: string): DemoUser | null {
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.uid === uid);
  if (!account) return null;
  return { ...account, getIdToken: async () => `demo|${account.uid}` };
}

type Listener = (user: DemoUser | null) => void;
const listeners = new Set<Listener>();

class DemoAuth {
  currentUser: DemoUser | null = null;

  constructor() {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) this.currentUser = hydrate(stored);
    } catch {
      /* sessionStorage unavailable */
    }
  }

  setUser(user: DemoUser | null) {
    this.currentUser = user;
    try {
      if (user) sessionStorage.setItem(STORAGE_KEY, user.uid);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    listeners.forEach((listener) => listener(user));
  }
}

export const demoAuth = new DemoAuth();

export function getAuth(): DemoAuth {
  return demoAuth;
}

export function onAuthStateChanged(_auth: unknown, callback: Listener): () => void {
  listeners.add(callback);
  // Asynchronous, like the real SDK, so consumers exercise their loading state.
  queueMicrotask(() => callback(demoAuth.currentUser));
  return () => listeners.delete(callback);
}

/**
 * Any email matching a seeded account signs you in as that account; anything
 * else signs you in as the default demo user. No password is checked, because
 * there is nothing here to protect.
 */
async function signInAs(email: string): Promise<{ user: DemoUser }> {
  const match = DEMO_ACCOUNTS.find(
    (account) => account.email.toLowerCase() === email.trim().toLowerCase(),
  );
  const user = hydrate(match?.uid ?? 'demo-user')!;
  demoAuth.setUser(user);
  return { user };
}

export const signInWithEmailAndPassword = (_auth: unknown, email: string) => signInAs(email);
export const createUserWithEmailAndPassword = (_auth: unknown, email: string) => signInAs(email);
export const signInWithPopup = () => signInAs('you@example.com');

export async function signOut(): Promise<void> {
  demoAuth.setUser(null);
}

export async function sendPasswordResetEmail(): Promise<void> {
  /* nothing to send in demo mode */
}

export class GoogleAuthProvider {}

export type User = DemoUser;
export type AuthError = { code?: string; message?: string };
