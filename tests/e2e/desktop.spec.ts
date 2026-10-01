import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { makeEnemy } from '../../src/engine/data';
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
  const directory = mkdtempSync(join(tmpdir(), 'frontier-e2e-v5-'));
  const engine = quietEngine();
  new SaveStore(directory).write(engine.state);
  let page = await launch(directory);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.context().setOffline(true);
  await create(page, 'transport', 'Antares Transport', 'colony');
  await create(page, 'defense', 'Peregrine Patrol Craft', 'colony');
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
  await page.screenshot({ animations: 'disabled', path: 'test-results/v5-complete.png' });
  expect(errors).toEqual([]);
  await app!.close();
  app = undefined;
  page = await launch(directory);
  const restored = (await page.evaluate(() => window.frontier.getState())).state;
  expect(restored.time).toBe(saved.time);
  expect(restored.orders).toEqual(saved.orders);
  expect(restored.paused).toBe(true);
});
test('pending decision, action editing and invalid orders show engine feedback', async () => {
  const e = quietEngine();
  e.dispatchCommand({ type: 'createOrder', spec: spec('explore') });
  until(e, () => e.state.orders[0].phase === 'decision');
  const directory = mkdtempSync(join(tmpdir(), 'frontier-decision-v5-'));
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
  await createDialog.getByLabel('分配 Peregrine Patrol Craft', { exact: true }).check();
  await createDialog.getByLabel('货物数量').fill('60');
  await createDialog.getByRole('button', { name: '授权派遣', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('货舱容量不足');
  await expect(createDialog).toBeVisible();
  expect((await page.evaluate(() => window.frontier.getState())).state.orders).toHaveLength(1);
});

test('LCARS map boundaries, pointer zoom, resize and overlay geometry at both required sizes', async () => {
  test.setTimeout(180000);
  const page = await launch(mkdtempSync(join(tmpdir(), 'frontier-map-v5-')));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const map = page.locator('.strategic-map');
  const camera = async () =>
    JSON.parse((await map.getAttribute('data-view'))!) as {
      x: number;
      y: number;
      k: number;
      width: number;
      height: number;
    };
  const bounded = async () => {
    const c = await camera();
    expect(c.k).toBeGreaterThanOrEqual(1);
    expect(c.k).toBeLessThanOrEqual(8);
    expect(c.x).toBeLessThanOrEqual(0.01);
    expect(c.y).toBeLessThanOrEqual(0.01);
    expect(c.x + c.width * c.k).toBeGreaterThanOrEqual(c.width - 0.01);
    expect(c.y + c.height * c.k).toBeGreaterThanOrEqual(c.height - 0.01);
  };
  for (const [width, height] of [
    [1920, 1080],
    [1600, 900],
  ]) {
    await app!.evaluate(
      ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height),
      { width, height },
    );
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    await page.getByRole('button', { name: 'FIT', exact: true }).click();
    await expect.poll(async () => (await camera()).k).toBe(1);
    await expect
      .poll(async () => (await camera()).width)
      .toBeCloseTo((await map.boundingBox())!.width, 0);
    const original = await map.boundingBox();
    await page.screenshot({ animations: 'disabled', path: `test-results/v5-sector-${width}.png` });
    for (const nav of ['OPERATIONS', 'PERSONNEL', 'STARBASE', 'COLONIES', 'ARCHIVE']) {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: new RegExp(nav) })
        .click();
      await expect(page.getByRole('dialog', { name: nav + ' 工作面板' })).toBeVisible();
      expect(await map.boundingBox()).toEqual(original);
      await page.screenshot({
        animations: 'disabled',
        path: `test-results/v5-${nav.toLowerCase()}-${width}.png`,
      });
      await page.getByRole('button', { name: '关闭管理面板' }).click();
    }
    const b = (await map.boundingBox())!,
      px = b.width * 0.43,
      py = b.height * 0.58;
    await page.mouse.move(b.x + px, b.y + py);
    await page.mouse.wheel(0, -650);
    await expect.poll(async () => (await camera()).k).toBeGreaterThan(2);
    await page.waitForTimeout(600);
    const z = await camera();
    expect((px - z.x) / z.k).toBeCloseTo(px, 0);
    expect((py - z.y) / z.k).toBeCloseTo(py, 0);
    await page.mouse.wheel(0, -10000);
    await expect.poll(async () => (await camera()).k).toBe(8);
    for (const [dx, dy] of [
      [-20000, 0],
      [20000, 0],
      [0, -20000],
      [0, 20000],
    ]) {
      await page.mouse.move(b.x + 4, b.y + 4);
      await page.mouse.down();
      await page.mouse.move(b.x + 4 + dx, b.y + 4 + dy, { steps: 4 });
      await page.mouse.up();
      await bounded();
      const edge = await camera();
      if (dx) expect(edge.x).toBeCloseTo(dx < 0 ? edge.width * (1 - edge.k) : 0, 3);
      if (dy) expect(edge.y).toBeCloseTo(dy < 0 ? edge.height * (1 - edge.k) : 0, 3);
    }
    await page.getByRole('button', { name: 'FIT', exact: true }).click();
    await bounded();
    await expect(page.getByRole('button', { name: '缩小地图' })).toBeDisabled();
    await page.getByRole('button', { name: '曙光基地', exact: true }).click();
    await expect(page.locator('.inspector h2')).toHaveText('曙光基地');
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /OPERATIONS/ })
      .click();
    await page.getByRole('button', { name: '新建战斗／防御', exact: true }).click();
    await page.screenshot({
      animations: 'disabled',
      path: `test-results/v5-composer-${width}.png`,
    });
    const form = page.getByRole('dialog', { name: '创建行动' });
    await form.getByLabel('分配 Peregrine Patrol Craft', { exact: true }).check();
    await form.getByRole('button', { name: '授权派遣', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: 'disabled',
      path: `test-results/v5-composer-controls-${width}.png`,
    });
    await page
      .getByRole('dialog', { name: '创建行动' })
      .getByRole('button', { name: /关闭/ })
      .click();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
  }
  await page.getByRole('button', { name: '放大地图' }).click();
  await page.waitForTimeout(600);
  const c = await camera(),
    center = {
      x: (c.width / 2 - c.x) / (c.width * c.k),
      y: (c.height / 2 - c.y) / (c.height * c.k),
    };
  await app!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080),
  );
  await expect.poll(async () => (await camera()).width).toBeGreaterThan(c.width);
  const r = await camera();
  expect((r.width / 2 - r.x) / (r.width * r.k)).toBeCloseTo(center.x, 5);
  expect((r.height / 2 - r.y) / (r.height * r.k)).toBeCloseTo(center.y, 5);
  await bounded();
  expect(errors).toEqual([]);
});

