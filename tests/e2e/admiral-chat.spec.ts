import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, cpSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine } from '../helpers';
import { makeEnemy } from '../../src/engine/data';
import { updateSensors } from '../../src/engine/sensors';
import type { Snapshot } from '../../src/engine/types';
let app: ElectronApplication | undefined;
const output = resolve('docs/verification/v12');
async function state(page: Page): Promise<Snapshot> {
  return (await page.evaluate(() => window.frontier.getState())).state;
}
async function launch(directory: string) {
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const page = await app.firstWindow();
  await page.getByTestId('chat-launcher').waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000),
  );
  await page.evaluate(() => document.fonts.ready);
  return page;
}
async function send(page: Page, channelId: string, text: string) {
  const chat = page.getByRole('dialog', { name: '舰队通讯' });
  if (!(await chat.isVisible())) await page.getByTestId('chat-launcher').click();
  await chat.locator(`[data-channel-id="${channelId}"]`).click();
  await chat.getByLabel('通讯消息').fill(text);
  await chat.getByRole('button', { name: 'SEND / 发送' }).click();
}
async function wait(page: Page, predicate: (s: Snapshot) => boolean, timeout = 60000) {
  await expect
    .poll(
      async () => {
        const world = await state(page);
        if (world.paused)
          await page.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
        return predicate(world);
      },
      { timeout, intervals: [100] },
    )
    .toBe(true);
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});

test('Electron v12: private fire command under RETURN FIRE actually destroys an unconfirmed Scout without API or fake hostile flags', async () => {
  mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(join(tmpdir(), 'frontier-v12-fire-'));
  const e = quietEngine(),
    ship = e.state.ships.find((s) => s.id === 'horizon')!;
  ship.x = 500;
  ship.y = 50;
  const target = makeEnemy('orion-scout', 'scout', 'orion', { x: 580, y: 50 });
  target.weapons = 0;
  target.nextDecision = 10000;
  e.state.enemies.push(target);
  updateSensors(e);
  new SaveStore(directory).write(e.state);
  const page = await launch(directory);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await send(page, 'private:ops-horizon', '去把 orion scout 干掉，立即开火。实时跟踪其位置！');
  await expect
    .poll(async () => (await state(page)).ships.find((s) => s.id === 'horizon')?.current?.source)
    .toBe('admiral');
  const armed = await state(page);
  expect(armed.contacts.find((c) => c.id === target.id)?.hostile).toBe(false);
  expect(armed.ships.find((s) => s.id === ship.id)?.current).toMatchObject({
    executorAgentId: 'ops-horizon',
    actorId: 'commander',
    action: { type: 'ATTACK', targetId: 'orion-scout' },
  });
  expect(armed.ships.find((s) => s.id === ship.id)?.standing.roe).toBe('RETURN FIRE');
  await page.evaluate(() => window.frontier.command({ type: 'speed', speed: 16 }));
  await wait(page, (s) => s.admiralTasks[0]?.status === 'completed');
  const done = await state(page);
  expect(done.agents.find((a) => a.id === 'ops-horizon')!.experience).toBeGreaterThan(0);
  expect(done.history.some((h) => h.kind === 'factionLoss' && h.entityId === target.id)).toBe(true);
  await expect(page.getByRole('log')).toContainText('聊天任务完成');
  expect(
    (
      await page.evaluate(() =>
        window.frontier.command({ type: 'admiralChatTask', agentId: 'ops-horizon', messageId: 1 }),
      )
    ).ok,
  ).toBe(false);
  await page.screenshot({ path: join(output, 'admiral-fire.png') });
  expect(errors).toEqual([]);
});

