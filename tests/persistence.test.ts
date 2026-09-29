import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveStore } from '../electron/persistence';
import { createWorld } from '../src/engine/data';
import { worldSchema } from '../src/engine/save-schema';
import { quietEngine, run, spec } from './helpers';
const dirs: string[] = [];
const dir = () => {
  const p = mkdtempSync(join(tmpdir(), 'frontier-v4-test-'));
  dirs.push(p);
  return p;
};
afterEach(() => {
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});
describe('v4 persistence', () => {
  it('saves and restores new order state including reservations and partial cargo', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec('transport') });
    const store = new SaveStore(dir());
    store.write(e.state);
    expect(store.read().world).toEqual(e.state);
    run(e, 10);
    store.write(e.state);
    expect(store.read().world).toEqual(e.state);
  });
  it('ignores old worlds without modifying them', () => {
    const p = dir(),
      legacy = join(p, 'world-v3.json');
    writeFileSync(legacy, 'old-world');
    const s = new SaveStore(p);
    expect(s.read().world).toBeNull();
    s.write(createWorld());
    expect(readFileSync(legacy, 'utf8')).toBe('old-world');
    expect(existsSync(join(p, 'world-v4.json'))).toBe(true);
  });
  it('recovers only same-generation backup and archives corrupt primary on write', () => {
    const p = dir(),
      s = new SaveStore(p),
      w = createWorld();
    s.write(w);
    s.write(w);
    writeFileSync(s.path, 'bad');
    expect(s.read().world).toEqual(w);
    s.write(w);
    expect(s.read().blocked).toBe(false);
  });
  it('blocks irrecoverable or future saves and does not fall back to old versions', () => {
    const p = dir(),
      s = new SaveStore(p);
    writeFileSync(s.path, 'bad');
    writeFileSync(join(p, 'world-v3.json'), JSON.stringify(createWorld()));
    expect(s.read().blocked).toBe(true);
    writeFileSync(s.path, JSON.stringify({ ...createWorld(), version: 5 }));
    expect(s.read().blocked).toBe(true);
    expect(() => s.write(createWorld())).toThrow();
  });
  it('rejects malformed resources, clock, inventory reservations, IDs and ship references', () => {
    for (const mutate of [
      (w: ReturnType<typeof createWorld>) => {
        w.tick = 1;
      },
      (w: ReturnType<typeof createWorld>) => {
        w.ships[0].core = 9999;
      },
      (w: ReturnType<typeof createWorld>) => {
        w.locations[0].reserved.supplies = 3;
      },
      (w: ReturnType<typeof createWorld>) => {
        w.ships[0].orderId = 'missing';
      },
      (w: ReturnType<typeof createWorld>) => {
        w.operators[0].shipId = w.operators[1].shipId;
      },
    ]) {
      const w = createWorld();
      mutate(w);
      expect(worldSchema.safeParse(w).success).toBe(false);
    }
  });
  it('archive resets v4 only, retaining legacy files', () => {
    const p = dir(),
      s = new SaveStore(p);
    writeFileSync(join(p, 'world-v3.json'), 'keep');
    s.write(createWorld());
    s.archive();
    expect(existsSync(s.path)).toBe(false);
    expect(readFileSync(join(p, 'world-v3.json'), 'utf8')).toBe('keep');
  });
});
