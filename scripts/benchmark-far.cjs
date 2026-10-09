/* Run after exporting c83889a src/engine and electron/agents into
 * .test-data/far-baseline. This measures actual source with an in-process
 * completion fixture; no vendor latency, usage, price or semantic accuracy. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {performance}=require('node:perf_hooks');
const ts=require('typescript');
const root=path.resolve(__dirname,'..'),baseline=path.resolve(process.argv[2]||path.join(root,'.test-data/far-baseline'));
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??null;
async function scenario(source,kind){
 const {SimulationEngine}=require(path.join(source,'src/engine/engine.ts')),{createWorld}=require(path.join(source,'src/engine/data.ts')),{createOrionState}=require(path.join(source,'src/engine/orion/generation.ts'));
 const {AgentDecisionService}=require(path.join(source,'electron/agents/service.ts')),{ChatCompletionsClient}=require(path.join(source,'electron/agents/client.ts')),{RequestTracker}=require(path.join(source,'electron/agents/runtime.ts'));
 const engine=new SimulationEngine(createWorld(236807)),world=engine.state,agent=world.agents.find(a=>a.id==='ops-meridian'),ship=world.ships.find(s=>s.id==='meridian'),mine=world.locations.find(l=>l.id==='mine');
 world.enemies=[];world.orion=createOrionState();world.factions.orion.credits=0;for(const l of world.locations.filter(l=>l.owner==='orion'))l.stock={materials:0,photon:0,quantum:0,specialFinds:0};
 for(const a of world.agents){a.enabled=a.id===agent.id;a.decision.events=[];a.decision.pendingReasons=[];a.decision.nextAt=0;}world.paused=false;ship.x=mine.x;ship.y=mine.y;mine.stock.materials=50;world.bodies.find(b=>b.id===mine.siteId).remaining=0;
 const far=source===root,tracker=new RequestTracker(),bodies=[],latencies=[];
 const client=new ChatCompletionsClient(async(_url,init)=>{
  const body=JSON.parse(String(init.body));bodies.push({bytes:Buffer.byteLength(String(init.body)),schemaBytes:Buffer.byteLength(JSON.stringify(body.response_format??null))});
  const start=performance.now(),parent=world.chatMessages.find(m=>m.sender===world.commander.id&&m.responses?.[agent.id]==='pending');
  let decision=far?(body.messages[0].content.startsWith('CommunicationDecision:')?{content:'你好，Admiral。',purpose:'information'}:{opportunityId:null,collaborationOptionId:null,supportAgentId:null,riskPreference:'cautious',reason:'保持当前授权与事实'}):{mode:'wait',goal:'等待',rationale:'遵守现有授权',action:null,messages:parent?[{channelId:'private:'+agent.id,content:'你好，Admiral。',mentions:[],purpose:'information',replyTo:parent.id}]:[],memory:null,waitMinutes:30,coordination:null,social:null};
  await new Promise(resolve=>setTimeout(resolve,5));latencies.push(performance.now()-start);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(decision)},finish_reason:'stop'}]}));
 },tracker);
 const host={snapshot:()=>engine.snapshot(),command:(command,actor)=>engine.dispatchCommand(command,actor),validate:(command,actor)=>engine.validate(command,actor)};
 if(far)host.cognitionPort=id=>engine.cognitionPort(id);else host.controllerPort=id=>engine.controllerPort(id);
 const service=new AgentDecisionService(host,()=>({baseUrl:'http://local-fixture.invalid/v1',defaultModel:'fixture',reasoningEffort:far?'provider-default':'none',apiKey:'isolated-benchmark-key'}),client);
 if(kind==='conversation'){engine.dispatchCommand({type:'sendChat',channelId:'private:'+agent.id,content:'你好',mentions:[]});service.pump();await new Promise(r=>setTimeout(r,15));await flush();service.pump();await flush();}
 if(kind==='unassigned'){world.assignments=world.assignments.filter(a=>a.operatorId!==agent.id);if(!far)agent.assignedShipId=null;engine.dispatchCommand({type:'retryAgent',agentId:agent.id});}
 if(kind==='logistics'){engine.dispatchCommand({type:'issueDirective',shipIds:[ship.id],mode:'REPLACE',action:{type:'HAUL',sourceId:mine.id,targetId:'base',cargoKind:'materials',amount:50,loadPolicy:'fixed',route:'safe',repeat:false}});}
 const timings=[];
 if(kind!=='conversation')for(let i=0;i<6000;i++){world.paused=false;const start=performance.now();engine.step();timings.push(performance.now()-start);if(i%10===0){service.pump();await new Promise(r=>setTimeout(r,7));await flush();}}
 service.pump();await new Promise(r=>setTimeout(r,15));await flush();service.dispose();await flush();
 const stats=tracker.stats();return {scenario:kind,requests:bodies.length,requestBytes:bodies.reduce((n,b)=>n+b.bytes,0),repairs:stats.repairs,cancellations:stats.cancellations,failures:stats.failures,usage:stats.tokens??null,mockResponseP50Ms:percentile(latencies,.5),mockResponseP95Ms:percentile(latencies,.95),engineStepP50Ms:percentile(timings,.5),engineStepP95Ms:percentile(timings,.95),physics:{carried:ship.cargo.materials,mine:mine.stock.materials,base:engine.base.stock.materials,activeAction:ship.current?.action.type??null,goalStatus:far?world.objectives.find(o=>o.shipId===ship.id)?.status??null:null},errors:world.agents.filter(a=>a.decision.lastError).map(a=>({id:a.id,error:a.decision.lastError}))};
}
(async()=>{
 if(!fs.existsSync(path.join(baseline,'src/engine/engine.ts')))throw Error('Export baseline source before benchmarking');
 const report={baselineCommit:'c83889a2044616ec5791385ff01337c632b162fc',generatedAt:new Date().toISOString(),node:process.version,platform:os.platform(),cpu:os.cpus()[0].model,method:'Actual baseline/current engine, service and client; identical deterministic seed, 600 simulation minutes, same 5ms in-process completion fixture. No real Provider or Token estimates. Step times exclude Service pump and Mock waits. One exploratory run, no significance claims.',baseline:[],far:[]};
 for(const kind of ['conversation','unassigned','logistics']){report.baseline.push(await scenario(baseline,kind));report.far.push(await scenario(root,kind));}
 const oldSchema=require(path.join(baseline,'src/engine/decision-protocol.ts')).decisionJsonSchema,schemas=require(path.join(root,'src/engine/cognition-protocol.ts')).cognitionJsonSchema;
 report.schemaBytes={legacyMixed:Buffer.byteLength(JSON.stringify(oldSchema)),communication:Buffer.byteLength(JSON.stringify(schemas('communication'))),strategy:Buffer.byteLength(JSON.stringify(schemas('strategy'))),judgment:Buffer.byteLength(JSON.stringify(schemas('judgment'))),intent:Buffer.byteLength(JSON.stringify(schemas('intent')))};
 const out=path.join(root,'docs/verification/v16/far-performance.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
