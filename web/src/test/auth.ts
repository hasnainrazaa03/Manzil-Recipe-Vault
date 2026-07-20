import { auth } from '../firebase';

/** Acts as a signed-in user for the duration of a test. */
export function signIn(uid = 'user-1', email = 'amina@example.com') {
  const mutable = auth as unknown as {
    currentUser: { uid: string; email: string; getIdToken: () => Promise<string> } | null;
  };
  mutable.currentUser = { uid, email, getIdToken: async () => `test-token-${uid}` };
  return mutable.currentUser;
}

export function signOut() {
  (auth as unknown as { currentUser: unknown }).currentUser = null;
}
