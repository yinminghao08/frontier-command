import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const require = createRequire(import.meta.url);
const { createAgentDemoWorld, AGENT_DEMO_NAME } = require('../dist-electron/src/engine/demo.js');
const { SaveStore } = require('../dist-electron/electron/persistence.js');
// Only this repository's generated demo data is touched, never the player's userData.
const directory = resolve('demo/user-data');
mkdirSync(directory, { recursive: true });
const world = createAgentDemoWorld();
const store = new SaveStore(directory);
const loaded = store.read();
if (loaded.blocked) throw Error(loaded.message);
if (loaded.world) {
  store.write(world);
  store.rename(store.catalog().activeId, AGENT_DEMO_NAME);
} else store.beginNew(world, undefined, AGENT_DEMO_NAME);
writeFileSync(join(directory, '..', 'agent-demo-v12.json'), JSON.stringify(world, null, 2) + '\n');
console.log('v12 Agent Demo saved: ' + store.path);
