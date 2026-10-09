import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine } from '../helpers';
import type { Snapshot } from '../../src/engine/types';

let app: ElectronApplication | undefined, server: Server | undefined;
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});
test('FAR v16 real Electron: model directory, canonical assignment, task revisions and retained cargo', async () => {
  test.setTimeout(120000);
  const directory = mkdtempSync(join(tmpdir(), 'frontier-far-v16-')),
    output = resolve('.test-data/verification/v16');
  mkdirSync(output, { recursive: true });
  const e = quietEngine(),
    ship = e.state.ships.find((s) => s.id === 'meridian')!,
    mine = e.state.locations.find((l) => l.id === 'mine')!;
  e.state.bodies.find((b) => b.id === mine.siteId)!.remaining = 0;
  mine.stock.materials = 80;
  ship.x = mine.x;
  ship.y = mine.y;
  ship.cargo = { materials: 0, photon: 0, quantum: 0, specialFinds: 0 };
  e.state.paused = true;
  for (const a of e.state.agents) a.enabled = a.id === 'ops-meridian';
  new SaveStore(directory).write(e.state);
  const requests: { purpose: string; model: string; bytes: number }[] = [];
  server = createServer((req, res) => {
    if (req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'far-mock' }, { id: 'far-agent-override' }] }));
      return;
    }
    let buffer = '';
    req.on('data', (data) => (buffer += data));
    req.on('end', () => {
      const body = JSON.parse(buffer),
        prompt = body.messages[0].content as string,
        purpose = prompt.split(':')[0];
      requests.push({ purpose, model: body.model, bytes: Buffer.byteLength(buffer) });
      const decision =
        purpose === 'Intent'
          ? {
              disposition: 'propose',
              proposal: {
                kind: 'loadReturn',
                sourceId: 'mine',
                destinationId: 'base',
                cargoKind: 'materials',
                deliver: false,
                route: 'safe',
              },
              allowWormholes: true,
              reply: '装走库存后返航',
            }
          : purpose === 'TaskJudgment'
            ? {
                response: 'accept',
                reason: 'preference',
                reply: '我会装走库存并返航，货物保留在舰上。',
                conditions: [],
              }
            : purpose === 'StrategicDecision'
              ? { opportunityId: null, riskPreference: 'cautious', reason: '等待 Admiral 的目标' }
              : { ok: true };
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(decision) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Mock did not bind');
  const baseUrl = 'http://127.0.0.1:' + address.port + '/v1';
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const p = await app.firstWindow();
  await p.getByTestId('chat-launcher').waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1800, 1100),
  );
  await p.evaluate(() => document.fonts.ready);
  const errors: string[] = [];
  p.on('pageerror', (error) => errors.push(error.message));
  await p.getByRole('button', { name: 'Console Settings', exact: true }).click();
  const settings = p.getByRole('dialog', { name: '控制台设置' });
  await settings.getByLabel('Agent API Base URL').fill(baseUrl);
  await settings.getByLabel('Agent API Key').fill('far-local-ui-secret');
  await settings.getByLabel('Agent 默认模型').fill('far-mock');
  await settings.getByLabel('Agent 默认推理').selectOption('provider-default');
  await settings.getByLabel('Agent 默认思考').selectOption('provider-default');
  await settings.getByRole('button', { name: /FETCH MODELS/ }).click();
  await expect(settings.locator('.api-test-success')).toContainText('已获取模型目录');
  await expect(settings.locator('#agent-model-directory option')).toHaveCount(2);
  await settings.getByRole('button', { name: '保存 Agent API', exact: true }).click();
  await expect(settings.locator('.api-test-success')).toContainText('系统加密');
  await p.screenshot({ path: join(output, 'far-provider-settings.png') });
  await settings.getByRole('button', { name: '关闭面板', exact: true }).click();
  await p
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /AGENTS/ })
    .click();
  const agents = p.getByRole('dialog', { name: 'AGENTS 工作面板' });
  await agents.getByRole('button', { name: '查看 Agent Mira', exact: true }).click();
  await expect(agents.getByTestId('agent-assignment')).toContainText(ship.name);
  await agents.getByLabel('Agent 独立模型').fill('far-agent-override');
  await agents.getByLabel('Agent 独立思考').selectOption('provider-default');
  await agents.getByRole('button', { name: '保存 Agent 模型', exact: true }).click();
  await agents.getByRole('button', { name: '与 Mira 私聊', exact: true }).click();
  const chat = p.getByRole('dialog', { name: '舰队通讯' });
  await expect(chat.locator('.chat-conversation-heading')).toContainText(ship.name);
  await chat.getByLabel('通讯消息').fill('去矿场装满货仓，然后返回基地');
  await chat.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
  const state = () => p.evaluate(() => window.frontier.getState()).then((r) => r.state as Snapshot);
  await expect
    .poll(async () => (await state()).ships.find((s) => s.id === 'meridian')?.current?.action.type)
    .toBe('LOAD');
  expect(requests.filter((r) => r.purpose === 'Intent')).toHaveLength(1);
  expect(requests.filter((r) => r.purpose === 'TaskJudgment')).toHaveLength(1);
  expect(
    requests
      .filter((r) => ['Intent', 'TaskJudgment'].includes(r.purpose))
      .every((r) => r.model === 'far-agent-override'),
  ).toBe(true);
  await chat.getByRole('button', { name: /REQUESTS/ }).click();
  const card = chat.locator('.task-card').filter({ hasText: '去矿场装满货仓' });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('task-step')).toContainText('装载');
  await p.screenshot({ path: join(output, 'far-task-loading.png') });
  await p.evaluate(() => window.frontier.command({ type: 'speed', speed: 1 }));
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await expect
    .poll(
      async () => (await state()).ships.find((s) => s.id === 'meridian')?.current?.action.type,
      { timeout: 45000 },
    )
    .toBe('RETURN');
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  await card.getByRole('button', { name: '修改目标', exact: true }).click();
  const revision = p.getByRole('dialog', { name: '修改完整目标' });
  await revision.locator('input[type=checkbox]').check();
  await revision.getByRole('button', { name: '提交目标修订', exact: true }).click();
  await expect
    .poll(async () => requests.filter((r) => r.purpose === 'TaskJudgment').length)
    .toBe(2);
  const calls = requests.length;
  await p.evaluate(() => window.frontier.command({ type: 'speed', speed: 16 }));
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await expect
    .poll(
      async () =>
        (await state()).agentRuntime.tasks.find((t) => t.ownerAgentId === 'ops-meridian')?.status,
      { timeout: 45000 },
    )
    .toBe('completed');
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  await chat.getByRole('button', { name: '包含已结束目标', exact: true }).click();
  await expect(card.getByTestId('task-cargo')).toContainText('交付 80.0');
  await card.getByText('步骤历史与完成证据', { exact: true }).click();
  await expect(card).toContainText('实际装载货物已交付');
  await p.screenshot({ path: join(output, 'far-task-verified.png') });
  const world = await state(),
    parent = world.chatMessages.find((m) => m.content === '去矿场装满货仓，然后返回基地')!;
  expect(
    world.chatMessages.filter((m) => m.sender === 'ops-meridian' && m.replyTo === parent.id),
  ).toHaveLength(1);
  expect(requests).toHaveLength(calls);
  expect(world.ships.find((s) => s.id === 'meridian')?.cargo.materials).toBe(0);
  expect(world.locations.find((l) => l.id === 'base')!.stock.materials).toBe(
    e.base.stock.materials + 80,
  );
  expect(errors).toEqual([]);
  await app.close();
  app = undefined;
  const disk = readFileSync(join(directory, 'timeline-v16.json'), 'utf8');
  expect(disk).not.toContain('far-local-ui-secret');
});
