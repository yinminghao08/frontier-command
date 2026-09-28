import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SimulationEngine } from '../../src/engine/engine';
import { SaveStore } from '../../electron/persistence';
let app: ElectronApplication;
test('desktop launch, missions, manual controls, viewport layouts and saved restart', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'frontier-e2e-'));
  const launch = () =>
    electron.launch({
      args: [resolve('.')],
      env: { ...process.env, FRONTIER_USER_DATA: userData, FRONTIER_HEADLESS: '1' },
    });
  app = await launch();
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByRole('heading', { name: 'FRONTIER COMMAND', exact: true })).toBeVisible();
  await expect(page.locator('.fleet-chip')).toHaveCount(3);
  await expect(page.locator('.mission-clock b')).toHaveText('Day 1 00:00');
  await expect(page.getByRole('button', { name: '16×', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '2×', exact: true })).toHaveCount(0);
  await expect(page.locator('.tactical-canvas')).toHaveAttribute(
    'aria-label',
    /Federation Space.*Neutral Zone.*Romulan Space/,
  );
  await expect(page.getByLabel('星图图例')).toContainText('M级行星');
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]);
      },
      [width, height],
    );
    await expect(page.locator('.tactical-canvas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const geometry = await page.evaluate(() => ({
      rail: document.querySelector('.upper-rail')!.getBoundingClientRect().width,
      bar: document.querySelector('.upper-bars')!.getBoundingClientRect().height,
      radius: getComputedStyle(document.querySelector('.upper-rail')!).borderBottomLeftRadius,
    }));
    expect(geometry).toEqual({
      rail: width === 1280 ? 180 : width === 1440 ? 200 : 240,
      bar: width === 1280 ? 20 : width === 1440 ? 24 : 28,
      radius: width === 1280 ? '100px' : width === 1440 ? '130px' : '160px',
    });
    await page.screenshot({ path: `test-results/overview-${width}.png` });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.getByRole('button', { name: '02 任务中心 OPERATIONS' }).click();
  await expect(page.locator('.mission-card')).toHaveCount(6);
  await page.screenshot({ path: 'test-results/missions.png' });
  await page.locator('.mission-card').filter({ hasText: '琥珀星云' }).click();
  await page.getByRole('button', { name: '授权派遣 →' }).click();
  await expect(page.locator('.assignment')).toContainText('前往任务区');
  await page.getByRole('button', { name: '继续模拟' }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.frontier.getState())).state.time)
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '直接操舰', exact: true }).click();
  await expect(page.getByRole('heading', { name: '直接操舰', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '4×', exact: true })).toBeDisabled();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 720),
  );
  await expect(page.getByRole('button', { name: 'W 推进', exact: true })).toBeInViewport();
  await expect(
    page.getByRole('button', { name: 'SPACE / 发射相位武器', exact: true }),
  ).toBeInViewport();
  await expect(page.getByRole('button', { name: '释放 · 恢复任务' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/manual-1280.png' });
  const before = await page.evaluate(async () => (await window.frontier.getState()).state.ships[0]);
  await page.keyboard.down('w');
  await page.waitForTimeout(1200);
  await page.keyboard.up('w');
  const after = await page.evaluate(async () => (await window.frontier.getState()).state.ships[0]);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: '释放 · 恢复任务' }).click();
  await page.getByRole('button', { name: '暂停模拟' }).click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await page.getByRole('button', { name: '03 舰队管理 STARBASE' }).click();
  await expect(page.locator('.berth')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/starbase.png' });
  await page.getByRole('button', { name: '05 星区档案 ARCHIVES' }).click();
  await expect(page.locator('.document')).toContainText('克拉斯家族');
  await page.getByRole('button', { name: '06 系统 SYSTEM / SAVE' }).click();
  await page.getByRole('button', { name: '立即保存' }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  const saved = await page.evaluate(async () => (await window.frontier.getState()).state);
  expect(errors).toEqual([]);
  await app.close();
  app = await launch();
  const next = await app.firstWindow();
  await expect(next.locator('.fleet-chip')).toHaveCount(3);
  const restored = await next.evaluate(async () => (await window.frontier.getState()).state);
  expect(restored.time).toBe(saved.time);
  expect(restored.paused).toBe(true);
  expect(restored.ships[0].missionId).toBe('amber');
  await app.close();
});

test('decision, settlement and corrupt-save recovery screens remain usable', async () => {
  test.setTimeout(120000);
  const engine = new SimulationEngine();
  engine.dispatchCommand({ type: 'dispatch', shipId: 'verity', missionId: 'amber', route: 'safe' });
  engine.dispatchCommand({ type: 'pause', paused: false });
  for (let i = 0; i < 5000 && engine.state.missions[0].phase === 'outbound'; i++) engine.step();
  expect(engine.state.missions[0].phase).toBe('decision');
  engine.state.paused = true;
  const decisionData = mkdtempSync(join(tmpdir(), 'frontier-decision-'));
  new SaveStore(decisionData).write(engine.state);
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: decisionData, FRONTIER_HEADLESS: '1' },
  });
  let page = await app.firstWindow();
  await expect(page.locator('.decision-box')).toBeVisible();
  await page.locator('.decision-box').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/exploration-decision.png' });
  await page.getByRole('button', { name: '近距调查 · 高收益 / 损伤' }).click();
  expect((await page.evaluate(() => window.frontier.getState())).state.missions[0].phase).toBe(
    'working',
  );
  await app.close();
  engine.dispatchCommand({ type: 'investigate', shipId: 'verity', choice: 'close' });
  engine.state.paused = false;
  for (let i = 0; i < 5000 && !engine.state.missions[0].settled; i++) {
    if (engine.state.paused) engine.dispatchCommand({ type: 'pause', paused: false });
    engine.step();
  }
  expect(engine.state.missions[0].settled).toBe(true);
  engine.state.paused = true;
  const settledData = mkdtempSync(join(tmpdir(), 'frontier-settled-'));
  new SaveStore(settledData).write(engine.state);
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: settledData, FRONTIER_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.getByRole('button', { name: '02 任务中心 OPERATIONS' }).click();
  await page.locator('.mission-card').filter({ hasText: '琥珀星云' }).click();
  await expect(page.locator('.result-box')).toBeVisible();
  await page.locator('.result-box').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/settlement.png' });
  await app.close();
  const corruptData = mkdtempSync(join(tmpdir(), 'frontier-corrupt-ui-'));
  writeFileSync(join(corruptData, 'world-v3.json'), '{broken');
  writeFileSync(join(corruptData, 'world-v3.json.bak'), '{broken');
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: corruptData, FRONTIER_HEADLESS: '1' },
  });
  page = await app.firstWindow();
  await page.getByRole('button', { name: '06 系统 SYSTEM / SAVE' }).click();
  await page.getByRole('button', { name: '立即保存' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  expect((await page.evaluate(() => window.frontier.getState())).saveBlocked).toBe(true);
  await page.screenshot({ path: 'test-results/corrupt-save.png' });
  await page.getByRole('button', { name: '归档旧存档并重置' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'test-results/reset-dialog.png' });
  await page.getByRole('button', { name: '归档并重置', exact: true }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.frontier.getState())).saveBlocked)
    .toBe(false);
  await app.close();
});
test.afterEach(async () => {
  if (app) await app.close().catch(() => {});
});

