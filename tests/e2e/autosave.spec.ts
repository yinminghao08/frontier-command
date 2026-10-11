import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, rmdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine } from '../helpers';

let app: ElectronApplication | undefined;
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});

for (const speed of [1, 4, 16] as const) {
  test(`${speed}x autosave failure keeps simulation running and recovers without log spam`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'frontier-autosave-'));
    const world = quietEngine().state;
    world.speed = speed;
    new SaveStore(directory).write(world);
    app = await electron.launch({
      args: [resolve('.')],
      env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
    });
    const page = await app.firstWindow();
    await page.getByRole('navigation', { name: '主导航' }).waitFor();
    await page.context().setOffline(true);
    const state = async () => (await page.evaluate(() => window.frontier.getState())).state;
    // Resume is saved successfully before the next automatic write is blocked.
    await page.getByRole('button', { name: '继续', exact: true }).click();
    const head = join(directory, 'frontiers-v16', 'frontier-000001', 'head.json');
    const obstruction = head + '.tmp';
    mkdirSync(obstruction);
    await expect.poll(async () => (await state()).logs.some((l) => l.text.startsWith('保存失败：')),
      { timeout: 20000, intervals: [50] }).toBe(true);
    const failed = await state();
    expect(failed.paused).toBe(false);
    expect(failed.pauseReasons).toEqual([]);
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
    const backupTime = statSync(head + '.bak').mtimeMs;
    await expect.poll(async () => (await state()).tick, { intervals: [50] })
      .toBeGreaterThanOrEqual(failed.tick + 32);
    expect(statSync(head + '.bak').mtimeMs).toBe(backupTime);
    await expect.poll(async () => (await state()).tick, { timeout: 30000, intervals: [50] })
      .toBeGreaterThanOrEqual(failed.tick + 200);
    const ongoing = await state();
    expect(ongoing.paused).toBe(false);
    expect(ongoing.logs.filter((l) => l.text.startsWith('保存失败：'))).toHaveLength(1);
    expect((await page.evaluate(() => window.frontier.getState())).saveMessage).toContain('保存失败');
    rmdirSync(obstruction);
    await expect.poll(() => JSON.parse(readFileSync(head, 'utf8')).tick,
      { timeout: 20000, intervals: [50] }).toBeGreaterThanOrEqual(ongoing.tick);
    expect((await page.evaluate(() => window.frontier.getState())).saveMessage).toBe('世界状态已保存至本机');
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const frozen = await state();
    expect(frozen.paused).toBe(true);
    expect((await new SaveStore(directory).read()).world?.tick).toBe(frozen.tick);
    await app.close();
    app = undefined;
    app = await electron.launch({
      args: [resolve('.')],
      env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
    });
    const restored = await app.firstWindow();
    await restored.getByRole('navigation', { name: '主导航' }).waitFor();
    const loaded = (await restored.evaluate(() => window.frontier.getState())).state;
    expect(loaded.tick).toBe(frozen.tick);
    expect(loaded.paused).toBe(true);
  });
}