test('Electron v12: isolated real player v11 save migrates, group @ assigns VIGIL, and private construction completes real delivery', async () => {
  test.setTimeout(120000);
  const directory = mkdtempSync(join(tmpdir(), 'frontier-v12-player-'));
  const source =
    process.env.FRONTIER_PLAYER_SAVE ??
    (process.env.APPDATA ? join(process.env.APPDATA, 'frontier-command') : '');
  test.skip(
    !source || !existsSync(join(source, 'timeline-v11.json')),
    '此回归场景需要本机提供的玩家 v11 存档；普通引擎/Electron 场景独立运行',
  );
  cpSync(join(source, 'timeline-v11.json'), join(directory, 'timeline-v11.json'));
  cpSync(join(source, 'frontiers-v11'), join(directory, 'frontiers-v11'), { recursive: true });
  const original = readFileSync(join(directory, 'frontiers-v11/frontier-000001/head.json'), 'utf8');
  const page = await launch(directory);
  const migrated = await state(page);
  expect(migrated.version).toBe(12);
  expect(migrated.admiralTasks).toEqual([]);
  const cadet = migrated.agents.find((a) => a.name === 'Cadet 5')!;
  expect(cadet.assignedShipId).toBeNull();
  await send(page, 'frontier-command', '@Cadet 5 USS VIGIL 给你了');
  await expect
    .poll(async () => (await state(page)).agents.find((a) => a.id === cadet.id)?.assignedShipId)
    .toBe('vigil');
  // Free Mira from the old autonomous delivery in this disposable copy, then ask for construction.
  // This saved delivery is still empty; cancellation retains any real cargo by rule.
  await page.evaluate(() =>
    window.frontier.command({ type: 'cancelDirective', shipId: 'meridian' }),
  );
  const materials = (await state(page)).locations.reduce((n, l) => n + l.stock.materials, 0);
  const credits = (await state(page)).resources.credits;
  await send(page, 'private:' + cadet.id, '你去建设好高密度矿物带 0/12-0-5');
  await expect
    .poll(async () =>
      (await state(page)).projects.some((p) => p.siteId === 'sector:0:12:system:0:body:5'),
    )
    .toBe(true);
  const starting = await state(page);
  expect(starting.resources.credits).toBe(credits - 165);
  expect(starting.admiralTasks.at(-1)?.carrierAgentId).toBe('ops-meridian');
  await page.evaluate(() => window.frontier.command({ type: 'speed', speed: 16 }));
  await wait(page, (s) => s.admiralTasks.at(-1)?.status === 'completed', 90000);
  const completed = await state(page);
  expect(
    completed.locations.some(
      (l) => l.siteId === 'sector:0:12:system:0:body:5' && l.kind === 'mine',
    ),
  ).toBe(true);
  expect(completed.history.some((h) => h.kind === 'cargo' && h.text.includes('装载 30'))).toBe(
    true,
  );
  expect(completed.locations.reduce((n, l) => n + l.stock.materials, 0)).toBeGreaterThanOrEqual(
    materials - 30 - 1e-6,
  );
  expect((await page.evaluate(() => window.frontier.save())).ok).toBe(true);
  await page.screenshot({ path: join(output, 'player-save-construction.png') });
  expect(readFileSync(join(directory, 'frontiers-v11/frontier-000001/head.json'), 'utf8')).toBe(
    original,
  );
  const taskId = completed.admiralTasks.at(-1)!.id;
  await app!.close();
  app = undefined;
  const reopened = await launch(directory);
  expect((await state(reopened)).admiralTasks.find((t) => t.id === taskId)?.status).toBe(
    'completed',
  );
  expect((await state(reopened)).agents.find((a) => a.id === cadet.id)?.assignedShipId).toBe(
    'vigil',
  );
});

test('Electron v12: explicit route forbids wormholes, survives restart, and direct Admiral control cancels it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'frontier-v12-route-'));
  const e = quietEngine();
  new SaveStore(directory).write(e.state);
  let page = await launch(directory);
  await send(page, 'private:ops-horizon', '沿 0/0 一路测绘到 0/2，不走虫洞');
  await expect.poll(async () => (await state(page)).admiralTasks[0]?.allowWormholes).toBe(false);
  await page.evaluate(() => window.frontier.command({ type: 'speed', speed: 16 }));
  await wait(page, (s) => s.admiralTasks[0]?.sectorIndex === 1);
  expect((await page.evaluate(() => window.frontier.save())).ok).toBe(true);
  await app!.close();
  app = undefined;
  page = await launch(directory);
  const resumed = await state(page);
  expect(resumed.admiralTasks[0]).toMatchObject({
    status: 'active',
    sectorIndex: 1,
    allowWormholes: false,
  });
  const current = resumed.ships.find((s) => s.id === 'horizon')?.current;
  if (current) expect(current.journey?.legs.every((l) => l.type === 'warp') ?? true).toBe(true);
  await page.evaluate(() =>
    window.frontier.command({
      type: 'issueDirective',
      shipIds: ['horizon'],
      mode: 'REPLACE',
      action: { type: 'MOVE', point: { x: -240, y: 0 } },
    }),
  );
  expect((await state(page)).admiralTasks[0].status).toBe('cancelled');
  await send(page, 'private:ops-horizon', '取消当前任务');
  await expect
    .poll(async () => (await state(page)).ships.find((s) => s.id === 'horizon')?.current)
    .toBeNull();
  await page.screenshot({ path: join(output, 'route-control.png') });
});
