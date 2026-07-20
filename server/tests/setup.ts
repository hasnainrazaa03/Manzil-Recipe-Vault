process.env.NODE_ENV = 'test';

import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Firebase is stubbed for the whole suite.
 *
 * `requireAuth`/`optionalAuth` funnel every request through
 * `admin.auth().verifyIdToken(token)`, so replacing that one call is enough to
 * let a test act as any user. A token is `test|<uid>|<email>`; anything else is
 * rejected exactly as an invalid Firebase token would be.
 *
 * This lives in setup.ts rather than helpers.ts because setup files run before
 * the test module (and therefore before `../src/app.js`) is imported, which is
 * what guarantees the mock is registered in time.
 */
vi.mock('firebase-admin', () => {
  const verifyIdToken = vi.fn(async (token: string) => {
    const parts = String(token).split('|');
    if (parts.length !== 3 || parts[0] !== 'test' || !parts[1]) {
      throw new Error('Firebase ID token has invalid signature');
    }
    return { uid: parts[1], email: parts[2] || undefined };
  });

  const getUser = vi.fn(async (uid: string) => ({
    uid,
    // Deliberately no displayName: the public-profile route must fall back to
    // the stored Profile, never to anything email-shaped.
    displayName: null,
    email: `${uid}@example.com`,
  }));

  const updateUser = vi.fn(async (uid: string) => ({ uid }));

  const auth = () => ({ verifyIdToken, getUser, updateUser });

  const admin = {
    apps: [{}],
    auth,
    initializeApp: vi.fn(),
    credential: { cert: vi.fn() },
  };

  return { default: admin, ...admin };
});

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();

  // Every test file forks its own worker and its own mongod, but two workers
  // starting at the same instant can both pick the same free port and end up
  // talking to one surviving instance. A database name unique to this worker
  // means that even then, one file's `afterEach` cleanup can never wipe another
  // file's data mid-test.
  const dbName = `test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  await mongoose.connect(mongo.getUri(), { dbName });

  // Models register themselves on import; pull them in so `modelNames()` is
  // populated, then build the declared indexes. The text index in particular
  // does not exist until this runs, and the relevance sort depends on it.
  await import('../src/models/Recipe.js');
  await import('../src/models/Profile.js');
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes()));

  const { startApi } = await import('./helpers.js');
  await startApi();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  const { stopApi } = await import('./helpers.js');
  await stopApi();
  await mongoose.disconnect();
  await mongo?.stop();
});
