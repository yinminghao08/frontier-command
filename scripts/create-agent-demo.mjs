import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createAgentDemoWorld, AGENT_DEMO_NAME } = require('../dist-electron/src/engine/demo.js');
const { SaveStore } = require('../dist-electron/electron/persistence.js');
// Only this repository's generated demo data is touched, never the player's userData.
const directory = fileURLToPath(new URL('../.test-data/demo/user-data/', import.meta.url));
mkdirSync(directory, { recursive: true });
const world = createAgentDemoWorld();
const store = new SaveStore(directory);
const loaded = store.read();
if (loaded.blocked) throw Error(loaded.message);
if (loaded.world) {
  store.write(world);
  store.rename(store.catalog().activeId, AGENT_DEMO_NAME);
} else store.beginNew(world, undefined, AGENT_DEMO_NAME);
writeFileSync(join(directory, '..', 'agent-demo-v16.json'), JSON.stringify(world, null, 2) + '\n');
console.log('v16 Agent Demo saved: ' + store.path);
