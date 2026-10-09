import {describe,it,expect} from 'vitest';
import {quietEngine,run,v15Fixture} from './helpers';
import {parseSave} from '../src/engine/saves';
import {SimulationEngine} from '../src/engine/engine';
import {makeAgent,registerAgent} from '../src/engine/agents';

describe('canonical persisted Assignment and derived Agent views',()=>{
 it('persists one relation and projects it into snapshots and observations',()=>{
  const e=quietEngine(),a=e.state.agents.find(a=>a.id==='ops-meridian')!;
  const save=JSON.parse(JSON.stringify(e.state));expect(save.agents[1]).not.toHaveProperty('assignedShipId');
  expect(e.snapshot().agents.find(x=>x.id===a.id)?.assignedShipId).toBe('meridian');expect(e.getObservation(a.id)?.self?.assignedShipId).toBe('meridian');
  const restored=new SimulationEngine(parseSave(save));restored.dispatchCommand({type:'assignAgent',agentId:a.id,shipId:null});expect(restored.state.agents.find(x=>x.id===a.id)?.assignedShipId).toBeNull();expect(restored.snapshot().agents.find(x=>x.id===a.id)?.assignedShipId).toBeNull();
  expect(JSON.parse(JSON.stringify(restored.state)).agents[1]).not.toHaveProperty('assignedShipId');
 });
 it('migrates a validated v15 link without preserving the duplicate field',()=>{
  const original=v15Fixture(quietEngine().state),restored=new SimulationEngine(parseSave(original));
  expect(original.agents.find(a=>a.id==='ops-meridian')?.assignedShipId).toBe('meridian');expect(restored.state.agents.find(a=>a.id==='ops-meridian')?.assignedShipId).toBe('meridian');expect(JSON.parse(JSON.stringify(restored.state)).agents[1]).not.toHaveProperty('assignedShipId');
 });
 it('notifies unassignment once and keeps unassigned archives quiet',()=>{
  const e=quietEngine(),a=makeAgent('cadet-28','Cadet 28','logistics');registerAgent(e.state,a);
  e.dispatchCommand({type:'assignAgent',agentId:a.id,shipId:null});run(e,120);expect(e.state.chatMessages.filter(m=>m.sender===a.id)).toHaveLength(0);
  e.dispatchCommand({type:'assignAgent',agentId:a.id,shipId:'verity'});e.dispatchCommand({type:'assignAgent',agentId:a.id,shipId:null});const count=e.state.chatMessages.filter(m=>m.sender===a.id).length;
  e.dispatchCommand({type:'assignAgent',agentId:a.id,shipId:null});run(e,120);expect(e.state.chatMessages.filter(m=>m.sender===a.id)).toHaveLength(count);expect(a.assignedShipId).toBeNull();
 });
 it('records loss ownership before removing the assignment and preserves the agent',()=>{
  const e=quietEngine(),a=e.state.agents.find(a=>a.id==='ops-meridian')!,s=e.state.ships.find(s=>s.id==='meridian')!;s.shield=0;e.hit(s,10000);
  expect(e.state.losses.find(l=>l.shipId===s.id)?.operatorIds).toContain(a.id);expect(a.assignedShipId).toBeNull();expect(a.status).toBe('unassigned');expect(parseSave(e.state).agents.find(x=>x.id===a.id)).toBeDefined();
 });
});
