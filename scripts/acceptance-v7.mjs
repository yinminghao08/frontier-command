import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { createWorld } = require('../dist-electron/src/engine/data.js');
const { SaveStore } = require('../dist-electron/electron/persistence.js');
const seed = Number(process.argv[2] ?? 236807),
  observe = process.argv.includes('--observe');
const dir = mkdtempSync(join(tmpdir(), 'frontier-v7-acceptance-')),
  out = resolve('docs/verification/v7');
mkdirSync(out, { recursive: true });
// Only normal new-world initialization. All subsequent mutations are UI commands.
new SaveStore(dir).write(createWorld(seed));
const app = await electron.launch({
  args: [resolve('.')],
  env: { ...process.env, FRONTIER_USER_DATA: dir, FRONTIER_HEADLESS: '0' },
});
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
const log = join(out, `acceptance-${seed}.jsonl`);
const record = (data) => {
  const entry = { wall: new Date().toISOString(), ...data };
  appendFileSync(log, JSON.stringify(entry) + '\n');
  console.log(JSON.stringify(entry));
};
const state = async () => (await page.evaluate(() => window.frontier.getState())).state;
const assert = (condition, message) => {
  if (!condition) throw Error(message);
};
const check = async (name) => {
  const s = await state();
  record({
    step: name,
    time: s.time,
    paused: s.paused,
    credits: s.resources.credits,
    ships: s.ships.map((s) => ({ id: s.id, hull: s.hull, cargo: s.cargo, current: s.current })),
    locations: s.locations
      .filter((l) => l.owner === 'starfleet')
      .map((l) => ({
        id: l.id,
        name: l.name,
        stock: l.stock,
        storageFull: l.storageFull,
        supplyState: l.supplyState,
        population: l.colony?.population,
      })),
    events: s.events,
    trade: s.trade.orders,
    history: s.history.slice(-12),
  });
  await page.screenshot({ path: join(out, `${seed}-${name}.png`), animations: 'disabled' });
};
const nav = async (name) => {
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: new RegExp(name) })
    .click();
};
async function fields(dialog, values) {
  for (const [label, value] of Object.entries(values)) {
    const f = dialog.getByLabel(label, { exact: true });
    if (await f.evaluate((el) => el.tagName === 'SELECT')) await f.selectOption(String(value));
    else if ((await f.getAttribute('type')) === 'checkbox') await f.setChecked(!!value);
    else await f.fill(String(value));
  }
}
async function action(ship, type, values = {}, mode = 'REPLACE') {
  await page.keyboard.press('Escape');
  await page.locator(`.operation-chip[data-ship-id="${ship}"]`).click();
  await page.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Admiral 指令' });
  await d.getByLabel('指令类型', { exact: true }).selectOption(type);
  await d.getByLabel('提交模式').selectOption(mode);
  await fields(d, values);
  await d.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
  record({ uiAction: type, ship, values, mode, time: (await state()).time });
}
async function wait(predicate, label, timeout = 90000) {
  const start = Date.now();
  let last = 0;
  while (Date.now() - start < timeout) {
    const s = await state();
    assert(s.status === 'active', 'Dawn lost during ' + label);
    if (predicate(s)) return s;
    if (s.paused) await page.getByRole('button', { name: '继续', exact: true }).click();
    if (Date.now() - last > 15000) {
      record({
        waiting: label,
        time: s.time,
        ships: s.ships.map((s) => ({
          id: s.id,
          action: s.current?.action.type,
          note: s.current?.note,
        })),
        events: s.events
          .filter((v) => v.stage === 'reported' || v.stage === 'responding')
          .map((v) => ({ id: v.id, kind: v.kind, subject: v.subjectId })),
      });
      last = Date.now();
    }
    await page.waitForTimeout(300);
  }
  throw Error('Timed out: ' + label);
}
async function facility(id) {
  await nav('COLONIES');
  await page
    .getByRole('dialog', { name: 'COLONIES 工作面板' })
    .locator(`[data-entity-id="${id}"]`)
    .click();
}
async function assist(id) {
  await action('verity', 'ASSIST_EVENT', { 指令目标: id });
  await wait((s) => s.events.find((v) => v.id === id)?.stage === 'resolved', 'event response');
}
page.on('pageerror', (e) => record({ pageerror: e.message }));
try {
  await page.getByRole('navigation', { name: '主导航' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  record({ start: true, seed, directory: dir, normalWorld: true });
  await check('start');
  await action('horizon', 'PATROL', { 指令目标: 'mine', 巡逻时间: 1440 });
  await action('meridian-2', 'HAUL', {
    货运起点: 'base',
    指令目标: 'mine',
    货物种类: 'supplies',
    货物数量: 40,
    航线: 'direct',
  });
  await action('verity', 'EXPLORE', { 探索星区: 'sector:0:-1', 调查方式: 'close' });
  await page.getByRole('button', { name: '16×', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  let s = await wait((s) => s.sectors.some((sec) => sec.id === 'sector:0:-1'), 'new Sector');
  const resource = s.bodies.find(
    (b) => b.kind === 'resource' && b.systemId.startsWith('sector:0:-1'),
  );
  assert(resource, 'new Sector must contain a discovered resource for this verified seed');
  await action('verity', 'SURVEY', { 指令目标: resource.id, 调查方式: 'close' });
  await wait((s) => s.bodies.find((b) => b.id === resource.id)?.survey === 2, 'survey resource');
  await check('resource');
  await nav('OPERATIONS');
  await page
    .getByRole('dialog', { name: 'OPERATIONS 工作面板' })
    .getByRole('button')
    .filter({ hasText: resource.name })
    .click();
  await page.getByLabel('设施类型', { exact: true }).selectOption('mine');
  await page.getByLabel('新设施名称').fill('ADMIRAL FRONTIER MINE');
  await page.getByRole('button', { name: '建立现场建设项目', exact: true }).click();
  const project = (await state()).projects.at(-1);
  await facility(project.id);
  await page.getByRole('button', { name: '安排建设物资 / 分批真实货运', exact: true }).click();
  await wait((s) => s.projects.find((p) => p.id === project.id)?.complete, 'physical construction');
  s = await state();
  const mine = s.locations.find((l) => l.siteId === resource.id && l.kind === 'mine');
  assert(mine, 'mine constructed');
  await check('mine-built');
  await action('meridian-3', 'HAUL', {
    货运起点: 'base',
    指令目标: mine.id,
    货物种类: 'supplies',
    货物数量: 70,
    航线: 'direct',
  });
  await action('vigil', 'PATROL', { 指令目标: mine.id, 巡逻时间: 1440 });
  // A mine accident is causal and must be treated before stock can fill.
  for (let i = 0; i < 8; i++) {
    s = await wait(
      (s) =>
        s.locations.find((l) => l.id === mine.id)?.storageFull ||
        s.events.some(
          (v) => v.kind === 'accident' && v.subjectId === mine.id && v.stage === 'reported',
        ),
      'mine full or accident',
    );
    if (s.locations.find((l) => l.id === mine.id)?.storageFull) break;
    const v = s.events.find(
      (v) => v.kind === 'accident' && v.subjectId === mine.id && v.stage === 'reported',
    );
    await assist(v.id);
    await check('event-response-' + i);
  }
  s = await state();
  assert(s.locations.find((l) => l.id === mine.id).stock.materials === 600, 'finite mine filled');
  assert(
    s.communications.some((c) => c.entityId === mine.id && c.text.includes('仓库已满')),
    'transport request',
  );
  await check('storage-full');
  await wait(
    (s) =>
      ['meridian', 'meridian-2', 'meridian-3'].every(
        (id) =>
          !s.ships.find((x) => x.id === id)?.current ||
          s.ships.find((x) => x.id === id)?.current?.source === 'standing',
      ),
    'available freighters',
  );
  await nav('FLEET');
  await page.getByLabel('编队名称').fill('MERIDIAN LOGISTICS GROUP');
  await page.getByRole('button', { name: '创建编队', exact: true }).click();
  await page.getByRole('button', { name: '下达 运输货物', exact: true }).click();
  let d = page.getByRole('dialog', { name: 'Admiral 指令' });
  await fields(d, {
    货运起点: mine.id,
    指令目标: 'base',
    货物种类: 'materials',
    货物数量: 600,
    航线: 'direct',
  });
  const baseline = (await state()).locations.find((l) => l.id === 'base').stock.materials;
  await d.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
  await action('vigil', 'ESCORT', { 指令目标: 'meridian' });
  await wait(
    (s) =>
      s.history.some(
        (h) =>
          h.kind === 'cargo' &&
          h.entityId === 'base' &&
          h.text.includes('实际交付') &&
          h.text.includes('600'),
      ),
    'group haul delivery',
  );
  s = await state();
  assert(
    s.locations.find((l) => l.id === 'base').stock.materials >= baseline + 600,
    'actual delivered Materials',
  );
  await check('group-delivery');
  // Respond to an actual Orion contact using the Admiral command UI.
  const contact = s.contacts.find((c) => c.factionId === 'orion' && !c.resolved);
  if (contact) {
    await action('vigil', 'INTERCEPT', { 指令目标: contact.id });
    await wait(
      (s) =>
        s.history.some((h) => h.kind === 'directive' && h.text.includes('截获')) ||
        s.ships.find((x) => x.id === 'vigil')?.current?.action.type !== 'INTERCEPT',
      'intercept',
    );
    await check('intercept');
  } else
    record({
      orionContact:
        'not currently public; retained intelligence will be verified from persisted world',
    });
  await action('meridian-2', 'HAUL', {
    货运起点: 'colony',
    指令目标: 'base',
    货物种类: 'supplies',
    货物数量: 50,
    航线: 'direct',
  });
  await wait(
    (s) => s.locations.find((l) => l.id === 'base').stock.supplies >= 10,
    'colony Supplies reach Starbase',
  );
  await nav('STARBASE');
  await page.getByRole('tab', { name: 'SHIPYARD', exact: true }).click();
  await page.getByLabel('建造舰级').selectOption('peregrine');
  await page.getByLabel('新舰名称').fill('USS V7 FRONTIER');
  const beforeShip = (await state()).locations.find((l) => l.id === 'base').stock.materials;
  await page.getByRole('button', { name: '建造新舰', exact: true }).click();
  await wait((s) => s.jobs.some((j) => j.name === 'USS V7 FRONTIER'), 'paid shipyard job');
  assert(
    (await state()).locations.find((l) => l.id === 'base').stock.materials === beforeShip - 20,
    'ship consumes actual Materials',
  );
  await wait((s) => s.ships.some((x) => x.name === 'USS V7 FRONTIER'), 'new ship');
  await check('ship-built');
  s = await state();
  let candidate = s.personnel.find((p) => p.status === 'candidate');
  if (candidate) {
    await nav('PERSONNEL');
    let row = page.locator(`[data-entity-id="${candidate.id}"]`);
    await row.getByRole('button', { name: '接受并培养', exact: true }).click();
    await wait(
      (s) => s.personnel.find((p) => p.id === candidate.id)?.status === 'available',
      'cadet training',
    );
    await nav('PERSONNEL');
    row = page.locator(`[data-entity-id="${candidate.id}"]`);
    await row.getByLabel('任职目标 ' + candidate.id).selectOption('colony');
    await row.getByRole('button', { name: '任命人员', exact: true }).click();
    await check('personnel');
  }
  s = await state();
  const unresolved = s.events.find(
    (v) =>
      ['accident', 'discovery', 'derelict', 'plague'].includes(v.kind) && v.stage === 'reported',
  );
  if (unresolved) await assist(unresolved.id);
  assert(
    (await state()).events.some((v) => v.stage === 'resolved'),
    'must respond to a persistent world event',
  );
  assert((await state()).resources.credits > 380, 'colony produces Credits');
  assert(
    (await state()).locations.find((l) => l.id === 'colony').stock.supplies > 60,
    'colony produces Supplies',
  );
  if (observe) {
    // Resupply actual facilities and defend before the uninterrupted 1x observation.
    await action('meridian-2', 'HAUL', {
      货运起点: 'colony',
      指令目标: mine.id,
      货物种类: 'supplies',
      货物数量: 40,
      航线: 'safe',
    });
    await action('meridian-3', 'HAUL', {
      货运起点: 'colony',
      指令目标: 'mine',
      货物种类: 'supplies',
      货物数量: 40,
      航线: 'safe',
    });
    await action('horizon', 'PATROL', { 指令目标: 'mine', 巡逻时间: 1440 });
    await action('vigil', 'PATROL', { 指令目标: mine.id, 巡逻时间: 1440 });
    await action('verity', 'RETURN');
    await wait(
      (s) =>
        ['meridian-2', 'meridian-3'].every(
          (id) => s.ships.find((x) => x.id === id)?.current?.action.type !== 'HAUL',
        ),
      'long observation maintenance',
    );
    await page.getByRole('button', { name: '1×', exact: true }).click();
    await check('observation-start');
    const wallStart = Date.now(),
      tickStart = (await state()).tick;
    while (Date.now() - wallStart < 600000) {
      await page.waitForTimeout(30000);
      s = await state();
      assert(!s.paused && s.status === 'active', '1x continuous observation interrupted');
      record({
        observation: true,
        elapsedMs: Date.now() - wallStart,
        time: s.time,
        tick: s.tick,
        speed: s.speed,
        credits: s.resources.credits,
        alive: s.ships.length,
      });
    }
    assert((await state()).tick - tickStart > 5000, 'ten-minute physical simulation progressed');
    await check('observation-ten-minutes');
  }
  await nav('ARCHIVE');
  await page.getByRole('button', { name: '立即保存', exact: true }).click();
  await check('archive');
  const persisted = new SaveStore(dir).read().world;
  assert(persisted, 'validated persisted world');
  const received = Object.values(persisted.factions.orion.reports),
    pressure = persisted.factions.orion.pressure;
  record({
    complete: true,
    seed,
    time: persisted.time,
    orionPressure: pressure,
    receivedOrionReports: received,
    orionAssets: persisted.enemies
      .filter((s) => s.factionId === 'orion')
      .map((s) => ({ id: s.id, intent: s.intent, cargo: s.cargo, localReports: s.localReports })),
    historyCount: persisted.history.length,
  });
  assert(
    pressure > 0 || persisted.history.some((h) => h.kind === 'cargoLoss'),
    'actual logistics created Orion pressure',
  );
  writeFileSync(join(out, `world-${seed}.json`), JSON.stringify(persisted, null, 2));
  await app.close();
} catch (error) {
  record({ failure: String(error), state: await state().catch(() => null) });
  await page.screenshot({ path: join(out, `${seed}-failure.png`) }).catch(() => {});
  await app.close().catch(() => {});
  process.exitCode = 1;
}
