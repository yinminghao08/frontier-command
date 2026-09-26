import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveStore } from '../electron/persistence';
import { createWorld } from '../src/engine/data';
describe('SaveStore', () => {
  it('atomically writes, rotates backup, and restores it after corruption without deleting evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-save-'));
    const store = new SaveStore(dir);
    const w = createWorld();
    store.write(w);
    w.resources.science = 12;
    store.write(w);
    writeFileSync(store.path, 'broken');
    const restored = store.read();
    expect(restored.world?.resources.science).toBe(0);
    expect(restored.message).toContain('备份');
    expect(readFileSync(store.path, 'utf8')).toBe('broken');
    store.write(restored.world!);
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);
    expect(store.read().world).not.toBeNull();
  });
  it('blocks persistence if no valid backup exists', () => {
    const store = new SaveStore(mkdtempSync(join(tmpdir(), 'frontier-broken-')));
    writeFileSync(store.path, '{}');
    expect(store.read().blocked).toBe(true);
    expect(store.read().world).toBeNull();
  });
  it('archives saves on explicit reset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-archive-'));
    const store = new SaveStore(dir);
    store.write(createWorld());
    store.archive();
    expect(readdirSync(dir).some((f) => f.includes('.archived-'))).toBe(true);
    expect(store.read().world).toBeNull();
  });
});