test('tactical encounter: scanning, targeting, phaser fire, warning and focus pause', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'frontier-tactical-'));
  const engine = new SimulationEngine();
  engine.dispatchCommand({ type: 'dispatch', shipId: 'vigil', missionId: 'k7', route: 'safe' });
  engine.state.paused = false;
  for (let i = 0; i < 5000 && engine.state.missions[4].phase === 'outbound'; i++) engine.step();
  expect(engine.state.missions[4].phase).toBe('working');
  // The new base approaches K-7 from the north. Aim at the spawned target for this firing fixture.
  const patrol = engine.state.ships[2],
    target = engine.state.contacts[0];
  patrol.heading = Math.atan2(target.y - patrol.y, target.x - patrol.x);
  engine.state.paused = true;
  new SaveStore(userData).write(engine.state);
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: userData, FRONTIER_HEADLESS: '1' },
  });
  const page = await app.firstWindow();
  await page.locator('.fleet-chip.vigil').click();
  await page.getByRole('button', { name: '直接操舰', exact: true }).click();
  await page.getByRole('button', { name: '扫描接触', exact: true }).click();
  await page.locator('.contact-row>button').first().click();
  await page.getByRole('button', { name: '继续模拟' }).click();
  await page.getByRole('button', { name: 'SPACE / 发射相位武器', exact: true }).click();
  await expect
    .poll(
      async () => (await page.evaluate(() => window.frontier.getState())).state.contacts[0].shield,
    )
    .toBeLessThan(65);
  await page.screenshot({ path: 'test-results/tactical-contact.png' });
  await page.getByRole('button', { name: '警告驱离', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.frontier.getState())).state.contacts[0].retreating,
    )
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('blur'));
  await expect(page.getByRole('button', { name: '继续模拟' })).toBeVisible();
  const state = (await page.evaluate(() => window.frontier.getState())).state;
  expect(state.paused).toBe(true);
  expect(state.ships[2].helm).toEqual({ turn: 0, throttle: 0 });
  await app.close();
});

