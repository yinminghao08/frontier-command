import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SaveStore } from '../electron/persistence';
import { createWorld } from '../src/engine/data';
import { SimulationEngine } from '../src/engine/engine';
import { applyDamage } from '../src/engine/combat';
import { quietEngine, run, issue } from './helpers';

const directories: string[] = [];
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-manager-'));
  directories.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const active = (store: SaveStore) => store.catalog().activeId!;
const snapshot = (tick: number) => {
  const w = createWorld();
  w.tick = tick;
  w.time = tick / 10;
  return w;
};

describe('save manager catalogue and independent worlds', () => {
  it('reads unnamed v10 metadata, renames without changing IDs or world bytes, and permits duplicate names', () => {
    const dir = directory(),
      first = new SaveStore(dir);
    first.write(createWorld());
    const id = active(first),
      worldBytes = readFileSync(first.path, 'utf8');
    const index = JSON.parse(readFileSync(first.indexPath, 'utf8'));
    delete index.branches[0].name;
    writeFileSync(first.indexPath, JSON.stringify(index));
    const store = new SaveStore(dir);
    expect(store.catalog().saves[0].name).toBe('曙光边疆 000001');
    store.rename(id, '  第一边疆 / 中文  ');
    expect(readFileSync(store.path, 'utf8')).toBe(worldBytes);
    store.beginNew(createWorld(99), store.read().world!, '第一边疆 / 中文');
    expect(new SaveStore(dir).catalog().saves.map((s) => s.name)).toEqual([
      '第一边疆 / 中文',
      '第一边疆 / 中文',
    ]);
    expect(store.activate(id).initialSeed).toBe(236807);
  });
  it.each(['', '  ', '长'.repeat(41)])(
    'rejects invalid names before any world or index write: %s',
    (name) => {
      const store = new SaveStore(directory());
      const world = createWorld();
      store.write(world);
      const before = readFileSync(store.indexPath, 'utf8'),
        bytes = readFileSync(store.path, 'utf8');
      world.resources.credits += 1;
      expect(() => store.rename(active(store), name)).toThrow();
      expect(() => store.beginNew(createWorld(), world, name)).toThrow();
      expect(() => store.copyCurrent(world, name)).toThrow();
      expect(readFileSync(store.indexPath, 'utf8')).toBe(before);
      expect(readFileSync(store.path, 'utf8')).toBe(bytes);
    },
  );
  it('copies full in-flight execution and RNG and continues deterministically; source and copy save independently', () => {
    const store = new SaveStore(directory()),
      engine = quietEngine();
    issue(
      engine,
      {
        type: 'HAUL',
        sourceId: 'base',
        targetId: 'outpost',
        cargoKind: 'materials',
        amount: 20,
        route: 'direct',
        repeat: false,
      },
      'meridian',
    );
    run(engine, 10);
    engine.state.paused = true;
    store.write(engine.state);
    const source = active(store);
    const copied = store.copyCurrent(engine.state, '运输副本');
    expect(copied).toEqual(engine.state);
    const copy = active(store);
    const a = new SimulationEngine(copied),
      b = new SimulationEngine(structuredClone(engine.state));
    run(a, 60);
    run(b, 60);
    expect(a.state).toEqual(b.state);
    store.write(a.state);
    const resumed = store.activate(source, a.state);
    expect(resumed).toEqual(engine.state);
    expect(store.activate(copy, resumed).tick).toBe(a.state.tick);
  });
  it('copies inherited daily snapshots into an independent branch, preserving the terminal freeze', () => {
    const store = new SaveStore(directory()),
      engine = quietEngine();
    store.write(engine.state);
    engine.state.tick = 14400;
    engine.state.time = 1440;
    store.daily(engine.state);
    engine.state.tick = 28800;
    engine.state.time = 2880;
    const branch = store.restorePreviousDay(engine.state);
    branch.tick = 30000;
    branch.time = 3000;
    const terminal = new SimulationEngine(branch);
    applyDamage(terminal, terminal.base, 10000);
    terminal.finishCritical();
    store.write(terminal.state);
    const copy = store.copyCurrent(terminal.state, '失败副本'),
      id = active(store);
    expect(copy.status).toBe('commandLost');
    expect(existsSync(join(store.root, id, 'failure.json'))).toBe(true);
    expect(existsSync(join(store.root, id, 'day-1.json'))).toBe(true);
    expect(store.catalog().saves.find((s) => s.id === id)?.parent).toBeNull();
    expect(new SaveStore(store.directory).read().world).toEqual(copy);
    copy.resources.credits += 1;
    expect(() => store.write(copy)).toThrow('失败时间线已封存');
  });
  it('loading the current ID preserves unsaved current progress and keeps the loaded world paused', () => {
    const store = new SaveStore(directory()),
      world = createWorld();
    store.write(world);
    world.resources.credits += 123;
    world.paused = false;
    const next = store.activate(active(store), world);
    expect(next.resources.credits).toBe(world.resources.credits);
    expect(next.paused).toBe(true);
  });
  it('lists corrupt and unsupported branches, uses valid backups, and can escape a protected active save', () => {
    const dir = directory(),
      store = new SaveStore(dir),
      w = createWorld();
    store.write(w);
    store.write(w);
    const first = active(store),
      firstPath = store.path;
    store.beginNew(createWorld(99), w, '第二存档');
    const second = active(store),
      secondPath = store.path;
    store.beginNew(createWorld(100), store.read().world!, '第三存档');
    const third = active(store);
    writeFileSync(firstPath, 'corrupt');
    writeFileSync(secondPath, JSON.stringify({ ...w, version: 99 }));
    writeFileSync(store.path, 'corrupt');
    const restarted = new SaveStore(dir);
    expect(restarted.read().blocked).toBe(true);
    expect(restarted.catalog().saves.find((s) => s.id === first)?.availability).toBe('backup');
    expect(restarted.catalog().saves.find((s) => s.id === second)?.availability).toBe(
      'unsupported',
    );
    expect(restarted.catalog().saves.find((s) => s.id === third)?.availability).toBe('corrupt');
    expect(() => restarted.activate(second)).toThrow();
    expect(active(restarted)).toBe(third);
    expect(restarted.activate(first).initialSeed).toBe(w.initialSeed);
    expect(readFileSync(join(store.root, third, 'head.json'), 'utf8')).toBe('corrupt');
    expect(restarted.read().blocked).toBe(false);
  });
  it('never falls back behind a corrupt failure record; valid failure takes precedence over unsupported head', () => {
    const store = new SaveStore(directory()),
      e = quietEngine();
    store.write(e.state);
    applyDamage(e, e.base, 10000);
    e.finishCritical();
    store.write(e.state);
    writeFileSync(store.path, JSON.stringify({ ...e.state, version: 99 }));
    expect(store.catalog().saves[0].status).toBe('commandLost');
    writeFileSync(join(store.root, active(store), 'failure.json'), 'bad');
    expect(store.catalog().saves[0].availability).toBe('corrupt');
    expect(() => store.activate(active(store))).toThrow();
  });
  it('can switch away when an unsupported active head is encountered during outgoing save, preserving its bytes', () => {
    const store = new SaveStore(directory()),
      world = createWorld();
    store.write(world);
    const good = active(store);
    store.beginNew(createWorld(99));
    const unsupportedPath = store.path;
    const bytes = JSON.stringify({ version: 99 });
    writeFileSync(unsupportedPath, bytes);
    expect(store.activate(good, createWorld(99)).initialSeed).toBe(world.initialSeed);
    expect(readFileSync(unsupportedPath, 'utf8')).toBe(bytes);
    expect(store.currentProtected).toBe(false);
  });
});

