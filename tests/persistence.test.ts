import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveStore } from '../electron/persistence';
import { createWorld } from '../src/engine/data';
import { parseSave, UnsupportedSaveVersionError } from '../src/engine/saves';
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

  it('migrates v1 without altering the legacy primary or backup, then prefers v2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-migration-'));
    const store = new SaveStore(dir);
    const legacy = readFileSync('tests/fixtures/lv1/in-progress.json', 'utf8');
    const legacyPath = join(dir, 'world-v1.json');
    writeFileSync(legacyPath, legacy);
    writeFileSync(legacyPath + '.bak', legacy);
    const loaded = store.read();
    expect(loaded.blocked).toBe(false);
    expect(loaded.world).toEqual(parseSave(JSON.parse(legacy)));
    expect(existsSync(store.path)).toBe(false);
    loaded.world!.resources.science = 123;
    store.write(loaded.world!);
    expect(store.path).toBe(join(dir, 'world-v2.json'));
    expect(store.read().world?.resources.science).toBe(123);
    expect(JSON.parse(readFileSync(store.path, 'utf8')).version).toBe(2);
    expect(readFileSync(legacyPath, 'utf8')).toBe(legacy);
    expect(readFileSync(legacyPath + '.bak', 'utf8')).toBe(legacy);
  });

  it('recovers a v1 backup while retaining both legacy files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-legacy-backup-'));
    const store = new SaveStore(dir);
    const legacyPath = join(dir, 'world-v1.json');
    const legacy = readFileSync('tests/fixtures/lv1/manual.json', 'utf8');
    writeFileSync(legacyPath, 'broken');
    writeFileSync(legacyPath + '.bak', legacy);
    const loaded = store.read();
    expect(loaded.message).toContain('备份');
    expect(loaded.world).toEqual(parseSave(JSON.parse(legacy)));
    store.write(loaded.world!);
    expect(readFileSync(legacyPath, 'utf8')).toBe('broken');
    expect(readFileSync(legacyPath + '.bak', 'utf8')).toBe(legacy);
  });

  it.each(['', '.bak'])(
    'does not roll back to v1 when a v2%s file exists but is corrupt',
    (suffix) => {
      const dir = mkdtempSync(join(tmpdir(), 'frontier-no-rollback-'));
      const store = new SaveStore(dir);
      writeFileSync(join(dir, 'world-v1.json'), readFileSync('tests/fixtures/lv1/initial.json'));
      writeFileSync(store.path + suffix, 'broken');
      expect(store.read()).toMatchObject({ world: null, blocked: true });
    },
  );

  it.each(['', '.bak'])('never overwrites an unsupported v2%s save', (suffix) => {
    const store = new SaveStore(mkdtempSync(join(tmpdir(), 'frontier-future-')));
    const future = JSON.stringify({ ...createWorld(), version: 9 });
    writeFileSync(store.path + suffix, future);
    expect(store.read()).toMatchObject({ world: null, blocked: true });
    expect(() => store.write(createWorld())).toThrow(UnsupportedSaveVersionError);
    expect(readFileSync(store.path + suffix, 'utf8')).toBe(future);
  });

  it('does not fall back from an unsupported primary to an older valid backup', () => {
    const store = new SaveStore(mkdtempSync(join(tmpdir(), 'frontier-future-primary-')));
    writeFileSync(store.path, JSON.stringify({ ...createWorld(), version: 9 }));
    writeFileSync(store.path + '.bak', JSON.stringify(createWorld()));
    expect(store.read()).toMatchObject({ world: null, blocked: true });
  });

  it('explicit reset archives both save generations and their backups', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-reset-all-'));
    const store = new SaveStore(dir);
    for (const file of ['world-v1.json', 'world-v1.json.bak', 'world-v2.json', 'world-v2.json.bak'])
      writeFileSync(join(dir, file), file);
    store.archive();
    expect(readdirSync(dir).filter((file) => file.includes('.archived-'))).toHaveLength(4);
    expect(store.read()).toMatchObject({ world: null, blocked: false });
    store.write(createWorld());
    expect(store.read().world).toEqual(createWorld());
  });
});
