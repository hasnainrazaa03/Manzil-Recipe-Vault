import { describe, expect, it } from 'vitest';
import { Follow } from '../src/models/Follow.js';
import { Profile } from '../src/models/Profile.js';
import { api, authHeader, createProfile, createRecipe, expectNoEmailLeak } from './helpers.js';

const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const CAROL = 'carol-uid';

/** Both parties need a profile for the denormalised counters to be maintained. */
async function seedProfiles(...uids: string[]) {
  for (const uid of uids) await createProfile(uid, { displayName: `Cook ${uid}` });
}

const follow = (follower: string, target: string) =>
  api().put(`/api/social/follow/${target}`).set(authHeader(follower));

/**
 * The invariant the denormalised counters exist to satisfy: both must equal the
 * number of `Follow` rows, and neither may go below zero. `min: 0` on the
 * schema does not enforce this — `$inc` through `updateOne` skips validators —
 * so it is only ever true if every counter change was gated on a write that
 * took effect.
 */
async function expectCountsMatchRows(follower: string, following: string, rows: number) {
  const [followerProfile, followingProfile] = await Promise.all([
    Profile.findOne({ user: follower }).lean(),
    Profile.findOne({ user: following }).lean(),
  ]);

  expect(followingProfile?.followerCount ?? 0).toBe(rows);
  expect(followerProfile?.followingCount ?? 0).toBe(rows);
  expect(followingProfile?.followerCount ?? 0).toBeGreaterThanOrEqual(0);
  expect(followerProfile?.followingCount ?? 0).toBeGreaterThanOrEqual(0);
}

