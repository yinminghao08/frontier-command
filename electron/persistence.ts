import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { worldSchema } from '../src/engine/save-schema';
import { parseSave, UnsupportedSaveVersionError } from '../src/engine/saves';
import { gameCalendar, TICKS_PER_DAY } from '../src/engine/clock';
import type { WorldState } from '../src/engine/types';
import type { SaveCatalog, SaveSummary, TimelineStatus } from '../src/engine/timeline';
const branchId = z.string().regex(/^frontier-\d{6,}$/);
const saveName = z.string().trim().min(1, '请输入存档名称').max(40, '名称最多 40 个字符');
const metaSchema = z
  .object({
    id: branchId,
    name: saveName.optional(),
    parent: z.object({ id: branchId, day: z.number().int().positive() }).strict().nullable(),
  })
  .strict();
const indexSchema = z
  .object({ version: z.literal(14), activeId: branchId, branches: z.array(metaSchema) })
  .strict();
type Index = z.infer<typeof indexSchema>;
function atomic(path: string, data: unknown) {
  writeFileSync(path + '.tmp', JSON.stringify(data), 'utf8');
  renameSync(path + '.tmp', path);
}
function loadWorld(path: string) {
  const text = readFileSync(path, 'utf8');
  if (text.length > 32_000_000) throw Error('存档超过容量限制');
  return parseSave(JSON.parse(text));
}
export class SaveStore {
  readonly root: string;
  readonly indexPath: string;
  private index: Index | null = null;
  private blocked = false;
  private indexBlocked = false;
  constructor(readonly directory: string) {
    this.root = join(directory, 'frontiers-v14');
    this.indexPath = join(directory, 'timeline-v14.json');
    if (
      existsSync(directory) &&
      readdirSync(directory).some(
        (file) => Number(/^timeline-v(\d+)\.json$/.exec(file)?.[1] ?? 0) > 14,
      )
    ) {
      this.blocked = true;
      this.indexBlocked = true;
      mkdirSync(this.root, { recursive: true });
      return;
    }
    mkdirSync(this.root, { recursive: true });
    if (existsSync(this.indexPath))
      try {
        this.index = indexSchema.parse(JSON.parse(readFileSync(this.indexPath, 'utf8')));
        if (!this.index.branches.some((b) => b.id === this.index!.activeId))
          throw Error('Missing active branch');
        if (new Set(this.index.branches.map((b) => b.id)).size !== this.index.branches.length)
          throw Error('Duplicate branch ID');
        for (const branch of this.index.branches) {
          const visited = new Set<string>();
          let current: string | null = branch.id;
          while (current) {
            if (visited.has(current)) throw Error('Cyclic branch ancestry');
            visited.add(current);
            const parent = this.index.branches.find((b) => b.id === current);
            if (!parent) throw Error('Missing parent branch');
            current = parent.parent?.id ?? null;
          }
        }
      } catch {
        this.index = null;
        this.blocked = true;
        this.indexBlocked = true;
      }
    if (!this.indexBlocked) {
      try {
        this.recoverTransactions();
      } catch {
        this.blocked = true;
        this.indexBlocked = true;
      }
    }
  }
  /** Only validated IDs can be resolved into paths used by management operations. */
  private branchDirectory(id: string) {
    const path = resolve(this.root, branchId.parse(id));
    if (!path.startsWith(resolve(this.root) + sep)) throw Error('非法存档路径');
    return path;
  }
  private recoverTransactions() {
    for (const file of readdirSync(this.root)) {
      const deleted = /^\.delete-(frontier-\d{6,})-[\da-f-]+$/.exec(file);
      if (deleted) {
        const path = join(this.root, file);
        const original = this.branchDirectory(deleted[1]);
        if (this.index?.branches.some((b) => b.id === deleted[1])) {
          if (existsSync(original)) throw Error('存档删除事务冲突，原文件已保留');
          renameSync(path, original);
        } else rmSync(path, { recursive: true, force: true });
      } else if (/^\.stage-[\da-f-]+$/.test(file)) {
        rmSync(join(this.root, file), { recursive: true, force: true });
      } else if (/^\.creating-frontier-\d{6,}$/.test(file)) {
        const id = file.slice('.creating-'.length);
        if (!this.index?.branches.some((b) => b.id === id))
          rmSync(this.branchDirectory(id), { recursive: true, force: true });
        rmSync(join(this.root, file));
      }
    }
  }
  private commit(next: Index) {
    atomic(this.indexPath, indexSchema.parse(next));
    this.index = next;
  }
  private requireCatalog() {
    if (this.indexBlocked) throw Error('时间线索引损坏或版本不支持；原文件已保留，禁止修改');
    if (!this.index) throw Error('存档尚未初始化');
    return this.index;
  }
  private requireBranch(id: string) {
    branchId.parse(id);
    const branch = this.requireCatalog().branches.find((b) => b.id === id);
    if (!branch) throw Error('存档不存在，请刷新列表');
    return branch;
  }
  private readBranch(id: string): { world: WorldState; backup: boolean; savedAt: number } {
    const dir = this.branchDirectory(id);
    const failure = join(dir, 'failure.json');
    if (existsSync(failure)) {
      const world = loadWorld(failure);
      if (world.status !== 'commandLost') throw Error('失败时间线记录无效，禁止回退');
      return { world, backup: false, savedAt: statSync(failure).mtimeMs };
    }
    const head = join(dir, 'head.json');
    try {
      return { world: loadWorld(head), backup: false, savedAt: statSync(head).mtimeMs };
    } catch (error) {
      if (error instanceof UnsupportedSaveVersionError) throw error;
      return {
        world: loadWorld(head + '.bak'),
        backup: true,
        savedAt: statSync(head + '.bak').mtimeMs,
      };
    }
  }
  catalog(): SaveCatalog {
    const saves: SaveSummary[] = (this.index?.branches ?? []).map((b) => {
      const meta = { id: b.id, name: b.name ?? '曙光边疆 ' + b.id.slice(9), parent: b.parent };
      try {
        const loaded = this.readBranch(b.id);
        return {
          ...meta,
          availability: loaded.backup ? 'backup' : 'ready',
          reason: loaded.backup ? '将从同代备份恢复' : '',
          status: loaded.world.status,
          tick: loaded.world.tick,
          lossCount: loaded.world.losses.length,
          savedAt: loaded.savedAt,
        };
      } catch (error) {
        return {
          ...meta,
          availability: error instanceof UnsupportedSaveVersionError ? 'unsupported' : 'corrupt',
          reason:
            error instanceof UnsupportedSaveVersionError
              ? '存档版本不支持，已保护原文件'
              : '存档不可读，原文件已保留',
          status: null,
          tick: null,
          lossCount: null,
          savedAt: null,
        };
      }
    });
    saves.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0) || b.id.localeCompare(a.id));
    return {
      activeId: this.index?.activeId ?? null,
      blocked: this.indexBlocked,
      message: this.indexBlocked ? '时间线索引损坏；原文件已保护，禁止修改。' : '',
      saves,
    };
  }
  get path() {
    return join(this.root, this.index?.activeId ?? 'uninitialized', 'head.json');
  }
  get currentProtected() {
    return this.blocked;
  }
  read(): { world: WorldState | null; message: string; blocked: boolean } {
    if (this.blocked)
      return {
        world: null,
        message: '时间线索引损坏或版本不支持；已保留原文件并阻止覆盖。',
        blocked: true,
      };
    if (!this.index) return { world: null, message: 'v14 持久海盗边疆就绪。', blocked: false };
    try {
      const loaded = this.readBranch(this.index.activeId);
      return {
        world: loaded.world,
        message: loaded.backup ? '已从同代备份恢复' : '已恢复 v14 时间线',
        blocked: false,
      };
    } catch (error) {
      this.blocked = true;
      return {
        world: null,
        message:
          error instanceof UnsupportedSaveVersionError
            ? '禁止覆盖不支持的存档版本'
            : '当前存档不可读；请选择其他存档或新建，原文件已保留。',
        blocked: true,
      };
    }
  }
  private create(
    world: WorldState,
    parent: Index['branches'][number]['parent'],
    name?: string,
    snapshots = new Map<number, string>(),
  ): WorldState {
    if (this.indexBlocked) throw Error('时间线索引已保护，禁止修改');
    worldSchema.parse(world);
    const displayName = name === undefined ? undefined : saveName.parse(name);
    const ids = readdirSync(this.root).flatMap(
      (n) => /^(?:\.allocated-)?frontier-(\d+)$/.exec(n)?.slice(1) ?? [],
    );
    const n =
        Math.max(
          0,
          ...ids.map(Number),
          ...(this.index?.branches ?? []).map((b) => Number(b.id.slice(9))),
        ) + 1,
      id = 'frontier-' + String(n).padStart(6, '0');
    // Durable reservation prevents ID reuse after deletion or a failed creation.
    writeFileSync(join(this.root, '.allocated-' + id), '', { flag: 'wx' });
    const dir = join(this.root, '.stage-' + randomUUID());
    const destination = this.branchDirectory(id);
    const journal = join(this.root, '.creating-' + id);
    mkdirSync(dir);
    let moved = false;
    try {
      atomic(join(dir, 'head.json'), world);
      for (const [day, path] of snapshots)
        atomic(join(dir, 'day-' + day + '.json'), loadWorld(path));
      if (
        world.tick % TICKS_PER_DAY === 0 &&
        !existsSync(join(dir, 'day-' + gameCalendar(world.tick).day + '.json'))
      )
        atomic(join(dir, 'day-' + gameCalendar(world.tick).day + '.json'), world);
      if (world.status === 'commandLost') atomic(join(dir, 'failure.json'), world);
      const meta = { id, parent, name: displayName ?? '曙光边疆 ' + id.slice(9) };
      atomic(join(dir, 'branch.json'), meta);
      writeFileSync(journal, '', { flag: 'wx' });
      renameSync(dir, destination);
      moved = true;
      this.commit({ version: 14, activeId: id, branches: [...(this.index?.branches ?? []), meta] });
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      if (moved) rmSync(destination, { recursive: true, force: true });
      rmSync(journal, { force: true });
      throw error;
    }
    // A committed creation is recovered from its journal if cleanup is interrupted.
    try {
      rmSync(journal, { force: true });
    } catch {
      /* recover on restart */
    }
    this.blocked = false;
    return structuredClone(world);
  }
  write(world: WorldState) {
    if (this.blocked) throw Error('存档被保护，禁止覆盖');
    worldSchema.parse(world);
    if (!this.index) {
      this.create(world, null);
      return;
    }
    const failure = join(this.root, this.index.activeId, 'failure.json');
    if (existsSync(failure)) {
      let frozen: WorldState;
      try {
        frozen = loadWorld(failure);
      } catch (error) {
        this.blocked = true;
        throw error;
      }
      if (JSON.stringify(frozen) !== JSON.stringify(worldSchema.parse(world)))
        throw Error('失败时间线已封存');
      return;
    }
    if (existsSync(this.path))
      try {
        loadWorld(this.path);
        copyFileSync(this.path, this.path + '.bak');
      } catch (error) {
        if (error instanceof UnsupportedSaveVersionError) {
          this.blocked = true;
          throw error;
        }
        copyFileSync(this.path, this.path + '.corrupt-' + Date.now());
      }
    atomic(this.path, world);
    if (world.status === 'commandLost')
      writeFileSync(failure, JSON.stringify(world), { flag: 'wx' });
  }
  daily(world: WorldState) {
    if (world.tick % TICKS_PER_DAY !== 0) throw Error('日快照必须位于午夜');
    worldSchema.parse(world);
    if (!this.index) {
      this.create(world, null);
      return;
    }
    const path = join(
      this.root,
      this.index.activeId,
      'day-' + gameCalendar(world.tick).day + '.json',
    );
    if (!existsSync(path)) writeFileSync(path, JSON.stringify(world), { flag: 'wx' });
  }
  private dailyPath(id: string, day: number): string | null {
    const visited = new Set<string>();
    let current: string | null = id;
    while (current && !visited.has(current)) {
      visited.add(current);
      const p = join(this.root, current, 'day-' + day + '.json');
      if (existsSync(p)) return p;
      const parent = this.index?.branches.find((b) => b.id === current)?.parent;
      current = parent && day <= parent.day ? parent.id : null;
    }
    return null;
  }
  status(tick: number): TimelineStatus {
    const day = gameCalendar(tick).day - 1;
    return {
      activeId: this.index?.activeId ?? null,
      previousDay: this.index && day >= 1 && this.dailyPath(this.index.activeId, day) ? day : null,
      branches: (this.index?.branches ?? []).flatMap((b) => {
        try {
          const { world: w } = this.readBranch(b.id);
          return [
            {
              id: b.id,
              parent: b.parent,
              status: w.status,
              tick: w.tick,
              lossCount: w.losses.length,
            },
          ];
        } catch {
          return [];
        }
      }),
    };
  }
  restorePreviousDay(world: WorldState): WorldState {
    if (!this.index) throw Error('时间线未初始化');
    const day = gameCalendar(world.tick).day - 1,
      path = this.dailyPath(this.index.activeId, day);
    if (!path) throw Error('没有上一游戏日快照');
    const restored = loadWorld(path);
    if (restored.status !== 'active') throw Error('昨日快照已失去指挥权');
    this.write(world);
    restored.paused = true;
    restored.pauseReasons = [];
    return this.create(restored, { id: this.index.activeId, day });
  }
  beginNew(world: WorldState, current?: WorldState, name?: string): WorldState {
    if (this.indexBlocked) throw Error('时间线索引已保护，禁止修改');
    if (name !== undefined) saveName.parse(name);
    this.persistOutgoing(current);
    return this.create(world, null, name);
  }
  private persistOutgoing(current?: WorldState) {
    if (!current || this.blocked) return;
    try {
      this.write(current);
    } catch (error) {
      // Protected future/failure records must stay untouched; ordinary I/O failures still abort.
      if (!this.blocked) throw error;
    }
  }
  /** Collect effective daily snapshots, respecting each ancestral fork cutoff. */
  private snapshots(id: string): Map<number, string> {
    const result = new Map<number, string>();
    const visited = new Set<string>();
    let current: string | null = id;
    let cutoff = Infinity;
    while (current) {
      if (visited.has(current)) throw Error('时间线父引用循环');
      visited.add(current);
      const b = this.requireBranch(current);
      for (const file of readdirSync(this.branchDirectory(current))) {
        const match = /^day-(\d+)\.json$/.exec(file);
        if (match) {
          const day = Number(match[1]);
          if (day <= cutoff && !result.has(day))
            result.set(day, join(this.branchDirectory(current), file));
        }
      }
      cutoff = Math.min(cutoff, b.parent?.day ?? Infinity);
      current = b.parent?.id ?? null;
    }
    return result;
  }
  copyCurrent(world: WorldState, name: string): WorldState {
    saveName.parse(name);
    const index = this.requireCatalog();
    if (this.blocked) throw Error('当前存档不可读，无法复制');
    const snapshots = this.snapshots(index.activeId);
    for (const path of snapshots.values()) loadWorld(path);
    this.write(world);
    return this.create(world, null, name, snapshots);
  }
  activate(id: string, current?: WorldState): WorldState {
    this.requireBranch(id);
    let next = this.readBranch(id).world;
    if (id === this.index?.activeId && current && !this.blocked) next = structuredClone(current);
    this.persistOutgoing(current);
    if (next.status === 'active') next.paused = true;
    this.commit({ ...this.requireCatalog(), activeId: id });
    this.blocked = false;
    return next;
  }
  rename(id: string, name: string) {
    this.requireBranch(id);
    const normalized = saveName.parse(name);
    const index = this.requireCatalog();
    this.commit({
      ...index,
      branches: index.branches.map((b) => (b.id === id ? { ...b, name: normalized } : b)),
    });
  }
  delete(id: string) {
    this.requireBranch(id);
    const index = this.requireCatalog();
    if (index.activeId === id) throw Error('请先切换到其他存档，再删除当前存档');
    const children = index.branches.filter((b) => b.parent?.id === id);
    const additions: { path: string; world: WorldState }[] = [];
    for (const child of children) {
      for (const [day, source] of this.snapshots(child.id)) {
        const path = join(this.branchDirectory(child.id), 'day-' + day + '.json');
        if (!existsSync(path)) additions.push({ path, world: loadWorld(source) });
      }
    }
    const original = this.branchDirectory(id);
    const trash = join(this.root, '.delete-' + id + '-' + randomUUID());
    const written: string[] = [];
    let moved = false;
    // Preserve IDs allocated by older versions as well.
    if (!existsSync(join(this.root, '.allocated-' + id)))
      writeFileSync(join(this.root, '.allocated-' + id), '', { flag: 'wx' });
    try {
      for (const entry of additions) {
        written.push(entry.path);
        atomic(entry.path, entry.world);
      }
      if (existsSync(original)) {
        renameSync(original, trash);
        moved = true;
      }
      this.commit({
        ...index,
        branches: index.branches
          .filter((b) => b.id !== id)
          .map((b) => (b.parent?.id === id ? { ...b, parent: null } : b)),
      });
    } catch (error) {
      if (moved) renameSync(trash, original);
      for (const path of written) {
        rmSync(path, { force: true });
        // A pre-existing directory can be the cause of the write failure; never remove it.
        if (existsSync(path + '.tmp') && statSync(path + '.tmp').isFile())
          rmSync(path + '.tmp', { force: true });
      }
      throw error;
    }
    try {
      rmSync(trash, { recursive: true, force: true });
    } catch {
      /* committed deletion; recover on restart */
    }
  }
}
