import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine, issue, run } from '../helpers';
import { makeLocation } from '../../src/engine/data';
import { COMMAND_CHANNEL, privateChannel } from '../../src/engine/chat';
import type { Snapshot, WorldState } from '../../src/engine/types';
import { AgentTestProvider } from './agent-provider';
let app: ElectronApplication | undefined, provider: AgentTestProvider | undefined;
const output = resolve('.test-data/verification/v14');
const testKey = 'isolated-e2e-test-key';
const state = async (p: Page) => (await p.evaluate(() => window.frontier.getState())).state;
async function launch(directory: string) {
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const p = await app.firstWindow();
  await p.getByRole('navigation', { name: '主导航' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1920, 1200),
  );
  await p.evaluate(() => document.fonts.ready);
  return p;
}
async function nav(p: Page, page: string) {
  await p
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: new RegExp(page) })
    .click();
}
async function wait(p: Page, predicate: (world: Snapshot) => boolean, timeout = 45000) {
  await expect
    .poll(async () => predicate(await state(p)), { timeout, intervals: [100] })
    .toBe(true);
}
function fixture(): WorldState {
  const e = quietEngine(),
    h = e.state.wormholes.find((h) => h.id === 'wormhole:0:0')!;
  h.stable = true;
  h.stability = 1;
  const scout = e.state.ships.find((s) => s.id === 'verity')!;
  scout.x = h.x;
  scout.y = h.y;
  issue(e, { type: 'TRANSIT', targetId: h.id }, scout.id);
  run(e, 2.2);
  const mine = makeLocation('remote-mine', 'AURORA MINE', 'mine', {
    x: scout.x + 110,
    y: scout.y + 40,
  });
  mine.stock.materials = 120;
  e.state.locations.push(mine);
  for (const id of ['meridian', 'horizon']) {
    const ship = e.state.ships.find((s) => s.id === id)!;
    ship.x = mine.x + (id === 'horizon' ? 20 : 0);
    ship.y = mine.y;
  }
  e.state.locations.find((l) => l.id === 'colony')!.colony!.nextCandidate = e.state.time;
  run(e, 0.1);
  e.state.paused = true;
  return e.state;
}
async function configureApi(p: Page, url: string) {
  await p.getByRole('button', { name: 'Console Settings', exact: true }).click();
  const settings = p.getByRole('dialog', { name: '控制台设置' });
  await settings.getByLabel('Agent API Base URL').fill(url);
  await settings.getByLabel('Agent API Key').fill(testKey);
  await settings.getByLabel('Agent 默认模型').fill('base-model');
  await settings.getByLabel('Agent 默认推理').selectOption('none');
  await settings.getByRole('button', { name: '测试 API 连接' }).click();
  await expect(settings.locator('.api-test-success')).toContainText('NONE');
  await settings.getByRole('button', { name: '保存 Agent API' }).click();
  await expect(settings.locator('.api-test-success')).toContainText('系统加密');
  await settings.getByRole('button', { name: '关闭面板', exact: true }).click();
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  await provider?.close();
  provider = undefined;
});

