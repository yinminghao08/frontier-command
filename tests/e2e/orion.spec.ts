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
import { piracyScenario } from '../orion-scenarios';
import { until } from '../helpers';
import { makeLocation } from '../../src/engine/data';
import { AgentTestProvider } from './agent-provider';
import type { Snapshot } from '../../src/engine/types';
let app: ElectronApplication | undefined, provider: AgentTestProvider | undefined;
const output = resolve('docs/verification/v14');
const state = async (p: Page) => (await p.evaluate(() => window.frontier.getState())).state;
async function launch(dir: string, width = 1366, height = 900) {
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: dir, FRONTIER_HEADLESS: '1' },
  });
  const p = await app.firstWindow();
  await p.getByRole('navigation', { name: '主导航' }).waitFor();
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
    { width, height },
  );
  await p.evaluate(() => document.fonts.ready);
  return p;
}
async function wait(p: Page, predicate: (w: Snapshot) => boolean, resume = true, timeout = 90000) {
  await expect
    .poll(
      async () => {
        const w = await state(p);
        if (predicate(w)) return true;
        if (resume && w.paused && w.status === 'active')
          await p.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
        return false;
      },
      { timeout, intervals: [100] },
    )
    .toBe(true);
}
async function selectCarrier(p: Page) {
  await p.locator('.operation-chip[data-ship-id="meridian"]').click();
  await p.getByRole('region', { name: '海盗遭遇' }).waitFor();
}
function scene(enableAgents = false) {
  const { e, ship } = piracyScenario('manual');
  const escort = e.state.ships.find((s) => s.id === 'horizon')!;
  escort.x = ship.x + 350;
  escort.y = ship.y;
  e.state.locations.push(
    makeLocation('rescue-refuge', 'RESCUE REFUGE', 'outpost', { x: 420, y: 1200 }),
  );
  until(e, () => e.state.piracyIncidents.length > 0, 5);
  e.state.paused = true;
  e.state.speed = 16;
  for (const a of e.state.agents) {
    a.enabled = enableAgents;
    a.modelConfig.reasoningEffort = 'none';
  }
  return e.state;
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  await provider?.close();
  provider = undefined;
});
test('Electron v14: real new-game reconnaissance, natural freight and private Orion data', async () => {
  test.setTimeout(150000);
  mkdirSync(output, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'frontier-orion-new-')),
    p = await launch(dir);
  expect((await state(p)).version).toBe(15);
  const r = await p.evaluate(() =>
    window.frontier.command({
      type: 'issueDirective',
      shipIds: ['meridian'],
      mode: 'REPLACE',
      action: {
        type: 'HAUL',
        sourceId: 'mine',
        targetId: 'base',
        cargoKind: 'materials',
        amount: 120,
        route: 'direct',
        repeat: false,
      },
    }),
  );
  expect(r.ok).toBe(true);
  await p.getByRole('button', { name: '16×', exact: true }).click();
  await wait(
    p,
    (w) => w.piracyIncidents.length > 0 || w.locations.find((l) => l.id === 'mine')!.attackedAt > 0,
    true,
    120000,
  );
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  await p.evaluate(() => window.frontier.save());
  const world = await state(p),
    bytes = JSON.stringify(world);
  expect(bytes).not.toContain('counterTracking');
  expect(bytes).not.toContain('realizedIncome');
  expect(world.locations.some((l) => l.owner === 'orion')).toBe(false);
  const saved = JSON.parse(readFileSync(new SaveStore(dir).path, 'utf8'));
  expect(saved.enemies.filter((s: { factionId: string }) => s.factionId === 'orion').length).toBe(
    10,
  );
  expect(saved.orion.operations.length).toBeGreaterThan(0);
  writeFileSync(
    join(output, 'opening-electron.json'),
    JSON.stringify(
      {
        time: world.time,
        cargo: world.ships.find((s) => s.id === 'meridian')!.cargo,
        incidents: world.piracyIncidents,
        observedContacts: world.contacts.length,
        orionAssets: saved.enemies.filter((s: { factionId: string }) => s.factionId === 'orion')
          .length,
      },
      null,
      2,
    ),
  );
  await p.screenshot({ path: join(output, 'opening-electron.png') });
});
test('Electron v14: LCARS policy, Admiral interruption, finite cargo loss and restart', async () => {
  mkdirSync(output, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'frontier-orion-policy-'));
  new SaveStore(dir).write(scene());
  let p = await launch(dir);
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await selectCarrier(p);
  await p.getByLabel('海盗交货策略').selectOption('preserveShip');
  expect((await state(p)).ships.find((s) => s.id === 'meridian')!.piracyPolicy).toBe(
    'preserveShip',
  );
  await p.getByRole('button', { name: '拒绝勒索 / 中断交货', exact: true }).click();
  expect((await state(p)).piracyIncidents[0].responseSource).toBe('admiral');
  await p.getByRole('button', { name: '同意有限交货', exact: true }).click();
  await p.screenshot({ path: join(output, 'extortion-lcars.png') });
  await wait(p, (w) => w.piracyIncidents[0].stage === 'resolved');
  await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  const before = await state(p);
  expect(before.piracyIncidents[0].lost.materials).toBe(50);
  expect(before.ships.find((s) => s.id === 'meridian')!.cargo.materials).toBe(150);
  await expect(p.getByRole('region', { name: '海盗遭遇' })).toContainText('实际货损');
  await p.evaluate(() => window.frontier.save());
  await app!.close();
  app = undefined;
  p = await launch(dir);
  const restored = await state(p);
  expect(restored.piracyIncidents).toEqual(before.piracyIncidents);
  expect(restored.ships.find((s) => s.id === 'meridian')!.cargo).toEqual(
    before.ships.find((s) => s.id === 'meridian')!.cargo,
  );
  expect(errors).toEqual([]);
});
test('Electron v14: 1024/1366 and 100%/200% extortion controls remain usable', async () => {
  mkdirSync(output, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'frontier-orion-layout-'));
  new SaveStore(dir).write(scene());
  const p = await launch(dir);
  for (const [width, height, textScale] of [
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
    await p.evaluate((scale) => {
      const key = 'frontier.lcars.console.v2';
      const current = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(
        key,
        JSON.stringify({ ...current, version: 2, textScale: scale, animations: 'off' }),
      );
    }, textScale);
    await p.reload();
    await p.getByRole('heading', { name: 'FRONTIER COMMAND', exact: true }).waitFor();
    await selectCarrier(p);
    const button = p.getByRole('button', { name: '同意有限交货', exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    await p.screenshot({
      path: join(output, 'piracy-' + width + '-text-' + textScale * 100 + '.png'),
    });
    const policy = p.getByLabel('海盗交货策略');
    await policy.scrollIntoViewIfNeeded();
    await expect(policy).toBeInViewport();
    await policy.selectOption('manual');
  }
});
for (const refusal of [false, true])
  test(
    'Electron v14: local provider Logistics requests Battle rescue / ' +
      (refusal ? 'refused' : 'accepted'),
    async () => {
      test.setTimeout(180000);
      mkdirSync(output, { recursive: true });
      const dir = mkdtempSync(join(tmpdir(), 'frontier-orion-agents-'));
      new SaveStore(dir).write(scene(true));
      provider = new AgentTestProvider();
      provider.mode = refusal ? 'piracyRefuse' : 'piracy';
      const baseUrl = await provider.start(),
        p = await launch(dir);
      const result = await p.evaluate(
        (url) =>
          window.frontier.configureAgentApi({
            baseUrl: url,
            defaultModel: 'piracy-test-model',
            reasoningEffort: 'none',
            apiKey: 'isolated-piracy-test-key',
          }),
        baseUrl,
      );
      expect(result.ok).toBe(true);
      await wait(
        p,
        (w) =>
          w.escortRequests.some(
            (r) => r.kind === 'reinforce' && r.status === (refusal ? 'rejected' : 'accepted'),
          ),
        false,
      );
      await wait(p, (w) => w.piracyIncidents[0].stage === 'resolved');
      await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
      let world = await state(p);
      expect(provider.requests.length).toBeGreaterThanOrEqual(2);
      expect(world.escortRequests[0].kind).toBe('reinforce');
      for (const request of provider.requests.filter((r) =>
        r.messages[1]?.content.startsWith('{'),
      )) {
        const observation = JSON.parse(request.messages[1].content);
        if (observation.self)
          expect(['ops-meridian', 'ops-horizon']).toContain(observation.self.id);
        expect(request.messages[1].content).not.toContain('counterTracking');
      }
      if (refusal) expect(world.piracyIncidents[0].lost.materials).toBeGreaterThan(0);
      else {
        expect(world.piracyIncidents[0].lost.materials).toBe(0);
        expect(world.ships.find((s) => s.id === 'horizon')!.current?.action.type).toBe('ESCORT');
        await wait(p, (w) => w.escortRequests[0].status === 'completed', true, 150000);
        world = await state(p);
        expect(world.ships.find((s) => s.id === 'meridian')!.cargo.materials).toBe(200);
        expect(world.agents.find((a) => a.id === 'ops-horizon')!.experience).toBeGreaterThan(0);
        expect(world.escortRequests[0].rescueArrivedAt).toBeDefined();
        expect(
          world.history.some((h) => h.kind === 'rescueArrived' && h.entityId === 'meridian'),
        ).toBe(true);
      }
      await p.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
      await p.screenshot({
        path: join(output, 'agent-rescue-' + (refusal ? 'refused' : 'completed') + '.png'),
      });
      writeFileSync(
        join(output, 'agent-rescue-' + (refusal ? 'refused' : 'completed') + '.json'),
        JSON.stringify(
          {
            incident: world.piracyIncidents[0],
            request: world.escortRequests[0],
            providerRequests: provider.requests.length,
          },
          null,
          2,
        ),
      );
    },
  );
