import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const executablePath =
  process.env.FRONTIER_EXECUTABLE || resolve('release/win-unpacked/Frontier Command.exe');
const userData = mkdtempSync(join(tmpdir(), 'frontier-packaged-v4-'));
const launch = () =>
  electron.launch({
    executablePath,
    args: [],
    env: { ...process.env, FRONTIER_USER_DATA: userData, FRONTIER_HEADLESS: '1' },
  });
let app;
try {
  app = await launch();
  let page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('.admiral-console');
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false,
  );
  await page.context().setOffline(true);
  const initial = (await page.evaluate(() => window.frontier.getState())).state;
  assert.equal(initial.version, 4);
  assert.equal(initial.ships.length, 4);
  assert.equal(initial.contacts.length, 0);
  const result = await page.evaluate(() =>
    window.frontier.command({
      type: 'createOrder',
      spec: {
        kind: 'transport',
        objective: { type: 'location', id: 'colony' },
        shipIds: ['meridian'],
        priority: 'normal',
        roe: 'RETURN FIRE',
        border: 'federation',
        retreat: { hull: 30, shield: 0, core: 0, emptyAmmo: false },
        duration: 45,
        sourceId: 'base',
        cargoKind: 'supplies',
        amount: 30,
        route: 'safe',
        approach: 'remote',
      },
    }),
  );
  assert.equal(result.ok, true);
  await page.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await new Promise((resolve) => setTimeout(resolve, 1400));
  await page.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  const saved = (await page.evaluate(() => window.frontier.getState())).state;
  assert.ok(saved.time > 0);
  assert.equal(saved.orders.length, 1);
  assert.equal((await page.evaluate(() => window.frontier.save())).ok, true);
  assert.deepEqual(errors, []);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('.admiral-console');
  const restored = (await page.evaluate(() => window.frontier.getState())).state;
  assert.equal(restored.paused, true);
  assert.equal(restored.time, saved.time);
  assert.deepEqual(restored.orders, saved.orders);
  console.log(
    'PASS: v4 packaged EXE, hidden window, offline order, fixed-step simulation, save and restart.',
  );
} finally {
  if (app) await app.close().catch(() => {});
}
