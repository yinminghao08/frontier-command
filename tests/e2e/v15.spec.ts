import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine, issue, run, until } from '../helpers';
import { makeEnemy } from '../../src/engine/data';
import { updateSensors } from '../../src/engine/sensors';
import type { Snapshot, WorldState } from '../../src/engine/types';
import { AgentTestProvider } from './agent-provider';
const output = resolve('.test-data/verification/v15');
let app: ElectronApplication | undefined, provider: AgentTestProvider | undefined;
const state = async (p: Page) => (await p.evaluate(() => window.frontier.getState())).state;
const marker = (p: Page, id: string) => p.locator(`.strategic-map [data-entity-id="${id}"]`);
const ship = (p: Page, id: string) => p.locator(`.operation-chip[data-ship-id="${id}"]`);
async function launch(w: WorldState) {
  const directory = mkdtempSync(join(tmpdir(), 'frontier-v15-ui-'));
  new SaveStore(directory).write(w);
  mkdirSync(output, { recursive: true });
  return openApp(directory);
}
async function openApp(directory: string) {
  mkdirSync(output, { recursive: true });
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const p = await app.firstWindow();
  await p.getByTestId('chat-launcher').waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000),
  );
  await p.evaluate(() => document.fonts.ready);
  return p;
}
async function configure(p: Page) {
  provider = new AgentTestProvider();
  const url = await provider.start();
  await p.evaluate(
    (baseUrl) =>
      window.frontier.configureAgentApi({
        baseUrl,
        defaultModel: 'v15-isolated',
        reasoningEffort: 'none',
        apiKey: 'local-v15-only',
      }),
    url,
  );
  await expect
    .poll(async () => (await p.evaluate(() => window.frontier.agentRuntime())).concurrency)
    .toBe(0);
}
async function chat(
  p: Page,
  id: string,
  content: string,
  mode: 'direct' | 'voluntary' = 'voluntary',
) {
  const comm = p.getByRole('dialog', { name: '舰队通讯' });
  if (!(await comm.isVisible())) await p.getByTestId('chat-launcher').click();
  await comm.locator(`[data-channel-id="private:${id}"]`).click();
  await comm.getByLabel('通讯任务模式').selectOption(mode);
  await comm.getByLabel('通讯消息').fill(content);
  await comm.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
  return comm;
}
async function wait(p: Page, predicate: (s: Snapshot) => boolean, timeout = 45000) {
  await expect
    .poll(
      async () => {
        const s = await state(p);
        if (s.paused)
          await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
        return predicate(s);
      },
      { timeout, intervals: [100] },
    )
    .toBe(true);
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  await provider?.close();
  provider = undefined;
});
test('v15 Electron migrates an underway v14 save without touching the old files or reloading goods', async () => {
  const e = quietEngine(),
    s = e.state.ships.find((s) => s.id === 'meridian')!;
  issue(
    e,
    {
      type: 'HAUL',
      sourceId: 'mine',
      targetId: 'base',
      cargoKind: 'materials',
      amount: 50,
      route: 'safe',
      repeat: false,
    },
    s.id,
  );
  until(e, () => s.cargo.materials === 50);
  e.state.paused = true;
  const directory = mkdtempSync(join(tmpdir(), 'frontier-v15-desktop-migration-')),
    old = {
      ...e.state,
      version: 14,
      agents: e.state.agents.map(({ stateDynamics: _, ...a }) => a),
    },
    bytes = JSON.stringify(old),
    root = join(directory, 'frontiers-v14', 'frontier-000001');
  mkdirSync(root, { recursive: true });
  for (const file of ['head.json', 'head.json.bak', 'day-1.json'])
    writeFileSync(join(root, file), bytes);
  writeFileSync(
    join(directory, 'timeline-v14.json'),
    JSON.stringify({
      version: 14,
      activeId: 'frontier-000001',
      branches: [{ id: 'frontier-000001', parent: null, name: '旧货运' }],
    }),
  );
  const p = await openApp(directory),
    w = await state(p);
  expect(w.version).toBe(15);
  expect(w.ships.find((s) => s.id === 'meridian')?.cargo.materials).toBe(50);
  expect(w.ships.find((s) => s.id === 'meridian')?.current?.carried).toBe(50);
  expect(w.history).toEqual(e.snapshot().history);
  for (const file of ['head.json', 'head.json.bak', 'day-1.json'])
    expect(readFileSync(join(root, file), 'utf8')).toBe(bytes);
  expect(w.chatMessages.filter((m) => m.content.includes('装载 50')).length).toBe(
    e.state.chatMessages.filter((m) => m.content.includes('装载 50')).length,
  );
  await p.screenshot({ path: join(output, 'v14-migrated-underway.png') });
});
test('v15 Ctrl enemy selection retains allies, toggles accurately, remembers control and focuses the full sequence', async () => {
  test.setTimeout(120000);
  const e = quietEngine();
  for (const id of ['horizon', 'vigil']) {
    const s = e.state.ships.find((s) => s.id === id)!;
    s.x = id === 'horizon' ? 0 : -40;
    s.y = 0;
  }
  for (const [id, x] of [
    ['orion-ui-a', 60],
    ['orion-ui-b', 110],
  ] as const) {
    const enemy = makeEnemy(id, 'raider', 'orion', { x, y: 20 });
    enemy.weapons = 0;
    enemy.engines = 0;
    enemy.nextDecision = 1e9;
    e.state.enemies.push(enemy);
  }
  updateSensors(e);
  run(e, 4);
  e.state.paused = true;
  const p = await launch(e.state);
  const errors: string[] = [];
  p.on('pageerror', (error) => errors.push(error.message));
  await ship(p, 'horizon').click();
  await ship(p, 'vigil').click({ modifiers: ['Control'] });
  await marker(p, 'orion-ui-a').click();
  await marker(p, 'orion-ui-b').click({ modifiers: ['Control'] });
  await expect(ship(p, 'horizon')).toHaveAttribute('aria-pressed', 'true');
  await expect(ship(p, 'vigil')).toHaveAttribute('aria-pressed', 'true');
  await expect(marker(p, 'orion-ui-a')).toHaveAttribute('aria-pressed', 'true');
  await marker(p, 'orion-ui-b').click({ modifiers: ['Control'] });
  await expect(marker(p, 'orion-ui-b')).toHaveAttribute('aria-pressed', 'false');
  await marker(p, 'orion-ui-b').click({ modifiers: ['Control'] });
  await expect(p.locator('.inspector')).toContainText('已选 2 个敌方目标');
  await p.locator('.inspector').getByRole('button', { name: '攻击', exact: true }).click();
  const d = p.getByRole('dialog', { name: 'Admiral 指令' });
  await expect(d.getByLabel('指挥方式', { exact: true })).toHaveValue('direct');
  await expect(d.getByLabel('分配 horizon', { exact: true })).toBeChecked();
  await expect(d.getByLabel('分配 vigil', { exact: true })).toBeChecked();
  await expect(d.getByLabel('攻击目标序列')).toContainText('集中火力');
  await d.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  let w = await state(p);
  for (const id of ['horizon', 'vigil'])
    expect(w.ships.find((s) => s.id === id)?.current?.action).toEqual({
      type: 'ATTACK_SET',
      targetIds: ['orion-ui-a', 'orion-ui-b'],
    });
  await ship(p, 'vigil').click({ modifiers: ['Control'] });
  await marker(p, 'orion-ui-a').click();
  await configure(p);
  let firstButton = true;
  for (const button of ['拦截', '跟踪', '攻击', '压制子系统', '驱离']) {
    await p.locator('.inspector').getByRole('button', { name: button, exact: true }).click();
    await expect(d.getByLabel('指挥方式', { exact: true })).toHaveValue(
      firstButton ? 'direct' : 'voluntary',
    );
    await d.getByLabel('指挥方式', { exact: true }).selectOption('voluntary');
    await d.getByRole('button', { name: '取消', exact: true }).click();
    firstButton = false;
  }
  provider!.mode = 'refuse';
  await p.locator('.inspector').getByRole('button', { name: '跟踪', exact: true }).click();
  await d.getByRole('button', { name: '提交给 Agent', exact: true }).click();
  await expect.poll(async () => (await state(p)).admiralTasks.at(-1)?.consent).toBe('rejected');
  expect((await state(p)).ships.find((s) => s.id === 'horizon')?.current?.action.type).toBe(
    'ATTACK_SET',
  );
  await ship(p, 'vigil').click();
  await marker(p, 'orion-ui-a').click();
  await p.locator('.inspector').getByRole('button', { name: '攻击', exact: true }).click();
  await expect(d).toContainText('没有可用 Agent');
  await expect(d.getByRole('button', { name: '提交给 Agent', exact: true })).toBeDisabled();
  await d.getByLabel('指挥方式', { exact: true }).selectOption('direct');
  await d.getByRole('button', { name: '取消', exact: true }).click();
  await marker(p, 'orion-ui-b').click({ modifiers: ['Control'] });
  await p.screenshot({ path: join(output, 'multi-target-control.png') });
  await p.evaluate(() => window.frontier.command({ type: 'speed', speed: 16 }));
  await wait(p, (w) =>
    ['horizon', 'vigil'].every((id) => !w.ships.find((s) => s.id === id)?.current),
  );
  w = await state(p);
  for (const id of ['orion-ui-a', 'orion-ui-b'])
    expect(w.history.some((h) => h.kind === 'factionLoss' && h.entityId === id)).toBe(true);
  expect(errors).toEqual([]);
});
test('v15 a voluntary full-hold amendment inherits the underway route, reports in the original chat and shows real state rates', async () => {
  const e = quietEngine(),
    freighter = e.state.ships.find((s) => s.id === 'meridian')!,
    mine = e.state.locations.find((l) => l.id === 'mine')!;
  mine.stock.materials = 1000;
  issue(
    e,
    {
      type: 'HAUL',
      sourceId: 'mine',
      targetId: 'base',
      cargoKind: 'materials',
      amount: 50,
      route: 'safe',
      repeat: false,
    },
    freighter.id,
  );
  until(e, () => freighter.cargo.materials === 50);
  run(e, 1);
  e.state.paused = true;
  const p = await launch(e.state);
  await configure(p);
  const comm = await chat(p, 'ops-meridian', '运输直接装满货仓，立即执行！');
  await expect
    .poll(async () => (await state(p)).ships.find((s) => s.id === 'meridian')?.current?.action.type)
    .toBe('HAUL');
  await expect(comm.getByRole('log')).toContainText('预计补装 550');
  await expect(comm.getByRole('log')).not.toContainText('请明确货物运输');
  await expect(comm.getByRole('log')).toContainText('已回复');
  expect((await state(p)).ships.find((s) => s.id === 'meridian')?.current?.carried).toBe(50);
  await p.screenshot({ path: join(output, 'haul-amendment-chat.png') });
  await comm.getByRole('button', { name: '关闭面板', exact: true }).click();
  await p.evaluate(() => window.frontier.command({ type: 'speed', speed: 16 }));
  await wait(p, (w) => w.ships.find((s) => s.id === 'meridian')?.cargo.materials === 600);
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  const loaded = await state(p);
  expect(loaded.ships.find((s) => s.id === 'meridian')?.current?.carried).toBe(600);
  await p
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /AGENTS/ })
    .click();
  await p.getByRole('button', { name: '查看 Agent Mira', exact: true }).click();
  await expect(p.getByLabel('状态变化速率')).toContainText('疲劳 +0.25');
  await expect(p.locator('.agent-attributes')).toContainText(/\d+\.\d\s*\/\s*100/);
  await p.getByLabel('状态变化速率').scrollIntoViewIfNeeded();
  await expect(p.getByLabel('状态变化速率')).toBeVisible();
  await p.screenshot({ path: join(output, 'agent-rates.png') });
  await wait(p, (w) => w.admiralTasks.at(-1)?.status === 'completed');
  expect((await state(p)).ships.find((s) => s.id === 'meridian')?.cargo.materials).toBe(0);
});
test('v15 slow streaming replies exceed 25 seconds, remain cancellable and support real-error retry', async () => {
  test.setTimeout(60000);
  const e = quietEngine();
  const p = await launch(e.state);
  await configure(p);
  provider!.mode = 'hang';
  let comm = await chat(p, 'ops-horizon', '现在舰船的情况如何？');
  await expect(comm.getByRole('button', { name: '取消等待', exact: true })).toBeVisible();
  await comm.getByRole('button', { name: '取消等待', exact: true }).click();
  await expect(comm.getByRole('log')).toContainText('模型请求已取消');
  provider!.mode = 'cooperate';
  provider!.delayMs = 25000;
  comm = await chat(p, 'ops-horizon', '再报告一次当前情况。');
  const start = Date.now();
  await p.waitForTimeout(21000);
  await expect(comm.getByRole('button', { name: '取消等待', exact: true })).toBeVisible();
  await expect(comm.getByRole('log')).not.toContainText('最多 20 秒');
  await expect
    .poll(
      async () =>
        (await state(p)).chatMessages.filter((m) => m.sender === 'commander').at(-1)?.responses?.[
          'ops-horizon'
        ],
      { timeout: 15000 },
    )
    .toBe('replied');
  expect(Date.now() - start).toBeGreaterThanOrEqual(25000);
  await p.screenshot({ path: join(output, 'slow-stream-replied.png') });
  provider!.delayMs = 0;
  provider!.failHttp = true;
  comm = await chat(p, 'ops-horizon', '网络错误后重试。');
  await expect(comm.getByRole('button', { name: '重试回复', exact: true })).toBeVisible();
  await expect(comm.getByRole('log')).toContainText('HTTP 503');
  provider!.failHttp = false;
  provider!.mode = 'cooperate';
  await comm.getByRole('button', { name: '重试回复', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state(p)).chatMessages.filter((m) => m.sender === 'commander').at(-1)?.responses?.[
          'ops-horizon'
        ],
    )
    .toBe('replied');
  const stats = await p.evaluate(() => window.frontier.agentRuntime());
  expect(
    [...stats.activeRequests, ...stats.recentRequests].every((r) => !('deadlineAt' in r)),
  ).toBe(true);
  writeFileSync(join(output, 'isolated-provider-telemetry.json'), JSON.stringify(stats, null, 2));
  expect(JSON.stringify(stats)).not.toContain('local-v15-only');
});

test('API connection test can be cancelled and immediately tested again', async () => {
  const e = quietEngine();
  for (const agent of e.state.agents) agent.enabled = false;
  const p = await launch(e.state);
  await configure(p);
  provider!.mode = 'hang';
  await p
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /Console Settings/i })
    .click();
  await p.getByRole('button', { name: '测试 API 连接', exact: true }).click();
  await p.getByRole('button', { name: '取消连接测试', exact: true }).click();
  await expect(p.getByRole('status').filter({ hasText: '模型请求已取消' })).toBeVisible();
  provider!.mode = 'cooperate';
  await p.getByRole('button', { name: '测试 API 连接', exact: true }).click();
  await expect(p.getByRole('status').filter({ hasText: 'API 可用' })).toBeVisible();
  await expect
    .poll(async () => (await p.evaluate(() => window.frontier.agentRuntime())).concurrency)
    .toBe(0);
  await p.screenshot({ path: join(output, 'api-test-cancel-retry.png') });
});
