import { describe, expect, it } from 'vitest';
import { mergeItems } from '../src/routes/shopping-list.js';
import { ShoppingList, type ShoppingItem } from '../src/models/ShoppingList.js';
import { LIMITS } from '../src/models/constants.js';
import { api, authHeader } from './helpers.js';

const USER = 'shopper-uid';

/** A shopping item with every field set, so a test only states what it varies. */
function item(overrides: Partial<ShoppingItem> & { id: string }): ShoppingItem {
  return {
    amount: '1',
    name: 'flour',
    recipeId: '',
    recipeTitle: '',
    checked: false,
    addedAt: 1_000,
    ...overrides,
  } as ShoppingItem;
}

const names = (items: { name: string }[]) => items.map((i) => i.name);
const ids = (items: { id: string }[]) => items.map((i) => i.id);

// === mergeItems, directly ====================================================

describe('mergeItems', () => {
  it('keeps items that exist only on the server', () => {
    const { items, dropped } = mergeItems([item({ id: 'a', name: 'server-only' })], []);
    expect(names(items)).toEqual(['server-only']);
    expect(dropped).toBe(0);
  });

  it('keeps items that exist only locally', () => {
    const { items, dropped } = mergeItems([], [item({ id: 'b', name: 'local-only' })]);
    expect(names(items)).toEqual(['local-only']);
    expect(dropped).toBe(0);
  });

  it('never drops anything — the governing rule', () => {
    const stored = [
      item({ id: 's1', name: 'stored one', addedAt: 10 }),
      item({ id: 'both', name: 'shared', addedAt: 20 }),
      item({ id: 's2', name: 'stored two', addedAt: 30 }),
    ];
    const incoming = [
      item({ id: 'l1', name: 'local one', addedAt: 15 }),
      item({ id: 'both', name: 'shared', addedAt: 25 }),
      item({ id: 'l2', name: 'local two', addedAt: 35 }),
    ];

    const { items, dropped } = mergeItems(stored, incoming);

    expect(ids(items).sort()).toEqual(['both', 'l1', 'l2', 's1', 's2']);
    // Every id from either side survives, and the shared one is not duplicated.
    expect(items.filter((i) => i.id === 'both')).toHaveLength(1);
    expect(dropped).toBe(0);
  });

  it('ends up checked if either side had it checked', () => {
    expect(
      mergeItems([item({ id: 'x', checked: true })], [item({ id: 'x', checked: false })]).items[0].checked,
    ).toBe(true);
    expect(
      mergeItems([item({ id: 'x', checked: false })], [item({ id: 'x', checked: true })]).items[0].checked,
    ).toBe(true);
    expect(
      mergeItems([item({ id: 'x', checked: false })], [item({ id: 'x', checked: false })]).items[0].checked,
    ).toBe(false);
  });

  it('takes the amount from whichever side was added more recently', () => {
    const newerIncoming = mergeItems(
      [item({ id: 'x', amount: 'stored', addedAt: 100 })],
      [item({ id: 'x', amount: 'incoming', addedAt: 200 })],
    );
    expect(newerIncoming.items[0].amount).toBe('incoming');

    const newerStored = mergeItems(
      [item({ id: 'x', amount: 'stored', addedAt: 200 })],
      [item({ id: 'x', amount: 'incoming', addedAt: 100 })],
    );
    expect(newerStored.items[0].amount).toBe('stored');
  });

  it('takes the incoming amount on an exact tie', () => {
    const merged = mergeItems(
      [item({ id: 'x', amount: 'stored', addedAt: 100 })],
      [item({ id: 'x', amount: 'incoming', addedAt: 100 })],
    );
    expect(merged.items[0].amount).toBe('incoming');
  });

  it('takes the EARLIER addedAt of the two', () => {
    expect(mergeItems([item({ id: 'x', addedAt: 500 })], [item({ id: 'x', addedAt: 100 })]).items[0].addedAt).toBe(100);
    expect(mergeItems([item({ id: 'x', addedAt: 100 })], [item({ id: 'x', addedAt: 500 })]).items[0].addedAt).toBe(100);
  });

  it('sorts the result by addedAt', () => {
    const merged = mergeItems(
      [item({ id: 'c', addedAt: 300 }), item({ id: 'a', addedAt: 100 })],
      [item({ id: 'b', addedAt: 200 })],
    );
    expect(ids(merged.items)).toEqual(['a', 'b', 'c']);
  });

  it(`caps the result at ${LIMITS.shoppingItems} items and reports how many went`, () => {
    const stored = Array.from({ length: LIMITS.shoppingItems }, (_unused, i) =>
      item({ id: `s${i}`, addedAt: 1_000 + i }),
    );
    const incoming = Array.from({ length: 5 }, (_unused, i) =>
      item({ id: `l${i}`, addedAt: 9_000 + i }),
    );

    const { items, dropped } = mergeItems(stored, incoming);

    expect(items).toHaveLength(LIMITS.shoppingItems);
    expect(dropped).toBe(5);
    // With nothing ticked, what has to go is the oldest — never what was just
    // added. See tests/FINDINGS-WAVE6.md #2.
    expect(ids(items).slice(-5)).toEqual(['l0', 'l1', 'l2', 'l3', 'l4']);
    expect(ids(items)).not.toContain('s0');
    expect(ids(items)).toContain(`s${LIMITS.shoppingItems - 1}`);
  });

  it('gives up ticked items before anything still needed', () => {
    // Half the stored list is already in the basket. Those are the ones the
    // reader has finished with, so they are what a full list sacrifices first.
    const stored = Array.from({ length: LIMITS.shoppingItems }, (_unused, i) =>
      item({ id: `s${i}`, addedAt: 1_000 + i, checked: i % 2 === 0 }),
    );
    const incoming = Array.from({ length: 10 }, (_unused, i) =>
      item({ id: `l${i}`, addedAt: 9_000 + i }),
    );

    const { items, dropped } = mergeItems(stored, incoming);

    expect(items).toHaveLength(LIMITS.shoppingItems);
    expect(dropped).toBe(10);

    // Every unticked item survives, ticked ones absorbed the whole loss…
    const survivors = new Set(ids(items));
    for (const candidate of [...stored, ...incoming]) {
      if (!candidate.checked) expect(survivors.has(candidate.id), candidate.id).toBe(true);
    }
    expect(items.filter((i) => i.checked)).toHaveLength(
      stored.filter((i) => i.checked).length - 10,
    );
  });

  it('keeps newly added items even when every stored item is ticked', () => {
    const stored = Array.from({ length: LIMITS.shoppingItems }, (_unused, i) =>
      item({ id: `s${i}`, addedAt: 1_000 + i, checked: true }),
    );
    const incoming = Array.from({ length: 4 }, (_unused, i) =>
      item({ id: `l${i}`, addedAt: 9_000 + i }),
    );

    const { items, dropped } = mergeItems(stored, incoming);

    expect(dropped).toBe(4);
    for (const id of ['l0', 'l1', 'l2', 'l3']) expect(ids(items)).toContain(id);
  });

  // Was FINDINGS-WAVE6.md #3, introduced by the fix for #2: `room` is 0 here,
  // and `checked.slice(-0)` was `checked.slice(0)` — the entire array — so the
  // cap was breached by exactly the number of ticked items, without bound.
  it('never returns more than the cap, however many items are ticked', () => {
    const stored = [
      ...Array.from({ length: LIMITS.shoppingItems }, (_unused, i) =>
        item({ id: `u${i}`, addedAt: 1_000 + i }),
      ),
      ...Array.from({ length: 50 }, (_unused, i) => item({ id: `c${i}`, addedAt: i, checked: true })),
    ];

    const { items, dropped } = mergeItems(stored, [item({ id: 'new', addedAt: 9_000 })]);

    expect(items).toHaveLength(LIMITS.shoppingItems);
    expect(ids(items)).toContain('new');
    expect(dropped).toBe(stored.length + 1 - items.length);
    // Every ticked item went, and nothing still needed did.
    expect(items.filter((i) => i.checked)).toHaveLength(0);
  });

  it('holds the cap at exactly the boundary with nothing ticked at all', () => {
    // `room` reaches 0 from the other direction: the unticked items fill the
    // cap on their own and there is not a single ticked item to give up.
    const stored = Array.from({ length: LIMITS.shoppingItems }, (_unused, i) =>
      item({ id: `u${i}`, addedAt: 1_000 + i }),
    );

    const exact = mergeItems(stored, []);
    expect(exact.items).toHaveLength(LIMITS.shoppingItems);
    expect(exact.dropped).toBe(0);
    expect(ids(exact.items)).toContain('u0');

    const overByOne = mergeItems(stored, [item({ id: 'new', addedAt: 9_000 })]);
    expect(overByOne.items).toHaveLength(LIMITS.shoppingItems);
    expect(overByOne.dropped).toBe(1);
    expect(ids(overByOne.items)).toContain('new');
    expect(ids(overByOne.items)).not.toContain('u0'); // the oldest, and only it
    expect(ids(overByOne.items)).toContain('u1');
  });

  it('always reports dropped as the number of distinct ids that did not survive', () => {
    /**
     * The invariant, rather than a number per case: whatever the mix, the ids
     * going in are the ids coming out plus `dropped`. A count computed
     * independently of the array it describes is what let the cap breach in
     * FINDINGS-WAVE6.md #3 report a truncation that had not happened.
     */
    const unticked = (count: number, from = 0) =>
      Array.from({ length: count }, (_unused, i) => item({ id: `u${from + i}`, addedAt: 1_000 + from + i }));
    const ticked = (count: number, from = 0) =>
      Array.from({ length: count }, (_unused, i) =>
        item({ id: `c${from + i}`, addedAt: 100 + from + i, checked: true }),
      );

    const shapes: [string, ShoppingItem[], ShoppingItem[]][] = [
      ['empty', [], []],
      ['under the cap', unticked(10), unticked(5, 10)],
      ['exactly at the cap', unticked(LIMITS.shoppingItems), []],
      ['at the cap, one added', unticked(LIMITS.shoppingItems), unticked(1, 900)],
      ['cap of unticked plus two ticked', [...unticked(LIMITS.shoppingItems), ...ticked(2)], unticked(2, 900)],
      ['cap of unticked plus many ticked', [...unticked(LIMITS.shoppingItems), ...ticked(2_000)], unticked(1, 900)],
      ['all ticked, over the cap', ticked(LIMITS.shoppingItems + 20), unticked(3, 900)],
      ['mixed, well over the cap', [...unticked(200), ...ticked(200)], unticked(200, 500)],
      ['overlapping ids', unticked(LIMITS.shoppingItems), unticked(50)],
    ];

    for (const [label, stored, incoming] of shapes) {
      const { items, dropped } = mergeItems(stored, incoming);
      const distinct = new Set([...stored, ...incoming].map((i) => i.id)).size;

      expect(dropped, `${label}: dropped`).toBe(distinct - items.length);
      expect(items.length, `${label}: cap`).toBeLessThanOrEqual(LIMITS.shoppingItems);
      expect(dropped, `${label}: dropped is not negative`).toBeGreaterThanOrEqual(0);
      expect(new Set(ids(items)).size, `${label}: no duplicates`).toBe(items.length);
      // Nothing is invented: every survivor came from one of the two inputs.
      const inputIds = new Set([...stored, ...incoming].map((i) => i.id));
      for (const id of ids(items)) expect(inputIds.has(id), `${label}: ${id}`).toBe(true);
    }
  });

  it('reports dropped: 0 whenever everything fits', () => {
    const stored = Array.from({ length: LIMITS.shoppingItems - 2 }, (_unused, i) =>
      item({ id: `s${i}`, addedAt: 1_000 + i }),
    );
    const { items, dropped } = mergeItems(stored, [item({ id: 'l0', addedAt: 9_000 })]);

    expect(items).toHaveLength(LIMITS.shoppingItems - 1);
    expect(dropped).toBe(0);
  });

  it('is a no-op on two empty lists', () => {
    expect(mergeItems([], [])).toEqual({ items: [], dropped: 0 });
  });
});

