import type { Enemy, Location, OrionJob, Stock } from '../types';
import type { SimulationEngine } from '../engine';
import { emptyStock, makeEnemy } from '../data';
import { capabilities, cargoUsed } from '../capabilities';
import { deposit } from '../inventory';
import { dist, move } from '../navigation';
import { ORION_BUILDS, ORION_RULES as R, type OrionClassId } from '../definitions/orion';
import { GOODS } from '../types';
import { goodsCount } from './piracy';
import { orionLocation } from './generation';
import { coordinateRandom, materialize } from '../world-generation';
import { regionAt } from '../definitions/locations';
import { goOrion } from './navigation';

export function ledger(
  e: SimulationEngine,
  kind: string,
  entityId: string,
  credits = 0,
  goods = emptyStock(),
) {
  const previous = e.state.orion.ledger
    .slice(-100)
    .reverse()
    .find(
      (l) =>
        l.kind === kind &&
        l.entityId === entityId &&
        Math.floor(l.time) === Math.floor(e.state.time),
    );
  if (previous && ['unload', 'repair', 'sale', 'lootTransshipment'].includes(kind)) {
    previous.credits += credits;
    for (const k of GOODS) previous.goods[k] += goods[k];
    return;
  }
  e.state.orion.ledger.push({
    id: 'orion-ledger-' + e.state.nextId++,
    time: e.state.time,
    kind,
    entityId,
    credits,
    goods: structuredClone(goods),
  });
}
export const operatingBases = (e: SimulationEngine) =>
  e.state.locations
    .filter((l) => l.owner === 'orion' && l.hull > 0 && !l.occupation)
    .sort((a, b) => a.id.localeCompare(b.id));