test('Electron v11: paid training, separate models, private/group/@ chat and real wormhole HAUL/ESCORT loop', async () => {
  test.setTimeout(120000);
  mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(join(tmpdir(), 'frontier-v11-e2e-')),
    world = fixture();
  new SaveStore(directory).write(world);
  provider = new AgentTestProvider();
  const url = await provider.start();
  const p = await launch(directory),
    errors: string[] = [];
  p.on('pageerror', (error) => errors.push(error.message));
  await expect(p.getByRole('navigation').getByRole('button', { name: /PERSONNEL/ })).toHaveCount(0);
  await nav(p, 'AGENTS');
  const agents = p.getByRole('dialog', { name: 'AGENTS 工作面板' });
  await expect(agents).toContainText('BATTLE / 战斗智能体');
  await expect(agents).toContainText('LOGISTICS / 物流智能体');
  for (const [name, model, effort] of [
    ['Talia', 'tactical-model', 'high'],
    ['Mira', 'freight-model', 'none'],
  ]) {
    await agents.getByRole('button', { name: '查看 Agent ' + name, exact: true }).click();
    await agents.getByLabel('Agent 独立模型').fill(model);
    await agents.getByLabel('Agent 独立推理').selectOption(effort);
    await agents.getByRole('button', { name: '保存 Agent 模型', exact: true }).click();
    await agents.getByRole('button', { name: '返回 Agent 名册' }).click();
  }
  await p.screenshot({ path: join(output, 'agents-roster.png') });
  const candidate = (await state(p)).personnel.find((person) => person.status === 'candidate')!;
  await nav(p, 'COLONIES');
  const colonies = p.getByRole('dialog', { name: 'COLONIES 工作面板' });
  await colonies.getByLabel('培养方向 ' + candidate.id).selectOption('battle');
  const credits = (await state(p)).resources.credits;
  await colonies
    .locator('[data-candidate-id="' + candidate.id + '"]')
    .getByRole('button', { name: /接受并培养/ })
    .click();
  expect((await state(p)).resources.credits).toBe(credits - 150);
  expect((await state(p)).personnel.find((person) => person.id === candidate.id)?.status).toBe(
    'training',
  );
  await colonies.getByRole('button', { name: '关闭管理面板', exact: true }).click();
  await configureApi(p, url);
  await wait(
    p,
    (w) =>
      w.escortRequests.some((r) => r.status === 'accepted') &&
      !w.escortRequests.some((r) => r.status === 'pending'),
  );
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await wait(p, (w) => w.ships.find((s) => s.id === 'meridian')?.current?.action.type === 'HAUL');
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  const configured = await state(p);
  expect(configured.ships.find((s) => s.id === 'horizon')!.current?.source).toBe('agent');
  expect(configured.ships.find((s) => s.id === 'horizon')!.current?.action.type).toBe('ESCORT');
  expect(configured.agents.find((a) => a.id === 'ops-horizon')!.modelConfig).toEqual({
    model: 'tactical-model',
    reasoningEffort: 'high',
  });
  expect(
    provider.requests.some((r) => r.model === 'tactical-model' && r.reasoning_effort === 'high'),
  ).toBe(true);
  expect(provider.requests.some((r) => r.model === 'tactical-model' && !r.reasoning_effort)).toBe(
    true,
  );
  expect(
    provider.requests
      .filter((r) => r.model === 'freight-model')
      .every((r) => !('reasoning_effort' in r)),
  ).toBe(true);
  const launcher = p.getByTestId('chat-launcher'),
    before = await launcher.boundingBox();
  await p.mouse.move(before!.x + 40, before!.y + 25);
  await p.mouse.down();
  await p.mouse.move(before!.x - 250, before!.y - 280, { steps: 8 });
  await p.mouse.up();
  const moved = await launcher.boundingBox();
  expect(moved!.x).toBeLessThan(before!.x - 100);
  expect(moved!.y).toBeLessThan(before!.y - 100);
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');
  await launcher.click();
  const chat = p.getByRole('dialog', { name: '舰队通讯' });
  await expect(chat).toContainText('请求护航');
  await expect(chat).toContainText('自愿接受任务');
  await expect(chat.locator('mark').filter({ hasText: '@Talia' })).toBeVisible();
  await p.getByRole('button', { name: '16×', exact: true }).click();
  await p.getByRole('button', { name: '继续', exact: true }).click();
  const initialBaseMaterials = configured.locations.find((l) => l.id === 'base')!.stock.materials;
  await wait(
    p,
    (w) =>
      !!w.ships.find((s) => s.id === 'meridian')?.cargo.materials &&
      w.ships.find((s) => s.id === 'meridian')?.current?.phase === 'delivering',
  );
  const travelled = await state(p);
  expect(
    travelled.ships
      .find((s) => s.id === 'meridian')
      ?.current?.journey?.legs.some((l) => l.type === 'wormhole'),
  ).toBe(true);
  const startTick = travelled.tick;
  await wait(
    p,
    (w) =>
      w.escortRequests[0].status === 'completed' &&
      w.locations.find((l) => l.id === 'base')!.stock.materials === initialBaseMaterials + 40 &&
      w.agents.some((a) => a.originPersonnelId === candidate.id),
  );
  const completed = await state(p);
  expect(completed.tick).toBeGreaterThan(startTick);
  expect(completed.agents.find((a) => a.id === 'ops-meridian')!.experience).toBeGreaterThan(0);
  expect(
    completed.agents.find((a) => a.id === 'ops-horizon')!.relationships['ops-meridian'].trust,
  ).toBeGreaterThan(50);
  expect(
    completed.history.some((h) => h.kind === 'wormhole' && h.text.includes('MERIDIAN-1')),
  ).toBe(true);
  await chat.locator('[data-channel-id="system-reports"]').click();
  await expect(chat.getByRole('log')).toContainText('HAUL 完成');
  await chat.locator('[data-channel-id="frontier-command"]').click();
  await p.getByRole('button', { name: '暂停', exact: true }).click();
  await chat.getByLabel('通讯消息').fill('@Mira 群聊验证：优先保护货物。');
  await chat.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
  await wait(p, (w) =>
    w.chatMessages.some((m) => m.sender === 'ops-meridian' && m.content.includes('收到群聊验证')),
  );
  await chat.locator('[data-channel-id="' + privateChannel('ops-meridian') + '"]').click();
  await chat.getByLabel('通讯消息').fill('请先休息。');
  await chat.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
  await wait(
    p,
    (w) =>
      w.agents.find((a) => a.id === 'ops-meridian')!.currentGoal.includes('私聊') &&
      w.ships.find((s) => s.id === 'meridian')!.current?.action.type === 'DOCK',
  );
  await expect(chat.getByRole('log')).toContainText('收到私聊');
  await p.screenshot({ path: join(output, 'agent-private-chat.png') });
  for (const channel of (await state(p)).chatChannels)
    await chat.locator('[data-channel-id="' + channel.id + '"]').click();
  await expect(launcher.locator('.chat-unread-badge')).toHaveCount(0);
  await chat.getByRole('button', { name: '关闭面板', exact: true }).click();
  await nav(p, 'AGENTS');
  const graduate = (await state(p)).agents.find((a) => a.originPersonnelId === candidate.id)!;
  await p.getByRole('button', { name: '查看 Agent ' + graduate.name }).click();
  await p.getByLabel('Agent 分配舰船').selectOption('verity');
  await p.getByRole('button', { name: '保存舰船分配' }).click();
  await wait(p, (w) => w.agents.find((a) => a.id === graduate.id)?.assignedShipId === 'verity');
  await p.screenshot({ path: join(output, 'agent-training-detail.png') });
  await p.evaluate(() => window.frontier.save());
  const persisted = await state(p);
  expect(JSON.stringify(persisted)).not.toContain(testKey);
  expect(readFileSync(join(directory, 'agent-api.v1.json'), 'utf8')).not.toContain(testKey);
  expect(readFileSync(new SaveStore(directory).path, 'utf8')).not.toContain(testKey);
  expect(await p.evaluate(() => window.frontier.agentSettings())).not.toHaveProperty('apiKey');
  await app!.close();
  app = undefined;
  const restarted = await launch(directory);
  const loaded = await state(restarted);
  expect(loaded.version).toBe(15);
  expect(loaded.chatMessages).toEqual(persisted.chatMessages);
  expect(loaded.agents.find((a) => a.id === graduate.id)?.assignedShipId).toBe('verity');
  expect(loaded.agents.find((a) => a.id === 'ops-horizon')?.modelConfig.model).toBe(
    'tactical-model',
  );
  expect((await restarted.evaluate(() => window.frontier.agentSettings())).hasKey).toBe(true);
  expect(errors).toEqual([]);
});