// === endpoints ===============================================================

describe('GET /api/shopping-list', () => {
  it('returns an empty list for a user who has never had one', async () => {
    const res = await api().get('/api/shopping-list').set(authHeader(USER));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], updatedAt: null });
    // Reading must not create a document.
    expect(await ShoppingList.countDocuments({})).toBe(0);
  });

  it('returns the stored list', async () => {
    await ShoppingList.create({ user: USER, items: [item({ id: 'a', name: 'eggs' })] });

    const res = await api().get('/api/shopping-list').set(authHeader(USER));

    expect(res.status).toBe(200);
    expect(names(res.body.items)).toEqual(['eggs']);
    expect(res.body.updatedAt).not.toBeNull();
  });

  it('never returns another users list', async () => {
    await ShoppingList.create({ user: 'someone-else', items: [item({ id: 'a', name: 'theirs' })] });

    const res = await api().get('/api/shopping-list').set(authHeader(USER));
    expect(res.body.items).toEqual([]);
  });

  it('requires auth', async () => {
    expect((await api().get('/api/shopping-list')).status).toBe(401);
  });
});

describe('PUT /api/shopping-list', () => {
  it('creates the list on first write', async () => {
    const res = await api()
      .put('/api/shopping-list')
      .set(authHeader(USER))
      .send({ items: [item({ id: 'a', name: 'eggs' })] });

    expect(res.status).toBe(200);
    expect(names(res.body.items)).toEqual(['eggs']);
  });

  it('replaces wholesale rather than merging', async () => {
    await api()
      .put('/api/shopping-list')
      .set(authHeader(USER))
      .send({ items: [item({ id: 'a', name: 'eggs' }), item({ id: 'b', name: 'milk' })] });

    const res = await api()
      .put('/api/shopping-list')
      .set(authHeader(USER))
      .send({ items: [item({ id: 'c', name: 'bread' })] });

    expect(res.status).toBe(200);
    expect(names(res.body.items)).toEqual(['bread']);

    const stored = await ShoppingList.findOne({ user: USER }).lean();
    expect(names(stored!.items)).toEqual(['bread']);
  });

  it('accepts an empty list', async () => {
    await api()
      .put('/api/shopping-list')
      .set(authHeader(USER))
      .send({ items: [item({ id: 'a' })] });

    const res = await api().put('/api/shopping-list').set(authHeader(USER)).send({ items: [] });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('requires auth', async () => {
    expect((await api().put('/api/shopping-list').send({ items: [] })).status).toBe(401);
  });
});

describe('POST /api/shopping-list/merge', () => {
  it('keeps items from both sides', async () => {
    await ShoppingList.create({
      user: USER,
      items: [item({ id: 'server', name: 'server item', addedAt: 100 })],
    });

    const res = await api()
      .post('/api/shopping-list/merge')
      .set(authHeader(USER))
      .send({ items: [item({ id: 'local', name: 'local item', addedAt: 200 })] });

    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(true);
    expect(names(res.body.items)).toEqual(['server item', 'local item']);
  });

  it('drops nothing when the server has never seen the list', async () => {
    const res = await api()
      .post('/api/shopping-list/merge')
      .set(authHeader(USER))
      .send({
        items: [item({ id: 'a', name: 'one', addedAt: 1 }), item({ id: 'b', name: 'two', addedAt: 2 })],
      });

    expect(res.status).toBe(200);
    expect(names(res.body.items)).toEqual(['one', 'two']);
  });

  it('resolves a conflict as checked if either side was checked', async () => {
    await ShoppingList.create({ user: USER, items: [item({ id: 'x', checked: true, addedAt: 100 })] });

    const res = await api()
      .post('/api/shopping-list/merge')
      .set(authHeader(USER))
      .send({ items: [item({ id: 'x', checked: false, addedAt: 200 })] });

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].checked).toBe(true);
  });

  it('takes the more recently added amount and the earlier addedAt', async () => {
    await ShoppingList.create({ user: USER, items: [item({ id: 'x', amount: '1 cup', addedAt: 100 })] });

    const res = await api()
      .post('/api/shopping-list/merge')
      .set(authHeader(USER))
      .send({ items: [item({ id: 'x', amount: '2 cups', addedAt: 500 })] });

    expect(res.body.items[0]).toMatchObject({ amount: '2 cups', addedAt: 100 });
  });

  it('persists the merged list', async () => {
    await ShoppingList.create({ user: USER, items: [item({ id: 'a', name: 'kept', addedAt: 1 })] });

    await api()
      .post('/api/shopping-list/merge')
      .set(authHeader(USER))
      .send({ items: [item({ id: 'b', name: 'added', addedAt: 2 })] })
      .expect(200);

    const stored = await ShoppingList.findOne({ user: USER }).lean();
    expect(names(stored!.items)).toEqual(['kept', 'added']);
  });

  it(`caps the merged list at ${LIMITS.shoppingItems}`, async () => {
    await ShoppingList.create({
      user: USER,
      items: Array.from({ length: LIMITS.shoppingItems }, (_unused, i) =>
        item({ id: `s${i}`, name: `stored ${i}`, addedAt: 1_000 + i }),
      ),
    });

    const res = await api()
      .post('/api/shopping-list/merge')
      .set(authHeader(USER))
      .send({
        items: Array.from({ length: 3 }, (_unused, i) =>
          item({ id: `l${i}`, name: `local ${i}`, addedAt: 9_000 + i }),
        ),
      });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(LIMITS.shoppingItems);
    expect(res.body.dropped).toBe(3);
    // The three just merged in are newer than everything stored, so they stay
    // and the oldest stored items are what go.
    expect(ids(res.body.items).slice(-3)).toEqual(['l0', 'l1', 'l2']);
  });

  it('requires auth', async () => {
    expect((await api().post('/api/shopping-list/merge').send({ items: [] })).status).toBe(401);
  });
});

