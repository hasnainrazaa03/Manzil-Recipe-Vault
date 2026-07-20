import { describe, expect, it } from 'vitest';
import { escapeRegex, formatDifficulty, formatDuration, pluralise, splitOnMatch } from '../format';

describe('formatDuration', () => {
  it.each([
    [15, '15 min'],
    [60, '1 hr'],
    [80, '1 hr 20 min'],
    [125, '2 hr 5 min'],
    [0, '0 min'],
  ])('renders %s minutes as %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it('distinguishes "not stated" from zero', () => {
    // The distinction the whole null-versus-0 design depends on.
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(0)).toBe('0 min');
  });
});

describe('formatDifficulty', () => {
  it('labels the known values', () => {
    expect(formatDifficulty('easy')).toBe('Easy');
    expect(formatDifficulty('hard')).toBe('Hard');
  });

  it('returns null for absent or unrecognised values', () => {
    expect(formatDifficulty(null)).toBeNull();
    expect(formatDifficulty('')).toBeNull();
    expect(formatDifficulty('impossible')).toBeNull();
  });
});

describe('pluralise', () => {
  it('agrees with the count', () => {
    expect(pluralise(1, 'item')).toBe('1 item');
    expect(pluralise(2, 'item')).toBe('2 items');
    expect(pluralise(0, 'item')).toBe('0 items');
  });

  it('accepts an irregular plural', () => {
    expect(pluralise(2, 'loaf', 'loaves')).toBe('2 loaves');
  });
});

describe('splitOnMatch', () => {
  it('splits around the match', () => {
    expect(splitOnMatch('Lemon cake', 'cake')).toEqual([
      { text: 'Lemon ', match: false },
      { text: 'cake', match: true },
    ]);
  });

  it('matches case-insensitively while preserving the original casing', () => {
    const segments = splitOnMatch('Lemon Cake', 'cake');

    expect(segments.find((segment) => segment.match)?.text).toBe('Cake');
  });

  it('finds every occurrence', () => {
    const segments = splitOnMatch('cake on cake', 'cake');

    expect(segments.filter((segment) => segment.match)).toHaveLength(2);
  });

  it('returns the text unsplit when there is no term', () => {
    expect(splitOnMatch('Lemon cake', '')).toEqual([{ text: 'Lemon cake', match: false }]);
    expect(splitOnMatch('Lemon cake', '   ')).toEqual([{ text: 'Lemon cake', match: false }]);
  });

  it('treats regex metacharacters as literal text', () => {
    // Unescaped, `(` would throw and `.` would match every character.
    expect(() => splitOnMatch('Rice (basmati)', '(')).not.toThrow();
    expect(splitOnMatch('Rice (basmati)', '(').filter((s) => s.match)).toHaveLength(1);

    const dots = splitOnMatch('abc', '.');
    expect(dots.filter((segment) => segment.match)).toHaveLength(0);
  });
});

describe('escapeRegex', () => {
  it('escapes every metacharacter it claims to', () => {
    expect(escapeRegex('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o',
    );
  });

  it('makes a ReDoS payload inert', () => {
    const pattern = new RegExp(escapeRegex('(a+)+$'));

    expect(pattern.test('(a+)+$')).toBe(true);
    expect(pattern.test('aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });
});
