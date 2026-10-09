import {describe,it,expect} from 'vitest';
import {quietEngine,until,issue} from './helpers';
import {SimulationEngine} from '../src/engine/engine';
import {compileIntent} from '../src/engine/intent-gateway';
import {AgentDecisionService} from '../electron/agents/service';
import {ChatCompletionsClient} from '../electron/agents/client';
import {RequestTracker} from '../electron/agents/runtime';
import type {CognitionResponse} from '../src/engine/cognition-protocol';

const config={baseUrl:'http://mock.invalid/v1',defaultModel:'mock',reasoningEffort:'provider-default' as const,apiKey:'isolated-cognition-key'};
const flush=async()=>{for(let i=0;i<16;i++)await new Promise<void>(r=>setImmediate(r));};
function setup(){const e=quietEngine(),ship=e.state.ships.find(s=>s.id==='meridian')!,agent=e.state.agents.find(a=>a.assignedShipId===ship.id)!;for(const a of e.state.agents)a.enabled=a.id===agent.id;return {e,ship,agent};}
function send(e:SimulationEngine,id:string,content:string){expect(e.dispatchCommand({type:'sendChat',channelId:'private:'+id,content,mentions:[]}).ok).toBe(true);}
const goal={kind:'loadReturn' as const,sourceId:'mine',destinationId:'base',cargoKind:'materials' as const,deliver:false,route:'safe' as const};
describe('purpose-specific cognition and authoritative commits',()=>{
 it('never collapses a compound instruction to RETURN',()=>{const {e,agent}=setup();expect(compileIntent(e.getObservation(agent.id)!,{content:'去矿场装满货仓，然后返回基地'}).intent).toBeNull();expect(compileIntent(e.getObservation(agent.id)!,{content:'返回基地'}).intent?.action?.type).toBe('RETURN');});
 it('preserves navigation versus body survey',()=>{const {e,agent}=setup(),o=e.getObservation(agent.id)!;expect(compileIntent(o,{content:'导航到 Frontier 0/12'}).intent?.action).toMatchObject({type:'MOVE',point:{x:0}});const body=o.bodies[0];expect(compileIntent(o,{content:'测绘 '+body.id}).intent?.action).toMatchObject({type:'SURVEY',targetId:body.id});});
 it('uses only intent then judgment schemas; physical logistics need no further model',async()=>{
  const {e,ship,agent}=setup(),mine=e.state.locations.find(l=>l.id==='mine')!;e.state.bodies.find(b=>b.id===mine.siteId)!.remaining=0;mine.stock.materials=17;ship.x=mine.x;ship.y=mine.y;
  const bodies:Record<string,unknown>[]=[];const client=new ChatCompletionsClient(async(_url,init)=>{const body=JSON.parse(String(init?.body));bodies.push(body);const intent=bodies.length===1;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(intent?{disposition:'propose',proposal:goal,allowWormholes:true,reply:'装载后返航'}:{response:'accept',reason:'preference',reply:'我会装走可用物资再返回，货物保留在舰上。',conditions:[]})},finish_reason:'stop'}]}));});
  const service=new AgentDecisionService({snapshot:()=>e.snapshot(),cognitionPort:id=>e.cognitionPort(id),command:(c,id)=>e.dispatchCommand(c,id)},()=>config,client);
  send(e,agent.id,'去矿场装满货仓，然后返回基地');service.pump();await flush();expect(ship.current).toBeNull();service.pump();await flush();
  expect(ship.current?.action.type).toBe('LOAD');expect(bodies).toHaveLength(2);expect(JSON.stringify(bodies[1].response_format)).not.toContain('ATTACK_SET');expect(JSON.stringify(bodies[1].response_format)).not.toContain('coordination');
  const task=e.state.agentRuntime.tasks.find(t=>e.state.objectives.some(o=>o.id===t.objectiveId&&o.ownerAgentId===agent.id))!;
  until(e,()=>e.runtime.taskForObjective(task.objectiveId)?.status==='completed');service.pump();await flush();expect(bodies).toHaveLength(2);expect(ship.cargo.materials).toBe(17);
  const parent=e.state.chatMessages.find(m=>m.sender===e.state.commander.id)!;expect(e.state.chatMessages.filter(m=>m.sender===agent.id&&m.replyTo===parent.id)).toHaveLength(1);service.dispose();
 });
 it.each(['reject','counter'] as const)('%s leaves physical execution untouched',response=>{
  const {e,ship,agent}=setup();e.dispatchCommand({type:'submitObjective',shipId:ship.id,goal,authorizationMode:'voluntary',instruction:'装满后返航'});
  const request=e.cognition.prepare(agent.id)!;
  const result=e.dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response:{purpose:'judgment',decision:{response,reason:'fatigue',reply:'需要先休整。',conditions:response==='counter'?[{type:'rest',when:'before',locationId:'base',minutes:10}]:[]}}},agent.id);
  expect(result.ok).toBe(true);expect(ship.current).toBeNull();expect(e.state.agentRuntime.events.filter(event=>event.type==='cargoTransfer')).toHaveLength(0);
 });
 it('rejects cancelled, stale-session, reassigned and forged-entity responses',()=>{
  const {e,agent}=setup();send(e,agent.id,'去一个地点');const request=e.cognition.prepare(agent.id)!;
  const response:CognitionResponse={purpose:'intent',decision:{disposition:'propose',proposal:{kind:'navigate',targetId:'secret-enemy-base',sector:null},allowWormholes:true,reply:'前往'}};
  expect(e.dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response},agent.id).ok).toBe(false);
  const safe:CognitionResponse={purpose:'intent',decision:{disposition:'conversation',proposal:null,allowWormholes:true,reply:'请说明地点'}};
  expect(new SimulationEngine(e.state).dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response:safe},agent.id).ok).toBe(false);
  e.cognition.cancel(agent.id);expect(e.dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response:safe},agent.id).ok).toBe(false);
 });
 it('does not cancel a player conversation when an ordinary directive completes',async()=>{
  const {e,agent,ship}=setup();expect(issue(e,{type:'RETURN'},ship.id).ok).toBe(true);send(e,agent.id,'你好');let resolve!:(value:Response)=>void;let calls=0;
  const client=new ChatCompletionsClient(()=>{calls++;return new Promise(r=>{resolve=r;});});
  const service=new AgentDecisionService({snapshot:()=>e.snapshot(),cognitionPort:id=>e.cognitionPort(id),command:(c,id)=>e.dispatchCommand(c,id)},()=>config,client);service.pump();await flush();
  const revision=agent.decision.revision;e.complete(ship,'到达基地');e.runtime.drain();service.pump();expect(agent.decision.revision).toBe(revision);expect(calls).toBe(1);
  resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({disposition:'conversation',proposal:null,allowWormholes:true,reply:'你好，Admiral。'})},finish_reason:'stop'}]})));await flush();expect(e.state.chatMessages.some(m=>m.content==='你好，Admiral。')).toBe(true);service.dispose();
 });
 it('applies documented thinking parameters and refuses unknown explicit controls before HTTP',async()=>{
  const tracker=new RequestTracker(),bodies:Record<string,unknown>[]=[];const client=new ChatCompletionsClient(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:9,total_tokens:21,completion_tokens_details:{reasoning_tokens:3}}}));},tracker);
  await client.complete({...config,baseUrl:'https://api.openai.com/v1',thinking:'off'},'gpt-5.2','provider-default',[]);
  expect(bodies[0].reasoning_effort).toBe('none');expect(bodies[0].max_completion_tokens).toBeGreaterThan(0);expect(tracker.stats().recentRequests[0]).toMatchObject({inputTokens:12,outputTokens:9,reasoningTokens:3});
  await expect(client.complete({...config,thinking:'off'},'unknown','provider-default',[])).rejects.toThrow('尚未确认');expect(bodies).toHaveLength(1);
 });
 it('does not retry an incompatible reasoning mode by omitting its parameters',async()=>{
  let calls=0;const client=new ChatCompletionsClient(async()=>{calls++;return new Response('{"error":{"message":"Unsupported reasoning_effort"}}',{status:400});});
  await expect(client.complete({...config,baseUrl:'https://api.openai.com/v1',thinking:'on'},'gpt-5.2','high',[])).rejects.toThrow('未改动');expect(calls).toBe(1);
 });
 it('falls back to a single validated tool response without changing reasoning',async()=>{
  const bodies:Record<string,unknown>[]=[];const client=new ChatCompletionsClient(async(_url,init)=>{
   const body=JSON.parse(String(init?.body));bodies.push(body);
   if(bodies.length===1)return new Response('{"error":{"message":"Unsupported response_format json_schema"}}',{status:400});
   return new Response(JSON.stringify({choices:[{message:{tool_calls:[{type:'function',function:{name:'frontier_decision',arguments:'{"ok":true}'}}]},finish_reason:'tool_calls'}]}));
  });
  const result=await client.complete({...config,baseUrl:'https://api.openai.com/v1',thinking:'on'},'gpt-5.2','high',[],undefined,{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false});
  expect(JSON.parse(result.content)).toEqual({ok:true});expect(bodies).toHaveLength(2);expect(bodies[1]).toMatchObject({reasoning_effort:'high',tool_choice:{type:'function',function:{name:'frontier_decision'}}});
 });
 it('bounds combined compatibility and JSON repair attempts',async()=>{
  const {e,agent}=setup();send(e,agent.id,'你好');const request=e.cognition.prepare(agent.id)!;let calls=0;
  const client=new ChatCompletionsClient(async()=>{calls++;return calls<3?new Response('{"error":{"message":"Unsupported response_format json_object"}}',{status:400}):new Response(JSON.stringify({choices:[{message:{content:'invalid'},finish_reason:'stop'}]}));});
  await expect(client.cognize(config,request,agent.modelConfig,new AbortController().signal)).rejects.toThrow();expect(calls).toBeLessThanOrEqual(4);expect(e.state.ships.find(s=>s.id===agent.assignedShipId)!.current).toBeNull();
 });
 it('connect and idle timeouts settle uncooperative transports without submitting',async()=>{
  const hung=new ChatCompletionsClient(()=>new Promise(()=>{}));
  await expect(hung.complete({...config,connectionTimeoutMs:5},'mock','provider-default',[])).rejects.toThrow('连接 Provider 超时');
  let cancelled=false;const idle=new ChatCompletionsClient(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}}));
  await expect(idle.complete({...config,idleTimeoutMs:5},'mock','provider-default',[])).rejects.toThrow('空闲超时');expect(cancelled).toBe(true);
 });
});