test('real hostile fire destroys a vessel; Archive and restart never resurrect it', async () => {
  const e = quietEngine();
  e.dispatchCommand({ type: 'createOrder', spec: spec('transport') });
  until(e, () => e.state.ships[0].cargo.supplies > 0);
  const s = e.state.ships[0];
  Object.assign(s, { x: 250, y: 650, hull: 1, shield: 0 });
  s.path = [];
  e.state.ships
    .filter((x) => x !== s)
    .forEach((x) => {
      x.x = 1400;
      x.y = 50;
    });
  e.state.enemies = [makeEnemy('pirate-loss', 'raider', 'pirate', { x: 270, y: 650 })];
  e.state.seed = 1;
  e.state.paused = true;
  const dir = mkdtempSync(join(tmpdir(), 'frontier-loss-v5-'));
  new SaveStore(dir).write(e.state);
  let page = await launch(dir);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.frontier.getState())).state.losses.length)
    .toBe(1);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /ARCHIVE/ })
    .click();
  await expect(page.locator('.loss-row')).toContainText('子午号');
  await page.screenshot({ animations: 'disabled', path: 'test-results/v5-vessel-loss.png' });
  await page.getByRole('button', { name: '立即保存' }).click();
  await page.locator('.loss-row').click();
  await expect(page.locator('.inspector')).toContainText('PERMANENT LOSS');
  await page.screenshot({ animations: 'disabled', path: 'test-results/lcars-inspector-loss.png' });
  await app!.close();
  app = undefined;
  page = await launch(dir);
  const w = (await page.evaluate(() => window.frontier.getState())).state;
  expect(w.ships.some((s) => s.id === 'meridian')).toBe(false);
  expect(w.losses[0].shipId).toBe('meridian');
  expect(w.orders[0].outcome).toBe('failed');
});

