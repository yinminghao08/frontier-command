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
import { parseSave, UnsupportedSaveVersionError } from '../src/engine/saves';
import type { WorldState } from '../src/engine/types';
export class SaveStore {
  readonly path: string;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, 'world-v4.json');
  }
  read(): { world: WorldState | null; message: string; blocked: boolean } {
    const selectedPath = this.path;
    if (!existsSync(selectedPath) && !existsSync(selectedPath + '.bak'))
      return { world: null, message: '新世界已就绪', blocked: false };
    for (const path of [selectedPath, selectedPath + '.bak']) {
      try {
        const content = readFileSync(path, 'utf8');
        if (content.length > 2_000_000) throw new Error('存档过大');
        const world = parseSave(JSON.parse(content));
        return {
          world,
          message:
            path === selectedPath
              ? '已恢复 v4 本地存档，模拟处于暂停状态'
              : '主存档损坏，已从 v4 备份恢复；原文件将在保存前归档',
          blocked: false,
        };
      } catch (error) {
        if (error instanceof UnsupportedSaveVersionError)
          return {
            world: null,
            message: '存档来自不支持的版本。当前为临时世界，已阻止保存以保留原文件。',
            blocked: true,
          };
        /* Try backup without overwriting the damaged data. */
      }
    }
    return {
      world: null,
      message: '主存档与备份均不可读。当前为临时世界；请在 ARCHIVE 选择“新世界”归档重置后再保存。',
      blocked: true,
    };
  }
  write(world: WorldState) {
    const validated = worldSchema.parse(world);
    // Never replace an unsupported generation, including a backup from a newer app.
    for (const path of [this.path, this.path + '.bak']) {
      if (!existsSync(path)) continue;
      try {
        parseSave(JSON.parse(readFileSync(path, 'utf8')));
      } catch (error) {
        if (error instanceof UnsupportedSaveVersionError) throw error;
      }
    }
    if (existsSync(this.path)) {
      try {
        parseSave(JSON.parse(readFileSync(this.path, 'utf8')));
        copyFileSync(this.path, this.path + '.bak');
      } catch {
        renameSync(this.path, this.path + `.corrupt-${Date.now()}`);
      }
    }
    writeFileSync(this.path + '.tmp', JSON.stringify(validated), 'utf8');
    renameSync(this.path + '.tmp', this.path);
  }
  archive() {
    const stamp = Date.now();
    for (const path of [this.path])
      for (const suffix of ['', '.bak'])
        if (existsSync(path + suffix))
          renameSync(path + suffix, path + suffix + `.archived-${stamp}`);
  }
}
