import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine } from '../helpers';
import { applyDamage } from '../../src/engine/combat';

let app: ElectronApplication | undefined;
const directories: string[] = [];
const temp = () => {
  const path = mkdtempSync(join(tmpdir(), 'frontier-save-ui-'));
  directories.push(path);
  return path;
};
async function launch(directory: string) {
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const page = await app.firstWindow();
  await page.getByRole('navigation', { name: '主导航' }).waitFor();
  return page;
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
const state = async (page: Page) => (await page.evaluate(() => window.frontier.getState())).state;
const catalog = (page: Page) => page.evaluate(() => window.frontier.listSaves());
const manager = (page: Page) => page.getByRole('dialog', { name: 'ARCHIVE 工作面板' });
async function open(page: Page) {
  const menu = page.getByRole('button', { name: 'MENU 导航', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /ARCHIVE.*存档/ })
    .click();
  await expect(manager(page)).toBeVisible();
}
async function create(page: Page, name: string, copy = false) {
  await manager(page)
    .getByRole('button', { name: copy ? '复制当前进度' : '新建存档', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: '存档编辑' });
  await form.getByLabel('存档名称').fill(name);
  await form.getByRole('button', { name: '创建并进入', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(manager(page)).not.toBeVisible();
  return (await catalog(page)).activeId!;
}

test('complete UI lifecycle: rename, pause, new world, copy progress, load, cancel/delete and restart', async () => {
  const dir = temp(),
    store = new SaveStore(dir);
  store.write(quietEngine().state);
  let page = await launch(dir);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const source = (await catalog(page)).activeId!;
  await open(page);
  await manager(page).getByRole('button', { name: '重命名', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '存档编辑' });
  await edit.getByLabel('存档名称').fill('  第一边疆  ');
  await edit.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(manager(page).getByRole('heading', { name: '第一边疆' })).toBeVisible();
  await expect(manager(page).getByRole('button', { name: '删除存档', exact: true })).toBeDisabled();
  await manager(page).getByRole('button', { name: '关闭管理面板' }).click();
  expect((await state(page)).paused).toBe(true);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(2);
  await open(page);
  const progress = await state(page);
  expect(progress.paused).toBe(true);
  const rejected = await page.evaluate(() =>
    window.frontier.command({ type: 'pause', paused: false }),
  );
  expect(rejected.ok).toBe(false);
  await page.waitForTimeout(250);
  expect((await state(page)).tick).toBe(progress.tick);
  const fresh = await create(page, '第二边疆');
  expect((await state(page)).tick).toBe(0);
  expect((await state(page)).paused).toBe(true);
  await open(page);
  await manager(page).locator(`[data-save-id="${source}"]`).click();
  await manager(page).getByRole('button', { name: '开始 / 加载', exact: true }).click();
  await expect(manager(page)).not.toBeVisible();
  expect((await state(page)).tick).toBe(progress.tick);
  await open(page);
  const copy = await create(page, '第一边疆 副本', true);
  const copied = await state(page);
  expect(copied.tick).toBe(progress.tick);
  expect(copied.ships).toEqual(progress.ships);
  expect(copied.history).toEqual(progress.history);
  expect(copy).not.toBe(source);
  await open(page);
  await manager(page).locator(`[data-save-id="${fresh}"]`).click();
  await manager(page).getByRole('button', { name: '删除存档', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除存档确认' });
  await expect(confirmation.getByRole('heading', { name: '第二边疆' })).toBeVisible();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  expect((await catalog(page)).saves).toHaveLength(3);
  await manager(page).getByRole('button', { name: '删除存档', exact: true }).click();
  await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(manager(page).locator(`[data-save-id="${fresh}"]`)).toHaveCount(0);
  expect((await catalog(page)).saves).toHaveLength(2);
  await page.screenshot({ path: 'test-results/save-manager-wide.png', animations: 'disabled' });
  expect(errors).toEqual([]);
  await app!.close();
  app = undefined;
  page = await launch(dir);
  expect((await catalog(page)).activeId).toBe(copy);
  expect((await state(page)).ships).toEqual(copied.ships);
  expect((await state(page)).tick).toBe(copied.tick);
  await expect(manager(page)).not.toBeVisible();
});

test('unreadable active save opens manager, reports all unavailable entries and loads a valid save without overwriting protected bytes', async () => {
  const dir = temp(),
    store = new SaveStore(dir);
  store.write(quietEngine().state);
  const good = store.catalog().activeId!;
  store.beginNew(quietEngine().state, undefined, '未来版本');
  const futurePath = store.path;
  writeFileSync(futurePath, JSON.stringify({ version: 99 }));
  store.beginNew(quietEngine().state, undefined, '损坏存档');
  const corruptPath = store.path;
  writeFileSync(corruptPath, 'protected broken bytes');
  const corruptFailure = join(store.root, store.catalog().activeId!, 'failure.json');
  writeFileSync(corruptFailure, 'protected private world data');
  const page = await launch(dir);
  await expect(manager(page)).toBeVisible();
  const unreadableId = (await catalog(page)).activeId!;
  const failedLoad = await page.evaluate(
    (id) => window.frontier.saveAction({ type: 'load', id }),
    unreadableId,
  );
  expect(failedLoad.ok).toBe(false);
  expect(failedLoad.reason).not.toContain('protected');
  expect(failedLoad.reason).not.toContain(dir);
  await expect(
    manager(page).getByText('存档版本不支持，已保护原文件', { exact: true }),
  ).toBeVisible();
  await expect(manager(page).getByRole('button', { name: '返回当前存档' })).toBeDisabled();
  await manager(page).locator(`[data-save-id="${good}"]`).click();
  await manager(page).getByRole('button', { name: '开始 / 加载', exact: true }).click();
  await expect(manager(page)).not.toBeVisible();
  expect((await catalog(page)).activeId).toBe(good);
  expect(readFileSync(corruptPath, 'utf8')).toBe('protected broken bytes');
  expect(readFileSync(corruptFailure, 'utf8')).toBe('protected private world data');
  expect(readFileSync(futurePath, 'utf8')).toBe(JSON.stringify({ version: 99 }));
});

test('failed creation retains the editable name and current world; IPC validates IDs and protects active deletion', async () => {
  const dir = temp(),
    store = new SaveStore(dir);
  store.write(quietEngine().state);
  const page = await launch(dir);
  const before = await state(page),
    id = (await catalog(page)).activeId!;
  await open(page);
  mkdirSync(store.indexPath + '.tmp');
  await manager(page).getByRole('button', { name: '新建存档', exact: true }).click();
  const form = page.getByRole('dialog', { name: '存档编辑' });
  await form.getByLabel('存档名称').fill('重试保留的名称');
  await form.getByRole('button', { name: '创建并进入', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  expect(await form.getByRole('alert').textContent()).not.toContain(dir);
  await expect(form.getByLabel('存档名称')).toHaveValue('重试保留的名称');
  expect((await catalog(page)).activeId).toBe(id);
  expect((await state(page)).ships).toEqual(before.ships);
  const validation = await page.evaluate(
    async (currentId) => [
      await window.frontier.saveAction({ type: 'delete', id: currentId }),
      await window.frontier.saveAction({ type: 'load', id: '../outside' }),
      await window.frontier.saveAction({ type: 'rename', id: currentId, name: '  ' }),
    ],
    id,
  );
  expect(validation.every((r) => !r.ok)).toBe(true);
  rmSync(store.indexPath + '.tmp', { recursive: true });
  await form.getByRole('button', { name: '创建并进入', exact: true }).click();
  await expect(form).not.toBeVisible();
  expect((await catalog(page)).saves.some((s) => s.name === '重试保留的名称')).toBe(true);
});

test('failed worlds enter the same manager and remain failed when copied', async () => {
  const dir = temp(),
    engine = quietEngine();
  applyDamage(engine, engine.base, 10000);
  engine.finishCritical();
  new SaveStore(dir).write(engine.state);
  const page = await launch(dir);
  await page.getByRole('button', { name: 'SAVE MANAGER / 存档管理', exact: true }).click();
  await expect(manager(page)).toBeVisible();
  await create(page, '封存副本', true);
  await expect(page.getByRole('dialog', { name: 'COMMAND LOST' })).toBeVisible();
  expect((await state(page)).status).toBe('commandLost');
  await page.getByRole('button', { name: 'BEGIN NEW FRONTIER', exact: true }).click();
  const form = page.getByRole('dialog', { name: '存档编辑' });
  await expect(form).toBeVisible();
  await form.getByLabel('存档名称').fill('恢复指挥');
  await form.getByRole('button', { name: '创建并进入', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'COMMAND LOST' })).not.toBeVisible();
  expect((await state(page)).status).toBe('active');
});

test('LCARS manager handles many saves, long names, a small window, large text and keyboard editing', async () => {
  const dir = temp(),
    store = new SaveStore(dir);
  for (let i = 0; i < 12; i++)
    store.beginNew(quietEngine().state, undefined, `${i}号边疆` + '长名称'.repeat(10));
  const page = await launch(dir);
  await app!.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(960, 540);
  });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(960);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '27px';
    window.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-console-layout', 'compact');
  await open(page);
  await expect(manager(page).locator('[data-save-id]')).toHaveCount(12);
  const first = manager(page).locator('[data-save-id]').first();
  await first.click();
  const rename = manager(page).getByRole('button', { name: '重命名', exact: true });
  await rename.scrollIntoViewIfNeeded();
  await rename.click();
  const form = page.getByRole('dialog', { name: '存档编辑' });
  await form.getByLabel('存档名称').fill('键盘确认名称');
  await page.keyboard.press('Enter');
  await expect(form).not.toBeVisible();
  await expect(manager(page).getByRole('heading', { name: '键盘确认名称' })).toBeVisible();
  const overflow = await manager(page).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({
    path: 'test-results/save-manager-small-large-text.png',
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(manager(page)).not.toBeVisible();
  expect((await state(page)).paused).toBe(true);
});