describe('PUT /api/social/follow/:userId', () => {
  it('follows on the first call', async () => {
    await seedProfiles(ALICE, BOB);

    const res = await follow(ALICE, BOB);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ following: true });
    expect(await Follow.countDocuments({ follower: ALICE, following: BOB })).toBe(1);
  });

  it('toggles off on the second call, and never creates a second row', async () => {
    await seedProfiles(ALICE, BOB);

    const first = await follow(ALICE, BOB);
    expect(first.body).toEqual({ following: true });
    expect(await Follow.countDocuments({})).toBe(1);

    const second = await follow(ALICE, BOB);
    expect(second.body).toEqual({ following: false });
    expect(await Follow.countDocuments({})).toBe(0);

    const third = await follow(ALICE, BOB);
    expect(third.body).toEqual({ following: true });
    // At no point did the pair accumulate more than the one row it may have.
    expect(await Follow.countDocuments({ follower: ALICE, following: BOB })).toBe(1);
  });

  it('refuses to let you follow yourself', async () => {
    await seedProfiles(ALICE);

    const res = await follow(ALICE, ALICE);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/yourself/i);
    expect(await Follow.countDocuments({})).toBe(0);
  });

  it('requires authentication', async () => {
    expect((await api().put(`/api/social/follow/${BOB}`)).status).toBe(401);
  });

  it('keeps followerCount and followingCount in step with the rows across follow → unfollow → follow', async () => {
    await seedProfiles(ALICE, BOB);

    const counts = async () => {
      const [alice, bob] = await Promise.all([
        Profile.findOne({ user: ALICE }).lean(),
        Profile.findOne({ user: BOB }).lean(),
      ]);
      return {
        aliceFollowing: alice!.followingCount,
        bobFollowers: bob!.followerCount,
        rows: await Follow.countDocuments({ follower: ALICE, following: BOB }),
      };
    };

    expect(await counts()).toEqual({ aliceFollowing: 0, bobFollowers: 0, rows: 0 });

    await follow(ALICE, BOB);
    expect(await counts()).toEqual({ aliceFollowing: 1, bobFollowers: 1, rows: 1 });

    await follow(ALICE, BOB);
    expect(await counts()).toEqual({ aliceFollowing: 0, bobFollowers: 0, rows: 0 });

    await follow(ALICE, BOB);
    expect(await counts()).toEqual({ aliceFollowing: 1, bobFollowers: 1, rows: 1 });
  });

  it('counts each follower separately', async () => {
    await seedProfiles(ALICE, BOB, CAROL);

    await follow(ALICE, CAROL);
    await follow(BOB, CAROL);

    const carol = await Profile.findOne({ user: CAROL }).lean();
    expect(carol!.followerCount).toBe(2);
    expect(await Follow.countDocuments({ following: CAROL })).toBe(2);
  });

  it('five parallel follows of the same pair leave exactly one row and a count of 1', async () => {
    await seedProfiles(ALICE, BOB);

    // Regression test for FINDINGS-WAVE5.md §W5-1 (resolved). This used to end
    // with no row at all and both counters at -1: every request decremented
    // whether or not its delete had removed anything.
    const results = await Promise.all(Array.from({ length: 5 }, () => follow(ALICE, BOB)));

    // Every request must have been *authenticated* and answered. Without the
    // Firebase stub these are all 401s, and the assertions below then pass
    // trivially against a database nothing ever wrote to.
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(typeof res.body.following).toBe('boolean');
    }

    const rows = await Follow.countDocuments({ follower: ALICE, following: BOB });
    expect(rows).toBe(1);

    // The row count alone was never the part that broke — the counters are.
    await expectCountsMatchRows(ALICE, BOB, rows);
  });

  it('five parallel UNfollows leave the counters agreeing with the rows', async () => {
    await seedProfiles(ALICE, BOB);
    await follow(ALICE, BOB).expect(200);

    // The original defect was on the delete path specifically, so start from a
    // row that exists and make every request contend to remove it.
    const results = await Promise.all(Array.from({ length: 5 }, () => follow(ALICE, BOB)));
    for (const res of results) expect(res.status).toBe(200);

    const rows = await Follow.countDocuments({ follower: ALICE, following: BOB });
    expect(rows).toBeLessThanOrEqual(1);
    await expectCountsMatchRows(ALICE, BOB, rows);
  });

  it('never lets a counter go negative, however a burst of toggles interleaves', async () => {
    await seedProfiles(ALICE, BOB);

    for (let round = 0; round < 3; round += 1) {
      await Promise.all(Array.from({ length: 4 }, () => follow(ALICE, BOB)));
      const rows = await Follow.countDocuments({ follower: ALICE, following: BOB });
      await expectCountsMatchRows(ALICE, BOB, rows);
    }
  });

  it('the unique index rejects a duplicate row written directly', async () => {
    await Follow.create({ follower: ALICE, following: BOB });

    await expect(Follow.create({ follower: ALICE, following: BOB })).rejects.toMatchObject({ code: 11000 });
    expect(await Follow.countDocuments({})).toBe(1);
  });

  it('works when the followed user has never saved a profile', async () => {
    // Nobody has a Profile document here: a user can be followed before they
    // have ever opened their own settings page, and a counter with nowhere to
    // live would silently diverge from the rows.
    expect(await Profile.countDocuments({})).toBe(0);

    const res = await follow(ALICE, BOB);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ following: true });

    const bob = await Profile.findOne({ user: BOB }).lean();
    expect(bob).not.toBeNull();
    expect(bob!.followerCount).toBe(1);
    expect(bob!.followingCount).toBe(0);
    // Created rather than named, so it must not be given anything email-shaped.
    expect(bob!.displayName).toBe('Anonymous cook');

    const alice = await Profile.findOne({ user: ALICE }).lean();
    expect(alice!.followingCount).toBe(1);
    expect(alice!.followerCount).toBe(0);

    await expectCountsMatchRows(ALICE, BOB, 1);
  });

  it('unfollowing a profile-less user leaves both counters back at zero', async () => {
    await follow(ALICE, BOB).expect(200);
    await follow(ALICE, BOB).expect(200);

    expect(await Follow.countDocuments({})).toBe(0);
    await expectCountsMatchRows(ALICE, BOB, 0);
  });

  it('surfaces the upserted follower through the followers list', async () => {
    await follow(ALICE, BOB).expect(200);

    const res = await api().get(`/api/social/${BOB}/followers`);

    expect(res.body.items.map((u: { uid: string }) => u.uid)).toEqual([ALICE]);
    expectNoEmailLeak(res.body);
  });
});

