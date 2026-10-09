import {describe,it,expect} from 'vitest';
import {quietEngine,run,until} from './helpers';
import {SimulationEngine} from '../src/engine/engine';
import {parseSave} from '../src/engine/saves';
import {TaskPlanner} from '../src/engine/agent-runtime/handlers';
import {makeLocation} from '../src/engine/data';
function setup(stock=50){const e=quietEngine(),ship=e.state.ships.find(s=>s.id==='meridian')!,mine=e.state.locations.find(l=>l.id==='mine')!;for(const agent of e.state.agents)agent.enabled=false;mine.stock.materials=stock;e.state.bodies.find(b=>b.id===mine.siteId)!.remaining=0;ship.x=mine.x;ship.y=mine.y;return {e,ship,mine};}
const haul={type:'HAUL' as const,sourceId:'mine',targetId:'base',cargoKind:'materials' as const,amount:50,loadPolicy:'fixed' as const,route:'safe' as const,repeat:false};
describe('typed deterministic handlers and revision proofs',()=>{
 it('planning and verification cannot perform inventory or world transactions',()=>{
  const {e,ship}=setup();const objective=e.runtime.start({kind:'loadReturn',sourceId:'mine',destinationId:'base',cargoKind:'materials',route:'safe',deliver:false},ship.id),task=e.runtime.taskForObjective(objective.id)!;
  const before=JSON.stringify(e.state),planner=new TaskPlanner(),view={world:e.state,objective,ship};
  expect(planner.plan(objective.goal,task,view).action?.type).toBe('LOAD');expect(planner.verifyCompletion(objective.goal,task,view).complete).toBe(false);
  expect(JSON.stringify(e.state)).toBe(before);expect(ship.current).toBeNull();
  e.runtime.drain();expect(ship.current?.action.type).toBe('LOAD');
 });
 it('a fixed short delivery is partial while full actual-stock loadReturn remains a separate goal',()=>{
  const {e,ship,mine}=setup(17),base=e.base.stock.materials,objective=e.runtime.start({kind:'operation',action:haul},ship.id);e.runtime.drain();
  until(e,()=>e.runtime.taskForObjective(objective.id)?.status==='completed_partial');const task=e.runtime.taskForObjective(objective.id)!;
  expect(e.base.stock.materials).toBe(base+17);expect(mine.stock.materials).toBe(0);expect(ship.cargo.materials).toBe(0);expect(task.progress.verified).toBe(false);expect(task.blockReason).toBeNull();expect(objective.reason).toContain('当前目标 50');
  expect(()=>parseSave(e.state)).not.toThrow();
 });
 it('prior delivery to another sink cannot satisfy a revised destination, including reload',()=>{
  const {e,ship,mine}=setup(),destination=makeLocation('handoff-sink','Handoff','outpost',{x:mine.x,y:mine.y});destination.stock.materials=0;destination.capacity.materials=10;e.state.locations.push(destination);
  const objective=e.runtime.start({kind:'operation',action:{...haul,targetId:destination.id}},ship.id);e.runtime.drain();until(e,()=>ship.current?.delivered===10);
  const task=e.runtime.taskForObjective(objective.id)!,base=e.base.stock.materials;expect(task.progress.delivered.materials).toBe(10);expect(ship.cargo.materials).toBe(40);
  expect(e.runtime.revise(objective.id,objective.revision,{kind:'operation',action:haul},'剩余货物送基地，基地目标仍为50').ok).toBe(true);
  expect(task.scope).toMatchObject({deliveredBaseline:{materials:10},carryIn:{materials:40}});
  const resumed=new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));until(resumed,()=>resumed.runtime.taskForObjective(objective.id)?.status==='completed_partial');
  const restored=resumed.runtime.taskForObjective(objective.id)!;expect(restored.progress.delivered.materials).toBe(50);expect(restored.progress.delivered.materials-restored.scope.deliveredBaseline.materials).toBe(40);expect(resumed.base.stock.materials).toBe(base+40);expect(destination.stock.materials).toBe(10);
  expect(restored.progress.verified).toBe(false);expect(()=>parseSave(resumed.state)).not.toThrow();
 });
 it('loaded source cannot be rewritten and corrupted revision baselines cannot be restored',()=>{
  const {e,ship}=setup(),objective=e.runtime.start({kind:'operation',action:haul},ship.id);e.runtime.drain();until(e,()=>ship.current?.carried===50);
  const before=JSON.stringify(e.state);expect(e.runtime.revise(objective.id,objective.revision,{kind:'operation',action:{...haul,sourceId:'colony'}},'换来源').ok).toBe(false);expect(JSON.stringify(e.state)).toBe(before);
  const forged=JSON.parse(JSON.stringify(e.state));forged.agentRuntime.tasks.find((t:{objectiveId:string})=>t.objectiveId===objective.id).scope.deliveredBaseline.materials=100;expect(()=>parseSave(forged)).toThrow('Invalid Task revision scope');
 });
 it('a terminal root cannot be revived or execute another transaction',()=>{
  const {e,ship}=setup(17),objective=e.runtime.start({kind:'operation',action:haul},ship.id);e.runtime.drain();until(e,()=>e.runtime.taskForObjective(objective.id)?.status==='completed_partial');const task=e.runtime.taskForObjective(objective.id)!,before=JSON.stringify(e.state);
  e.runtime.transition(task,'running');expect(e.runtime.resume(objective.id,objective.revision).ok).toBe(false);expect(e.runtime.revise(objective.id,objective.revision,{kind:'operation',action:haul},'再运').ok).toBe(false);expect(JSON.stringify(e.state)).toBe(before);run(e,1);expect(ship.current).toBeNull();expect(task.status).toBe('completed_partial');
 });
});
