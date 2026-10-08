import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SaveStore } from '../electron/persistence';
import { parseSave } from '../src/engine/saves';
import { quietEngine } from './helpers';
const directories: string[] = [];
const directory = () => {
  const d = mkdtempSync(join(tmpdir(), 'frontier-v14-isolation-'));
  directories.push(d);
  return d;
};
afterEach(() => {
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
});
describe('v14 isolated generation replaces legacy migration', () => {
  it.each([9, 10, 11, 12, 13, 15])('rejects version %s without altering input', (version) => {
    const old = { ...quietEngine().state, version },
      bytes = JSON.stringify(old);
    expect(() => parseSave(old)).toThrow('Unsupported save version: ' + version);
    expect(JSON.stringify(old)).toBe(bytes);
  });
  it('preserves all older timelines, heads, failures and API bytes while starting v14', () => {
    const d = directory(),
      bytes = readFileSync('tests/fixtures/v12/in-progress.json', 'utf8');
    for (const version of [11, 12, 13]) {
      const root = join(d, 'frontiers-v' + version, 'frontier-000001');
      mkdirSync(root, { recursive: true });
      for (const name of ['head.json', 'head.json.bak', 'day-1.json', 'failure.json'])
        writeFileSync(join(root, name), bytes);
      writeFileSync(join(d, 'timeline-v' + version + '.json'), 'historical timeline ' + version);
    }
    writeFileSync(join(d, 'agent-api.v1.json'), 'encrypted-config');
    const store = new SaveStore(d);
    expect(store.read()).toMatchObject({ world: null, blocked: false });
    store.write(quietEngine().state);
    expect(store.read().world?.version).toBe(14);
    for (const version of [11, 12, 13]) {
      for (const name of ['head.json', 'head.json.bak', 'day-1.json', 'failure.json'])
        expect(
          readFileSync(join(d, 'frontiers-v' + version, 'frontier-000001', name), 'utf8'),
        ).toBe(bytes);
      expect(readFileSync(join(d, 'timeline-v' + version + '.json'), 'utf8')).toBe(
        'historical timeline ' + version,
      );
    }
    expect(readFileSync(join(d, 'agent-api.v1.json'), 'utf8')).toBe('encrypted-config');
  });
  it('a corrupted v14 terminal file cannot fall back to older worlds or overwrite the failure', () => {
    const d = directory(),
      store = new SaveStore(d);
    store.write(quietEngine().state);
    const failure = join(store.root, 'frontier-000001', 'failure.json');
    writeFileSync(failure, 'damaged-terminal');
    const next = new SaveStore(d);
    expect(next.read()).toMatchObject({ world: null, blocked: true });
    expect(() => next.write(quietEngine().state)).toThrow();
    expect(readFileSync(failure, 'utf8')).toBe('damaged-terminal');
  });
  it('corrupt current and future indexes protect their files', () => {
    for (const version of [14, 15]) {
      const d = directory(),
        file = join(d, 'timeline-v' + version + '.json');
      writeFileSync(file, 'broken');
      const store = new SaveStore(d);
      expect(store.read().blocked).toBe(true);
      expect(() => store.write(quietEngine().state)).toThrow();
      expect(readFileSync(file, 'utf8')).toBe('broken');
      if (version === 15) expect(existsSync(store.indexPath)).toBe(false);
    }
  });
  it('retains contract, sequence and escrow validation in the new schema', () => {
    const w = quietEngine().state;
    for (const change of [
      (c: typeof w) => c.agents[0].feedbackEvents.push('event', 'event'),
      (c: typeof w) =>
        c.agents[0].decision.events.push({ id: 'future', kind: 'chat', time: c.time + 1 }),
      (c: typeof w) =>
        c.commitments.push({
          id: 'forged',
          contractId: 'absent',
          agentId: c.agents[0].id,
          condition: { type: 'reward', when: 'after', credits: 20 },
          status: 'fulfilled',
          escrow: 20,
          directiveId: null,
        }),
    ]) {
      const copy = structuredClone(w);
      change(copy);
      expect(() => parseSave(copy)).toThrow();
    }
  });
});
