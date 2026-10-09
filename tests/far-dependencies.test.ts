import {describe,it,expect} from 'vitest';
import {quietEngine,run,until} from './helpers';
import {makeRequest} from '../src/engine/contracts';
import {parseSave} from '../src/engine/saves';
import {SimulationEngine} from '../src/engine/engine';

const mira='ops-meridian',talia='ops-horizon';
describe('FAR persisted physical Task dependencies',()=>{
 it('escort follow-up waits for real rendezvous and has a verified dependency across reload',()=>{
  const e=quietEngine(),freighter=e.state.ships.find(s=>s.id==='meridian')!,guard=e.state.ships.find(s=>s.id==='horizon')!,mine=e.state.locations.find(l=>l.id==='mine')!;
  freighter.x=mine.x;freighter.y=mine.y;guard.x=e.base.x;guard.y=e.base.y;
  const request=makeRequest(e,mira,talia,'escort',{type:'ESCORT',targetId:freighter.id},{type:'HAUL',sourceId:'mine',targetId:'base',cargoKind:'materials',amount:20,loadPolicy:'fixed',route:'safe',repeat:false});
  const ticket=e.cognition.prepare(talia)!;
  expect(e.dispatchCommand({type:'cognitionDecision',agentId:talia,requestId:ticket.requestId,response:{purpose:'collaboration',decision:{requestId:request.id,version:request.conditionVersion,response:'accept',reason:'preference',reply:'会合后护航。',conditions:[]}}},talia).ok).toBe(true);
  run(e,1);expect(guard.current?.action.type).toBe('ESCORT');expect(freighter.current).toBeNull();
  until(e,()=>freighter.current?.action.type==='HAUL');
  const root=e.state.agentRuntime.tasks.find(t=>t.taskId===freighter.current?.taskId)!,escort=e.state.agentRuntime.tasks.find(t=>t.taskId===guard.current?.taskId)!;
  expect(root.dependencyTaskIds).toContain(escort.taskId);expect(root.dependencies[0]).toMatchObject({criterion:'rendezvous',status:'fulfilled',targetShipId:freighter.id});
  expect(e.state.agentRuntime.events.some(event=>event.eventId===root.dependencies[0].evidenceEventId&&event.type==='taskDependency')).toBe(true);
  const restored=new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));until(restored,()=>restored.state.escortRequests.find(r=>r.id===request.id)?.status==='completed');
  const current=restored.runtime.taskForObjective(root.objectiveId)!;
  expect(current.progress.delivered.materials).toBe(20);expect(current.dependencies[0].status).toBe('fulfilled');
  expect(restored.state.settledOutcomes.filter(id=>id===request.id+':settled')).toHaveLength(1);
  expect(()=>parseSave(restored.state)).not.toThrow();
 });
 it('a before-REST commitment is a distinct child and is never reissued on its completion boundary',()=>{
  const e=quietEngine(),agent=e.state.agents.find(a=>a.id===talia)!,ship=e.state.ships.find(s=>s.id===agent.assignedShipId)!;ship.x=e.base.x;ship.y=e.base.y;
  const objective=e.runtime.start({kind:'operation',action:{type:'PATROL',targetId:'base',duration:1}},ship.id,e.state.commander.id,talia,'休整后巡逻');
  objective.controlMode='voluntary';objective.conditions=[{type:'rest',when:'before',locationId:'base',minutes:5}];e.runtime.drain();
  const root=e.runtime.taskForObjective(objective.id)!,child=e.state.agentRuntime.tasks.find(t=>t.coordinationId===objective.id)!;
  expect(root.dependencyTaskIds).toContain(child.taskId);expect(ship.current?.action.type).toBe('REST');
  until(e,()=>root.status==='completed');
  expect(child.status).toBe('completed');expect(root.dependencies[0].status).toBe('fulfilled');
  expect(e.state.agentRuntime.tasks.filter(t=>t.coordinationId===objective.id)).toHaveLength(1);
  expect(e.state.commitments.find(p=>p.contractId===objective.id)!.status).toBe('fulfilled');
  expect(()=>parseSave(e.state)).not.toThrow();
 });
 it('rejects cyclic dependencies both at registration and when validating a saved graph',()=>{
  const e=quietEngine(),first=e.runtime.start({kind:'operation',action:{type:'RETURN'}},'verity'),second=e.runtime.start({kind:'operation',action:{type:'RETURN'}},'meridian');
  const a=e.runtime.taskForObjective(first.id)!,b=e.runtime.taskForObjective(second.id)!;
  expect(e.runtime.linkDependency(a,b,'completed').ok).toBe(true);expect(e.runtime.linkDependency(b,a,'completed').ok).toBe(false);
  b.dependencyTaskIds.push(a.taskId);b.dependencies.push({taskId:a.taskId,criterion:'completed',targetShipId:null,status:'pending',evidenceEventId:null});
  expect(()=>parseSave(e.state)).toThrow(/Cyclic/);
 });
});
