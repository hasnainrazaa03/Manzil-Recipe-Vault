/**
 * Runs the real API against a throwaway in-memory database, with Firebase
 * verification stubbed, so the app can be explored end to end without a
 * MongoDB instance, a Firebase project or a Cloudinary account.
 *
 * This is a development harness. It lives outside `src/` precisely so it can
 * never be reached by the production build, and it depends on
 * `mongodb-memory-server`, which is a devDependency.
 *
 *   npm run demo
 *
 * Nothing is persisted: every start gives a clean, freshly seeded database.
 */
process.env.NODE_ENV ??= 'development';
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/placeholder';
process.env.CORS_ORIGINS ??= 'http://localhost:5173,http://localhost:4173';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import admin from 'firebase-admin';
import { DEMO_RECIPES, DEMO_USERS } from './seed.js';

/**
 * Accepts the demo tokens the demo client mints, in place of real Firebase
 * verification. Format: `demo|<uid>`.
 *
 * `createApp()` never calls `initFirebase()` — only the real entry point does —
 * so replacing `admin.auth` here is enough to satisfy the auth middleware
 * without any credentials existing.
 */
function stubFirebase(): void {
  const users = new Map(DEMO_USERS.map((user) => [user.uid, user]));

  const fakeAuth = {
    verifyIdToken: async (token: string) => {
      const uid = token.startsWith('demo|') ? token.slice(5) : null;
      const user = uid ? users.get(uid) : null;
      if (!user) throw new Error('Invalid demo token');
      return { uid: user.uid, email: user.email, name: user.displayName };
    },
    getUser: async (uid: string) => {
      const user = users.get(uid);
      if (!user) throw new Error('No such user');
      return { uid: user.uid, email: user.email, displayName: user.displayName };
    },
    updateUser: async (uid: string) => ({ uid }),
  };

  Object.defineProperty(admin, 'auth', { value: () => fakeAuth, configurable: true });
}

async function seed(): Promise<void> {
  const { Recipe } = await import('../src/models/Recipe.js');
  const { Profile } = await import('../src/models/Profile.js');

  await Profile.insertMany(
    DEMO_USERS.map((user) => ({
      user: user.uid,
      displayName: user.displayName,
      bio:
        user.uid === 'demo-user'
          ? 'Signed in as the demo user. Everything you do here is thrown away when the server stops.'
          : 'Cooks a lot, writes it down occasionally.',
      profilePictureUrl: '',
      savedRecipes: [],
    })),
  );

  const created = await Recipe.create(
    DEMO_RECIPES.map((recipe) => ({
      ...recipe,
      comments: recipe.comments.map((comment, index) => ({
        text: comment.text,
        authorId: comment.authorId,
        authorEmail: `${comment.authorId}@example.com`,
        authorDisplayName: comment.authorName,
        authorProfilePictureUrl: '',
        // Spread the timestamps out so "newest first" has something to order.
        createdAt: new Date(Date.now() - (index + 1) * 36e5),
        editedAt: null,
      })),
      commentCount: recipe.comments.length,
      ratingCount: recipe.ratings.length,
      averageRating:
        recipe.ratings.length > 0
          ? Math.round(
              (recipe.ratings.reduce((sum, rating) => sum + rating.score, 0) /
                recipe.ratings.length) *
                10,
            ) / 10
          : 0,
    })),
  );

  // Give the demo user a couple of saved recipes so that page is not empty.
  await Profile.updateOne(
    { user: 'demo-user' },
    { $set: { savedRecipes: created.slice(0, 2).map((recipe) => recipe._id) } },
  );

  console.log(`  Seeded ${created.length} recipes and ${DEMO_USERS.length} profiles`);
}

async function main(): Promise<void> {
  console.log('\n  Starting the Manzil Recipe Vault demo API…\n');

  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri('manzil-demo');

  stubFirebase();

  await mongoose.connect(process.env.MONGO_URI);
  console.log('  In-memory MongoDB ready');

  const { Recipe } = await import('../src/models/Recipe.js');
  const { Profile } = await import('../src/models/Profile.js');
  await Promise.all([Recipe.syncIndexes(), Profile.syncIndexes()]);

  await seed();

  const { createApp } = await import('../src/app.js');
  const port = Number(process.env.PORT ?? 4000);

  createApp().listen(port, () => {
    console.log(`\n  API listening on http://localhost:${port}`);
    console.log('  Now run the web client:  cd ../web && npm run demo\n');
  });

  const shutdown = async () => {
    console.log('\n  Stopping the demo…');
    await mongoose.connection.close();
    await mongo.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error('  Demo failed to start:', error);
  process.exit(1);
});