test('COMMAND LOST freezes real Electron, restores yesterday into a new branch, preserves failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-terminal-v5-')),
    store = new SaveStore(dir),
    e = quietEngine();
  store.write(e.state);
  e.state.tick = 14400;
  e.state.time = 1440;
  store.daily(e.state);
  e.state.tick = 28810;
  e.state.time = 2881;
  e.state.ships.forEach((s) => {
    s.x = 100;
    s.y = 100;
  });
  e.base.hull = 1;
  e.base.shield = 0;
  e.state.seed = 1;
  e.state.enemies = [
    makeEnemy('pirate-terminal', 'raider', 'pirate', { x: e.base.x + 30, y: e.base.y }),
  ];
  store.write(e.state);
  let page = await launch(dir);
  await page.evaluate(() => {
    const w = window as unknown as Window & { terminalCue: boolean };
    w.terminalCue = false;
    window.addEventListener('lcars:cue', (event) => {
      if ((event as CustomEvent<{ cue: string }>).detail.cue === 'terminal') w.terminalCue = true;
    });
  });
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'COMMAND LOST', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as Window & { terminalCue: boolean }).terminalCue),
    )
    .toBe(true);
  const terminal = (await page.evaluate(() => window.frontier.getState())).state;
  expect(
    (await page.evaluate(() => window.frontier.command({ type: 'pause', paused: false }))).ok,
  ).toBe(false);
  await page.waitForTimeout(500);
  expect((await page.evaluate(() => window.frontier.getState())).state.tick).toBe(terminal.tick);
  for (const [width, height] of [
    [1920, 1080],
    [1600, 900],
  ]) {
    await app!.evaluate(
      ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height),
      { width, height },
    );
    await page.waitForTimeout(100);
    await page.screenshot({
      animations: 'disabled',
      path: `test-results/v5-command-lost-${width}.png`,
    });
  }
  const failurePath = join(dir, 'frontiers-v5', 'frontier-000001', 'failure.json'),
    failure = readFileSync(failurePath, 'utf8');
  await app!.close();
  app = undefined;
  page = await launch(dir);
  await expect(page.getByRole('dialog', { name: 'COMMAND LOST', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'RESTORE PREVIOUS DAY', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'COMMAND LOST', exact: true })).not.toBeVisible();
  const restored = await page.evaluate(() => window.frontier.getState());
  expect(restored.state.tick).toBe(14400);
  expect(restored.state.status).toBe('active');
  expect(restored.timeline.activeId).toBe('frontier-000002');
  expect(readFileSync(failurePath, 'utf8')).toBe(failure);
});

test('16x midnight writes exact independent daily snapshot in Electron', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-midnight-v5-')),
    store = new SaveStore(dir),
    e = quietEngine();
  store.write(e.state);
  e.state.tick = 14399;
  e.state.time = 1439.9;
  store.write(e.state);
  const page = await launch(dir);
  await page.getByRole('button', { name: '16×', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const path = join(dir, 'frontiers-v5', 'frontier-000001', 'day-2.json');
  await expect.poll(() => existsSync(path)).toBe(true);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  expect(JSON.parse(readFileSync(path, 'utf8')).tick).toBe(14400);
  expect(
    JSON.parse(readFileSync(join(dir, 'frontiers-v5', 'frontier-000001', 'day-1.json'), 'utf8'))
      .tick,
  ).toBe(0);
});

test('explicit ammunition loading uses stock and rejects unavailable rounds through the LCARS inspector', async () => {
  const e = quietEngine(),
    s = e.state.ships.find((s) => s.id === 'horizon')!;
  s.photon = 0;
  s.quantum = 0;
  e.state.armory.stock = { photon: 3, quantum: 1 };
  const dir = mkdtempSync(join(tmpdir(), 'frontier-armory-v5-'));
  new SaveStore(dir).write(e.state);
  const page = await launch(dir);
  await page.getByRole('button', { name: s.name, exact: true }).click();
  await page.getByLabel('装弹 photon').fill('4');
  await page.getByLabel('装弹 quantum').fill('0');
  await page.getByRole('button', { name: '授权装弹' }).click();
  await expect(page.getByRole('status')).toContainText('弹药库存或弹舱余量不足');
  await page.getByLabel('装弹 photon').fill('3');
  await page.getByLabel('装弹 quantum').fill('1');
  await page.getByRole('button', { name: '授权装弹' }).click();
  let w = (await page.evaluate(() => window.frontier.getState())).state;
  expect(w.armory.reserved).toEqual({ photon: 3, quantum: 1 });
  expect(w.ships.find((s) => s.id === 'horizon')!.photon).toBe(0);
  await page.screenshot({ animations: 'disabled', path: 'test-results/v5-armory-loading.png' });
  await page.getByRole('button', { name: '16×', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.frontier.getState())).state.ships.find(
          (s) => s.id === 'horizon',
        )!.status,
    )
    .toBe('docked');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  w = (await page.evaluate(() => window.frontier.getState())).state;
  expect(w.armory.stock).toEqual({ photon: 0, quantum: 0 });
  expect(w.armory.reserved).toEqual({ photon: 0, quantum: 0 });
  expect(w.ships.find((s) => s.id === 'horizon')).toMatchObject({ photon: 3, quantum: 1 });
});

