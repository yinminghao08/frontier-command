import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine, spec, until } from '../helpers';
let app: ElectronApplication | undefined;
const key = 'frontier.lcars.console.v1';
async function launch(directory: string, scale = 1) {
  app = await electron.launch({
    args: ['--force-device-scale-factor=' + scale, resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const page = await app.firstWindow();
  await page.getByRole('navigation', { name: '主导航' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});
async function size(page: Page, width: number, height: number) {
  await app!.evaluate(
    ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height),
    { width, height },
  );
  // Windows converts DIP to physical pixels and can round back by one CSS pixel.
  await expect
    .poll(() =>
      page.evaluate(
        (s) => Math.abs(innerWidth - s.width) <= 1 && Math.abs(innerHeight - s.height) <= 1,
        { width, height },
      ),
    )
    .toBe(true);
  await page.waitForTimeout(250);
}
async function screenshot(page: Page, name: string) {
  await page.waitForTimeout(220);
  await page.screenshot({ path: 'test-results/lcars-' + name + '.png', animations: 'disabled' });
}
test('Classic geometry at six display sizes, every management page, form and Inspector', async () => {
  test.setTimeout(120000);
  const directory = mkdtempSync(join(tmpdir(), 'lcars-geometry-'));
  const engine = quietEngine();
  engine.dispatchCommand({ type: 'createOrder', spec: spec('explore') });
  until(engine, () => engine.state.orders[0].phase === 'decision');
  engine.state.intel.push({
    id: 'recorded-contact',
    name: 'Recorded Raider',
    x: 1200,
    y: 400,
    level: 'TRACKED',
    strength: 1,
    lastSeen: engine.state.time,
    live: false,
    hostile: true,
    factionId: 'pirate',
    classId: 'raider',
    hull: 80,
    shield: 50,
    resolved: false,
  });
  new SaveStore(directory).write(engine.state);
  const page = await launch(directory),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [width, height] of [
    [1600, 900],
    [1920, 1080],
    [1920, 1200],
    [2560, 1440],
    [2560, 1600],
    [3840, 2160],
  ]) {
    await size(page, width, height);
    const map = await page.locator('.strategic-map').boundingBox();
    expect(map!.width).toBeGreaterThan(width * 0.58);
    expect(map!.height).toBeGreaterThan(height * 0.5);
    const overflow = await page.evaluate(() => {
      const selectors = [
        '.command-header',
        '.section-nav',
        '.map-container',
        '.inspector',
        '.operations-footer',
      ];
      return selectors.filter((selector) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return r.x < 0 || r.y < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
      });
    });
    expect(overflow).toEqual([]);
    await screenshot(page, 'console-' + width + 'x' + height);
  }
  await size(page, 1920, 1080);
  const box = await page.locator('.strategic-map').boundingBox();
  for (const nav of ['OPERATIONS', 'PERSONNEL', 'STARBASE', 'COLONIES', 'ARCHIVE']) {
    const trigger = page.getByRole('navigation').getByRole('button', { name: new RegExp(nav) });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: nav + ' 工作面板' })).toBeVisible();
    expect(await page.locator('.strategic-map').boundingBox()).toEqual(box);
    await screenshot(page, nav.toLowerCase());
    if (nav === 'PERSONNEL') {
      const assignment = page.getByLabel(/分配操作者/).first(),
        assigned = await assignment.inputValue();
      await assignment.selectOption('');
      await expect(assignment).toHaveValue('');
      await assignment.selectOption(assigned);
      await expect(assignment).toHaveValue(assigned);
    }
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  for (const kind of ['战斗／防御', '运输', '探索／侦察']) {
    await page.getByRole('button', { name: /02 OPERATIONS/ }).click();
    await page.getByRole('button', { name: '新建' + kind, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '创建行动' });
    await expect(dialog).toBeVisible();
    await screenshot(
      page,
      'form-' + (kind === '运输' ? 'transport' : kind === '战斗／防御' ? 'defense' : 'explore'),
    );
    const last = dialog.getByRole('checkbox').last();
    await last.focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: '关闭行动编辑' })).toBeFocused();
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '曙光基地', exact: true }).click();
  await screenshot(page, 'inspector-location');
  const shipName = (await page.evaluate(() => window.frontier.getState())).state.ships.find(
    (s) => s.id === 'vigil',
  )!.name;
  await page.getByRole('button', { name: shipName, exact: true }).click();
  await screenshot(page, 'inspector-ship');
  await page.getByRole('button', { name: 'Recorded Raider', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('观测 Hull');
  await screenshot(page, 'inspector-contact');
  await page.locator('.operation-chip').first().click();
  await expect(page.locator('.decision-box')).toBeVisible();
  await screenshot(page, 'inspector-decision');
  await page.getByRole('button', { name: 'FIT', exact: true }).click();
  const mapBox = (await page.locator('.strategic-map').boundingBox())!;
  await page.mouse.click(mapBox.x + mapBox.width * 0.92, mapBox.y + mapBox.height * 0.9);
  await expect(page.locator('.inspector h2')).toHaveText('未知区域');
  await screenshot(page, 'inspector-point');
  expect(errors).toEqual([]);
});
test('preferences persist, three motion modes, real audio and rapid feedback are bounded', async () => {
  test.setTimeout(90000);
  const directory = mkdtempSync(join(tmpdir(), 'lcars-preferences-'));
  let page = await launch(directory);
  await size(page, 1920, 1080);
  await screenshot(page, 'console-ready');
  await page.evaluate(() => {
    const w = window as unknown as Window & { cues: string[] };
    w.cues = [];
    window.addEventListener('lcars:cue', (e) =>
      w.cues.push((e as CustomEvent<{ cue: string }>).detail.cue),
    );
  });
  await page.getByRole('button', { name: 'Console Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '控制台设置' });
  await expect(settings.getByLabel('音量')).toHaveValue('25');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as Window & { cues: string[] }).cues.includes('navigation'),
      ),
    )
    .toBe(true);
  const animations = settings.getByRole('group', { name: 'ANIMATIONS', exact: true });
  for (const mode of ['OFF', 'REDUCED', 'ON']) {
    await animations.getByRole('button', { name: mode, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-motion', mode.toLowerCase());
    const cascade = await page
      .locator('.dc-row-1')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(cascade).toBe(mode === 'ON' ? 'data-group-1' : 'none');
  }
  await page.waitForTimeout(400);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as Window & { cues: string[] }).cues.includes('commit'),
      ),
    )
    .toBe(true);
  await settings.getByRole('button', { name: 'TEST SOUND', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as Window & { cues: string[] }).cues.includes('action'),
      ),
    )
    .toBe(true);
  await settings
    .getByRole('group', { name: 'SOUND', exact: true })
    .getByRole('button', { name: 'OFF', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-sound', 'off');
  const before = await page.evaluate(
    () => (window as unknown as Window & { cues: string[] }).cues.length,
  );
  await animations.getByRole('button', { name: 'OFF', exact: true }).click();
  await settings.getByLabel('音量').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
  await screenshot(page, 'settings');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '放大地图' }).click();
  expect(JSON.parse((await page.locator('.strategic-map').getAttribute('data-view'))!).k).toBe(1.4);
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => (window as unknown as Window & { cues: string[] }).cues.length),
  ).toBe(before);
  await page.getByRole('button', { name: 'Console Settings', exact: true }).click();
  await settings
    .getByRole('group', { name: 'SOUND', exact: true })
    .getByRole('button', { name: 'ON', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Console Settings', exact: true }).click();
  await page.getByRole('button', { name: /02 OPERATIONS/ }).click();
  await expect(settings).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'OPERATIONS 工作面板' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    (window as unknown as Window & { cues: string[] }).cues = [];
    const nav = document.querySelector<HTMLButtonElement>('nav button')!;
    for (let i = 0; i < 20; i++) nav.click();
  });
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => (window as unknown as Window & { cues: string[] }).cues.length),
  ).toBeLessThanOrEqual(1);
  await page.evaluate((k) => {
    const p = JSON.parse(localStorage.getItem(k)!);
    p.sound = false;
    localStorage.setItem(k, JSON.stringify(p));
  }, key);
  await app!.close();
  app = undefined;
  page = await launch(directory);
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  await expect(page.locator('html')).toHaveAttribute('data-sound', 'off');
  await page.getByRole('button', { name: 'Console Settings', exact: true }).click();
  await expect(page.getByLabel('音量')).toHaveValue('60');
});
for (const scale of [1.25, 1.5, 2])
  test('Windows display scaling ' + scale * 100 + '% and compact Inspector', async () => {
    const page = await launch(mkdtempSync(join(tmpdir(), 'lcars-scale-')), scale);
    await size(page, Math.round(1920 / scale), Math.round(1080 / scale));
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(scale);
    for (const nav of ['SECTOR', 'OPERATIONS', 'PERSONNEL', 'STARBASE', 'COLONIES', 'ARCHIVE'])
      await expect(
        page.getByRole('navigation').getByRole('button', { name: new RegExp(nav) }),
      ).toBeInViewport();
    await screenshot(page, 'scale-' + scale * 100);
    if (scale === 2) {
      await page.getByRole('button', { name: '打开 Inspector' }).click();
      await expect(page.locator('.inspector')).toBeVisible();
      await screenshot(page, 'compact-inspector');
      await page.keyboard.press('Escape');
      await expect(page.locator('.inspector')).not.toBeVisible();
      const colony = page
        .locator('.strategic-map')
        .getByRole('button', { name: '新曙殖民地', exact: true });
      await colony.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.inspector')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(colony).toBeFocused();
    }
    await page.getByRole('button', { name: /02 OPERATIONS/ }).click();
    await page.getByRole('button', { name: '新建运输', exact: true }).click();
    await screenshot(page, 'scale-' + scale * 100 + '-form');
    await expect(page.getByRole('button', { name: '关闭行动编辑' })).toBeInViewport();
  });
