import { describe, expect, it } from 'vitest';
import { buildSrcSet, imageProps, resizedImage } from '../images';

const CLOUDINARY = 'https://res.cloudinary.com/demo/image/upload/v123/recipes/cake.jpg';
const WITH_TRANSFORM =
  'https://res.cloudinary.com/demo/image/upload/c_limit,w_2000,h_2000/v123/recipes/cake.jpg';
const ELSEWHERE = 'https://www.masalachilli.com/wp-content/uploads/bhindi.jpg';

describe('resizedImage', () => {
  it('inserts a width transform into a Cloudinary URL', () => {
    const result = resizedImage(CLOUDINARY, 480);

    expect(result).toContain('/image/upload/c_fill,w_480,q_auto,f_auto/');
    expect(result).toContain('recipes/cake.jpg');
  });

  it('preserves a transformation already applied at upload time', () => {
    // Dropping it would discard the size cap the upload signature enforced.
    const result = resizedImage(WITH_TRANSFORM, 480);

    expect(result).toContain('c_fill,w_480');
    expect(result).toContain('c_limit,w_2000,h_2000');
  });

  it.each([ELSEWHERE, '', 'not a url'])('leaves %o untouched', (url) => {
    expect(resizedImage(url, 480)).toBe(url);
  });
});

describe('buildSrcSet', () => {
  it('offers several widths for an image we host', () => {
    const srcSet = buildSrcSet(CLOUDINARY);
    const entries = srcSet.split(', ');

    expect(entries.length).toBeGreaterThan(1);
    expect(entries.every((entry) => /\s\d+w$/.test(entry))).toBe(true);
    expect(srcSet).toContain('w_320');
  });

  it('offers larger widths for a hero than for a card', () => {
    const card = buildSrcSet(CLOUDINARY, 'card');
    const hero = buildSrcSet(CLOUDINARY, 'hero');

    expect(hero).toContain('1600w');
    expect(card).not.toContain('1600w');
  });

  it('returns nothing for a host that cannot be transformed', () => {
    // A single-entry srcset saves no bytes and is worse than omitting it.
    expect(buildSrcSet(ELSEWHERE)).toBe('');
    expect(buildSrcSet('')).toBe('');
  });
});

describe('imageProps', () => {
  it('supplies srcSet and sizes for an image we host', () => {
    const props = imageProps(CLOUDINARY, 'card');

    expect(props.src).toBe(CLOUDINARY);
    expect(props.srcSet).toBeTruthy();
    expect(props.sizes).toContain('vw');
  });

  it('supplies src alone for anything else, so the attribute is simply absent', () => {
    const props = imageProps(ELSEWHERE);

    expect(props).toEqual({ src: ELSEWHERE });
    expect(props.srcSet).toBeUndefined();
  });
});
