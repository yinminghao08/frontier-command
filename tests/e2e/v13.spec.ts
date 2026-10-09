import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { createAgentDemoWorld } from '../../src/engine/demo';
import { quietEngine } from '../helpers';
import { AgentTestProvider } from './agent-provider';
import type { Snapshot } from '../../src/engine/types';
let app: ElectronApplication | undefined, provider: AgentTestProvider | undefined;
const output = resolve('.test-data/verification/v14');
const state = async (p: Page) => (await p.evaluate(() => window.frontier.getState())).state;
async function launch(dir: string, width = 1366, height = 900) {
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: dir, FRONTIER_HEADLESS: '1' },
  });
  const p = await app.firstWindow();
  await p.getByTestId('chat-launcher').waitFor();
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
    { width, height },
  );
  await p.evaluate(() => document.fonts.ready);
  return p;
}
async function chat(p: Page) {
  if (!(await p.getByRole('dialog', { name: '舰队通讯' }).isVisible()))
    await p.getByTestId('chat-launcher').click();
  return p.getByRole('dialog', { name: '舰队通讯' });
}
async function wait(p: Page, condition: (w: Snapshot) => boolean) {
  await expect
    .poll(async () => condition(await state(p)), { timeout: 45000, intervals: [100] })
    .toBe(true);
}
async function configure(p: Page, url: string) {
  await p.getByRole('button', { name: 'Console Settings', exact: true }).click();
  const settings = p.getByRole('dialog', { name: '控制台设置' });
  await settings.getByLabel('Agent API Base URL').fill(url);
  await settings.getByLabel('Agent API Key').fill('local-v13-e2e-key');
  await settings.getByLabel('Agent 默认模型').fill('v13-local-model');
  await settings.getByLabel('Agent 默认推理').selectOption('provider-default');
  await settings.getByRole('button', { name: '保存 Agent API', exact: true }).click();
  await expect(settings.locator('.api-test-success')).toContainText('系统加密');
  await settings.getByRole('button', { name: '关闭面板', exact: true }).click();
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  await provider?.close();
  provider = undefined;
});