describe('GET /api/social/:userId/followers', () => {
  it('lists followers with their display names', async () => {
    await seedProfiles(ALICE, BOB, CAROL);
    await follow(ALICE, CAROL);
    await follow(BOB, CAROL);

    const res = await api().get(`/api/social/${CAROL}/followers`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((u: { uid: string }) => u.uid).sort()).toEqual([ALICE, BOB].sort());
    expect(res.body.items.map((u: { displayName: string }) => u.displayName).sort()).toEqual(
      [`Cook ${ALICE}`, `Cook ${BOB}`].sort(),
    );
    expectNoEmailLeak(res.body);
  });

  it('falls back to a placeholder name rather than anything email-shaped', async () => {
    await follow(ALICE, CAROL);

    const res = await api().get(`/api/social/${CAROL}/followers`);

    expect(res.body.items[0].displayName).toBe('Anonymous cook');
    expectNoEmailLeak(res.body);
  });

  it('paginates', async () => {
    for (const uid of ['f1', 'f2', 'f3']) {
      await createProfile(uid, { displayName: `Cook ${uid}` });
      await follow(uid, CAROL);
    }

    const page1 = await api().get(`/api/social/${CAROL}/followers?page=1&limit=2`);
    const page2 = await api().get(`/api/social/${CAROL}/followers?page=2&limit=2`);

    expect(page1.body).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(page1.body.items).toHaveLength(2);
    expect(page2.body.items).toHaveLength(1);

    const seen = [...page1.body.items, ...page2.body.items].map((u: { uid: string }) => u.uid);
    expect(new Set(seen).size).toBe(3);
  });

  it('is empty for someone nobody follows', async () => {
    const res = await api().get(`/api/social/${CAROL}/followers`);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });
});

describe('GET /api/social/:userId/following', () => {
  it('lists who someone follows, with display names and no emails', async () => {
    await seedProfiles(ALICE, BOB, CAROL);
    await follow(ALICE, BOB);
    await follow(ALICE, CAROL);

    const res = await api().get(`/api/social/${ALICE}/following`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((u: { uid: string }) => u.uid).sort()).toEqual([BOB, CAROL].sort());
    expectNoEmailLeak(res.body);
  });

  it('paginates', async () => {
    for (const uid of ['t1', 't2', 't3']) {
      await createProfile(uid, { displayName: `Cook ${uid}` });
      await follow(ALICE, uid);
    }

    const page2 = await api().get(`/api/social/${ALICE}/following?page=2&limit=2`);

    expect(page2.body).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(page2.body.items).toHaveLength(1);
  });

  it('does not confuse the two directions', async () => {
    await seedProfiles(ALICE, BOB);
    await follow(ALICE, BOB);

    const aliceFollowing = await api().get(`/api/social/${ALICE}/following`);
    const aliceFollowers = await api().get(`/api/social/${ALICE}/followers`);

    expect(aliceFollowing.body.items.map((u: { uid: string }) => u.uid)).toEqual([BOB]);
    expect(aliceFollowers.body.items).toEqual([]);
  });
});

describe('GET /api/social/relationship/:userId', () => {
  it('reports nothing when there is no relationship', async () => {
    const res = await api().get(`/api/social/relationship/${BOB}`).set(authHeader(ALICE));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ following: false, followsYou: false, isSelf: false });
  });

  it('reports one-way: you follow them', async () => {
    await follow(ALICE, BOB);

    const res = await api().get(`/api/social/relationship/${BOB}`).set(authHeader(ALICE));
    expect(res.body).toEqual({ following: true, followsYou: false, isSelf: false });
  });

  it('reports one-way: they follow you', async () => {
    await follow(BOB, ALICE);

    const res = await api().get(`/api/social/relationship/${BOB}`).set(authHeader(ALICE));
    expect(res.body).toEqual({ following: false, followsYou: true, isSelf: false });
  });

  it('reports mutual', async () => {
    await follow(ALICE, BOB);
    await follow(BOB, ALICE);

    const res = await api().get(`/api/social/relationship/${BOB}`).set(authHeader(ALICE));
    expect(res.body).toEqual({ following: true, followsYou: true, isSelf: false });
  });

  it('reports isSelf', async () => {
    const res = await api().get(`/api/social/relationship/${ALICE}`).set(authHeader(ALICE));
    expect(res.body).toEqual({ following: false, followsYou: false, isSelf: true });
  });

  it('requires auth', async () => {
    expect((await api().get(`/api/social/relationship/${BOB}`)).status).toBe(401);
  });
});

