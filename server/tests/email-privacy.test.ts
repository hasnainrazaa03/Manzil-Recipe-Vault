import { beforeEach, describe, expect, it } from 'vitest';
import { displayNameFrom } from '../src/routes/recipes.js';
import { Recipe } from '../src/models/Recipe.js';
import { Comment } from '../src/models/Comment.js';
import { EMAIL_PATTERN, api, authHeader, createProfile, expectNoEmailLeak, findEmailLeaks, recipePayload } from './helpers.js';

/**
 * A cross-cutting sweep of the one property that must hold on every response
 * that carries a recipe or a comment: no author email address, in any field, at
 * any depth.
 *
 * uids are published in every recipe payload, so a single `authorEmail`
 * anywhere makes the whole authoring user base enumerable uid → email without a
 * token. The rule is asserted per-endpoint rather than once, because each
 * response path assembles its payload differently (lean projection, `toJSON()`
 * on a live document, subdocument arrays) and they have historically diverged.
 */

const AUTHOR = 'author-uid';
const AUTHOR_EMAIL = 'author-uid@example.com';
const COMMENTER = 'commenter-uid';
const READER = 'reader-uid';

let recipeId: string;
let commentId: string;

beforeEach(async () => {
  // Both users have profiles, so display names come from the profile rather
  // than from any email-derived fallback.
  await createProfile(AUTHOR, { displayName: 'The Author' });
  await createProfile(COMMENTER, { displayName: 'The Commenter' });

  const created = await api()
    .post('/api/recipes')
    .set(authHeader(AUTHOR, AUTHOR_EMAIL))
    .send(recipePayload({ title: 'Sweep Recipe' }));
  recipeId = created.body._id;

  const comment = await api()
    .post(`/api/recipes/${recipeId}/comments`)
    .set(authHeader(COMMENTER))
    .send({ text: 'a comment' });
  commentId = comment.body._id;

  await api().put(`/api/users/me/saved-recipes/${recipeId}`).set(authHeader(READER));
});

describe('the leak detector itself', () => {
  it('spots an authorEmail key and a raw address, and passes clean payloads', () => {
    expect(findEmailLeaks({ items: [{ authorEmail: '' }] })).toHaveLength(1);
    expect(findEmailLeaks({ user: { displayName: 'a@b.com' } })).toHaveLength(1);
    expect(findEmailLeaks({ items: [{ author: 'uid', authorName: 'The Author' }] })).toEqual([]);
  });
});