test('v13 complete model/engine chain: conditional escort, escrow, restart, real delivery, relations and subsequent choice', async () => {
  test.setTimeout(120000);
  mkdirSync(output, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'frontier-v13-chain-'));
  new SaveStore(dir).write(createAgentDemoWorld());
  provider = new AgentTestProvider();
  provider.mode = 'negotiate';
  const url = await provider.start();
  let p = await launch(dir);
  const errors: string[] = [];
  p.on('pageerror', (error) => errors.push(error.message));
  expect((await state(p)).escortRequests).toEqual([]);
  await configure(p, url);
  await wait(p, (w) => w.escortRequests.some((r) => r.status === 'awaitingApproval'));
  let comm = await chat(p);
  await comm.getByRole('button', { name: 'REQUESTS / 待处理请求', exact: true }).click();
  const request = (await state(p)).escortRequests[0];
  const row = comm.locator(`[data-request-id="${request.id}"]`);
  await expect(row).toContainText('维修至 90%');
  await expect(row).toContainText('25 Credits');
  await expect(row).toContainText('条件版本 2');
  expect((await state(p)).ships.find((s) => s.id === 'meridian')!.current).toBeNull();
  await p.screenshot({ path: join(output, 'request-negotiation.png') });
  const credits = (await state(p)).resources.credits;
  await row.getByRole('button', { name: '确认条件与预算', exact: true }).click();
  expect((await state(p)).resources.credits).toBe(credits - 25);
  await expect(comm).toContainText('已托管 25 Credits');
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await wait(p, (w) => w.ships.find((s) => s.id === 'horizon')?.current?.action.type === 'REPAIR');
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  await p.evaluate(() => window.frontier.save());
  const repairing = await state(p);
  expect(repairing.commitments.filter((c) => c.condition.type === 'reward')[0].escrow).toBe(25);
  expect(repairing.agents.find((a) => a.id === 'ops-horizon')!.rewardCredits).toBe(0);
  await p.screenshot({ path: join(output, 'request-repair.png') });
  await app!.close();
  app = undefined;
  p = await launch(dir);
  p.on('pageerror', (error) => errors.push(error.message));
  expect((await p.evaluate(() => window.frontier.agentSettings())).hasKey).toBe(true);
  expect(await p.evaluate(() => window.frontier.agentRuntime())).not.toHaveProperty('settings');
  const initial = (await state(p)).locations.find((l) => l.id === 'base')!.stock.materials;
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await wait(p, (w) => w.escortRequests[0].status === 'completed');
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  const done = await state(p);
  expect(done.locations.find((l) => l.id === 'base')!.stock.materials).toBe(initial + 40);
  expect(done.agents.find((a) => a.id === 'ops-horizon')!.rewardCredits).toBe(25);
  expect(done.commitments.every((c) => c.status === 'fulfilled' && c.escrow === 0)).toBe(true);
  expect(done.agents.find((a) => a.id === 'ops-meridian')!.relationships['ops-horizon'].trust).toBe(
    56,
  );
  comm = await chat(p);
  await comm.locator('[data-channel-id="system-reports"]').click();
  await expect(comm.getByRole('log')).toContainText('HAUL 完成');
  await expect(comm.getByLabel('通讯消息')).toHaveCount(0);
  await expect(comm).toContainText('不调用模型');
  await p.screenshot({ path: join(output, 'system-reports.png') });
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await p.waitForTimeout(1800);
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  const calls = provider.requests.length;
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await p.waitForTimeout(1800);
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  expect(provider.requests.length).toBe(calls);
  expect((await p.evaluate(() => window.frontier.agentRuntime())).concurrency).toBe(0);
  await comm.locator('[data-channel-id="private:ops-meridian"]').click();
  await comm.getByLabel('通讯消息').fill('请评估第二轮货运的合作对象。');
  await comm.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
  await wait(p, (w) => w.escortRequests.length === 2 && w.escortRequests[1].status === 'accepted');
  expect((await state(p)).escortRequests[1]).toMatchObject({
    responderId: 'ops-horizon',
    conditions: [],
    rounds: 0,
  });
  expect(
    provider.requests.some((r) => r.messages.some((m) => m.content.includes('"trust":56'))),
  ).toBe(true);
  await comm.getByRole('button', { name: '关闭面板', exact: true }).click();
  await p
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /AGENTS/ })
    .click();
  await p.getByRole('button', { name: '查看 Agent Mira', exact: true }).click();
  const agents = p.getByRole('dialog', { name: 'AGENTS 工作面板' });
  await expect(agents).toContainText('任务意愿');
  await expect(agents).toContainText('LONG TERM');
  await expect(agents).toContainText('TRUST 56');
  await p.screenshot({ path: join(output, 'personality-relationship.png') });
  await p.evaluate(() => window.frontier.save());
  const saved = await state(p);
  expect(JSON.stringify(saved)).not.toContain('local-v13-e2e-key');
  expect(readFileSync(join(dir, 'agent-api.v1.json'), 'utf8')).not.toContain('local-v13-e2e-key');
  expect(errors).toEqual([]);
});

test('v13 voluntary proposal waits; request view direct takeover executes with zero model requests', async () => {
  mkdirSync(output, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'frontier-v13-takeover-'));
  new SaveStore(dir).write(quietEngine().state);
  const p = await launch(dir),
    comm = await chat(p);
  await comm.locator('[data-channel-id="private:ops-horizon"]').click();
  await comm.getByLabel('通讯消息').fill('巡逻基地 5 分钟');
  await comm.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
  await wait(p, (w) => w.objectives[0]?.consent === 'proposed');
  expect((await state(p)).ships.find((s) => s.id === 'horizon')!.current).toBeNull();
  const trust = (await state(p)).agents.find((a) => a.id === 'ops-horizon')!.trust;
  await comm.getByRole('button', { name: 'REQUESTS / 待处理请求', exact: true }).click();
  await comm.getByRole('button', { name: '直接接管', exact: true }).click();
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await wait(p, (w) => w.ships.find((s) => s.id === 'horizon')?.current?.controlMode === 'direct');
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  expect((await state(p)).agents.find((a) => a.id === 'ops-horizon')!.trust).toBe(trust);
  expect((await p.evaluate(() => window.frontier.agentRuntime())).requests).toBe(0);
  await p.screenshot({ path: join(output, 'direct-takeover.png') });
});