describe('GET /api/social/feed', () => {
  it('says followsAnyone: false when you follow nobody', async () => {
    await createRecipe({ author: BOB });

    const res = await api().get('/api/social/feed').set(authHeader(ALICE));

    expect(res.status).toBe(200);
    expect(res.body.followsAnyone).toBe(false);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('says followsAnyone: true when you follow someone who has posted nothing', async () => {
    await follow(ALICE, BOB);

    const res = await api().get('/api/social/feed').set(authHeader(ALICE));

    expect(res.status).toBe(200);
    // Same empty item list, different empty state — the UI shows a different
    // message for "nobody to follow yet" than for "they have not posted".
    expect(res.body.followsAnyone).toBe(true);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('returns only recipes by followed authors', async () => {
    await follow(ALICE, BOB);

    await createRecipe({ author: BOB, title: 'From Bob' });
    await createRecipe({ author: CAROL, title: 'From Carol' });
    await createRecipe({ author: ALICE, title: 'From Alice herself' });

    const res = await api().get('/api/social/feed').set(authHeader(ALICE));

    expect(res.body.total).toBe(1);
    expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['From Bob']);
    expectNoEmailLeak(res.body);
  });

  it('is newest first', async () => {
    await follow(ALICE, BOB);

    await createRecipe({ author: BOB, title: 'Oldest', createdAt: new Date('2020-01-01') });
    await createRecipe({ author: BOB, title: 'Newest', createdAt: new Date('2024-01-01') });
    await createRecipe({ author: BOB, title: 'Middle', createdAt: new Date('2022-01-01') });

    const res = await api().get('/api/social/feed').set(authHeader(ALICE));

    expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Newest', 'Middle', 'Oldest']);
  });

  it('paginates', async () => {
    await follow(ALICE, BOB);
    for (let i = 0; i < 5; i += 1) {
      await createRecipe({ author: BOB, title: `R${i}`, createdAt: new Date(2020, 0, i + 1) });
    }

    const page2 = await api().get('/api/social/feed?page=2&limit=2').set(authHeader(ALICE));

    expect(page2.body).toMatchObject({ page: 2, limit: 2, total: 5, totalPages: 3, followsAnyone: true });
    expect(page2.body.items.map((r: { title: string }) => r.title)).toEqual(['R2', 'R1']);
  });

  it('drops out of the feed again when you unfollow', async () => {
    await createRecipe({ author: BOB });

    await follow(ALICE, BOB);
    expect((await api().get('/api/social/feed').set(authHeader(ALICE))).body.total).toBe(1);

    await follow(ALICE, BOB);
    const after = await api().get('/api/social/feed').set(authHeader(ALICE));
    expect(after.body).toMatchObject({ total: 0, followsAnyone: false });
  });

  it('requires auth', async () => {
    expect((await api().get('/api/social/feed')).status).toBe(401);
  });
});

describe('GET /api/social/suggestions', () => {
  it('excludes yourself and anyone you already follow', async () => {
    await seedProfiles(ALICE, BOB, CAROL);
    await createRecipe({ author: ALICE, averageRating: 5 });
    await createRecipe({ author: BOB, averageRating: 4 });
    await createRecipe({ author: CAROL, averageRating: 3 });

    await follow(ALICE, BOB);

    const res = await api().get('/api/social/suggestions').set(authHeader(ALICE));

    expect(res.status).toBe(200);
    expect(res.body.map((u: { uid: string }) => u.uid)).toEqual([CAROL]);
    expectNoEmailLeak(res.body);
  });

  it('reports the recipe count and average rating per suggested cook', async () => {
    await seedProfiles(BOB);
    await createRecipe({ author: BOB, averageRating: 4 });
    await createRecipe({ author: BOB, averageRating: 5 });

    const res = await api().get('/api/social/suggestions').set(authHeader(ALICE));

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ uid: BOB, recipeCount: 2, averageRating: 4.5, displayName: `Cook ${BOB}` });
  });

  it('is empty when there is nobody left to suggest', async () => {
    await createRecipe({ author: ALICE });

    const res = await api().get('/api/social/suggestions').set(authHeader(ALICE));
    expect(res.body).toEqual([]);
  });

  it('requires auth', async () => {
    expect((await api().get('/api/social/suggestions')).status).toBe(401);
  });
});
