import { describe,it,expect } from 'vitest';
import { quietEngine,run,v15Fixture } from './helpers';
import { createEvent } from '../src/engine/world-events';
import { parseSave } from '../src/engine/saves';
import { SimulationEngine } from '../src/engine/engine';
import { makeDirective } from '../src/engine/command-system';

describe('v16 removes periodic mine shutdowns while retaining economic limits',()=>{
  it('crosses old hazard thresholds without another accident and preserves stored production history',()=>{
    const e=quietEngine(),mine=e.state.locations.find(l=>l.id==='mine')!,site=e.state.bodies.find(b=>b.id===mine.siteId)!;
    mine.stock.materials=0;mine.capacity.materials=300;mine.extracted=9000;site.remaining=10000;site.hazard=100;
    const accidents=e.state.events.filter(v=>v.kind==='accident').length,ore=site.remaining;
    run(e,200);
    expect(e.state.events.filter(v=>v.kind==='accident')).toHaveLength(accidents);expect(site.remaining).toBeLessThan(ore);expect(mine.extracted).toBeGreaterThan(9000);
    expect(mine.stock.materials).toBe(mine.capacity.materials);
    const remaining=site.remaining;run(e,20);expect(site.remaining).toBe(remaining);
    mine.stock.materials=0;site.remaining=3;run(e,5);expect(site.remaining).toBe(0);expect(mine.stock.materials).toBe(3);
    expect(()=>parseSave(e.state)).not.toThrow();
  });
  it('validates published v15 first, retires unfinished repair without replay or reward, and keeps original bytes',()=>{
    const e=quietEngine(),mine=e.state.locations.find(l=>l.id==='mine')!,ship=e.state.ships.find(s=>s.id==='verity')!;
    const event=createEvent(e,'accident',mine.id,'旧事故停工');event.stage='responding';event.work=12;
    const directive=makeDirective(e,{type:'ASSIST_EVENT',targetId:event.id});directive.source='admiral';directive.actorId=e.state.commander.id;directive.origin={x:ship.x,y:ship.y};ship.current=directive;
    const old=v15Fixture(e.state),bytes=JSON.stringify(old),credits=old.resources.credits,history=old.history,materials=old.locations.find(l=>l.id==='mine')!.stock.materials;
    const migrated=parseSave(JSON.parse(bytes));expect(JSON.stringify(old)).toBe(bytes);expect(migrated.version).toBe(16);
    expect(migrated.events.find(v=>v.id===event.id)).toMatchObject({stage:'resolved',work:12,outcome:expect.stringContaining('规则移除')});
    expect(migrated.ships.find(s=>s.id===ship.id)!.current).toBeNull();expect(migrated.resources.credits).toBe(credits);expect(migrated.history).toEqual(history);
    expect(migrated.locations.find(l=>l.id==='mine')!.stock.materials).toBe(materials);
    const restored=new SimulationEngine(migrated),remaining=restored.state.bodies.find(b=>b.id===mine.siteId)!.remaining;
    restored.state.locations.find(l=>l.id==='mine')!.stock.materials=0;run(restored,5);expect(restored.state.bodies.find(b=>b.id===mine.siteId)!.remaining).toBeLessThan(remaining);
  });
});
