import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { readJson, readJsonArray, writeJson } from '../lib/storage';

/**
 * State backed by `localStorage`, shared across every consumer of the same key.
 *
 * The obvious implementation — a `useState` per hook call — is wrong here, and
 * subtly so: the only cross-component sync would be the `storage` event, which
 * by specification **does not fire in the tab that wrote it**. Two components
 * reading the same key in one tab therefore drift apart. That is exactly the
 * shopping list: the header badge is mounted for the whole session while the
 * detail page adds items, and the badge simply never moved.
 *
 * So the value lives in a module-level store, subscribed via
 * `useSyncExternalStore`, and every write notifies every subscriber. The
 * `storage` event is still handled, for other tabs.
 */

type Listener = () => void;

/** Last parsed value per key, so snapshots are referentially stable. */
const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();

function subscribersFor(key: string): Set<Listener> {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

function notify(key: string): void {
  subscribersFor(key).forEach((listener) => listener());
}

/**
 * `useSyncExternalStore` compares snapshots by identity and will loop forever
 * if handed a fresh object each call, so the parsed value is cached and only
 * replaced when the underlying string actually changes.
 */
function readCached<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  if (!cache.has(key)) {
    cache.set(key, readJson(key, isValid) ?? fallback);
  }
  return cache.get(key) as T;
}

export function useLocalStorage<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, (next: T | ((current: T) => T)) => void] {
  const subscribe = useCallback(
    (listener: Listener) => {
      const set = subscribersFor(key);
      set.add(listener);
      return () => set.delete(listener);
    },
    [key],
  );

  const getSnapshot = useCallback(
    () => readCached(key, fallback, isValid),
    // `fallback` and `isValid` are module-level constants at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = readCached(key, fallback, isValid);
      const resolved = typeof next === 'function' ? (next as (c: T) => T)(current) : next;

      cache.set(key, resolved);
      writeJson(key, resolved);
      notify(key);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  // Another tab wrote to this key. Drop the cached parse and re-read.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      cache.delete(key);
      notify(key);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  return [value, update];
}

/**
 * A stored array that drops only the entries which fail validation.
 *
 * The all-or-nothing guard `useLocalStorage` uses is right for a single value
 * but wrong for a collection: one malformed element would discard the user's
 * entire shopping list or view history.
 */
export function useLocalStorageArray<T>(
  key: string,
  isItem: (value: unknown) => value is T,
): [T[], (next: T[] | ((current: T[]) => T[])) => void] {
  const subscribe = useCallback((listener: Listener) => {
    const set = subscribersFor(key);
    set.add(listener);
    return () => set.delete(listener);
  }, [key]);

  const read = useCallback((): T[] => {
    if (!cache.has(key)) cache.set(key, readJsonArray(key, isItem) ?? []);
    return cache.get(key) as T[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const value = useSyncExternalStore(subscribe, read, read);

  const update = useCallback(
    (next: T[] | ((current: T[]) => T[])) => {
      const current = read();
      const resolved = typeof next === 'function' ? next(current) : next;

      cache.set(key, resolved);
      writeJson(key, resolved);
      notify(key);
    },
    [key, read],
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      cache.delete(key);
      notify(key);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  return [value, update];
}

/** Test seam: drops the in-memory cache so a test starts from clean storage. */
export function resetLocalStorageCache(): void {
  cache.clear();
}
