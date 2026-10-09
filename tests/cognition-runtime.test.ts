import {describe,it,expect} from 'vitest';
import {quietEngine,until,issue} from './helpers';
import {piracyScenario} from './orion-scenarios';
import {makeLocation} from '../src/engine/data';
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
  const response:CognitionResponse={purpose:'intent',decision:{disposition:'propose',objectiveId:null,proposal:{kind:'navigate',targetId:'secret-enemy-base',sector:null},allowWormholes:true,reply:'前往'}};
  expect(e.dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response},agent.id).ok).toBe(false);
  const safe:CognitionResponse={purpose:'intent',decision:{disposition:'conversation',objectiveId:null,proposal:null,allowWormholes:true,reply:'请说明地点'}};
  expect(new SimulationEngine(e.state).dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response:safe},agent.id).ok).toBe(false);
  e.cognition.cancel(agent.id);expect(e.dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response:safe},agent.id).ok).toBe(false);
 });
 it('does not cancel a player conversation when an ordinary directive completes',async()=>{
  const {e,agent,ship}=setup();expect(issue(e,{type:'RETURN'},ship.id).ok).toBe(true);send(e,agent.id,'你好');let resolve!:(value:Response)=>void;let calls=0;
  const client=new ChatCompletionsClient(()=>{calls++;return new Promise(r=>{resolve=r;});});
  const service=new AgentDecisionService({snapshot:()=>e.snapshot(),cognitionPort:id=>e.cognitionPort(id),command:(c,id)=>e.dispatchCommand(c,id)},()=>config,client);service.pump();await flush();
  const revision=agent.decision.revision;e.complete(ship,'到达基地');e.runtime.drain();service.pump();expect(agent.decision.revision).toBe(revision);expect(calls).toBe(1);
  resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({content:'你好，Admiral。',purpose:'information'})},finish_reason:'stop'}]})));await flush();expect(e.state.chatMessages.some(m=>m.content==='你好，Admiral。')).toBe(true);service.dispose();
 });
 it('API configuration changes alone produce no new decision trigger and revoke old tickets',()=>{
  const {e,agent}=setup();e.cognition.configurationChanged();expect(agent.decision.pendingReasons).toEqual([]);
  send(e,agent.id,'你好');const request=e.cognition.prepare(agent.id)!;e.dispatchCommand({type:'agentDecisionState',agentId:agent.id,revision:request.revision,state:'waiting',error:null},agent.id);
  e.cognition.configurationChanged();expect(agent.decision.events.some(event=>event.id==='configuration:pending-request')).toBe(true);
  expect(e.dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response:{purpose:'communication',decision:{content:'旧配置结果',purpose:'information'}}},agent.id).ok).toBe(false);
  expect(e.state.chatMessages.some(m=>m.content==='旧配置结果')).toBe(false);
 });
 it('public peer goals do not disclose the original private instruction',()=>{
  const {e,agent}=setup(),peer=e.state.agents.find(a=>a.id!==agent.id)!,ship=e.state.ships.find(s=>s.id===peer.assignedShipId)!;peer.enabled=true;
  const secret='私聊原文仅限接收者 / PRIVATE-ORDER-947';peer.currentGoal=secret;
  const objective=e.runtime.start({kind:'operation',action:{type:'PATROL',targetId:'base',duration:20}},ship.id,e.state.commander.id,peer.id,secret);e.runtime.drain();
  expect(objective.originalInstruction).toBe(secret);expect(JSON.stringify(e.getObservation(agent.id,false)!.fleet)).not.toContain(secret);
  e.dispatchCommand({type:'retryAgent',agentId:agent.id});expect(JSON.stringify(e.cognition.prepare(agent.id)!.context)).not.toContain(secret);
 });
 it('claims dispatched triggers once, preserves new events, and reports real execution state',()=>{
  const {e,agent,ship}=setup();e.dispatchCommand({type:'retryAgent',agentId:agent.id});
  const request=e.cognition.prepare(agent.id)!;
  expect(e.dispatchCommand({type:'agentDecisionState',agentId:agent.id,revision:request.revision,state:'waiting',error:null},agent.id).ok).toBe(true);
  expect(agent.decision.events).toHaveLength(0);
  agent.decision.events.push({id:'danger:new-contact',kind:'danger',time:e.state.time});agent.decision.pendingReasons.push('danger:new-contact');
  expect(e.dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response:{purpose:'strategy',decision:{opportunityId:null,riskPreference:'balanced',reason:'等待'}}},agent.id).ok).toBe(true);
  expect(agent.decision.events.map(event=>event.id)).toEqual(['danger:new-contact']);
  expect(agent.decision.pendingReasons).toEqual(['danger:new-contact']);
  expect(agent.decision.nextAt).toBe(e.state.time);
  expect(issue(e,{type:'PATROL',targetId:'base',duration:10},ship.id).ok).toBe(true);
  e.dispatchCommand({type:'agentDecisionState',agentId:agent.id,revision:agent.decision.revision,state:'ready',error:null},agent.id);
  expect(agent.status).toBe('admiral');
 });
 it('retains an unconsumed danger across missing API configuration and dispatches it once while paused',async()=>{
  const {e,agent}=setup();e.state.paused=true;agent.decision.events=[{id:'danger:known',kind:'danger',time:e.state.time}];agent.decision.pendingReasons=['danger:known'];
  let configured={...config,apiKey:''},calls=0;
  const client=new ChatCompletionsClient(async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({opportunityId:null,riskPreference:'cautious',reason:'保留当前目标'})},finish_reason:'stop'}]}));});
  const service=new AgentDecisionService({snapshot:()=>e.snapshot(),cognitionPort:id=>e.cognitionPort(id),command:(c,id)=>e.dispatchCommand(c,id)},()=>configured,client);
  service.pump();service.pump();expect(calls).toBe(0);expect(agent.decision.events.map(event=>event.id)).toEqual(['danger:known']);
  configured=config;e.cognition.configurationChanged();service.pump();await flush();service.pump();await flush();expect(calls).toBe(1);expect(agent.decision.events).toEqual([]);service.dispose();
 });
 it('selects a real rescue contract without overwriting a directly authorized objective',()=>{
  const {e,ship}=piracyScenario('manual'),peer=e.state.ships.find(s=>s.id==='horizon')!;peer.x=ship.x+350;peer.y=ship.y;
  e.state.locations.push(makeLocation('rescue-refuge','RESCUE REFUGE','outpost',{x:420,y:1200}));
  until(e,()=>e.state.piracyIncidents.length>0,5);for(const agent of e.state.agents)agent.enabled=true;
  const own=e.state.agents.find(a=>a.assignedShipId===ship.id)!,helper=e.state.agents.find(a=>a.assignedShipId===peer.id)!;
  expect(issue(e,{type:'PATROL',targetId:'base',duration:20},ship.id).ok).toBe(true);const directive=ship.current!.id;
  e.dispatchCommand({type:'retryAgent',agentId:own.id});const request=e.cognition.prepare(own.id)!;
  const choices=request.context.rescueChoices as {id:string;agentId:string}[];
  const choice=choices.find(choice=>choice.agentId===helper.id)!;expect(choice).toBeDefined();
  const decision={purpose:'strategy' as const,decision:{opportunityId:null,collaborationOptionId:choice.id,riskPreference:'cautious' as const,reason:'请求真实支援'}};
  expect(e.dispatchCommand({type:'cognitionDecision',agentId:own.id,requestId:request.requestId,response:decision},own.id).ok).toBe(true);
  const contract=e.state.escortRequests[0];expect(contract).toMatchObject({kind:'reinforce',status:'pending',followUp:null});expect(ship.current!.id).toBe(directive);expect(peer.current).toBeNull();
  const response=e.cognition.prepare(helper.id)!;expect(response.purpose).toBe('collaboration');
  expect(e.dispatchCommand({type:'cognitionDecision',agentId:helper.id,requestId:response.requestId,response:{purpose:'collaboration',decision:{requestId:contract.id,version:contract.conditionVersion,response:'reject',reason:'fatigue',reply:'先休整',conditions:[]}}},helper.id).ok).toBe(true);
  expect(contract.status).toBe('rejected');expect(peer.current).toBeNull();expect(ship.current!.id).toBe(directive);
  e.dispatchCommand({type:'retryAgent',agentId:own.id});const stale=e.cognition.prepare(own.id)!;e.state.piracyIncidents[0].stage='resolved';
  expect(e.dispatchCommand({type:'cognitionDecision',agentId:own.id,requestId:stale.requestId,response:decision},own.id).ok).toBe(false);expect(e.state.escortRequests).toHaveLength(1);
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
  const {e,agent}=setup();send(e,agent.id,'请说明现在能做什么');const request=e.cognition.prepare(agent.id)!;let calls=0;
  const client=new ChatCompletionsClient(async()=>{calls++;return calls<3?new Response('{"error":{"message":"Unsupported response_format json_object"}}',{status:400}):new Response(JSON.stringify({choices:[{message:{content:'invalid'},finish_reason:'stop'}]}));});
  await expect(client.cognize(config,request,agent.modelConfig,new AbortController().signal)).rejects.toThrow();expect(calls).toBeLessThanOrEqual(4);expect(e.state.ships.find(s=>s.id===agent.assignedShipId)!.current).toBeNull();
 });
 it('connect and idle timeouts settle uncooperative transports without submitting',async()=>{
  const hung=new ChatCompletionsClient(()=>new Promise(()=>{}));
  await expect(hung.complete({...config,connectionTimeoutMs:5},'mock','provider-default',[])).rejects.toThrow('连接 Provider 超时');
  let cancelled=false;const idle=new ChatCompletionsClient(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}}));
  await expect(idle.complete({...config,idleTimeoutMs:5},'mock','provider-default',[])).rejects.toThrow('空闲超时');expect(cancelled).toBe(true);
 });
 it('uses the complete four-attempt ceiling across two protocol fallbacks and one repair',async()=>{
  const {e,agent}=setup();send(e,agent.id,'你好');const request=e.cognition.prepare(agent.id)!,tracker=new RequestTracker();let calls=0;
  const client=new ChatCompletionsClient(async()=>{calls++;if(calls<=2)return new Response(JSON.stringify({error:{message:calls===1?'Unsupported json_schema response_format':'Unsupported tools tool_choice'}}),{status:400});return new Response(JSON.stringify({choices:[{message:{content:calls===3?'bad JSON':'{"content":"你好","purpose":"information"}'},finish_reason:'stop'}]}));},tracker);
  const result=await client.cognize({...config,baseUrl:'https://api.openai.com/v1',defaultModel:'gpt-5.2'},request,{model:null,reasoningEffort:null},new AbortController().signal);
  expect(result).toEqual({purpose:'communication',decision:{content:'你好',purpose:'information'}});expect(calls).toBe(4);expect(tracker.stats()).toMatchObject({requests:4,repairs:1});
 });
 it('a follow-up inherits the original complete goal and a semantic amendment keeps its cargo owner',()=>{
  const {e,ship,agent}=setup(),mine=e.state.locations.find(l=>l.id==='mine')!;ship.x=mine.x;ship.y=mine.y;mine.stock.materials=80;e.state.bodies.find(b=>b.id===mine.siteId)!.remaining=0;
  const action={type:'HAUL' as const,sourceId:'mine',targetId:'base',cargoKind:'materials' as const,amount:50,loadPolicy:'fixed' as const,route:'safe' as const,repeat:false};
  const o=e.runtime.start({kind:'operation',action},ship.id,e.state.commander.id,agent.id,'从矿场装载50材料并交付基地');e.runtime.drain();until(e,()=>ship.current?.carried===50);const root=e.runtime.taskForObjective(o.id)!;
  send(e,agent.id,'那你倒是去收集啊');let request=e.cognition.prepare(agent.id)!;expect(JSON.stringify(request.context)).toContain(o.originalInstruction);
  expect(e.dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response:{purpose:'intent',decision:{disposition:'continue',objectiveId:o.id,proposal:null,allowWormholes:true,reply:'继续原目标，不重复装载。'}}},agent.id).ok).toBe(true);expect(e.state.objectives).toHaveLength(1);
  send(e,agent.id,'改用风险航线交付这批物资');request=e.cognition.prepare(agent.id)!;
  expect(e.dispatchCommand({type:'cognitionDecision',agentId:agent.id,requestId:request.requestId,response:{purpose:'intent',decision:{disposition:'revise',objectiveId:o.id,proposal:{kind:'transport',sourceId:'mine',destinationId:'base',cargoKind:'materials',amount:50,repeat:false,route:'risky'},allowWormholes:true,reply:'重新判断风险航线。'}}},agent.id).ok).toBe(true);
  expect(e.state.objectives).toHaveLength(1);expect(e.runtime.taskForObjective(o.id)?.taskId).toBe(root.taskId);expect(root.checkpoint?.carried).toBe(50);expect(ship.current).toBeNull();expect(e.state.agentRuntime.cargoLots.filter(l=>l.taskId===root.taskId).reduce((n,l)=>n+l.amount,0)).toBe(50);
 });
});
