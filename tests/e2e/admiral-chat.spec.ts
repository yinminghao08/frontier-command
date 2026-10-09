import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine, run } from '../helpers';
import { makeEnemy } from '../../src/engine/data';
import { updateSensors } from '../../src/engine/sensors';
import { materialize } from '../../src/engine/world-generation';
import { AgentTestProvider } from './agent-provider';
import type { Snapshot } from '../../src/engine/types';
let app: ElectronApplication | undefined, provider: AgentTestProvider | undefined;
const output = resolve('.test-data/verification/v14');
const state = async (p: Page) => (await p.evaluate(() => window.frontier.getState())).state;
async function launch(directory: string) {
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
async function configure(p:Page){provider=new AgentTestProvider();const baseUrl=await provider.start();expect((await p.evaluate(baseUrl=>window.frontier.configureAgentApi({baseUrl,defaultModel:'isolated-semantic-goals',reasoningEffort:'provider-default',apiKey:'local-semantic-only'}),baseUrl)).ok).toBe(true);}
async function send(p: Page, id: string, content: string, mode: 'voluntary' | 'direct' = 'direct') {
  const chat = p.getByRole('dialog', { name: '舰队通讯' });
  if (!(await chat.isVisible())) await p.getByTestId('chat-launcher').click();
  await chat.locator(`[data-channel-id="${id}"]`).click();
  await chat.getByLabel('通讯任务模式').selectOption(mode);
  await chat.getByLabel('通讯消息').fill(content);
  await chat.getByRole('button', { name: 'SEND / 发送', exact: true }).click();
}
async function wait(p: Page, predicate: (s: Snapshot) => boolean, timeout = 60000) {
  await expect
    .poll(
      async () => {
        const w = await state(p);
        if (w.paused)
          await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
        return predicate(w);
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

test('Electron v13: explicit direct fire preserves final Admiral authority over an unconfirmed contact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-v13-fire-')),
    e = quietEngine(),
    ship = e.state.ships.find((s) => s.id === 'horizon')!;
  ship.x = 500;
  ship.y = 50;
  const target = makeEnemy('orion-scout', 'scout', 'orion', { x: 580, y: 50 });
  target.weapons = 0;
  target.nextDecision = 10000;
  e.state.enemies.push(target);
  updateSensors(e);
  new SaveStore(dir).write(e.state);
  const p = await launch(dir),
    errors: string[] = [];
  p.on('pageerror', (error) => errors.push(error.message));
  await configure(p);
  await send(p, 'private:ops-horizon', '去把 orion scout 干掉，立即开火。实时跟踪其位置！');
  await expect
    .poll(async () => (await state(p)).ships.find((s) => s.id === 'horizon')?.current?.source)
    .toBe('admiral');
  const armed = await state(p);
  expect(armed.contacts.find((c) => c.id === target.id)?.hostile).toBe(false);
  expect(armed.ships.find((s) => s.id === ship.id)?.current).toMatchObject({
    executorAgentId: 'ops-horizon',
    actorId: 'commander',
    controlMode: 'direct',
    action: { type: 'ATTACK', targetId: target.id },
  });
  expect(armed.ships.find((s) => s.id === ship.id)?.standing.roe).toBe('RETURN FIRE');
  await p.evaluate(() => window.frontier.command({ type: 'speed', speed: 16 }));
  await wait(p, (w) => w.objectives[0]?.status === 'completed');
  const done = await state(p);
  expect(done.agents.find((a) => a.id === 'ops-horizon')!.experience).toBeGreaterThan(0);
  expect(done.history.some((h) => h.kind === 'factionLoss' && h.entityId === target.id)).toBe(true);
  await p
    .getByRole('dialog', { name: '舰队通讯' })
    .locator('[data-channel-id="private:ops-horizon"]')
    .click();
  expect(done.agentRuntime.tasks.find(t=>t.objectiveId===done.objectives[0].id)?.progress.verified).toBe(true);
  await expect(p.getByRole('log')).toContainText('已接受直接授权');
  await p.screenshot({ path: join(output, 'admiral-fire.png') });
  expect(errors).toEqual([]);
});

test('Electron v13: paid graduate receives VIGIL and construction requests voluntary real logistics support', async () => {
  test.setTimeout(120000);
  const dir = mkdtempSync(join(tmpdir(), 'frontier-v13-construction-')),
    e = quietEngine();
  e.state.locations.find((l) => l.id === 'colony')!.colony!.nextCandidate = 0;
  run(e, 0.1);
  const candidate = e.state.personnel.find((p) => p.status === 'candidate')!;
  e.dispatchCommand({
    type: 'candidate',
    personnelId: candidate.id,
    accept: true,
    career: 'battle',
  });
  run(e, 90);
  const cadet = e.state.agents.find((a) => a.originPersonnelId === candidate.id)!;
  const sector = materialize(e.state, { q: 0, r: 2 });
  sector.discovered = true;
  const systems = e.state.systems.filter((s) => s.sectorId === sector.id);
  for (const s of systems) {
    s.discovered = true;
    s.survey = 2;
  }
  for (const b of e.state.bodies.filter((b) => systems.some((s) => s.id === b.systemId))) {
    b.discovered = true;
    b.survey = 2;
  }
  const body = e.state.bodies.find(
    (b) => b.kind === 'resource' && systems.some((s) => s.id === b.systemId),
  )!;
  e.state.paused = true;
  new SaveStore(dir).write(e.state);
  provider = new AgentTestProvider();
  const url = await provider.start(),
    p = await launch(dir);
  await p.evaluate(async (baseUrl) => {
    await window.frontier.configureAgentApi({
      baseUrl,
      defaultModel: 'isolated-construction',
      reasoningEffort: 'none',
      apiKey: 'local-construction-key',
    });
  }, url);
  await send(p, 'frontier-command', '@' + cadet.name + ' USS VIGIL 给你了');
  await expect
    .poll(async () => (await state(p)).agents.find((a) => a.id === cadet.id)?.assignedShipId)
    .toBe('vigil');
  const before = (await state(p)).resources.credits;
  await send(p, 'private:' + cadet.id, '你去建设好 ' + body.name, 'voluntary');
  await expect.poll(async()=>{const objective=(await state(p)).objectives.find(o=>o.goal.kind==='construction');return objective?.consent;}).toBe('accepted');
  await p.evaluate(() => window.frontier.command({ type: 'speed', speed: 16 }));
  await wait(p, (w) =>
    w.escortRequests.some((r) => r.kind === 'logistics' && r.status === 'accepted'),
  );
  const start = await state(p);
  expect(start.resources.credits).toBeGreaterThanOrEqual(before - 165);
  expect(start.projects.filter((project) => project.siteId === body.id)).toHaveLength(1);
  await wait(p, (w) => w.objectives.find(o=>o.goal.kind==='construction'&&o.goal.siteId===body.id)?.status === 'completed', 90000);
  const done = await state(p);
  expect(done.locations.some((l) => l.siteId === body.id && l.kind === 'mine')).toBe(true);
  expect(done.history.some((h) => h.kind === 'cargo' && h.text.includes('装载 30'))).toBe(true);
  expect(done.escortRequests.find((r) => r.kind === 'logistics')?.status).toBe('completed');
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  await p.evaluate(() => window.frontier.save());
  await p.screenshot({ path: join(output, 'construction-cooperation.png') });
  const taskId = done.objectives.find(o=>o.goal.kind==='construction'&&o.goal.siteId===body.id)!.id;
  await app!.close();
  app = undefined;
  const restarted = await launch(dir);
  expect((await state(restarted)).objectives.find((t) => t.id === taskId)?.status).toBe(
    'completed',
  );
});

test('Electron v13: direct route forbids wormholes, survives restart, and map takeover cancels future steps', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-v13-route-'));
  new SaveStore(dir).write(quietEngine().state);
  let p = await launch(dir);
  await configure(p);
  await send(p, 'private:ops-horizon', '沿 0/0 一路测绘到 0/2，不走虫洞');
  await expect.poll(async () => (await state(p)).objectives[0]?.allowWormholes).toBe(false);
  await p.evaluate(() => window.frontier.command({ type: 'speed', speed: 16 }));
  await wait(p, (w) => w.agentRuntime.tasks.find(t=>t.objectiveId===w.objectives[0]?.id)?.execution.sectorIndex === 1);
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  await p.evaluate(() => window.frontier.save());
  await app!.close();
  app = undefined;
  p = await launch(dir);
  expect((await state(p)).objectives[0]).toMatchObject({
    status: 'active',

    allowWormholes: false,
  });
  await p.evaluate(() =>
    window.frontier.command({
      type: 'issueDirective',
      shipIds: ['horizon'],
      mode: 'REPLACE',
      action: { type: 'MOVE', point: { x: -240, y: 0 } },
    }),
  );
  expect((await state(p)).objectives[0].status).toBe('interrupted');
  await send(p, 'private:ops-horizon', '取消当前任务');
  await expect
    .poll(async () => (await state(p)).ships.find((s) => s.id === 'horizon')?.current)
    .toBeNull();
  await p.screenshot({ path: join(output, 'route-control.png') });
});
