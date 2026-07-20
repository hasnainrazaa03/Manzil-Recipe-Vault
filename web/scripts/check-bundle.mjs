/**
 * Fails the build if the emitted chunks import each other in a cycle.
 *
 * This exists because a green `vite build` is not evidence that the app boots.
 * A hand-written `manualChunks` split React and the editor into separate
 * chunks, Rollup put React's generated CommonJS interop helpers in the editor
 * chunk, and the two ended up importing each other. The build succeeded, every
 * test passed, and the deployed site was a blank page with
 *
 *     Cannot set properties of undefined (setting 'Children')
 *
 * because the editor chunk evaluated before React had initialised. A circular
 * chunk dependency is never intentional and is invisible in the build log, so
 * it is worth one automated check.
 *
 * Runs automatically after `npm run build`.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = 'dist/assets';

if (!existsSync(ASSETS)) {
  console.error(`\n  check-bundle: ${ASSETS} does not exist — did the build run?\n`);
  process.exit(1);
}

const files = readdirSync(ASSETS).filter((file) => file.endsWith('.js'));
const chunkName = (file) => file.split('-')[0];

/** chunk name -> the chunks it statically imports */
const graph = new Map();

for (const file of files) {
  const source = readFileSync(join(ASSETS, file), 'utf8');
  const imports = [...source.matchAll(/from"\.\/([A-Za-z0-9_.-]+\.js)"/g)].map((match) =>
    chunkName(match[1]),
  );
  graph.set(chunkName(file), [...new Set(imports)]);
}

const cycles = [];
for (const [from, targets] of graph) {
  for (const to of targets) {
    if (graph.get(to)?.includes(from) && from < to) cycles.push([from, to]);
  }
}

if (cycles.length > 0) {
  console.error('\n  Circular chunk dependencies in the build:\n');
  for (const [a, b] of cycles) console.error(`      ${a}  <->  ${b}`);
  console.error(`
  The chunks import each other, so one of them evaluates before its
  dependency is ready. This usually ships as a blank page with a message
  like "Cannot set properties of undefined".

  Almost always caused by a manualChunks rule that splits a package away
  from a module it needs — including the interop helpers Rollup generates
  for CommonJS packages such as React.

  Fix the grouping in vite.config.ts, or remove the manual chunking and
  let Rollup decide.
`);
  process.exit(1);
}

console.log(`  check-bundle: ${graph.size} chunks, no circular dependencies.`);