test('legacy manual save migrates, navigation keeps selection and v3 restarts paused', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'frontier-v1-e2e-'));
  const legacy = readFileSync('tests/fixtures/lv1/manual.json', 'utf8');
  const legacyPath = join(userData, 'world-v1.json');
  writeFileSync(legacyPath, legacy);
  const launch = () =>
    electron.launch({
      args: [resolve('.')],
      env: { ...process.env, FRONTIER_USER_DATA: userData, FRONTIER_HEADLESS: '1' },
    });
  app = await launch();
  let page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: '直接操舰', exact: true })).toBeVisible();
  const loaded = (await page.evaluate(() => window.frontier.getState())).state;
  expect(loaded.version).toBe(3);
  expect(loaded.paused).toBe(true);
  expect(loaded.time).toBe(30);
  expect(loaded.ships[0].helm).toEqual({ turn: 0, throttle: 0 });
  expect(loaded.ships[0].missionId).toBe('amber');
  await page.getByRole('button', { name: '释放 · 恢复任务' }).click();
  await page.locator('.fleet-chip.meridian').click();
  await page.getByRole('button', { name: '02 任务中心 OPERATIONS' }).click();
  await page.getByRole('button', { name: '补给', exact: true }).click();
  await expect(page.locator('.mission-card')).toHaveCount(2);
  await page.locator('.mission-card').filter({ hasText: '信标前哨' }).click();
  await expect(page.locator('#assign-ship')).toHaveValue('meridian');
  await page.getByRole('button', { name: '03 舰队管理 STARBASE' }).click();
  await expect(page.locator('.ship-name')).toHaveText('USS MERIDIAN');
  await page.getByRole('button', { name: '02 任务中心 OPERATIONS' }).click();
  await expect(page.locator('.mission-card')).toHaveCount(2);
  await expect(page.locator('.filter-row .selected')).toHaveText('补给');
  await page.getByRole('button', { name: '04 行动日志 RECORDS' }).click();
  await expect(page.locator('.full-logs')).toBeVisible();
  await page.getByRole('button', { name: '06 系统 SYSTEM / SAVE' }).click();
  await page.getByRole('button', { name: '立即保存' }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  const saved = (await page.evaluate(() => window.frontier.getState())).state;
  await app.close();
  expect(readFileSync(legacyPath, 'utf8')).toBe(legacy);
  expect(existsSync(join(userData, 'world-v3.json'))).toBe(true);
  app = await launch();
  page = await app.firstWindow();
  await expect(page.locator('.fleet-chip')).toHaveCount(3);
  const restored = (await page.evaluate(() => window.frontier.getState())).state;
  expect(restored.paused).toBe(true);
  expect(restored.time).toBe(saved.time);
  expect(restored.ships).toEqual(saved.ships);
  expect(restored.resources).toEqual(saved.resources);
  expect(readFileSync(legacyPath, 'utf8')).toBe(legacy);
});

