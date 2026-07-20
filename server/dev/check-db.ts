/**
 * Checks a MongoDB connection and reports what is actually in the cluster.
 *
 *   npm run check:db
 *
 * Written for the moment you are wiring up a fresh environment and need to
 * answer two questions the Atlas UI does not put in front of you:
 *
 *   1. Is the password right?
 *   2. Which database holds the recipes?
 *
 * The connection string Atlas hands you ends `.../?appName=Cluster0` — with no
 * database name. Mongoose quietly falls back to a database called `test`, so
 * the app connects successfully, reports healthy, and shows an empty library.
 * That failure looks exactly like "my data is gone".
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const uri = process.env.MONGO_URI;

if (!uri) {
  console.error('\n  MONGO_URI is not set. Fill it in in server/.env first.\n');
  process.exit(1);
}

function describeUri(value: string): void {
  try {
    const withoutScheme = value.replace(/^mongodb(\+srv)?:\/\//, '');
    const [credentials, rest = ''] = withoutScheme.split('@');
    const user = credentials?.split(':')[0] ?? '(none)';
    const host = rest.split('/')[0]?.split('?')[0] ?? '(unknown)';
    const path = rest.includes('/') ? rest.split('/')[1]!.split('?')[0] : '';

    console.log(`  user     : ${user}`);
    console.log(`  host     : ${host}`);
    console.log(`  database : ${path || '(none specified — will default to "test")'}`);

    if (value.includes('<') || value.includes('>')) {
      console.log('\n  The string still contains a <placeholder>. Replace it with the real value.');
    }

    // A raw @ : / ? # % in a password breaks URI parsing in ways that surface as
    // baffling authentication errors.
    const password = credentials?.split(':')[1] ?? '';
    if (/[@:/?#[\]]/.test(decodeURIComponent(password || ''))) {
      console.log('\n  The password contains characters that must be percent-encoded.');
      console.log('  Encode it with:  node -e "console.log(encodeURIComponent(\'YOUR_PASSWORD\'))"');
    }
  } catch {
    console.log('  Could not parse the connection string.');
  }
}

async function main(): Promise<void> {
  console.log('\n  Connection string\n');
  describeUri(uri!);

  console.log('\n  Connecting…');
  await mongoose.connect(uri!, { serverSelectionTimeoutMS: 10_000 });
  console.log('  Connected.\n');

  const admin = mongoose.connection.db!.admin();

  let databases: { name: string }[] = [];
  try {
    const result = await admin.listDatabases();
    databases = result.databases;
  } catch {
    // Atlas' default user role cannot list all databases; fall back to the one
    // the connection string selected.
    databases = [{ name: mongoose.connection.name }];
    console.log('  (Not permitted to list all databases; showing the connected one only.)\n');
  }

  console.log('  Databases and collections\n');

  for (const { name } of databases) {
    if (['admin', 'local', 'config'].includes(name)) continue;

    const db = mongoose.connection.getClient().db(name);
    const collections = await db.listCollections().toArray();
    if (collections.length === 0) continue;

    const counts = await Promise.all(
      collections.map(async (collection) => ({
        name: collection.name,
        count: await db.collection(collection.name).estimatedDocumentCount(),
      })),
    );

    const isOurs = counts.some((c) => c.name === 'recipes');
    console.log(`  ${name}${isOurs ? '   <-- this is the one you want' : ''}`);
    for (const { name: collectionName, count } of counts) {
      console.log(`      ${collectionName.padEnd(20)} ${count} documents`);
    }
    console.log('');
  }

  const connected = mongoose.connection.name;
  const recipeCount = await mongoose.connection.db!.collection('recipes').estimatedDocumentCount();

  console.log(`  MONGO_URI currently points at "${connected}", which holds ${recipeCount} recipes.`);
  if (recipeCount === 0) {
    console.log('\n  Zero recipes here. If a database above shows a populated "recipes"');
    console.log('  collection, add its name to the URI, before the "?":');
    console.log('      ...mongodb.net/YOUR_DB_NAME?appName=Cluster0');
  }

  console.log('');
  await mongoose.connection.close();
}

main().catch((error: unknown) => {
  const message = (error as Error).message;
  console.error(`\n  Failed: ${message}\n`);

  if (/authentication failed|bad auth/i.test(message)) {
    console.error('  The username or password is wrong.');
    console.error('  Reset it in Atlas: Database Access -> Edit on the user -> Edit Password.');
    console.error('  That does not touch your data.\n');
  } else if (/ENOTFOUND|querySrv/i.test(message)) {
    console.error('  The cluster hostname did not resolve. Check it for typos.\n');
  } else if (/timed out|ETIMEDOUT/i.test(message)) {
    console.error('  Connected to nothing in time — usually the Atlas IP allow-list.');
    console.error('  Atlas -> Network Access -> add your current IP address.\n');
  }

  process.exit(1);
});