test('Electron v11: illegal model JSON reports privately, manual retry recovers, tired Battle refuses real escort', async () => {
  test.setTimeout(90000);
  const directory = mkdtempSync(join(tmpdir(), 'frontier-v11-errors-')),
    world = fixture();
  world.agents[0].fatigue = 90;
  new SaveStore(directory).write(world);
  provider = new AgentTestProvider();
  provider.mode = 'invalid';
  const url = await provider.start(),
    p = await launch(directory);
  await configureApi(p, url);
  await wait(p, (w) => w.agents.every((a) => a.status === 'error'));
  const errored = await state(p);
  expect(errored.ships.every((s) => s.current === null)).toBe(true);
  expect(errored.chatMessages.some((m) => m.kind === 'error' && m.content.includes('schema'))).toBe(
    true,
  );
  await p.getByTestId('chat-launcher').click();
  const chat = p.getByRole('dialog', { name: '舰队通讯' });
  await chat.locator('[data-channel-id="' + privateChannel('ops-meridian') + '"]').click();
  await expect(chat.getByRole('log')).toContainText('schema');
  await chat.getByRole('button', { name: '关闭面板' }).click();
  provider.mode = 'refuse';
  await p.evaluate(() => window.frontier.command({ type: 'retryAgent', agentId: 'ops-horizon' }));
  await nav(p, 'AGENTS');
  await p.getByRole('button', { name: '查看 Agent Mira' }).click();
  await p.getByRole('button', { name: '再次决策' }).click();
  await wait(
    p,
    (w) =>
      w.escortRequests[0]?.status === 'rejected' &&
      w.chatMessages.some((m) => m.content.includes('暂缓此次货运')),
  );
  const refused = await state(p);
  expect(refused.ships.find((s) => s.id === 'horizon')!.current).toBeNull();
  expect(refused.ships.find((s) => s.id === 'meridian')!.current).toBeNull();
  expect(
    refused.agents.find((a) => a.id === 'ops-horizon')!.relationships['ops-meridian'].trust,
  ).toBe(50);
  expect(
    refused.chatMessages.some((m) => m.kind === 'reply' && m.content.includes('拒绝任务')),
  ).toBe(true);
  expect(refused.chatMessages.some((m) => m.content.includes('暂缓此次货运'))).toBe(true);
  expect((await p.evaluate(() => window.frontier.save())).ok).toBe(true);
});

