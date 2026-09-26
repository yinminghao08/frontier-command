import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

// Launches the actual packaged binary without showing or focusing any desktop window.
const executablePath =
  process.env.FRONTIER_EXECUTABLE || resolve('release/win-unpacked/Frontier Command.exe');
const userData = mkdtempSync(join(tmpdir(), 'frontier-packaged-'));
const launch = () =>
  electron.launch({
    executablePath,
    args: [],
    env: { ...process.env, FRONTIER_USER_DATA: userData, FRONTIER_HEADLESS: '1' },
  });
let app;
try {
  app = await launch();
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('.fleet-chip', { state: 'attached' });
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false,
  );
  await page.context().setOffline(true);
  assert.equal(await page.locator('.fleet-chip').count(), 3);
  const dispatch = await page.evaluate(() =>
    window.frontier.command({
      type: 'dispatch',
      shipId: 'verity',
      missionId: 'amber',
      route: 'safe',
    }),
  );
  assert.equal(dispatch.ok, true);
  await page.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await new Promise((resolve) => setTimeout(resolve, 1300));
  await page.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  const state = (await page.evaluate(() => window.frontier.getState())).state;
  assert.ok(state.time > 0);
  assert.equal(state.ships[0].missionId, 'amber');
  assert.equal((await page.evaluate(() => window.frontier.save())).ok, true);
  assert.deepEqual(errors, []);
  await app.close();
  app = await launch();
  const restoredPage = await app.firstWindow();
  await restoredPage.waitForSelector('.fleet-chip', { state: 'attached' });
  const restored = (await restoredPage.evaluate(() => window.frontier.getState())).state;
  assert.equal(restored.paused, true);
  assert.equal(restored.time, state.time);
  assert.equal(restored.ships[0].missionId, 'amber');
  console.log(
    'PASS: packaged EXE, hidden-window launch, offline commands, simulation advancement, save and restart.',
  );
} finally {
  if (app) await app.close().catch(() => {});
}