describe('DELETE /api/shopping-list', () => {
  it('clears the list', async () => {
    await ShoppingList.create({ user: USER, items: [item({ id: 'a' })] });

    const res = await api().delete('/api/shopping-list').set(authHeader(USER));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], cleared: true });
    expect((await ShoppingList.findOne({ user: USER }).lean())!.items).toEqual([]);
  });

  it('requires auth', async () => {
    expect((await api().delete('/api/shopping-list')).status).toBe(401);
  });
});

describe('shopping list validation', () => {
  it(`rejects more than ${LIMITS.shoppingItems} items`, async () => {
    const items = Array.from({ length: LIMITS.shoppingItems + 1 }, (_unused, i) => item({ id: `x${i}` }));

    const put = await api().put('/api/shopping-list').set(authHeader(USER)).send({ items });
    const merge = await api().post('/api/shopping-list/merge').set(authHeader(USER)).send({ items });

    expect(put.status).toBe(400);
    expect(merge.status).toBe(400);
    expect(await ShoppingList.countDocuments({})).toBe(0);
  });

  it('rejects an item with no name', async () => {
    const res = await api()
      .put('/api/shopping-list')
      .set(authHeader(USER))
      .send({ items: [{ id: 'a', amount: '1' }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('rejects an empty name', async () => {
    const res = await api()
      .put('/api/shopping-list')
      .set(authHeader(USER))
      .send({ items: [{ id: 'a', name: '   ' }] });

    expect(res.status).toBe(400);
  });

  it('rejects an item with no id', async () => {
    const res = await api()
      .put('/api/shopping-list')
      .set(authHeader(USER))
      .send({ items: [{ name: 'eggs' }] });

    expect(res.status).toBe(400);
  });

  it('strips HTML from the name', async () => {
    const res = await api()
      .put('/api/shopping-list')
      .set(authHeader(USER))
      .send({ items: [{ id: 'a', name: '<script>alert(1)</script>eggs', recipeTitle: '<b>Cake</b>' }] });

    expect(res.status).toBe(200);
    expect(res.body.items[0].name).toBe('eggs');
    expect(res.body.items[0].name).not.toContain('<');
    expect(res.body.items[0].recipeTitle).toBe('Cake');

    const stored = await ShoppingList.findOne({ user: USER }).lean();
    expect(stored!.items[0].name).toBe('eggs');
  });

  it('rejects unknown top-level keys', async () => {
    const res = await api()
      .put('/api/shopping-list')
      .set(authHeader(USER))
      .send({ items: [], user: 'someone-else' });

    expect(res.status).toBe(400);
  });

  it('defaults the optional fields', async () => {
    const res = await api()
      .put('/api/shopping-list')
      .set(authHeader(USER))
      .send({ items: [{ id: 'a', name: 'eggs' }] });

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ amount: '', recipeId: '', recipeTitle: '', checked: false });
    expect(typeof res.body.items[0].addedAt).toBe('number');
  });
});
