import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useShoppingList, type ShoppingItem } from './useShoppingList';
import { api } from '../lib/api';

/**
 * Keeps the local shopping list and the server copy in step.
 *
 * Local-first on purpose. The list is used standing in a supermarket, which is
 * exactly where the signal is worst, so `localStorage` stays the thing the UI
 * reads and the server is a synchronisation target rather than the source of
 * truth. Everything works offline; syncing is an improvement on top.
 *
 * The rule that governs the whole design: **nothing is ever silently dropped.**
 * Signing in must not discard a list built while signed out, so the first thing
 * a session does is merge rather than overwrite in either direction.
 */

const PUSH_DELAY_MS = 1500;

export function useShoppingListSync(): void {
  const { user, isLoading } = useAuth();
  const { items, replaceAll } = useShoppingList();

  /** Which uid we have already reconciled, so it happens once per sign-in. */
  const mergedFor = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Suppresses the push that the merge's own write would otherwise trigger. */
  const applyingRemote = useRef(false);

  // --- Merge on sign-in ------------------------------------------------------
  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      mergedFor.current = null;
      return;
    }

    if (mergedFor.current === user.uid) return;
    mergedFor.current = user.uid;

    let cancelled = false;

    const merge = async () => {
      try {
        const result = await api.shoppingList.merge(items as ShoppingItem[]);
        if (cancelled) return;

        applyingRemote.current = true;
        replaceAll(result.items as ShoppingItem[]);
      } catch {
        // A failed merge is not worth interrupting anyone over — the local list
        // still works, and the next change will try to push again.
      }
    };

    void merge();

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on identity alone. Including `items` would re-merge on
    // every edit, and merging is not idempotent with respect to deletions: an
    // item deleted locally would be resurrected from the server copy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, isLoading]);

  // --- Push local changes ----------------------------------------------------
  useEffect(() => {
    if (!user || mergedFor.current !== user.uid) return;

    if (applyingRemote.current) {
      applyingRemote.current = false;
      return;
    }

    // Debounced: ticking five things off in a row is one request, not five.
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      void api.shoppingList.replace(items as ShoppingItem[]).catch(() => {
        // Offline, most likely. The list is intact locally and the next change
        // will retry; surfacing this would be noise in the one place the app is
        // most likely to be offline.
      });
    }, PUSH_DELAY_MS);

    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [items, user]);
}