test('Scout intelligence changes a distant Warbird decision in the actual Electron simulation', async () => {
  for (const defended of [false, true]) {
    const e = quietEngine();
    e.state.ships.forEach((s) => {
      s.x = 100;
      s.y = 100;
    });
    const cargo = e.state.ships[0];
    Object.assign(cargo, { x: 1120, y: 600 });
    cargo.cargo.supplies = 80;
    if (defended) {
      for (const id of ['horizon', 'verity'])
        Object.assign(e.state.ships.find((s) => s.id === id)!, { x: 1130, y: 605 });
    }
    const bird = makeEnemy('intelligence-bird', 'valdore', 'romulan', { x: 1530, y: 600 }),
      scout = makeEnemy('intelligence-scout', 'scout', 'romulan', { x: 1160, y: 600 });
    e.state.enemies = [bird, scout];
    const dir = mkdtempSync(join(tmpdir(), 'frontier-scout-v5-'));
    new SaveStore(dir).write(e.state);
    const page = await launch(dir);
    await page.getByRole('button', { name: '16×', exact: true }).click();
    await page.getByRole('button', { name: '继续', exact: true }).click();
    await expect
      .poll(
        async () => {
          const w = (await page.evaluate(() => window.frontier.getState())).state;
          if (w.paused && w.time < 6)
            await page.getByRole('button', { name: '继续', exact: true }).click();
          return w.time;
        },
        { timeout: 15000 },
      )
      .toBeGreaterThanOrEqual(6);
    const view = await page.evaluate(() => window.frontier.getState());
    if (!view.state.paused) await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.evaluate(() => window.frontier.save());
    const truth = new SaveStore(dir).read().world!;
    expect(
      truth.romulanReports.some(
        (r) => r.id === 'meridian' && r.observerId === 'intelligence-scout',
      ),
    ).toBe(true);
    expect(truth.enemies.find((s) => s.id === 'intelligence-bird')!.intent).toBe(
      defended ? 'observe' : 'probe',
    );
    expect(view.state).not.toHaveProperty('romulanReports');
    expect(view.state).not.toHaveProperty('enemies');
    await app!.close();
    app = undefined;
  }
});

test('failed defense and energy-starved recon report real failure in Electron', async () => {
  for (const kind of ['defense', 'explore'] as const) {
    const e = quietEngine();
    e.dispatchCommand({ type: 'createOrder', spec: spec(kind) });
    if (kind === 'explore') {
      until(e, () => e.state.orders[0].phase === 'decision');
      e.state.ships.find((s) => s.id === 'verity')!.core = 0;
    } else {
      const colony = e.state.locations.find((l) => l.id === 'colony')!;
      colony.hull = 1;
      colony.shield = 0;
      e.state.enemies = [
        makeEnemy('defense-failure', 'raider', 'pirate', { x: colony.x + 25, y: colony.y }),
      ];
      e.state.seed = 1;
    }
    e.state.paused = true;
    const dir = mkdtempSync(join(tmpdir(), 'frontier-failed-operation-'));
    new SaveStore(dir).write(e.state);
    const page = await launch(dir);
    await page.locator('.operation-chip').click();
    if (kind === 'explore')
      await page.getByRole('button', { name: '远距扫描 · 保守', exact: true }).click();
    await page.getByRole('button', { name: '继续', exact: true }).click();
    await expect
      .poll(
        async () => (await page.evaluate(() => window.frontier.getState())).state.orders[0].outcome,
      )
      .toBe('failed');
    await expect(page.locator('.result-box')).toContainText(
      kind === 'explore' ? '调查能源不足' : '设施已摧毁',
    );
    await app!.close();
    app = undefined;
  }
});

test('Day 1 has no restore; BEGIN NEW FRONTIER keeps terminal files and legacy saves', async () => {
  const e = quietEngine(),
    dir = mkdtempSync(join(tmpdir(), 'frontier-new-v5-')),
    store = new SaveStore(dir);
  store.write(e.state);
  e.state.ships.forEach((s) => {
    s.x = 100;
    s.y = 100;
  });
  e.base.hull = 1;
  e.base.shield = 0;
  e.state.seed = 1;
  e.state.enemies = [
    makeEnemy('day-one-loss', 'raider', 'pirate', { x: e.base.x + 30, y: e.base.y }),
  ];
  store.write(e.state);
  writeFileSync(join(dir, 'world-v4.json'), 'legacy untouched');
  const page = await launch(dir);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'COMMAND LOST', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'RESTORE PREVIOUS DAY' })).toBeDisabled();
  await page.screenshot({ animations: 'disabled', path: 'test-results/v5-day-one-lost.png' });
  const path = join(dir, 'frontiers-v5', 'frontier-000001', 'failure.json'),
    bytes = readFileSync(path, 'utf8');
  await page.getByRole('button', { name: 'BEGIN NEW FRONTIER', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '新世界确认' })).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/v5-new-frontier-confirm.png',
  });
  await page.getByRole('button', { name: '保留记录并创建新世界' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const next = await page.evaluate(() => window.frontier.getState());
  expect(next.state.tick).toBe(0);
  expect(next.timeline.branches).toHaveLength(2);
  expect(readFileSync(path, 'utf8')).toBe(bytes);
  expect(readFileSync(join(dir, 'world-v4.json'), 'utf8')).toBe('legacy untouched');
});
