import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { worldSchema } from '../src/engine/save-schema';
import type { WorldState } from '../src/engine/types';
export class SaveStore {
  readonly path: string;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, 'world-v1.json');
  }
  read(): { world: WorldState | null; message: string; blocked: boolean } {
    if (!existsSync(this.path) && !existsSync(this.path + '.bak'))
      return { world: null, message: '新世界已就绪', blocked: false };
    for (const path of [this.path, this.path + '.bak']) {
      try {
        const content = readFileSync(path, 'utf8');
        if (content.length > 2_000_000) throw new Error('存档过大');
        const world = worldSchema.parse(JSON.parse(content));
        return {
          world,
          message:
            path === this.path
              ? '已恢复本地存档，模拟处于暂停状态'
              : '主存档损坏，已从备份恢复；原文件将在保存前归档',
          blocked: false,
        };
      } catch {
        /* Try backup without overwriting the damaged data. */
      }
    }
    return {
      world: null,
      message: '主存档与备份均不可读。当前为临时世界；请在系统页选择“归档旧存档并重置”后再保存。',
      blocked: true,
    };
  }
  write(world: WorldState) {
    const validated = worldSchema.parse(world);
    if (existsSync(this.path)) {
      try {
        worldSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
        copyFileSync(this.path, this.path + '.bak');
      } catch {
        renameSync(this.path, this.path + `.corrupt-${Date.now()}`);
      }
    }
    writeFileSync(this.path + '.tmp', JSON.stringify(validated), 'utf8');
    renameSync(this.path + '.tmp', this.path);
  }
  archive() {
    for (const suffix of ['', '.bak'])
      if (existsSync(this.path + suffix))
        renameSync(this.path + suffix, this.path + suffix + `.archived-${Date.now()}`);
  }
}
