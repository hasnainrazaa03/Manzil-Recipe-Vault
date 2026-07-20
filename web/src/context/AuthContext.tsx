import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '../firebase';

interface AuthContextValue {
  user: User | null;
  /** True until Firebase has restored (or rejected) the persisted session. */
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();
  const previousUid = useRef<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      /**
       * Evict everything when the identity changes.
       *
       * Disabling a query does not discard its data, and `keys.me` is cached
       * for a minute with `refetchOnWindowFocus` off. On a shared machine, a
       * second person signing in within that window saw the first person's
       * display name in the header, their saved recipes starred across the
       * grid, and their saved-recipes page — one account's private list
       * rendered inside another's session.
       */
      const nextUid = currentUser?.uid ?? null;
      if (previousUid.current !== nextUid) {
        queryClient.clear();
        previousUid.current = nextUid;
      }

      setUser(currentUser);
      setIsLoading(false);
    });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, logout: () => signOut(auth) }),
    [user, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
