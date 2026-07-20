import { useCallback, useEffect, useState } from 'react';
import { readJson, writeJson } from '../lib/storage';

/**
 * State backed by `localStorage`, validated on read.
 *
 * The guard is required rather than optional: an unvalidated read hands
 * whatever a previous version of the app (or another tab, or a user with the
 * dev tools open) left behind straight into React state.
 */
export function useLocalStorage<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, (next: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readJson(key, isValid) ?? fallback);

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === 'function' ? (next as (c: T) => T)(current) : next;
        writeJson(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  // Keep tabs in step. Someone ticking off a shopping list on one tab should
  // not have it silently reappear when they switch to another.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      setValue(readJson(key, isValid) ?? fallback);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // `fallback` and `isValid` are expected to be stable module-level values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, update];
}
