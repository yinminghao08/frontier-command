import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SaveStore } from '../electron/persistence';
import { parseSave } from '../src/engine/saves';
import { SimulationEngine } from '../src/engine/engine';
import { quietEngine, run, until, v12Fixture, v11Fixture } from './helpers';
const fixtureBytes = readFileSync('tests/fixtures/v12/in-progress.json', 'utf8');
const directories: string[] = [];
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-v13-migration-'));
  directories.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function legacy(dir: string, files: Record<string, string> = {}) {
  const path = join(dir, 'frontiers-v12', 'frontier-000001');
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(dir, 'timeline-v12.json'),
    JSON.stringify({
      version: 12,
      activeId: 'frontier-000001',
      branches: [{ id: 'frontier-000001', name: '旧边疆', parent: null }],
    }),
  );
  for (const [name, bytes] of Object.entries({
    'head.json': fixtureBytes,
    'head.json.bak': fixtureBytes,
    'day-1.json': fixtureBytes,
    ...files,
  }))
    writeFileSync(join(path, name), bytes);
  return path;
}
describe('strict v12 → v13 transactional migration', () => {
  it('retains identity, history, model overrides, cargo, escort and paid training without replaying old chat', () => {
    const original = JSON.parse(fixtureBytes),
      w = parseSave(original);
    expect(w.version).toBe(13);
    expect(w.history).toEqual(original.history);
    expect(w.chatMessages.map((m) => m.content)).toEqual(
      original.chatMessages.map((m: { content: string }) => m.content),
    );
    expect(w.agents.map((a) => a.modelConfig)).toEqual(
      original.agents.map((a: { modelConfig: unknown }) => a.modelConfig),
    );
    expect(w.ships.map((s) => s.cargo)).toEqual(
      original.ships.map((s: { cargo: unknown }) => s.cargo),
    );
    expect(w.personnel).toEqual(original.personnel);
    expect(w.commitments).toEqual([]);
    expect(w.admiralTasks).toEqual([]);
    expect(
      w.agents.every(
        (a) =>
          a.decision.lastAdmiralMessageId === w.nextChat - 1 &&
          a.decision.pendingReasons.length === 0,
      ),
    ).toBe(true);
    const e = new SimulationEngine(w),
      before = e.base.stock.materials;
    until(e, () => e.state.escortRequests[0].status === 'completed');
    expect(e.base.stock.materials).toBe(before + 40);
    const restored = new SimulationEngine(parseSave(e.state)),
      xp = e.state.agents.map((a) => a.experience),
      reward = e.state.agents.map((a) => a.rewardCredits);
    run(restored, 3);
    expect(restored.state.agents.map((a) => a.experience)).toEqual(xp);
    expect(restored.state.agents.map((a) => a.rewardCredits)).toEqual(reward);
  });
  it('copies heads, backups, days, terminal failure, ancestry and allocated IDs before publishing; leaves source/API bytes unchanged', () => {
    const dir = directory(),
      old = legacy(dir),
      engine = new SimulationEngine(parseSave(JSON.parse(fixtureBytes)));
    engine.base.shield = 0;
    engine.hit(engine.base, 100000);
    const failure = JSON.stringify(v12Fixture(engine.state));
    const second = join(dir, 'frontiers-v12', 'frontier-000002');
    mkdirSync(second);
    for (const name of ['head.json', 'head.json.bak', 'day-1.json'])
      writeFileSync(join(second, name), fixtureBytes);
    writeFileSync(join(second, 'failure.json'), failure);
    const index = JSON.stringify({
      version: 12,
      activeId: 'frontier-000002',
      branches: [
        { id: 'frontier-000001', name: '源档', parent: null },
        { id: 'frontier-000002', name: '终局分支', parent: { id: 'frontier-000001', day: 1 } },
      ],
    });
    writeFileSync(join(dir, 'timeline-v12.json'), index);
    writeFileSync(join(dir, 'frontiers-v12', '.allocated-frontier-000003'), '');
    writeFileSync(join(dir, 'agent-api.v1.json'), 'encrypted-api-config-is-preserved');
    const store = new SaveStore(dir);
    expect(store.read().world!.status).toBe('commandLost');
    expect(store.read().world!.version).toBe(13);
    for (const id of ['frontier-000001', 'frontier-000002'])
      for (const name of ['head.json', 'head.json.bak', 'day-1.json'])
        expect(JSON.parse(readFileSync(join(store.root, id, name), 'utf8')).version).toBe(13);
    expect(
      JSON.parse(readFileSync(join(store.root, 'frontier-000002', 'failure.json'), 'utf8')).version,
    ).toBe(13);
    expect(store.catalog().saves.find((s) => s.id === 'frontier-000002')!.parent).toEqual({
      id: 'frontier-000001',
      day: 1,
    });
    expect(readFileSync(join(old, 'head.json'), 'utf8')).toBe(fixtureBytes);
    expect(readFileSync(join(second, 'failure.json'), 'utf8')).toBe(failure);
    expect(readFileSync(join(dir, 'timeline-v12.json'), 'utf8')).toBe(index);
    expect(readFileSync(join(dir, 'agent-api.v1.json'), 'utf8')).toBe(
      'encrypted-api-config-is-preserved',
    );
    expect(existsSync(join(store.root, '.allocated-frontier-000003'))).toBe(true);
    store.beginNew(quietEngine().state);
    expect(store.catalog().activeId).toBe('frontier-000004');
  });
  it('a corrupt terminal failure is protected and cannot load an older head or older generation', () => {
    const dir = directory();
    legacy(dir, { 'failure.json': 'corrupt-terminal' });
    const store = new SaveStore(dir);
    expect(store.read()).toMatchObject({ blocked: true, world: null });
    expect(() => store.write(quietEngine().state)).toThrow();
    expect(readFileSync(join(store.root, 'frontier-000001', 'failure.json'), 'utf8')).toBe(
      'corrupt-terminal',
    );
  });
  it('a newer corrupt/future index never falls back to a valid v12 timeline', () => {
    for (const bytes of [
      'broken',
      JSON.stringify({ version: 14, activeId: 'frontier-000001', branches: [] }),
    ]) {
      const dir = directory();
      legacy(dir);
      writeFileSync(join(dir, 'timeline-v13.json'), bytes);
      const store = new SaveStore(dir);
      expect(store.read().blocked).toBe(true);
      expect(store.catalog().blocked).toBe(true);
      expect(readFileSync(join(dir, 'timeline-v13.json'), 'utf8')).toBe(bytes);
      expect(readFileSync(join(dir, 'frontiers-v12', 'frontier-000001', 'head.json'), 'utf8')).toBe(
        fixtureBytes,
      );
    }
  });
  it('invalid legacy ancestry fails before publishing any new index', () => {
    const dir = directory();
    legacy(dir);
    writeFileSync(
      join(dir, 'timeline-v12.json'),
      JSON.stringify({
        version: 12,
        activeId: 'frontier-000001',
        branches: [{ id: 'frontier-000001', parent: { id: 'frontier-000001', day: 1 } }],
      }),
    );
    const store = new SaveStore(dir);
    expect(store.read().blocked).toBe(true);
    expect(existsSync(store.indexPath)).toBe(false);
  });
  it('a future-generation timeline protects progress even when the current v13 index is absent', () => {
    const dir = directory();
    legacy(dir);
    writeFileSync(join(dir, 'timeline-v14.json'), 'unreadable future timeline');
    const store = new SaveStore(dir);
    expect(store.read().blocked).toBe(true);
    expect(existsSync(store.indexPath)).toBe(false);
    expect(readFileSync(join(dir, 'frontiers-v12', 'frontier-000001', 'head.json'), 'utf8')).toBe(
      fixtureBytes,
    );
  });
  it('validates the old schema before supplementing fields; v11 uses the same safe path', () => {
    const old = JSON.parse(fixtureBytes);
    expect(() =>
      parseSave({ ...old, agents: old.agents.map((a: object) => ({ ...a, profile: {} })) }),
    ).toThrow();
    const v11 = v11Fixture(quietEngine().state);
    expect(parseSave(v11).version).toBe(13);
    expect(() => parseSave({ ...v11, admiralTasks: [] })).toThrow();
    expect(parseSave(JSON.parse(readFileSync('demo/agent-demo-v11.json', 'utf8'))).version).toBe(
      13,
    );
  });
  it('rejects duplicate report events, forged escrow, consumed events and unknown contract references', () => {
    const w = quietEngine().state;
    for (const change of [
      (copy: typeof w) => copy.agents[0].feedbackEvents.push('event', 'event'),
      (copy: typeof w) =>
        copy.commitments.push({
          id: 'forged',
          contractId: 'absent',
          agentId: copy.agents[0].id,
          condition: { type: 'reward', when: 'after', credits: 20 },
          status: 'fulfilled',
          escrow: 20,
          directiveId: null,
        }),
      (copy: typeof w) =>
        copy.agents[0].decision.events.push({ id: 'future', kind: 'chat', time: copy.time + 1 }),
    ]) {
      const copy = structuredClone(w);
      change(copy);
      expect(() => parseSave(copy)).toThrow();
    }
  });
});