describe('save manager transactions and ancestry', () => {
  it('refuses active deletion and invalid IDs, and never reuses a deleted ID', () => {
    const store = new SaveStore(directory());
    store.write(createWorld());
    expect(() => store.delete(active(store))).toThrow('请先切换');
    expect(() => store.delete('../outside')).toThrow();
    expect(() => store.activate('frontier-999999')).toThrow('存档不存在');
    store.beginNew(createWorld(), store.read().world!);
    const second = active(store);
    store.activate('frontier-000001');
    store.delete(second);
    expect(existsSync(join(store.root, second))).toBe(false);
    store.beginNew(createWorld(), store.read().world!);
    expect(active(store)).toBe('frontier-000003');
  });
  it('does not reuse an indexed ID whose directory is missing', () => {
    const store = new SaveStore(directory());
    store.write(createWorld());
    store.beginNew(createWorld());
    const missing = active(store);
    rmSync(join(store.root, missing), { recursive: true });
    expect(store.read().blocked).toBe(true);
    store.beginNew(createWorld(), undefined, '新边疆');
    expect(active(store)).toBe('frontier-000003');
    expect(store.catalog().saves.find((s) => s.id === missing)?.availability).toBe('corrupt');
  });
  it('deleting a parent materializes inherited days for direct children and retains grandchild restoration after restart', () => {
    const dir = directory(),
      store = new SaveStore(dir);
    store.write(snapshot(0));
    store.daily(snapshot(14400));
    const child = store.restorePreviousDay(snapshot(28800)),
      childId = active(store);
    child.tick = 28800;
    child.time = 2880;
    store.daily(child);
    const grandchild = store.restorePreviousDay(snapshot(43200)),
      grandchildId = active(store);
    store.delete('frontier-000001');
    expect(store.catalog().saves.find((s) => s.id === childId)?.parent).toBeNull();
    expect(existsSync(join(store.root, childId, 'day-1.json'))).toBe(true);
    const restarted = new SaveStore(dir);
    expect(active(restarted)).toBe(grandchildId);
    grandchild.tick = 14400;
    grandchild.time = 1440;
    expect(restarted.restorePreviousDay(grandchild).tick).toBe(0);
  });
  it('rolls back failed creation, rename and activation without replacing the active branch', () => {
    const store = new SaveStore(directory());
    store.write(createWorld());
    store.beginNew(createWorld(99));
    const id = active(store),
      bytes = readFileSync(store.indexPath, 'utf8');
    mkdirSync(store.indexPath + '.tmp');
    expect(() => store.beginNew(createWorld(), undefined, '新建失败')).toThrow();
    expect(() => store.rename(id, '改名失败')).toThrow();
    expect(() => store.activate('frontier-000001')).toThrow();
    expect(active(store)).toBe(id);
    expect(readFileSync(store.indexPath, 'utf8')).toBe(bytes);
    expect(
      readdirSync(store.root).some((s) => s.startsWith('.stage-') || s.startsWith('.creating-')),
    ).toBe(false);
    rmSync(store.indexPath + '.tmp', { recursive: true });
    expect(new SaveStore(store.directory).read().world?.initialSeed).toBe(99);
  });
  it('a current-world write failure prevents switching, and a copy failure leaves its source active', () => {
    const store = new SaveStore(directory()),
      world = createWorld();
    store.write(world);
    const source = active(store);
    store.beginNew(createWorld(99));
    store.activate(source);
    mkdirSync(store.path + '.tmp');
    expect(() => store.activate('frontier-000002', world)).toThrow();
    expect(() => store.copyCurrent(world, '复制失败')).toThrow();
    expect(active(store)).toBe(source);
    expect(store.read().world).toEqual(world);
  });
  it('rolls back deletion and newly materialized days if the index commit fails', () => {
    const store = new SaveStore(directory());
    store.write(snapshot(0));
    store.daily(snapshot(14400));
    store.restorePreviousDay(snapshot(28800));
    const childId = active(store),
      index = readFileSync(store.indexPath, 'utf8');
    mkdirSync(store.indexPath + '.tmp');
    expect(() => store.delete('frontier-000001')).toThrow();
    expect(existsSync(join(store.root, 'frontier-000001'))).toBe(true);
    expect(existsSync(join(store.root, childId, 'day-1.json'))).toBe(false);
    expect(readFileSync(store.indexPath, 'utf8')).toBe(index);
  });
  it('recovers interrupted deletion before index publication and cleans committed tombstones on restart', () => {
    const dir = directory(),
      store = new SaveStore(dir);
    store.write(createWorld());
    store.beginNew(createWorld(99));
    const source = join(store.root, 'frontier-000001');
    const tombstone = join(store.root, '.delete-frontier-000001-1234-abcd');
    renameSync(source, tombstone);
    const restarted = new SaveStore(dir);
    expect(existsSync(source)).toBe(true);
    expect(restarted.catalog().saves).toHaveLength(2);
    restarted.delete('frontier-000001');
    mkdirSync(tombstone);
    writeFileSync(join(tombstone, 'head.json'), 'old bytes');
    new SaveStore(dir);
    expect(existsSync(tombstone)).toBe(false);
  });
  it('a failed inherited snapshot write leaves the parent and an obstructing directory untouched', () => {
    const store = new SaveStore(directory());
    store.write(snapshot(0));
    store.daily(snapshot(14400));
    store.restorePreviousDay(snapshot(28800));
    const childDay = join(store.root, active(store), 'day-1.json');
    const index = readFileSync(store.indexPath, 'utf8');
    mkdirSync(childDay + '.tmp');
    expect(() => store.delete('frontier-000001')).toThrow();
    expect(existsSync(join(store.root, 'frontier-000001'))).toBe(true);
    expect(existsSync(childDay)).toBe(false);
    expect(existsSync(childDay + '.tmp')).toBe(true);
    expect(readFileSync(store.indexPath, 'utf8')).toBe(index);
  });
  it('recovers creation journals according to the published index and preserves ID reservations', () => {
    const dir = directory(),
      store = new SaveStore(dir);
    store.write(createWorld());
    const orphan = join(store.root, 'frontier-000002');
    mkdirSync(orphan);
    copyFileSync(store.path, join(orphan, 'head.json'));
    writeFileSync(join(store.root, '.allocated-frontier-000002'), '');
    writeFileSync(join(store.root, '.creating-frontier-000002'), '');
    writeFileSync(join(store.root, '.creating-frontier-000001'), '');
    const restarted = new SaveStore(dir);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(restarted.path)).toBe(true);
    restarted.beginNew(createWorld());
    expect(active(restarted)).toBe('frontier-000003');
  });
  it('protects a corrupt index from every management mutation', () => {
    const dir = directory(),
      first = new SaveStore(dir);
    first.write(createWorld());
    writeFileSync(first.indexPath, 'bad index');
    const store = new SaveStore(dir);
    expect(store.catalog().blocked).toBe(true);
    expect(() => store.beginNew(createWorld())).toThrow();
    expect(() => store.rename('frontier-000001', '名字')).toThrow();
    expect(() => store.delete('frontier-000001')).toThrow();
    expect(readFileSync(first.indexPath, 'utf8')).toBe('bad index');
  });
});
