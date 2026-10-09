import { AgentDecisionService } from '../electron/agents/service';
import { ChatCompletionsClient } from '../electron/agents/client';
import { makeAgent,registerAgent } from '../src/engine/agents';
import { compactObservation } from '../electron/agents/context';
import { describe,it,expect } from 'vitest';
import { quietEngine,run,until,issue } from './helpers';
import { SimulationEngine } from '../src/engine/engine';
import { parseSave } from '../src/engine/saves';
import { capabilities,cargoUsed } from '../src/engine/capabilities';
import { commitPrimaryReply } from '../src/engine/agent-runtime/replies';

function logistics(stock: number) {
  const e=quietEngine(),mine=e.state.locations.find(l=>l.id==='mine')!,ship=e.state.ships.find(s=>s.id==='meridian')!;
  for(const agent of e.state.agents)agent.enabled=false;
  const site=e.state.bodies.find(b=>b.id===mine.siteId)!;site.remaining=0;
  mine.stock.materials=stock;ship.x=mine.x;ship.y=mine.y;ship.cargo={materials:0,photon:0,quantum:0,specialFinds:0};
  return {e,mine,ship};
}
describe('FAR authoritative logistics and event ownership',()=>{
  it.each([600,17,17.4])('loads actual stock %s then returns without changing RETURN semantics',stock=>{
    const {e,mine,ship}=logistics(stock),capacity=capabilities(ship).cargo;
    const objective=e.runtime.start({kind:'loadReturn',sourceId:mine.id,destinationId:'base',cargoKind:'materials',deliver:false,route:'safe'},ship.id);
    const base=e.base.stock.materials;
    e.runtime.drain();expect(ship.current?.action.type).toBe('LOAD');
    until(e,()=>e.runtime.taskForObjective(objective.id)?.status==='completed');
    expect(ship.cargo.materials).toBe(Math.min(stock,capacity));
    expect(mine.stock.materials+ship.cargo.materials).toBe(stock);expect(e.base.stock.materials).toBe(base);
    const task=e.runtime.taskForObjective(objective.id)!;
    expect(task.steps.map(s=>s.action.type)).toEqual(['LOAD','RETURN']);expect(task.completionEvidence.some(v=>v.kind==='verified')).toBe(true);
    expect(()=>parseSave(e.state)).not.toThrow();
  });
  it('zero inventory blocks without a false return; production becomes a valid load event',()=>{
    const {e,mine,ship}=logistics(0);
    const o=e.runtime.start({kind:'loadReturn',sourceId:mine.id,destinationId:'base',cargoKind:'materials',deliver:false,route:'safe'},ship.id);e.runtime.drain();run(e,8);
    expect(e.runtime.taskForObjective(o.id)?.status).not.toBe('completed');expect(ship.current?.action.type).toBe('LOAD');expect(cargoUsed(ship)).toBe(0);
    mine.stock.materials=9;until(e,()=>e.runtime.taskForObjective(o.id)?.status==='completed');expect(ship.cargo.materials).toBe(9);
  });
  it('recovery preserves sources across multiple trips, discoveries and reload, excluding mixed cargo',()=>{
    const {e,ship}=logistics(0),capacity=capabilities(ship).cargo;
    ship.cargo.materials=5;e.base.capacity.materials=100000;
    const wreck=(id:string,materials:number)=>({id,name:'renamed '+id,x:ship.x+10,y:ship.y,stock:{materials,photon:0,quantum:0,specialFinds:0},discovered:true,sourceShipId:id.slice(6),sourceClassId:'scout' as const});
    e.state.wrecks.push(wreck('wreck:scout-a',capacity+13));
    const o=e.runtime.start({kind:'recovery',wreckIds:['wreck:scout-a'],sourceClassId:'scout',includeDiscoveries:true,destinationId:'base',cargoKind:'materials'},ship.id);e.runtime.drain();
    until(e,()=>e.runtime.taskForObjective(o.id)!.progress.loaded.materials>0);
    e.state.wrecks.push(wreck('wreck:scout-b',21));
    const resumed=new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    const base=resumed.base.stock.materials;
    until(resumed,()=>resumed.runtime.taskForObjective(o.id)?.status==='completed',1200);
    const t=resumed.runtime.taskForObjective(o.id)!;
    expect(t.progress.loaded.materials).toBe(capacity+34);expect(t.progress.delivered.materials).toBe(capacity+34);expect(resumed.base.stock.materials-base).toBe(capacity+39);
    expect(resumed.state.wrecks.filter(w=>w.sourceClassId==='scout').every(w=>w.stock.materials===0)).toBe(true);
    resumed.state.wrecks.push(wreck('wreck:scout-c',100));run(resumed,3);expect(t.status).toBe('completed');expect(resumed.state.wrecks.at(-1)!.stock.materials).toBe(100);
    expect(()=>parseSave(resumed.state)).not.toThrow();
  });
  it('cancel keeps physical cargo and prevents any future task step',()=>{
    const {e,ship}=logistics(50),o=e.runtime.start({kind:'loadReturn',sourceId:'mine',destinationId:'base',cargoKind:'materials',deliver:true,route:'safe'},ship.id);e.runtime.drain();
    until(e,()=>ship.current?.action.type==='RETURN');const cargo=ship.cargo.materials;
    expect(e.runtime.cancel(o.id,o.revision).ok).toBe(true);run(e,100);expect(ship.cargo.materials).toBe(cargo);expect(ship.current).toBeNull();expect(e.runtime.resume(o.id,o.revision).ok).toBe(false);
  });
  it('Admiral takeover keeps a loaded goal interrupted across reload until explicit resume',()=>{
    const {e,ship}=logistics(50);const owner=e.state.assignments.find(a=>a.shipId===ship.id)!.operatorId;
    const o=e.runtime.start({kind:'loadReturn',sourceId:'mine',destinationId:'base',cargoKind:'materials',deliver:true,route:'safe'},ship.id,e.state.commander.id,owner,'矿场装货交付');
    o.messageId=0;e.runtime.drain();until(e,()=>ship.current?.action.type==='RETURN');
    expect(issue(e,{type:'MOVE',point:{x:ship.x,y:ship.y}},ship.id).ok).toBe(true);
    expect(e.runtime.taskForObjective(o.id)?.status).toBe('interrupted');run(e,2);expect(ship.cargo.materials).toBe(50);
    const restored=new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    expect(restored.dispatchCommand({type:'resumeObjective',objectiveId:o.id,expectedRevision:o.revision}).ok).toBe(true);
    until(restored,()=>restored.runtime.taskForObjective(o.id)?.status==='completed');
    expect(restored.runtime.taskForObjective(o.id)!.progress.loaded.materials).toBe(50);
    expect(restored.runtime.taskForObjective(o.id)!.progress.delivered.materials).toBe(50);
  });
  it('Cadet 28 consumes no autonomous requests while unassigned but answers a player',async()=>{
    const {e}=logistics(0);for(const agent of e.state.agents)agent.enabled=false;
    const cadet=makeAgent('cadet-28','Cadet 28','logistics');registerAgent(e.state,cadet);
    let calls=0;const client=new ChatCompletionsClient(async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({goal:'对话',rationale:'主动输入',action:null})}}]}));});
    const service=new AgentDecisionService({snapshot:()=>e.snapshot(),controllerPort:id=>e.controllerPort(id),command:(c,id)=>e.dispatchCommand(c,id),validate:(c,id)=>e.validate(c,id)},()=>({baseUrl:'http://mock.invalid/v1',defaultModel:'mock',reasoningEffort:'none',apiKey:'isolated-test-key'}),client);
    for(let i=0;i<10;i++){run(e,20);service.pump();}
    await new Promise(resolve=>setTimeout(resolve,20));expect(calls).toBe(0);
    expect(e.state.chatMessages.filter(m=>m.sender===cadet.id)).toHaveLength(0);
    e.dispatchCommand({type:'sendChat',channelId:'private:'+cadet.id,content:'你好',mentions:[]});service.pump();
    await new Promise(resolve=>setTimeout(resolve,30));expect(calls).toBe(1);service.pump();run(e,20);service.pump();expect(calls).toBe(1);service.dispose();
  });
  it('required objective context retains the full source and constraint facts',()=>{
    const {e,ship}=logistics(20),owner=e.state.assignments.find(a=>a.shipId===ship.id)!.operatorId;
    const instruction='矿场装满后返航；'.repeat(100);
    e.runtime.start({kind:'loadReturn',sourceId:'mine',destinationId:'base',cargoKind:'materials',deliver:false,route:'safe'},ship.id,e.state.commander.id,owner,instruction);
    const context=compactObservation(e.getObservation(owner)!);
    expect(context.objective?.originalInstruction).toBe(instruction);expect(context.inventories.some(i=>i.locationId==='mine')).toBe(true);expect(context.runtimeTask).not.toBeNull();
  });
  it('primary replies and repeated journal consumption are idempotent',()=>{
    const {e}=logistics(0),agent=e.state.agents[0];
    e.dispatchCommand({type:'sendChat',channelId:'private:'+agent.id,content:'你好',mentions:[],controlMode:'voluntary'});
    const parent=e.state.chatMessages.find(m=>m.sender===e.state.commander.id)!;
    const a=commitPrimaryReply(e,agent.id,parent.id,'收到'),b=commitPrimaryReply(e,agent.id,parent.id,'第二次');expect(a?.id).toBe(b?.id);
    expect(e.state.chatMessages.filter(m=>m.sender===agent.id&&m.replyTo===parent.id)).toHaveLength(1);
    e.runtime.drain();e.runtime.drain();expect(()=>parseSave(e.state)).not.toThrow();
  });
});
