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
    const merged = mergeItems([item({ id: 'a', name: 'server-only' })], []);
    expect(names(merged)).toEqual(['server-only']);
  });

  it('keeps items that exist only locally', () => {
    const merged = mergeItems([], [item({ id: 'b', name: 'local-only' })]);
    expect(names(merged)).toEqual(['local-only']);
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

    const merged = mergeItems(stored, incoming);

    expect(ids(merged).sort()).toEqual(['both', 'l1', 'l2', 's1', 's2']);
    // Every id from either side survives, and the shared one is not duplicated.
    expect(merged.filter((i) => i.id === 'both')).toHaveLength(1);
  });

  it('ends up checked if either side had it checked', () => {
    expect(
      mergeItems([item({ id: 'x', checked: true })], [item({ id: 'x', checked: false })])[0].checked,
    ).toBe(true);
    expect(
      mergeItems([item({ id: 'x', checked: false })], [item({ id: 'x', checked: true })])[0].checked,
    ).toBe(true);
    expect(
      mergeItems([item({ id: 'x', checked: false })], [item({ id: 'x', checked: false })])[0].checked,
    ).toBe(false);
  });

  it('takes the amount from whichever side was added more recently', () => {
    const newerIncoming = mergeItems(
      [item({ id: 'x', amount: 'stored', addedAt: 100 })],
      [item({ id: 'x', amount: 'incoming', addedAt: 200 })],
    );
    expect(newerIncoming[0].amount).toBe('incoming');

    const newerStored = mergeItems(
      [item({ id: 'x', amount: 'stored', addedAt: 200 })],
      [item({ id: 'x', amount: 'incoming', addedAt: 100 })],
    );
    expect(newerStored[0].amount).toBe('stored');
  });

  it('takes the incoming amount on an exact tie', () => {
    const merged = mergeItems(
      [item({ id: 'x', amount: 'stored', addedAt: 100 })],
      [item({ id: 'x', amount: 'incoming', addedAt: 100 })],
    );
    expect(merged[0].amount).toBe('incoming');
  });

  it('takes the EARLIER addedAt of the two', () => {
    expect(mergeItems([item({ id: 'x', addedAt: 500 })], [item({ id: 'x', addedAt: 100 })])[0].addedAt).toBe(100);
    expect(mergeItems([item({ id: 'x', addedAt: 100 })], [item({ id: 'x', addedAt: 500 })])[0].addedAt).toBe(100);
  });

  it('sorts the result by addedAt', () => {
    const merged = mergeItems(
      [item({ id: 'c', addedAt: 300 }), item({ id: 'a', addedAt: 100 })],
      [item({ id: 'b', addedAt: 200 })],
    );
    expect(ids(merged)).toEqual(['a', 'b', 'c']);
  });

  it(`caps the result at ${LIMITS.shoppingItems} items, keeping the earliest`, () => {
    const stored = Array.from({ length: LIMITS.shoppingItems }, (_unused, i) =>
      item({ id: `s${i}`, addedAt: 1_000 + i }),
    );
    const incoming = Array.from({ length: 5 }, (_unused, i) => item({ id: `l${i}`, addedAt: i }));

    const merged = mergeItems(stored, incoming);

    expect(merged).toHaveLength(LIMITS.shoppingItems);
    // The five earliest incoming items are at the front; the newest stored ones
    // fall off the end.
    expect(ids(merged).slice(0, 5)).toEqual(['l0', 'l1', 'l2', 'l3', 'l4']);
    expect(ids(merged)).not.toContain(`s${LIMITS.shoppingItems - 1}`);
  });

  it('is a no-op on two empty lists', () => {
    expect(mergeItems([], [])).toEqual([]);
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
        items: Array.from({ length: 3 }, (_unused, i) => item({ id: `l${i}`, name: `local ${i}`, addedAt: i })),
      });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(LIMITS.shoppingItems);
    expect(ids(res.body.items).slice(0, 3)).toEqual(['l0', 'l1', 'l2']);
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
