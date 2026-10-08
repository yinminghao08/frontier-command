import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { createWorld } = require('../dist-electron/src/engine/data.js');
const { SimulationEngine } = require('../dist-electron/src/engine/engine.js');
const { parseSave } = require('../dist-electron/src/engine/saves.js');
const results = [];
for (const seed of [42, 1701, 236807])
  for (const [amount, route, repeat] of [
    [120, 'direct', false],
    [600, 'direct', false],
    [600, 'risky', false],
    [600, 'safe', false],
  ]) {
    const e = new SimulationEngine(createWorld(seed));
    const command = e.dispatchCommand({
      type: 'issueDirective',
      shipIds: ['meridian'],
      mode: 'REPLACE',
      action: {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials',
        amount,
        route,
        repeat,
      },
    });
    if (!command.ok) throw Error(command.reason);
    let at120;
    for (let n = 0; n < 3600; n++) {
      e.state.paused = false;
      e.step();
      if (n === 1199)
        at120 = {
          time: e.state.time,
          operationTargets: e.state.orion.operations.map((o) => o.targetId),
          taken: e.state.orion.operations.reduce((sum, o) => sum + o.taken, 0),
          incidents: e.state.piracyIncidents.length,
          realizedIncome: e.state.orion.realizedIncome,
        };
    }
    parseSave(e.state);
    const w = e.state;
    results.push({
      seed,
      amount,
      route,
      repeat,
      at120,
      time: w.time,
      orionShips: w.enemies.filter((s) => s.factionId === 'orion').length,
      losses: w.orion.shipLosses.map((l) => l.id),
      incidents: w.piracyIncidents.map((i) => ({
        created: i.created,
        stage: i.stage,
        response: i.response,
        demand: i.demand,
        lost: i.lost,
      })),
      operations: w.orion.operations.map((o) => ({
        target: o.targetId,
        created: o.created,
        phase: o.phase,
        status: o.status,
        taken: o.taken,
        reason: o.reason,
      })),
      realizedIncome: w.orion.realizedIncome,
      budget: w.factions.orion.credits,
      marketInventory: w.orion.market.stock,
      production: w.orion.jobs
        .filter((j) => j.kind === 'ship')
        .map(({ id, classId, status, work, duration, credits, materials }) => ({
          id,
          classId,
          status,
          work,
          duration,
          credits,
          materials,
        })),
      meridian: w.ships.find((s) => s.id === 'meridian')?.cargo ?? null,
      mineHull: w.locations.find((l) => l.id === 'mine').hull,
    });
  }
const output = resolve('docs/verification/v14');
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'natural-worlds.json'), JSON.stringify(results, null, 2) + '\n');
for (const r of results)
  console.log(
    JSON.stringify({
      seed: r.seed,
      amount: r.amount,
      route: r.route,
      firstDemand: r.incidents[0]?.created ?? null,
      stolen: r.incidents.reduce((n, i) => n + i.lost.materials, 0),
      income: r.realizedIncome,
      operations: r.operations.length,
      assets: r.orionShips,
    }),
  );