test('unlimited model calls finish repairs immediately, ignore old quotas and remain idle after failures', async () => {
  mkdirSync(output, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'frontier-unlimited-calls-'));
  new SaveStore(dir).write(quietEngine().state);
  writeFileSync(
    join(dir, 'agent-runtime.v1.json'),
    JSON.stringify({
      version: 1,
      settings: { globalPerMinute: 1, agentPerMinute: 1 },
      recent: [{ at: Date.now(), agentId: 'ops-meridian' }],
    }),
  );
  provider = new AgentTestProvider();
  provider.mode = 'invalid';
  const url = await provider.start();
  let p = await launch(dir);
  await configure(p, url);
  await wait(p, (w) => w.agents.every((a) => a.status === 'error'));
  let stats = await p.evaluate(() => window.frontier.agentRuntime());
  expect(stats.requests).toBe(6);
  expect(stats.repairs).toBe(4);
  expect(stats.failures).toBe(2);
  expect(stats.concurrency).toBe(0);
  expect(stats).not.toHaveProperty('queued');
  const started = Date.now();
  for (let i = 0; i < 5; i++) {
    await p.evaluate(() =>
      window.frontier.command({ type: 'retryAgent', agentId: 'ops-meridian' }),
    );
    await wait(p, (w) => w.agents.find((a) => a.id === 'ops-meridian')?.status === 'error');
  }
  stats = await p.evaluate(() => window.frontier.agentRuntime());
  expect(stats.requests).toBe(21);
  expect(Date.now() - started).toBeLessThan(15000);
  expect(provider.requests.every((r) => !('reasoning_effort' in r))).toBe(true);
  await p.evaluate(async () => {
    await window.frontier.command({ type: 'speed', speed: 16 });
    await window.frontier.command({ type: 'pause', paused: false });
  });
  await p.waitForTimeout(1700);
  expect(provider.requests).toHaveLength(21);
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  await p.getByRole('button', { name: 'Console Settings', exact: true }).click();
  const settings = p.getByRole('dialog', { name: '控制台设置' });
  await expect(settings.getByLabel('全局请求上限')).toHaveCount(0);
  await expect(settings.getByLabel('Agent 请求上限')).toHaveCount(0);
  await expect(settings.getByTestId('agent-usage')).toContainText('本次运行请求 21');
  await settings.getByTestId('agent-usage').scrollIntoViewIfNeeded();
  await expect(settings.getByTestId('agent-usage')).toBeInViewport();
  await p.screenshot({ path: join(output, 'unlimited-call-stats.png'), animations: 'disabled' });
  await settings.getByRole('button', { name: '关闭面板', exact: true }).click();
  await p.evaluate(() => window.frontier.save());
  await app!.close();
  app = undefined;
  p = await launch(dir);
  provider.mode = 'cooperate';
  const comm = await chat(p);
  await comm.locator('[data-channel-id="private:ops-meridian"]').click();
  await comm.getByLabel('通讯消息').fill('请评估当前状况。');
  await comm.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
  await wait(p, (w) => w.agents.find((a) => a.id === 'ops-meridian')?.decision.lastError === null);
  expect((await p.evaluate(() => window.frontier.agentRuntime())).requests).toBeGreaterThan(0);
});

test('Electron keeps one low-ammo report across elapsed hours, rename and restart', async () => {
  mkdirSync(output, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'frontier-ammo-once-'));
  const e = quietEngine();
  e.state.agents.forEach((a) => {
    a.enabled = false;
  });
  const ship = e.state.ships.find((s) => s.id === 'horizon')!;
  ship.photon = 0;
  ship.quantum = 0;
  ship.standing.serviceWhenDocked = false;
  new SaveStore(dir).write(e.state);
  let p = await launch(dir);
  const count = (w: Snapshot) =>
    w.chatMessages.filter((m) => m.content.includes('弹药不足') && m.content.includes('HORIZON'))
      .length;
  await p.evaluate(async () => {
    await window.frontier.command({ type: 'speed', speed: 16 });
    await window.frontier.command({ type: 'pause', paused: false });
  });
  await wait(p, (w) => w.time >= 125);
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  expect(count(await state(p))).toBe(1);
  await p.evaluate(() =>
    window.frontier.command({ type: 'renameEntity', entityId: 'horizon', name: 'Renamed Horizon' }),
  );
  await p.evaluate(() => window.frontier.save());
  await app!.close();
  app = undefined;
  p = await launch(dir);
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await wait(p, (w) => w.time >= 250);
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  const restored = await state(p);
  expect(restored.chatMessages.filter((m) => m.content.includes('弹药不足'))).toHaveLength(1);
  const comm = await chat(p);
  await comm.locator('[data-channel-id="system-reports"]').click();
  await expect(comm.getByRole('log').getByText(/弹药不足/)).toHaveCount(1);
  await p.screenshot({ path: join(output, 'ammo-alert-once.png') });
});