test('strategic clock crosses midnight, pauses critically, supports map selection and persists', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'frontier-clock-e2e-'));
  const engine = new SimulationEngine();
  engine.dispatchCommand({ type: 'dispatch', shipId: 'verity', missionId: 'amber', route: 'safe' });
  const location = engine.state.locations.find((l) => l.id === 'anomaly1')!;
  Object.assign(engine.state.ships[0], { x: location.x, y: location.y, path: [] });
  engine.state.tick = 14399;
  engine.state.time = 1439.9;
  engine.state.nextIncursion = 1e9;
  new SaveStore(userData).write(engine.state);
  const launch = () =>
    electron.launch({
      args: [resolve('.')],
      env: { ...process.env, FRONTIER_USER_DATA: userData, FRONTIER_HEADLESS: '1' },
    });
  app = await launch();
  let page = await app.firstWindow();
  await expect(page.locator('.mission-clock b')).toHaveText('Day 1 23:59');
  for (const speed of [4, 1, 16]) {
    await page.getByRole('button', { name: speed + '×', exact: true }).click();
    const state = (await page.evaluate(() => window.frontier.getState())).state;
    expect(state.speed).toBe(speed);
    expect(state.paused).toBe(true);
    expect(state.tick).toBe(14399);
  }
  await page.getByRole('button', { name: '继续模拟' }).click();
  await expect(page.getByRole('alert', { name: '自动暂停原因' })).toContainText('等待调查决策');
  await expect(page.locator('.mission-clock b')).toHaveText('Day 2 00:00');
  let state = (await page.evaluate(() => window.frontier.getState())).state;
  expect(state.tick).toBe(14400);
  expect(state.paused).toBe(true);
  expect(state.speed).toBe(16);
  // Verify the expanded-map coordinate transform selects a ship at its saved world position.
  const meridian = state.ships.find((s) => s.id === 'meridian')!;
  const canvas = page.locator('.tactical-canvas');
  const bounds = (await canvas.boundingBox())!;
  await canvas.click({
    position: { x: (meridian.x / 1600) * bounds.width, y: (meridian.y / 800) * bounds.height },
  });
  await expect(page.locator('.ship-name')).toHaveText('USS MERIDIAN');
  await page.locator('.fleet-chip.verity').click();
  await page.getByRole('button', { name: '远距调查 · 安全' }).click();
  state = (await page.evaluate(() => window.frontier.getState())).state;
  expect(state.paused).toBe(true);
  expect(state.tick).toBe(14400);
  await page.screenshot({ path: 'test-results/strategic-clock-pause.png' });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.locator('.mission-clock b')).toHaveText('Day 2 00:00');
  await expect(page.getByRole('alert', { name: '自动暂停原因' })).toBeVisible();
  state = (await page.evaluate(() => window.frontier.getState())).state;
  expect(state.tick).toBe(14400);
  expect(state.paused).toBe(true);
  expect(state.speed).toBe(16);
  await page.getByRole('button', { name: '继续模拟' }).click();
  await expect(page.getByRole('alert', { name: '自动暂停原因' })).toHaveCount(0);
  await expect
    .poll(async () => (await page.evaluate(() => window.frontier.getState())).state.tick)
    .toBeGreaterThan(14400);
  await app.close();
});
