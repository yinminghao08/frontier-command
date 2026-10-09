import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine, issue,v15Fixture } from '../helpers';
import { createEvent } from '../../src/engine/world-events';
import type { WorldState } from '../../src/engine/types';

let app: ElectronApplication | undefined;
const output = resolve('.test-data/verification/v14/mine-accidents');
const state = async (p: Page) => (await p.evaluate(() => window.frontier.getState())).state;
async function launch(world: WorldState) {
  const directory = mkdtempSync(join(tmpdir(), 'frontier-mine-repair-'));
  const previous=v15Fixture(world),bytes=JSON.stringify(previous),branch='frontier-000001',legacy=join(directory,'frontiers-v15',branch);mkdirSync(legacy,{recursive:true});
  for(const file of ['head.json','head.json.bak','day-1.json'])writeFileSync(join(legacy,file),bytes);
  writeFileSync(join(directory,'timeline-v15.json'),JSON.stringify({version:15,activeId:branch,branches:[{id:branch,parent:null,name:'冻结旧矿场'}]}));
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const p = await app.firstWindow();
  await p.getByRole('navigation', { name: '主导航' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1920, 1200),
  );
  await p.context().setOffline(true);
  await p.evaluate(() => {
    const key = 'frontier.lcars.console.v2';
    const preferences = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...preferences, version: 2, animations: 'off' }));
  });
  await p.reload();
  await p.getByRole('navigation', { name: '主导航' }).waitFor();
  await p.evaluate(() => document.fonts.ready);
  mkdirSync(output, { recursive: true });
  for(const file of ['head.json','head.json.bak','day-1.json'])expect(readFileSync(join(legacy,file),'utf8')).toBe(bytes);
  return p;
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});

test('frozen v15 blocked mine migrates to running production and preserves original files in Electron',async()=>{
 const e=quietEngine(),mine=e.state.locations.find(l=>l.id==='mine')!,site=e.state.bodies.find(b=>b.id===mine.siteId)!,ship=e.state.ships.find(s=>s.id==='verity')!;
 mine.stock.materials=0;site.hazard=1;ship.x=mine.x;ship.y=mine.y;const event=createEvent(e,'accident',mine.id,'旧事故：累计开采后设备停工');issue(e,{type:'ASSIST_EVENT',targetId:event.id},ship.id);event.stage='responding';event.work=19;ship.current!.work=19;
 const cargo=ship.cargo.materials,experience=e.state.agents.map(a=>({id:a.id,experience:a.experience})),base=e.base.stock.materials,p=await launch(e.state);
 const migrated=await state(p);expect(migrated.version).toBe(16);expect(migrated.events.find(v=>v.id===event.id)).toMatchObject({stage:'resolved',work:19});expect(migrated.events.find(v=>v.id===event.id)!.outcome).toContain('规则移除');expect(migrated.ships.find(s=>s.id===ship.id)?.current).toBeNull();expect(migrated.ships.find(s=>s.id===ship.id)?.cargo.materials).toBe(cargo);expect(migrated.agents.map(a=>({id:a.id,experience:a.experience}))).toEqual(experience);
 await p.locator('.strategic-map [data-entity-id="mine"]').click();const inspector=p.getByRole('complementary',{name:'对象详情'});await expect(inspector).toContainText('实际仓储 / 运行中');await expect(inspector.getByLabel('矿场事故响应状态')).toHaveCount(0);
 await p.evaluate(()=>window.frontier.command({type:'speed',speed:16}));await p.evaluate(()=>window.frontier.command({type:'pause',paused:false}));await expect.poll(async()=> (await state(p)).locations.find(l=>l.id==='mine')!.stock.materials,{timeout:10000}).toBeGreaterThan(0);await p.evaluate(()=>window.frontier.command({type:'pause',paused:true}));
 const running=await state(p);expect(running.baseResources.stock.materials).toBe(base);expect(running.events.filter(v=>v.kind==='accident')).toHaveLength(1);expect(running.bodies.find(b=>b.id===site.id)!.remaining).toBeLessThan(site.remaining);await p.screenshot({path:join(output,'v15-rule-removed-production.png')});
});
test('frozen v15 spent repair materials and historical work are not refunded or replayed',async()=>{
 const e=quietEngine(),mine=e.state.locations.find(l=>l.id==='mine')!,ship=e.state.ships.find(s=>s.id==='verity')!;ship.x=mine.x;ship.y=mine.y;ship.cargo.materials=0;e.base.stock.materials-=5;
 const event=createEvent(e,'accident',mine.id,'旧设备修复已耗费5材料，仍有未完成工作');issue(e,{type:'ASSIST_EVENT',targetId:event.id},ship.id);event.stage='responding';event.work=20;ship.current!.work=20;e.record('cargo','旧维修材料实际消耗 5',mine.id);
 const stock=e.base.stock.materials,p=await launch(e.state),migrated=await state(p);expect(migrated.baseResources.stock.materials).toBe(stock);expect(migrated.ships.find(s=>s.id===ship.id)?.cargo.materials).toBe(0);expect(migrated.events.find(v=>v.id===event.id)).toMatchObject({stage:'resolved',work:20});expect(migrated.events.find(v=>v.id===event.id)!.outcome).toContain('规则移除');expect(migrated.history.filter(h=>h.text==='旧维修材料实际消耗 5')).toHaveLength(1);
 await p.evaluate(()=>window.frontier.save());await p.reload();await p.getByRole('navigation',{name:'主导航'}).waitFor();expect((await state(p)).baseResources.stock.materials).toBe(stock);await p.screenshot({path:join(output,'v15-spent-materials-preserved.png')});
});