test('v14 starts independently from an isolated old fixture and preserves files across restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-v14-fixture-')),
    root = join(dir, 'frontiers-v12', 'frontier-000001');
  mkdirSync(root, { recursive: true });
  const original = readFileSync(resolve('tests/fixtures/v12/in-progress.json'), 'utf8');
  for (const name of ['head.json', 'head.json.bak', 'day-1.json'])
    writeFileSync(join(root, name), original);
  writeFileSync(
    join(dir, 'timeline-v12.json'),
    JSON.stringify({
      version: 12,
      activeId: 'frontier-000001',
      branches: [{ id: 'frontier-000001', parent: null }],
    }),
  );
  let p = await launch(dir);
  const before = await state(p);
  expect(before.version).toBe(16);
  expect(before.escortRequests).toEqual([]);
  expect(readFileSync(join(root, 'head.json'), 'utf8')).toBe(original);
  await p.evaluate(() => window.frontier.save());
  await app!.close();
  app = undefined;
  p = await launch(dir);
  const restored = await state(p);
  expect(restored.history).toEqual(before.history);
  expect(restored.ships).toEqual(before.ships);
  expect(readFileSync(join(root, 'head.json'), 'utf8')).toBe(original);
});
test('v13 request/report/composer and Agent psychology remain reachable at 1366/1024 and 100%/200% text', async () => {
  test.setTimeout(120000);
  mkdirSync(output, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'frontier-v13-layout-'));
  new SaveStore(dir).write(quietEngine().state);
  const p = await launch(dir);
  for (const [width, height, scale] of [
    [1366, 900, 1],
    [1366, 900, 2],
    [1024, 768, 1],
    [1024, 768, 2],
  ]) {
    await app!.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
      { width, height },
    );
    await p.evaluate((textScale) => {
      const key = 'frontier.lcars.console.v2',
        settings = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(
        key,
        JSON.stringify({ ...settings, version: 2, textScale, animations: 'off' }),
      );
    }, scale);
    await p.reload();
    await p.getByTestId('chat-launcher').waitFor();
    let comm = await chat(p);
    await expect(comm.getByLabel('通讯任务模式')).toBeInViewport();
    await expect(comm.getByLabel('通讯消息')).toBeInViewport();
    await expect(comm.getByRole('button', { name: 'SEND / 发送', exact: true })).toBeInViewport();
    await comm.getByLabel('通讯消息').fill('@Talia 巡逻基地 5 分钟');
    await comm.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
    await wait(p, (w) => w.objectives.some((t) => t.consent === 'proposed'));
    await comm.getByRole('button', { name: 'REQUESTS / 待处理请求', exact: true }).click();
    const takeover = comm.getByRole('button', { name: '直接接管', exact: true }).last();
    await takeover.scrollIntoViewIfNeeded();
    await expect(takeover).toBeInViewport();
    await p.screenshot({ path: join(output, `requests-${width}-text-${scale * 100}.png`) });
    await comm.locator('[data-channel-id="system-reports"]').scrollIntoViewIfNeeded();
    await comm.locator('[data-channel-id="system-reports"]').click();
    await expect(comm.getByLabel('通讯消息')).toHaveCount(0);
    await expect(comm).toContainText('此频道只读');
    await p.screenshot({ path: join(output, `reports-${width}-text-${scale * 100}.png`) });
    await comm.getByRole('button', { name: '关闭面板', exact: true }).click();
    const menu = p.getByRole('button', { name: 'MENU 导航', exact: true });
    if (await menu.isVisible()) await menu.click();
    await p
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: /AGENTS/ })
      .click();
    await p.getByRole('button', { name: '查看 Agent Talia', exact: true }).click();
    const agents = p.getByRole('dialog', { name: 'AGENTS 工作面板' });
    const stress = agents.locator('.meter').filter({ hasText: '压力' }).first();
    await stress.scrollIntoViewIfNeeded();
    await expect(stress).toBeInViewport();
    expect(await agents.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await p.screenshot({ path: join(output, `agents-${width}-text-${scale * 100}.png`) });
    await agents.getByRole('button', { name: '关闭管理面板', exact: true }).click();
  }
});
