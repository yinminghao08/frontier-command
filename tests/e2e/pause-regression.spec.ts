import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine } from '../helpers';
import { makeEnemy } from '../../src/engine/data';
import { updateSensors } from '../../src/engine/sensors';
import { parseSave } from '../../src/engine/saves';

let app: ElectronApplication | undefined;
async function launch(directory: string) {
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '0' },
  });
  const page = await app.firstWindow();
  await page.getByRole('navigation', { name: '主导航' }).waitFor();
  await page.context().setOffline(true);
  return page;
}
const state = async (page: Page) => (await page.evaluate(() => window.frontier.getState())).state;
async function resume(page: Page) {
  await page.getByRole('button', { name: '16×', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
}
async function continuousUntil(page: Page, tick: number) {
  await expect
    .poll(
      async () => {
        const snapshot = await state(page);
        expect(snapshot.paused).toBe(false);
        expect(snapshot.pauseReasons).toEqual([]);
        return snapshot.tick;
      },
      { timeout: 45000, intervals: [100] },
    )
    .toBeGreaterThanOrEqual(tick);
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});

test('scouted capture keeps running through three autosaves and restores the captured base', async () => {
  test.setTimeout(90000);
  const e = quietEngine();
  const site = e.state.locations.find((l) => l.id === 'orion-base')!;
  const ship = e.state.ships[2];
  ship.x = site.x;
  ship.y = site.y;
  e.dispatchCommand({ type: 'pause', paused: false });
  for (let i = 0; i < 110; i++) e.step();
  expect(site.discovered).toBe(true);
  expect(e.state.siteIntel.some((i) => i.locationId === site.id)).toBe(true);
  e.hit(site, site.hull + site.shield + 1);
  e.finishCritical();
  e.dispatchCommand({ type: 'pause', paused: true });
  const directory = mkdtempSync(join(tmpdir(), 'frontier-pause-capture-'));
  const store = new SaveStore(directory);
  store.write(e.state);
  let page = await launch(directory);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.operation-chip[data-ship-id="' + ship.id + '"]').click();
  await page.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Admiral 指令' });
  await dialog.getByLabel('指令类型', { exact: true }).selectOption('CAPTURE');
  await dialog.getByLabel('指令目标', { exact: true }).selectOption(site.id);
  await dialog.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await resume(page);
  await expect
    .poll(
      async () => {
        const snapshot = await state(page);
        expect(snapshot.paused).toBe(false);
        return snapshot.locations.find((l) => l.id === site.id)?.owner;
      },
      { timeout: 20000, intervals: [100] },
    )
    .toBe('starfleet');
  const captured = await state(page);
  const savedCapture = parseSave(JSON.parse(readFileSync(store.path, 'utf8')));
  expect(savedCapture.locations.find((l) => l.id === site.id)?.owner).toBe('starfleet');
  expect(savedCapture.siteIntel.some((i) => i.locationId === site.id)).toBe(false);
  const savedTicks = new Set<number>();
  await expect
    .poll(
      async () => {
        const snapshot = await state(page);
        expect(snapshot.paused).toBe(false);
        expect(snapshot.pauseReasons).toEqual([]);
        const saved = parseSave(JSON.parse(readFileSync(store.path, 'utf8')));
        if (saved.tick > captured.tick) savedTicks.add(saved.tick);
        return snapshot.tick;
      },
      { timeout: 45000, intervals: [100] },
    )
    .toBeGreaterThanOrEqual(captured.tick + 350);
  expect(savedTicks.size).toBeGreaterThanOrEqual(3);
  expect(parseSave(JSON.parse(readFileSync(store.path, 'utf8'))).tick).toBeGreaterThanOrEqual(
    captured.tick + 300,
  );
  await page.screenshot({
    path: join(directory, 'capture-continuous.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const beforeClose = await state(page);
  await app!.close();
  app = undefined;
  page = await launch(directory);
  const restored = await state(page);
  expect(restored.tick).toBe(beforeClose.tick);
  expect(restored.locations.find((l) => l.id === site.id)?.owner).toBe('starfleet');
  expect(restored.history.some((h) => h.kind === 'capture' && h.entityId === site.id)).toBe(true);
  await resume(page);
  await continuousUntil(page, restored.tick + 120);
  expect(errors).toEqual([]);
});

test('known contact reacquisition and hostile upgrade do not pause, including after restart', async () => {
  const e = quietEngine();
  const enemy = makeEnemy('known-scout', 'scout', 'orion', { x: e.base.x + 80, y: e.base.y });
  enemy.cloak = 'off';
  enemy.nextDecision = 1e9;
  enemy.standing.roe = 'HOLD FIRE';
  e.state.ships.forEach((s) => {
    s.standing.roe = 'HOLD FIRE';
  });
  e.state.enemies = [enemy];
  updateSensors(e);
  e.finishCritical();
  e.dispatchCommand({ type: 'pause', paused: false });
  e.state.tick = 120;
  e.state.time = 12;
  enemy.lastHostileAt = e.state.time;
  enemy.lastHostileTargetId = 'base';
  const directory = mkdtempSync(join(tmpdir(), 'frontier-pause-contact-'));
  const store = new SaveStore(directory);
  store.write(e.state);
  let page = await launch(directory);
  await resume(page);
  await continuousUntil(page, e.state.tick + 150);
  const running = await state(page);
  expect(
    running.communications.some(
      (c) => c.text.includes('已确认敌对接触') && !c.text.includes('手动继续'),
    ),
  ).toBe(true);
  await expect(page.getByRole('dialog', { name: '接触警报' })).not.toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const beforeClose = await state(page);
  await app!.close();
  app = undefined;
  expect(
    parseSave(JSON.parse(readFileSync(store.path, 'utf8'))).contactAlerts[0].hostileAlerted,
  ).toBe(true);
  page = await launch(directory);
  await resume(page);
  await continuousUntil(page, beforeClose.tick + 120);
  await expect(page.getByRole('dialog', { name: '接触警报' })).not.toBeVisible();
});
