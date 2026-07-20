import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStringArray, readJson, removeItem, writeJson } from '../storage';

const KEY = 'test-key';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readJson', () => {
  it('round-trips a valid value', () => {
    writeJson(KEY, ['a', 'b']);
    expect(readJson(KEY, isStringArray)).toEqual(['a', 'b']);
  });

  it('returns null for a key that was never written', () => {
    expect(readJson(KEY, isStringArray)).toBeNull();
  });

  it('discards malformed JSON instead of throwing', () => {
    localStorage.setItem(KEY, '{not json');

    expect(readJson(KEY, isStringArray)).toBeNull();
    // Cleared, so the same failure does not recur on every future mount.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('discards valid JSON of the wrong shape', () => {
    // The realistic case: data written by an older version of the app.
    localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));

    expect(readJson(KEY, isStringArray)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('survives storage throwing outright, as in private mode', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => readJson(KEY, isStringArray)).not.toThrow();
    expect(readJson(KEY, isStringArray)).toBeNull();
  });
});

describe('writeJson', () => {
  it('reports success', () => {
    expect(writeJson(KEY, { a: 1 })).toBe(true);
  });

  it('reports failure when the quota is exceeded, without throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(writeJson(KEY, { a: 1 })).toBe(false);
  });
});

describe('removeItem', () => {
  it('removes a key', () => {
    writeJson(KEY, ['a']);
    removeItem(KEY);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => removeItem(KEY)).not.toThrow();
  });
});