describe('SECURITY: no response carrying a recipe or comment leaks an email', () => {
  it('the email is still recorded server-side (so the test is meaningful)', async () => {
    const stored = await Recipe.findById(recipeId).select('+authorEmail').lean();
    expect(stored!.authorEmail).toBe(AUTHOR_EMAIL);
    expect(EMAIL_PATTERN.test(stored!.authorEmail)).toBe(true);
  });

  it('POST /api/recipes (create response)', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader(AUTHOR, AUTHOR_EMAIL))
      .send(recipePayload({ title: 'Another' }));

    expect(res.status).toBe(201);
    expectNoEmailLeak(res.body);
    expect(res.body).not.toHaveProperty('authorEmail');
  });

  it('PUT /api/recipes/:id (update response)', async () => {
    const res = await api()
      .put(`/api/recipes/${recipeId}`)
      .set(authHeader(AUTHOR, AUTHOR_EMAIL))
      .send({ title: 'Renamed' });

    expect(res.status).toBe(200);
    expectNoEmailLeak(res.body);
  });

  it('GET /api/recipes (list), anonymous and authenticated', async () => {
    const anon = await api().get('/api/recipes');
    expect(anon.status).toBe(200);
    expectNoEmailLeak(anon.body);
    expect(anon.body.items[0]).not.toHaveProperty('authorEmail');
    // The replacement field is present and useful.
    expect(anon.body.items[0].authorName).toBe('The Author');

    const signedIn = await api().get('/api/recipes').set(authHeader(READER));
    expectNoEmailLeak(signedIn.body);
  });

  it('GET /api/recipes?author=me for the author themselves', async () => {
    const res = await api()
      .get('/api/recipes?author=me')
      .set(authHeader(AUTHOR, AUTHOR_EMAIL));

    expect(res.body.total).toBe(1);
    // Not even the owner's own list echoes the address back.
    expectNoEmailLeak(res.body);
  });

  it('GET /api/recipes/:id (detail, including the first page of the thread)', async () => {
    const anon = await api().get(`/api/recipes/${recipeId}`);
    expect(anon.status).toBe(200);
    expect(anon.body.comments).toHaveLength(1);
    expectNoEmailLeak(anon.body);
    expect(anon.body.comments[0]).not.toHaveProperty('authorEmail');

    const asAuthor = await api()
      .get(`/api/recipes/${recipeId}`)
      .set(authHeader(AUTHOR, AUTHOR_EMAIL));
    expectNoEmailLeak(asAuthor.body);
  });

  it('GET /api/recipes/:id/comments (paginated comment list)', async () => {
    const res = await api().get(`/api/recipes/${recipeId}/comments`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expectNoEmailLeak(res.body);
    expect(res.body.items[0]).not.toHaveProperty('authorEmail');
    expect(res.body.items[0].authorName).toBe('The Commenter');
  });

  it('GET /api/recipes/:id/comments leaks nothing whatever it returns', async () => {
    // Independent of what the page happens to contain — an empty page is also
    // email-free, so this holds even if the thread query changes shape again.
    const res = await api().get(`/api/recipes/${recipeId}/comments`);

    expect(res.status).toBe(200);
    expectNoEmailLeak(res.body);
  });

  it('POST /api/recipes/:id/comments (create response)', async () => {
    const res = await api()
      .post(`/api/recipes/${recipeId}/comments`)
      .set(authHeader(COMMENTER))
      .send({ text: 'another comment' });

    expect(res.status).toBe(201);
    expectNoEmailLeak(res.body);
    expect(res.body).not.toHaveProperty('authorEmail');
  });

  it('PATCH /api/recipes/:id/comments/:commentId (edit response)', async () => {
    const res = await api()
      .patch(`/api/recipes/${recipeId}/comments/${commentId}`)
      .set(authHeader(COMMENTER))
      .send({ text: 'edited comment' });

    expect(res.status).toBe(200);
    expectNoEmailLeak(res.body);
    expect(res.body).not.toHaveProperty('authorEmail');
  });

  it('GET /api/users/me/saved-recipes', async () => {
    const res = await api().get('/api/users/me/saved-recipes').set(authHeader(READER));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expectNoEmailLeak(res.body);
  });

  it('GET /api/users/:userId/profile, anonymous and as the owner', async () => {
    const anon = await api().get(`/api/users/${AUTHOR}/profile`);
    expect(anon.status).toBe(200);
    expect(anon.body.recipes.items).toHaveLength(1);
    expectNoEmailLeak(anon.body);

    const owner = await api()
      .get(`/api/users/${AUTHOR}/profile`)
      .set(authHeader(AUTHOR, AUTHOR_EMAIL));
    expectNoEmailLeak(owner.body);
  });

  it('a comment document stores no email address at all', async () => {
    // The embedded subdocument used to keep its own copy of the address, which
    // is why every comment response had to be serialised through
    // `publicComment()`. The collection simply has no such field, so the leak
    // is closed at the schema rather than at each response path.
    const stored = await Comment.find({ recipe: recipeId }).lean();

    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toHaveProperty('authorEmail');
    expect(JSON.stringify(stored)).not.toMatch(EMAIL_PATTERN);
  });
});