test('Electron v11: floating communications stays usable at narrow widths and 200% text', async () => {
  test.setTimeout(60000);
  const directory = mkdtempSync(join(tmpdir(), 'frontier-v11-chat-layout-'));
  new SaveStore(directory).write(quietEngine().state);
  const p = await launch(directory);
  for (const [width, height, textScale] of [
    [1366, 900, 1],
    [1024, 768, 2],
  ]) {
    await app!.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
      { width, height },
    );
    await p.evaluate((scale) => {
      const key = 'frontier.lcars.console.v2';
      const settings = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(
        key,
        JSON.stringify({ ...settings, version: 2, textScale: scale, animations: 'off' }),
      );
    }, textScale);
    await p.reload();
    const launcher = p.getByTestId('chat-launcher');
    await launcher.waitFor();
    await expect
      .poll(() =>
        launcher.evaluate((button) => {
          const rect = button.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight
          );
        }),
      )
      .toBe(true);
    await launcher.click();
    const chat = p.getByRole('dialog', { name: '舰队通讯' });
    await expect(chat).toBeVisible();
    await expect(chat.getByLabel('通讯消息')).toBeInViewport();
    await chat.getByLabel('通讯消息').fill('大字号通讯检查');
    await expect(chat.getByRole('button', { name: 'SEND / 发送' })).toBeInViewport();
    await chat.getByRole('button', { name: 'SEND / 发送' }).click();
    await expect(chat.getByRole('log')).toContainText('大字号通讯检查');
    expect(
      await chat
        .getByRole('log')
        .evaluate(
          (el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize),
        ),
    ).toBeGreaterThan(2);
    expect(
      await chat.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= innerWidth + 1 &&
          rect.bottom <= innerHeight + 1
        );
      }),
    ).toBe(true);
    mkdirSync(output, { recursive: true });
    await p.screenshot({
      path: join(output, 'chat-' + width + '-text-' + textScale * 100 + '.png'),
    });
  }
});

test('Electron v14: old demo files stay untouched; a new demo awaits genuine model consent', async () => {
  test.setTimeout(90000);
  const directory = mkdtempSync(join(tmpdir(), 'frontier-v11-demo-'));
  cpSync(resolve('demo/user-data/frontiers-v11'), join(directory, 'frontiers-v11'), {
    recursive: true,
  });
  cpSync(resolve('demo/user-data/timeline-v11.json'), join(directory, 'timeline-v11.json'));
  const p = await launch(directory);
  const initial = await state(p);
  expect(initial.paused).toBe(true);
  expect(initial.version).toBe(15);
  expect(initial.speed).toBe(1);
  expect((await p.evaluate(() => window.frontier.agentSettings())).hasKey).toBe(false);
  expect(readFileSync(join(directory, 'timeline-v11.json'), 'utf8')).toBe(
    readFileSync(resolve('demo/user-data/timeline-v11.json'), 'utf8'),
  );
  await nav(p, 'ARCHIVE');
  const manager = p.getByRole('dialog', { name: 'ARCHIVE 工作面板' });
  await manager.getByRole('button', { name: 'AGENT DEMO / 演示存档', exact: true }).click();
  await expect(manager).toHaveCount(0);
  const catalog = await p.evaluate(() => window.frontier.listSaves());
  expect(catalog.saves).toHaveLength(2);
  expect((await state(p)).escortRequests).toEqual([]);
  expect((await p.evaluate(() => window.frontier.save())).ok).toBe(true);
  await app!.close();
  app = undefined;
  const restarted = await launch(directory);
  expect((await state(restarted)).escortRequests).toEqual([]);
  expect((await restarted.evaluate(() => window.frontier.listSaves())).saves).toHaveLength(2);
});
