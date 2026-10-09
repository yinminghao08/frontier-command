import { AgentDecisionService } from '../electron/agents/service';
import { ChatCompletionsClient } from '../electron/agents/client';
import { makeAgent,registerAgent } from '../src/engine/agents';
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
  it('revises delivery on the same root while retaining loaded cargo and history',()=>{
    const {e,ship}=logistics(50);
    const o=e.runtime.start({kind:'loadReturn',sourceId:'mine',destinationId:'base',cargoKind:'materials',deliver:false,route:'safe'},ship.id);
    e.runtime.drain();until(e,()=>ship.current?.action.type==='RETURN');
    const task=e.runtime.taskForObjective(o.id)!,id=task.taskId,base=e.base.stock.materials;
    expect(e.dispatchCommand({type:'reviseObjective',objectiveId:o.id,expectedRevision:o.revision,goal:{...o.goal,kind:'loadReturn',sourceId:'mine',destinationId:'base',cargoKind:'materials',deliver:true,route:'safe'},instruction:'返航后交付这些材料'}).ok).toBe(true);
    expect(task.taskId).toBe(id);expect(task.progress.loaded.materials).toBe(50);expect(o.amendments).toHaveLength(1);
    const reloaded=new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));until(reloaded,()=>reloaded.runtime.taskForObjective(o.id)?.status==='completed');
    expect(reloaded.base.stock.materials).toBe(base+50);expect(reloaded.runtime.taskForObjective(o.id)!.progress.loaded.materials).toBe(50);expect(reloaded.state.agentRuntime.tasks.filter(t=>t.objectiveId===o.id)).toHaveLength(1);
  });
  it('revising an accepted voluntary haul pauses its manifest until new consent',()=>{
    const {e,ship}=logistics(80),agent=e.state.agents.find(a=>a.assignedShipId===ship.id)!;agent.enabled=true;
    const action={type:'HAUL' as const,sourceId:'mine',targetId:'base',cargoKind:'materials' as const,amount:50,loadPolicy:'fixed' as const,route:'safe' as const,repeat:false};
    const o=e.runtime.start({kind:'operation',action},ship.id,e.state.commander.id,agent.id);o.controlMode='voluntary';o.consent='accepted';e.runtime.drain();until(e,()=>ship.current?.carried===50);
    const checkpointId=ship.current!.id;expect(e.dispatchCommand({type:'reviseObjective',objectiveId:o.id,expectedRevision:o.revision,goal:{kind:'operation',action:{...action,route:'risky'}},instruction:'使用风险航线完成原交付'}).ok).toBe(true);
    const task=e.runtime.taskForObjective(o.id)!;expect(ship.current).toBeNull();expect(task.checkpoint?.carried).toBe(50);expect(ship.cargo.materials).toBe(50);
    const restored=new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state)))),request=restored.cognition.prepare(agent.id)!;
    expect(restored.dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response:{purpose:'judgment',decision:{response:'accept',reason:'preference',reply:'按新航线交付现有货物。',conditions:[]}}},agent.id).ok).toBe(true);
    expect(restored.state.ships.find(s=>s.id===ship.id)!.current?.id).toBe(checkpointId);until(restored,()=>restored.runtime.taskForObjective(o.id)?.status==='completed');
    expect(restored.runtime.taskForObjective(o.id)!.progress.loaded.materials).toBe(50);expect(restored.runtime.taskForObjective(o.id)!.progress.delivered.materials).toBe(50);
  });
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
  it('records delivery elsewhere as diverted goods and retains custody facts after completion',()=>{
    const {e,ship}=logistics(20),owner=e.state.assignments.find(a=>a.shipId===ship.id)!.operatorId;
    const o=e.runtime.start({kind:'loadReturn',sourceId:'mine',destinationId:'base',cargoKind:'materials',deliver:true,route:'safe'},ship.id,e.state.commander.id,owner);e.runtime.drain();until(e,()=>ship.current?.action.type==='RETURN');
    const root=e.runtime.taskForObjective(o.id)!,before=e.state.locations.find(l=>l.id==='outpost')!.stock.materials;
    expect(issue(e,{type:'UNLOAD',targetId:'outpost'},ship.id).ok).toBe(true);until(e,()=>ship.cargo.materials===0);
    expect(root.status).toBe('interrupted');expect(root.progress.delivered.materials).toBe(0);expect(root.progress.diverted.materials).toBe(20);expect(root.progress.lost.materials).toBe(0);
    expect(e.state.locations.find(l=>l.id==='outpost')!.stock.materials).toBe(before+20);expect(()=>parseSave(e.state)).not.toThrow();
    const second=logistics(12),goal=second.e.runtime.start({kind:'loadReturn',sourceId:'mine',destinationId:'base',cargoKind:'materials',deliver:false,route:'safe'},second.ship.id);second.e.runtime.drain();until(second.e,()=>second.e.runtime.taskForObjective(goal.id)?.status==='completed');
    const terminal=second.e.runtime.taskForObjective(goal.id)!,proof=terminal.completionEvidence.find(e=>e.kind==='verified')!.eventId;
    expect(issue(second.e,{type:'UNLOAD',targetId:'base'},second.ship.id).ok).toBe(true);until(second.e,()=>second.ship.cargo.materials===0);
    expect(terminal.status).toBe('completed');expect(terminal.progress.delivered.materials).toBe(12);expect(terminal.completionEvidence.filter(e=>e.kind==='verified').map(e=>e.eventId)).toEqual([proof]);
    const count=terminal.completionEvidence.length;second.e.runtime.drain();second.e.runtime.drain();expect(terminal.completionEvidence).toHaveLength(count);expect(()=>parseSave(second.e.state)).not.toThrow();
  });
  it('journals cancellation of a queued directive once without physical execution',()=>{
    const {e,ship}=logistics(50);expect(issue(e,{type:'PATROL',targetId:'base',duration:60},ship.id).ok).toBe(true);
    expect(issue(e,{type:'HAUL',sourceId:'mine',targetId:'base',cargoKind:'materials',amount:20,route:'safe',loadPolicy:'fixed',repeat:false},ship.id,'QUEUE').ok).toBe(true);
    const directive=ship.queue[0],goal=e.state.objectives.find(o=>o.id===directive.objectiveId)!,root=e.runtime.taskForObjective(goal.id)!;
    expect(root.scheduling).toBe('queued');expect(root.steps[0].status).toBe('pending');expect(e.runtime.cancel(goal.id,goal.revision).ok).toBe(true);expect(e.runtime.cancel(goal.id,goal.revision).ok).toBe(false);e.runtime.drain();
    expect(ship.queue).toHaveLength(0);expect(root.status).toBe('cancelled');expect(root.progress.loaded.materials).toBe(0);expect(e.state.agentRuntime.events.filter(event=>event.type==='directiveOutcome'&&event.directiveId===directive.id)).toHaveLength(1);expect(()=>parseSave(e.state)).not.toThrow();
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
    let calls=0;const client=new ChatCompletionsClient(async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({content:'你好',purpose:'information'})}}]}));});
    const service=new AgentDecisionService({snapshot:()=>e.snapshot(),cognitionPort:id=>e.cognitionPort(id),command:(c,id)=>e.dispatchCommand(c,id),validate:(c,id)=>e.validate(c,id)},()=>({baseUrl:'http://mock.invalid/v1',defaultModel:'mock',reasoningEffort:'none',apiKey:'isolated-test-key'}),client);
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
    const agent=e.state.agents.find(a=>a.id===owner)!;agent.enabled=true;e.dispatchCommand({type:'sendChat',channelId:'private:'+owner,content:'那你倒是去收集啊',mentions:[]});
    const request=e.cognition.prepare(owner)!;const context=JSON.stringify(request.context);
    expect(context).toContain(instruction);expect(context).toContain('mine');expect(context).toContain('taskId');expect(context).not.toContain('actionExamples');
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