describe('GET /api/users/me still returns the caller’s own email, by design', () => {
  it('returns the address for the authenticated caller', async () => {
    const res = await api().get('/api/users/me').set(authHeader(AUTHOR, AUTHOR_EMAIL));

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(AUTHOR_EMAIL);
  });

  it('but only ever the caller’s own — there is no route to another user’s', async () => {
    const res = await api().get('/api/users/me').set(authHeader(READER, 'reader@example.com'));

    expect(res.body.email).toBe('reader@example.com');
    expect(res.body.email).not.toBe(AUTHOR_EMAIL);
  });
});

describe('email-derived display names', () => {
  it('a recipe author with no profile gets the email local part, not the address', async () => {
    const res = await api()
      .post('/api/recipes')
      .set(authHeader('no-profile-uid', 'someone@example.com'))
      .send(recipePayload({ title: 'Profileless' }));

    expect(res.status).toBe(201);
    expect(res.body.authorName).toBe('someone');
    expectNoEmailLeak(res.body);
  });

  it('a commenter with no profile does not get their address as a display name', async () => {
    const created = await api()
      .post('/api/recipes')
      .set(authHeader(AUTHOR, AUTHOR_EMAIL))
      .send(recipePayload({ title: 'Host' }));

    const res = await api()
      .post(`/api/recipes/${created.body._id}/comments`)
      .set(authHeader('no-profile-uid', 'someone@example.com'))
      .send({ text: 'hi' });

    expect(res.status).toBe(201);
    expectNoEmailLeak(res.body);
    expect(res.body.authorName).not.toMatch(EMAIL_PATTERN);
    expect(res.body.authorName).toBe('someone');
  });

  it('a commenter WITH a profile still gets their profile display name', async () => {
    await createProfile('with-profile-uid', { displayName: 'Properly Named' });

    const created = await api()
      .post('/api/recipes')
      .set(authHeader(AUTHOR, AUTHOR_EMAIL))
      .send(recipePayload({ title: 'Host' }));

    const res = await api()
      .post(`/api/recipes/${created.body._id}/comments`)
      .set(authHeader('with-profile-uid', 'ignored@example.com'))
      .send({ text: 'hi' });

    expect(res.status).toBe(201);
    // The profile wins over the email-derived fallback.
    expect(res.body.authorName).toBe('Properly Named');
    expectNoEmailLeak(res.body);
  });

  it('the profile-less comment stays email-free on every read path', async () => {
    const created = await api()
      .post('/api/recipes')
      .set(authHeader(AUTHOR, AUTHOR_EMAIL))
      .send(recipePayload({ title: 'Host' }));
    const recipeId = created.body._id;

    const posted = await api()
      .post(`/api/recipes/${recipeId}/comments`)
      .set(authHeader('no-profile-uid', 'someone@example.com'))
      .send({ text: 'hi' });
    expect(posted.status).toBe(201);

    // The exact case that slipped through when only `authorEmail` was stripped:
    // the address arrived in the display name instead. Sweep every path that can
    // serve this comment, anonymously.
    const list = await api().get(`/api/recipes/${recipeId}/comments`);
    expect(list.status).toBe(200);
    expect(list.body.items[0].authorName).toBe('someone');
    expectNoEmailLeak(list.body);

    const detail = await api().get(`/api/recipes/${recipeId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.comments[0].authorName).toBe('someone');
    expectNoEmailLeak(detail.body);

    const edited = await api()
      .patch(`/api/recipes/${recipeId}/comments/${posted.body._id}`)
      .set(authHeader('no-profile-uid', 'someone@example.com'))
      .send({ text: 'edited' });
    expect(edited.status).toBe(200);
    expectNoEmailLeak(edited.body);

    // And the stored document holds no address to leak in the first place.
    const stored = await Comment.find({ recipe: recipeId }).lean();
    expect(stored[0]!.authorName).toBe('someone');
    expect(JSON.stringify(stored)).not.toMatch(EMAIL_PATTERN);
  });

  it('the recipe list and public profile stay email-free for a profile-less author', async () => {
    const created = await api()
      .post('/api/recipes')
      .set(authHeader('no-profile-uid', 'someone@example.com'))
      .send(recipePayload({ title: 'Profileless author' }));
    expect(created.status).toBe(201);

    const list = await api().get('/api/recipes?author=no-profile-uid');
    expect(list.body.items[0].authorName).toBe('someone');
    expectNoEmailLeak(list.body);

    const profile = await api().get('/api/users/no-profile-uid/profile');
    expect(profile.status).toBe(200);
    expectNoEmailLeak(profile.body);
  });
});

describe('displayNameFrom', () => {
  it('takes the local part of an email address', () => {
    expect(displayNameFrom('someone@example.com')).toBe('someone');
    expect(displayNameFrom('first.last+tag@example.co.uk')).toBe('first.last+tag');
  });

  it('passes a plain name through unchanged', () => {
    expect(displayNameFrom('Ada Lovelace')).toBe('Ada Lovelace');
  });

  it('degrades to "Anonymous cook" when there is nothing usable', () => {
    expect(displayNameFrom(undefined)).toBe('Anonymous cook');
    expect(displayNameFrom('')).toBe('Anonymous cook');
    expect(displayNameFrom('   ')).toBe('Anonymous cook');
    // An address with no local part has nothing to fall back on either.
    expect(displayNameFrom('@example.com')).toBe('Anonymous cook');
  });

  it('never returns anything email-shaped', () => {
    for (const input of ['someone@example.com', '@example.com', '', undefined]) {
      expect(displayNameFrom(input)).not.toMatch(EMAIL_PATTERN);
    }
  });
});

describe('a token carrying no email claim', () => {
  // Phone, anonymous and custom-token sign-in all produce one. `authorEmail` is
  // no longer `required`, so these callers can write like anybody else — see
  // FINDINGS.md #6.
  it('a comment from such a caller falls back to "Anonymous cook"', async () => {
    const created = await api()
      .post('/api/recipes')
      .set(authHeader(AUTHOR, AUTHOR_EMAIL))
      .send(recipePayload({ title: 'Host' }));

    // `authHeader(uid, '')` produces a token whose email claim is absent.
    const res = await api()
      .post(`/api/recipes/${created.body._id}/comments`)
      .set(authHeader('emailless-uid', ''))
      .send({ text: 'hi' });

    expect(res.status).toBe(201);
    expect(res.body.authorName).toBe('Anonymous cook');
    expectNoEmailLeak(res.body);
  });

  /**
   * Regression for FINDINGS.md #6. Both `authorEmail` fields used to be
   * `required: true` while the routes set them from `user.email ?? ''` — and an
   * empty string does not satisfy `required`, so any caller without an email
   * claim was rejected with a validation error naming a field they never sent
   * and could not set.
   */
  it('such a caller can create a recipe and a comment', async () => {
    const recipe = await api()
      .post('/api/recipes')
      .set(authHeader('emailless-uid', ''))
      .send(recipePayload({ title: 'No email author' }));

    expect(recipe.status).toBe(201);
    expect(recipe.body.authorName).toBe('Anonymous cook');
    expectNoEmailLeak(recipe.body);

    const comment = await api()
      .post(`/api/recipes/${recipe.body._id}/comments`)
      .set(authHeader('emailless-uid', ''))
      .send({ text: 'hi' });

    expect(comment.status).toBe(201);
    expect(comment.body.authorName).toBe('Anonymous cook');
    expectNoEmailLeak(comment.body);
  });

  it('but reading, rating and the profile endpoints work for such a caller', async () => {
    const host = await api()
      .post('/api/recipes')
      .set(authHeader(AUTHOR, AUTHOR_EMAIL))
      .send(recipePayload({ title: 'Host' }));

    const rating = await api()
      .put(`/api/recipes/${host.body._id}/rating`)
      .set(authHeader('emailless-uid', ''))
      .send({ score: 4 });
    expect(rating.status).toBe(200);

    const me = await api().get('/api/users/me').set(authHeader('emailless-uid', ''));
    expect(me.status).toBe(200);
    expect(me.body.uid).toBe('emailless-uid');
    expect(me.body.email).toBe('');
  });
});