export function retreatBase(e: SimulationEngine, s: Enemy) {
  return operatingBases(e).sort((a, b) => dist(s, a) - dist(s, b) || a.id.localeCompare(b.id))[0];
}
export function startOrionShipJob(e: SimulationEngine, home: Location, classId: OrionClassId) {
  const w = e.state,
    d = ORION_BUILDS[classId];
  const count =
    w.enemies.filter((s) => s.factionId === 'orion').length +
    w.orion.jobs.filter((j) => j.status === 'active' && j.kind === 'ship').length;
  const growthSpent = w.orion.ledger
    .filter((l) => l.kind === 'growth')
    .reduce((n, l) => n - l.credits, 0);
  if (
    home.owner !== 'orion' ||
    home.hull <= 0 ||
    home.occupation ||
    count >= R.fleetLimit ||
    (classId === 'orionCorsair' && home.defenseProfile !== 'orionHQ') ||
    w.orion.jobs.some(
      (j) => j.status === 'active' && j.kind === 'ship' && j.locationId === home.id,
    ) ||
    home.stock.materials < d.materials ||
    w.factions.orion.credits < d.credits ||
    (count >= 10 &&
      (w.orion.realizedIncome - growthSpent < d.credits ||
        home.stock.materials < d.materials + R.repairReserve ||
        w.factions.orion.credits < d.credits + R.budgetReserve))
  )
    return false;
  home.stock.materials -= d.materials;
  w.factions.orion.credits -= d.credits;
  const job: OrionJob = {
    id: 'orion-job-' + w.nextId++,
    kind: 'ship',
    locationId: home.id,
    builderId: null,
    point: { x: home.x, y: home.y },
    classId,
    work: 0,
    duration: d.minutes,
    credits: d.credits,
    materials: d.materials,
    status: 'active',
  };
  w.orion.jobs.push(job);
  ledger(e, count >= 10 ? 'growth' : 'replacement', home.id, -d.credits, {
    ...emptyStock(),
    materials: d.materials,
  });
  return true;
}
export function startOrionConstruction(
  e: SimulationEngine,
  builder: Enemy,
  point: { x: number; y: number },
  headquarters = false,
) {
  const w = e.state,
    cost = headquarters ? R.hqCost : R.supplyCost,
    bases = operatingBases(e);
  if (
    builder.factionId !== 'orion' ||
    builder.hull <= 0 ||
    builder.cargo.materials < cost.materials ||
    w.factions.orion.credits < cost.credits ||
    w.orion.jobs.some(
      (j) =>
        j.status === 'active' &&
        (j.builderId === builder.id || j.kind === (headquarters ? 'hq' : 'supply')),
    ) ||
    (headquarters
      ? bases.some((l) => l.defenseProfile === 'orionHQ')
      : bases.filter((l) => l.defenseProfile === 'orionSupply').length >= R.supplyLimit) ||
    w.locations.some((l) => l.hull > 0 && dist(l, point) < 300) ||
    regionAt(point.x, point.y) === 'romulan' ||
    regionAt(point.x, point.y) === 'neutral'
  )
    return false;
  materialize(w, { q: Math.round(point.x / 400), r: Math.round(point.y / 400) });
  if (
    w.systems.some((s) => dist(s, point) < 70) ||
    w.bodies.some((b) => dist(b, point) < 60) ||
    w.wormholes.some((h) => dist(h, point) < 80)
  )
    return false;
  builder.cargo.materials -= cost.materials;
  const loot = w.orion.lootCargo[builder.id];
  if (loot) loot.materials = Math.min(loot.materials, builder.cargo.materials);
  builder.loot = goodsCount(loot ?? emptyStock());
  w.factions.orion.credits -= cost.credits;
  w.orion.jobs.push({
    id: 'orion-job-' + w.nextId++,
    kind: headquarters ? 'hq' : 'supply',
    locationId: null,
    builderId: builder.id,
    point: { ...point },
    classId: null,
    work: 0,
    duration: cost.minutes,
    credits: cost.credits,
    materials: cost.materials,
    status: 'active',
  });
  builder.intent = 'observe';
  builder.destination = { ...point };
  w.orion.provisioning = w.orion.provisioning.filter((p) => p.shipId !== builder.id);
  ledger(e, 'construction', builder.id, -cost.credits, {
    ...emptyStock(),
    materials: cost.materials,
  });
  return true;
}
export function serviceOrion(e: SimulationEngine, s: Enemy, dt: number) {
  const home = retreatBase(e, s);
  if (!home) {
    s.intent = 'observe';
    s.targetId = null;
    return false;
  }
  s.homeId = home.id;
  s.destination = { x: home.x, y: home.y };
  if (dist(s, home) > R.dockingRange) {
    goOrion(e, s, home, dt);
    return true;
  }
  if (s.intent !== 'docked') {
    s.intent = 'docked';
    s.nextDecision = e.state.time + 2;
  }
  s.status = 'docked';
  const manifest = e.state.orion.lootCargo[s.id] ?? emptyStock();
  for (const k of GOODS) {
    let amount = Math.min(s.cargo[k], R.transferRate * dt);
    if (k !== 'materials') {
      s.cooldowns['unload:' + k] = (s.cooldowns['unload:' + k] ?? 0) + dt * R.transferRate + dt;
      amount = Math.min(s.cargo[k], Math.floor(s.cooldowns['unload:' + k]));
    }
    const n = deposit(home, k, amount);
    if (n <= 0) continue;
    if (k !== 'materials') s.cooldowns['unload:' + k] -= n;
    const stolen = Math.min(n, manifest[k]);
    manifest[k] -= stolen;
    s.cargo[k] -= n;
    // The export quota is recorded once on physical unloading, including fractional materials.
    const quota = stolen * 0.25;
    (e.state.orion.servicedLoot[home.id] ??= emptyStock())[k] += quota;
    ledger(e, 'unload', home.id, 0, { ...emptyStock(), [k]: n });
  }
  s.loot = goodsCount(manifest);
  e.state.orion.lootCargo[s.id] = manifest;
  let remaining = home.stock.materials;
  const hull = Math.min(capabilities(s).hull - s.hull, dt * 8, remaining * 8);
  remaining -= hull / 8;
  s.hull += hull;
  for (const k of ['engines', 'weapons'] as const) {
    const n = Math.min(100 - s[k], dt * 4, remaining * 8);
    s[k] += n;
    remaining -= n / 8;
  }
  const used = home.stock.materials - remaining;
  home.stock.materials = Math.max(0, remaining);
  if (used > 0) ledger(e, 'repair', s.id, 0, { ...emptyStock(), materials: used });
  s.cooldowns.orionRearm = (s.cooldowns.orionRearm ?? 0) + 2 * dt;
  if (s.cooldowns.orionRearm >= 0.6) {
    for (const k of ['photon', 'quantum'] as const)
      if (s[k] < capabilities(s)[k] && home.stock[k] > 0) {
        const n = Math.min(1, Math.floor(home.stock[k]));
        home.stock[k] -= n;
        s[k] += n;
        ledger(e, 'rearm', s.id, 0, { ...emptyStock(), [k]: n });
      }
    s.cooldowns.orionRearm = 0;
  }
  if (
    e.state.time >= s.nextDecision &&
    cargoUsed(s) < 1e-8 &&
    s.hull >= capabilities(s).hull * 0.85 &&
    s.engines >= 80 &&
    s.weapons >= 80 &&
    s.core >= capabilities(s).core * 0.5 &&
    s.photon >= Math.min(2, capabilities(s).photon)
  ) {
    s.intent = 'observe';
    s.status = 'active';
    s.nextDecision = e.state.time;
    return false;
  }
  return true;
}
export function advanceOrionLogistics(e: SimulationEngine, s: Enemy, dt: number) {
  const w = e.state,
    task = w.orion.logistics.find((t) => t.shipId === s.id);
  if (!task) return false;
  const source = operatingBases(e).find((l) => l.id === task.sourceId),
    target = operatingBases(e).find((l) => l.id === task.targetId);
  if (!source || !target) {
    w.orion.logistics = w.orion.logistics.filter((t) => t !== task);
    s.intent = 'retreat';
    return false;
  }
  s.intent = 'transfer';
  const destination = task.phase === 'loading' ? source : target;
  s.destination = { x: destination.x, y: destination.y };
  if (dist(s, destination) > R.dockingRange) {
    goOrion(e, s, destination, dt);
    return true;
  }
  task.work += dt;
  if (task.work < 2) return true;
  if (task.phase === 'loading') {
    let free = capabilities(s).cargo - cargoUsed(s);
    for (const k of GOODS) {
      const n = Math.min(task.manifest[k], source.stock[k], free);
      source.stock[k] -= n;
      s.cargo[k] += n;
      task.manifest[k] = n;
      free -= n;
      const quota = w.orion.servicedLoot[source.id];
      if (quota) quota[k] = Math.min(quota[k], source.stock[k]);
    }
    task.phase = 'delivery';
    task.work = 0;
    ledger(e, 'supplyLoaded', s.id, 0, task.manifest);
  } else {
    for (const k of GOODS) {
      const n = deposit(target, k, Math.min(s.cargo[k], task.manifest[k]));
      s.cargo[k] -= n;
      task.manifest[k] -= n;
    }
    if (goodsCount(task.manifest) > 1e-8) {
      task.work = 0;
      return true;
    }
    ledger(e, 'supplyDelivered', target.id);
    w.orion.logistics = w.orion.logistics.filter((t) => t !== task);
    s.intent = cargoUsed(s) > 0 ? 'retreat' : 'observe';
  }
  return true;
}
export function advanceOrionEconomy(e: SimulationEngine, dt: number) {
  const w = e.state,
    o = w.orion,
    bases = operatingBases(e),
    faction = w.factions.orion;
  for (const j of o.jobs.filter((j) => j.status === 'active')) {
    const home = bases.find((l) => l.id === j.locationId),
      builder = w.enemies.find((s) => s.id === j.builderId && s.hull > 0);
    if (j.builderId ? !builder : !home) {
      j.status = 'lost';
      ledger(e, 'jobLost', j.id);
      continue;
    }
    if (builder && (builder.counterTracking.evading || dist(builder, j.point) > R.dockingRange))
      continue;
    j.work = Math.min(j.duration, j.work + dt);
    if (j.work + 1e-8 < j.duration) continue;
    j.status = 'complete';
    if (j.kind === 'ship' && j.classId && j.classId in ORION_BUILDS && home) {
      const d = ORION_BUILDS[j.classId as OrionClassId];
      const s = makeEnemy(
        'orion-built-' + w.nextId++,
        j.classId,
        'orion',
        { x: home.x, y: home.y + 25 },
        home.id,
        d.role,
      );
      s.name = capabilities(s).name + ' ' + s.id.split('-').at(-1);
      s.photon = 0;
      s.quantum = 0;
      s.intent = 'retreat';
      if (['interceptor', 'corsair'].includes(s.role)) s.modules = ['precisionTargeting'];
      w.enemies.push(s);
      o.patrols[s.id] = { anchor: { x: home.x, y: home.y }, leg: 0 };
      ledger(e, 'commissioned', s.id);
    } else if (j.kind === 'ammo' && home) {
      if (deposit(home, 'photon', 1) < 1) {
        j.status = 'active';
        continue;
      }
      ledger(e, 'manufactured', home.id, 0, { ...emptyStock(), photon: 1 });
    } else if (builder) {
      const location = orionLocation(w, 'orion-site-' + w.nextId++, j.point, j.kind === 'hq');
      builder.homeId = location.id;
      builder.intent = 'retreat';
      ledger(e, 'facilityBuilt', location.id);
    }
  }
  if (w.tick % 10 !== 0) return;
  for (const home of bases) {
    const quota = o.servicedLoot[home.id];
    if (quota)
      for (const k of GOODS) {
        const price = R.marketPrices[k];
        let n = Math.min(
          quota[k],
          home.stock[k],
          o.market.capacity[k] - o.market.stock[k],
          o.market.credits / price,
          R.transferRate,
        );
        if (k !== 'materials') n = Math.floor(n);
        if (n <= 1e-8) continue;
        home.stock[k] -= n;
        quota[k] -= n;
        o.market.stock[k] += n;
        o.market.credits = Math.max(0, o.market.credits - n * price);
        faction.credits += n * price;
        o.realizedIncome += n * price;
        ledger(e, 'sale', home.id, n * price, { ...emptyStock(), [k]: n });
      }
  }
  if (w.tick % 50 !== 0) return;
  const active = w.enemies.filter((s) => s.factionId === 'orion'),
    pending = o.jobs.filter((j) => j.status === 'active' && j.kind === 'ship');
  const classes = Object.keys(ORION_BUILDS) as OrionClassId[];
  const missing = classes.filter(
    (id) =>
      active.filter((s) => s.classId === id).length +
        pending.filter((j) => j.classId === id).length <
      ORION_BUILDS[id].desired,
  );
  const priority = missing.sort(
    (a, b) =>
      ['orionScout', 'orionSmuggler', 'orionRaider', 'orionInterceptor', 'orionCorsair'].indexOf(
        a,
      ) -
      ['orionScout', 'orionSmuggler', 'orionRaider', 'orionInterceptor', 'orionCorsair'].indexOf(b),
  );
  const growthSpent = o.ledger
    .filter((l) => l.kind === 'growth')
    .reduce((n, l) => n - l.credits, 0);
  const chosen =
    priority[0] ??
    (o.realizedIncome - growthSpent >= ORION_BUILDS.orionRaider.credits ? 'orionRaider' : null);
  if (chosen)
    for (const home of [...bases].sort(
      (a, b) => b.stock.materials - a.stock.materials || a.id.localeCompare(b.id),
    )) {
      const d = ORION_BUILDS[chosen];
      const growth = active.length + pending.length >= 10;
      if (
        growth &&
        (faction.credits < d.credits + R.budgetReserve ||
          home.stock.materials < d.materials + R.repairReserve)
      )
        continue;
      if (startOrionShipJob(e, home, chosen)) break;
    }
  for (const home of bases)
    if (
      home.stock.photon < 12 &&
      home.stock.materials >= 1 &&
      faction.credits >= 4 &&
      !o.jobs.some((j) => j.status === 'active' && j.kind === 'ammo' && j.locationId === home.id)
    ) {
      home.stock.materials--;
      faction.credits -= 4;
      o.jobs.push({
        id: 'orion-job-' + w.nextId++,
        kind: 'ammo',
        locationId: home.id,
        builderId: null,
        point: { x: home.x, y: home.y },
        classId: null,
        work: 0,
        duration: 5,
        credits: 4,
        materials: 1,
        status: 'active',
      });
      ledger(e, 'ammoStarted', home.id, -4, { ...emptyStock(), materials: 1 });
    }
  for (const s of active.filter(
    (s) =>
      s.role === 'smuggler' &&
      !o.logistics.some((t) => t.shipId === s.id) &&
      !o.provisioning.some((p) => p.shipId === s.id) &&
      !o.jobs.some((j) => j.status === 'active' && j.builderId === s.id) &&
      !o.operations.some(
        (op) => op.status === 'active' && op.members.some((m) => m.shipId === s.id),
      ),
  )) {
    if (cargoUsed(s) > 0) {
      s.intent = 'retreat';
      continue;
    }
    const source = [...bases].sort((a, b) => b.stock.materials - a.stock.materials)[0];
    const target = bases
      .filter((l) => l.id !== source?.id && (l.stock.materials < 25 || l.stock.photon < 6))
      .sort((a, b) => dist(s, a) - dist(s, b))[0];
    if (source && target && (source.stock.materials > 45 || source.stock.photon > 20))
      o.logistics.push({
        shipId: s.id,
        sourceId: source.id,
        targetId: target.id,
        phase: 'loading',
        work: 0,
        manifest: {
          ...emptyStock(),
          materials: Math.max(0, Math.min(50, source.stock.materials - 35)),
          photon: Math.max(0, Math.min(20, source.stock.photon - 12)),
        },
      });
  }
  const needsHQ = bases.length > 0 && !bases.some((l) => l.defenseProfile === 'orionHQ');
  const demand = bases
    .flatMap((l) => o.intelligence[l.id] ?? [])
    .some(
      (r) =>
        w.time - r.seenAt < R.reportTTL && r.value > 1500 && bases.every((l) => dist(l, r) > 600),
    );
  const shouldBuild =
    !bases.length ||
    needsHQ ||
    (demand &&
      o.realizedIncome >= R.supplyCost.credits &&
      bases.filter((l) => l.defenseProfile === 'orionSupply').length < R.supplyLimit);
  if (
    shouldBuild &&
    faction.credits >= (needsHQ ? R.hqCost.credits : R.supplyCost.credits) &&
    !o.jobs.some((j) => j.status === 'active' && (j.kind === 'supply' || j.kind === 'hq'))
  ) {
    const cost = needsHQ ? R.hqCost : R.supplyCost;
    const builder = active
      .filter(
        (s) =>
          s.hull > capabilities(s).hull * 0.5 &&
          capabilities(s).cargo >= cost.materials &&
          !o.operations.some(
            (op) => op.status === 'active' && op.members.some((m) => m.shipId === s.id),
          ),
      )
      .sort(
        (a, b) =>
          (b.role === 'smuggler' ? 1 : 0) - (a.role === 'smuggler' ? 1 : 0) ||
          b.cargo.materials - a.cargo.materials ||
          a.id.localeCompare(b.id),
      )[0];
    if (
      builder &&
      builder.cargo.materials < cost.materials &&
      capabilities(builder).cargo >= cost.materials
    ) {
      const home = bases
        .filter((l) => l.stock.materials >= cost.materials - builder.cargo.materials)
        .sort((a, b) => dist(builder, a) - dist(builder, b))[0];
      if (home && !o.provisioning.some((p) => p.shipId === builder.id))
        o.provisioning.push({ shipId: builder.id, sourceId: home.id, headquarters: needsHQ });
    }
    if (builder && builder.cargo.materials >= cost.materials && faction.credits >= cost.credits) {
      const rng = coordinateRandom(
        w.initialSeed,
        { q: Math.round(builder.x / 400), r: Math.round(builder.y / 400) },
        w.nextId,
      );
      for (let n = 0; n < 32; n++) {
        const angle = rng() * Math.PI * 2,
          p = {
            x: builder.x + Math.cos(angle) * (320 + rng() * 200),
            y: builder.y + Math.sin(angle) * (320 + rng() * 200),
          };
        if (startOrionConstruction(e, builder, p, needsHQ)) break;
      }
    }
  }
}
export function advanceProvisioning(e: SimulationEngine, s: Enemy, dt: number) {
  const p = e.state.orion.provisioning.find((p) => p.shipId === s.id);
  if (!p) return false;
  const cost = p.headquarters ? R.hqCost : R.supplyCost;
  if (e.state.factions.orion.credits < cost.credits) {
    e.state.orion.provisioning = e.state.orion.provisioning.filter((t) => t !== p);
    return false;
  }
  if (s.cargo.materials >= cost.materials) {
    s.intent = 'observe';
    return true;
  }
  const home = operatingBases(e).find((l) => l.id === p.sourceId);
  if (!home) {
    e.state.orion.provisioning = e.state.orion.provisioning.filter((t) => t !== p);
    return false;
  }
  s.intent = 'transfer';
  s.destination = { x: home.x, y: home.y };
  if (dist(s, home) > 15) {
    goOrion(e, s, home, dt);
    return true;
  }
  const n = Math.min(
    home.stock.materials,
    cost.materials - s.cargo.materials,
    capabilities(s).cargo - cargoUsed(s),
    R.transferRate * dt,
  );
  home.stock.materials -= n;
  s.cargo.materials += n;
  if (n > 0) ledger(e, 'constructionLoaded', s.id, 0, { ...emptyStock(), materials: n });
  return true;
}
