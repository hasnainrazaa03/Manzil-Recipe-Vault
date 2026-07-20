/**
 * Assembles a MongoDB connection string correctly.
 *
 *   npm run make:uri -- '<password>' [database]
 *
 * Two things go wrong by hand, both of which present as a baffling
 * "authentication failed":
 *
 *   1. A password containing @ : / ? # or % breaks URI parsing unless it is
 *      percent-encoded. `p@ssw0rd` silently truncates the host.
 *   2. The string Atlas gives you has no database name, so Mongoose connects to
 *      a default database called `test` — the app reports healthy and shows an
 *      empty recipe library.
 *
 * Quote the password in single quotes so your shell does not eat the special
 * characters before this script sees them.
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';

const [password, database = 'manzil'] = process.argv.slice(2);

if (!password) {
  console.error(`
  Usage:  npm run make:uri -- '<password>' [database]

  Example:
      npm run make:uri -- 'aB3!xY9@zQ' manzil

  Quote the password in single quotes. Find the database name with:
      npm run check:db
`);
  process.exit(1);
}

/** Reuse the cluster host already in .env so it cannot be mistyped. */
function clusterHost(): string {
  const existing = process.env.MONGO_URI ?? '';
  const match = /@([^/?]+)/.exec(existing);
  if (match?.[1]) return match[1];

  console.error('  Could not read the cluster host from MONGO_URI in server/.env.');
  console.error('  Paste the string Atlas gives you into that file first, placeholders and all.\n');
  process.exit(1);
}

function username(): string {
  const existing = process.env.MONGO_URI ?? '';
  const match = /mongodb\+srv:\/\/([^:]+):/.exec(existing);
  return match?.[1] ?? 'recipe_user';
}

const encoded = encodeURIComponent(password);
const uri = `mongodb+srv://${username()}:${encoded}@${clusterHost()}/${database}?retryWrites=true&w=majority&appName=Cluster0`;

console.log('\n  Connection string built\n');
console.log(`  user     : ${username()}`);
console.log(`  host     : ${clusterHost()}`);
console.log(`  database : ${database}`);

if (encoded !== password) {
  console.log(`\n  Password contained characters needing encoding — handled.`);
  console.log(`  (${password.length} chars in, ${encoded.length} chars encoded.)`);
}

// Printing it would put the password in the terminal scrollback, and from there
// into screenshots and shell history.
try {
  execSync('pbcopy', { input: uri });
  console.log('\n  Copied to your clipboard. Paste it into server/.env and Render.');
} catch {
  console.log('\n  Could not reach the clipboard. The string is:\n');
  console.log(`  ${uri}`);
}

console.log('\n  Then check it with:  npm run check:db\n');
