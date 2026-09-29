import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SimulationEngine } from '../../src/engine/engine';
import { SaveStore } from '../../electron/persistence';
import { quietEngine, spec, until } from '../helpers';
let app: ElectronApplication | undefined;
const launch = async (directory: string) => {
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const page = await app.firstWindow();
  await page.getByRole('navigation', { name: '主导航' }).waitFor();
  return page;
};
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});
async function create(
  page: Page,
  kind: 'defense' | 'transport' | 'explore',
  ship: string,
  target: string,
) {
  await page.getByRole('button', { name: /02 OPERATIONS/ }).click();
  await page
    .getByRole('button', {
      name: '新建' + { defense: '战斗／防御', transport: '运输', explore: '探索／侦察' }[kind],
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', { name: '创建行动' });
  await dialog.getByLabel('行动目标').selectOption('location:' + target);
  await dialog.getByLabel('分配 ' + ship, { exact: true }).check();
  await dialog.getByRole('button', { name: '授权派遣', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
test('real Electron: create three concurrent orders, decisions, settlement, return, restart', async () => {
  test.setTimeout(120000);
  const directory = mkdtempSync(join(tmpdir(), 'frontier-e2e-v4-'));
  const engine = quietEngine();
  new SaveStore(directory).write(engine.state);
  let page = await launch(directory);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.context().setOffline(true);
  await create(page, 'transport', 'Antares', 'colony');
  await create(page, 'defense', 'Peregrine', 'colony');
  await create(page, 'explore', 'Constitution', 'anomaly1');
  let state = (await page.evaluate(() => window.frontier.getState())).state;
  expect(state.orders).toHaveLength(3);
  expect(state.orders.every((o) => o.phase === 'preparing')).toBe(true);
  await page.getByRole('button', { name: '16×', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  let decided = false;
  await expect
    .poll(
      async () => {
        state = (await page.evaluate(() => window.frontier.getState())).state;
        const decision = state.orders.find((o) => o.phase === 'decision');
        if (decision) {
          await page.locator('.operation-chip').filter({ hasText: decision.id }).click();
          await page.getByRole('button', { name: '近距调查 · 高精度', exact: true }).click();
          decided = true;
        }
        if (state.paused) await page.getByRole('button', { name: '继续', exact: true }).click();
        return state.orders.every((o) => o.phase === 'complete');
      },
      { timeout: 75000, intervals: [300, 500] },
    )
    .toBe(true);
  expect(decided).toBe(true);
  expect(state.orders.every((o) => o.outcome === 'success')).toBe(true);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: /06 ARCHIVE/ }).click();
  await page.getByRole('button', { name: '立即保存', exact: true }).click();
  const saved = (await page.evaluate(() => window.frontier.getState())).state;
  expect(saved.ships.every((s) => s.orderId === null)).toBe(true);
  expect(saved.resources.science).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/v4-complete.png' });
  expect(errors).toEqual([]);
  await app!.close();
  app = undefined;
  page = await launch(directory);
  const restored = (await page.evaluate(() => window.frontier.getState())).state;
  expect(restored.time).toBe(saved.time);
  expect(restored.orders).toEqual(saved.orders);
  expect(restored.paused).toBe(true);
});
test('map pan, zoom, layers, selection, navigation and layouts remain usable', async () => {
  test.setTimeout(120000);
  const directory = mkdtempSync(join(tmpdir(), 'frontier-map-v4-')),
    page = await launch(directory);
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ]) {
    await app!.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
      { width, height },
    );
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
    for (const nav of [
      /01 SECTOR/,
      /02 OPERATIONS/,
      /03 PERSONNEL/,
      /04 STARBASE/,
      /05 COLONIES/,
      /06 ARCHIVE/,
    ]) {
      await page.getByRole('button', { name: nav }).click();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= window.innerWidth &&
            document.documentElement.scrollHeight <= window.innerHeight,
        ),
      ).toBe(true);
      const box = await page.locator('.strategic-map').boundingBox();
      expect(box!.width).toBeGreaterThan(450);
      expect(box!.height).toBeGreaterThan(150);
      const inspector = await page.locator('.inspector').boundingBox();
      expect(inspector!.x + inspector!.width).toBeLessThanOrEqual(width);
    }
    await page.getByRole('button', { name: /01 SECTOR/ }).click();
    await page.screenshot({ path: 'test-results/v4-sector-' + width + '.png' });
  }
  const map = page.locator('.strategic-map'),
    before = await map.getAttribute('data-view'),
    box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.wheel(0, -350);
  await expect.poll(() => map.getAttribute('data-view')).not.toBe(before);
  const zoomed = await map.getAttribute('data-view');
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + 100, box.y + box.height * 0.5 + 50, {
    steps: 12,
  });
  await page.mouse.up();
  await expect.poll(() => map.getAttribute('data-view')).not.toBe(zoomed);
  await page.getByLabel('Sensors', { exact: true }).check();
  await page.getByRole('button', { name: '复位视角', exact: true }).click();
  await expect(map).toHaveAttribute('data-view', '{"x":0,"y":0,"k":1}');
  await page.getByRole('button', { name: '曙光基地', exact: true }).click();
  await expect(page.locator('.inspector h2')).toHaveText('曙光基地');
  await page.getByRole('button', { name: 'USS VERITY / 明理号', exact: true }).click();
  await expect(page.locator('.inspector h2')).toHaveText('明理号');
  await page.getByRole('button', { name: '主动扫描', exact: true }).click();
  expect(
    (await page.evaluate(() => window.frontier.getState())).state.ships.find(
      (s) => s.id === 'verity',
    )!.core,
  ).toBe(138);
});
test('pending decision, action editing and invalid orders show engine feedback', async () => {
  const e = quietEngine();
  e.dispatchCommand({ type: 'createOrder', spec: spec('explore') });
  until(e, () => e.state.orders[0].phase === 'decision');
  const directory = mkdtempSync(join(tmpdir(), 'frontier-decision-v4-'));
  new SaveStore(directory).write(e.state);
  const page = await launch(directory);
  await page.locator('.operation-chip').click();
  await expect(page.locator('.decision-box')).toBeVisible();
  await page.getByRole('button', { name: '远距扫描 · 保守', exact: true }).click();
  expect((await page.evaluate(() => window.frontier.getState())).state.orders[0].phase).toBe(
    'working',
  );
  await page.getByRole('button', { name: '修改指令', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '修改行动' });
  await dialog.getByLabel('交战规则').selectOption('HOLD FIRE');
  await dialog.getByRole('button', { name: '更新指令' }).click();
  expect((await page.evaluate(() => window.frontier.getState())).state.orders[0].roe).toBe(
    'HOLD FIRE',
  );
  await page.getByRole('button', { name: /02 OPERATIONS/ }).click();
  await page.getByRole('button', { name: '新建运输', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: '创建行动' });
  await createDialog.getByLabel('行动目标').selectOption('location:colony');
  await createDialog.getByLabel('分配 Peregrine', { exact: true }).check();
  await createDialog.getByLabel('货物数量').fill('60');
  await createDialog.getByRole('button', { name: '授权派遣', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('货舱容量不足');
  await expect(createDialog).toBeVisible();
  expect((await page.evaluate(() => window.frontier.getState())).state.orders).toHaveLength(1);
});
test('corrupt v4 recovery is actionable and reset never overwrites old generation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'frontier-corrupt-v4-'));
  writeFileSync(join(directory, 'world-v4.json'), '{bad');
  writeFileSync(join(directory, 'world-v3.json'), 'old');
  const page = await launch(directory);
  expect((await page.evaluate(() => window.frontier.getState())).saveBlocked).toBe(true);
  await page.getByRole('button', { name: /06 ARCHIVE/ }).click();
  await page.getByRole('button', { name: '新世界', exact: true }).click();
  await page.getByRole('button', { name: '归档并创建新世界', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect((await page.evaluate(() => window.frontier.getState())).saveBlocked).toBe(false);
  expect(readFileSync(join(directory, 'world-v3.json'), 'utf8')).toBe('old');
});
