import type { Command,CommandResult,Snapshot } from '../../src/engine/types';
import type { CognitionRequest } from '../../src/engine/cognition-protocol';
import { ChatCompletionsClient,AgentApiError } from './client';
import type { ConnectionConfig } from './config';
export interface DecisionHost {
 snapshot():Snapshot;
 cognitionPort(id:string):{prepare():CognitionRequest|null;cancel():void};
 command(command:Extract<Command,{type:'cognitionDecision'|'agentDecisionState'}>,actorId:string):CommandResult;
 validate?(command:Extract<Command,{type:'cognitionDecision'|'agentDecisionState'}>,actorId:string):CommandResult;
}
/** One logical request per Agent. Only meaningful inputs can enter cognition;
 * physical steps and stat refreshes stay inside the deterministic Task Runtime. */
export class AgentDecisionService {
 private readonly flights=new Map<string,{controller:AbortController;revision:number;configuration:string}>();
 private disposed=false;
 constructor(private readonly host:DecisionHost,private readonly config:()=>ConnectionConfig,private readonly client=new ChatCompletionsClient()){}
 dispose(){this.disposed=true;for(const [id,f] of this.flights){f.controller.abort();this.host.cognitionPort(id).cancel();}this.flights.clear();}
 pump(){
  if(this.disposed)return;const snapshot=this.host.snapshot(),config=this.config(),configuration=JSON.stringify(config);
  for(const [id,f] of this.flights){if(snapshot.agents.find(a=>a.id===id)?.decision.revision!==f.revision||f.configuration!==configuration){f.controller.abort();this.host.cognitionPort(id).cancel();this.flights.delete(id);}}
  if(snapshot.status!=='active')return;
  for(const a of snapshot.agents){
   const pending=snapshot.chatMessages.some(m=>m.responses?.[a.id]==='pending');
   if(!a.assignedShipId&&!pending)continue;
   if(!a.enabled||this.flights.has(a.id)||!a.decision.pendingReasons.length||snapshot.time<a.decision.nextAt)continue;
   const meaningful=pending||a.decision.events.some(event=>['chat','request','danger','opportunity','manual','configuration','proposal'].includes(event.kind));
   if(!meaningful)continue;
   if(snapshot.paused&&!pending&&!a.decision.events.some(event=>['request','manual','configuration','proposal'].includes(event.kind)))continue;
   if(!config.apiKey){this.host.command({type:'agentDecisionState',agentId:a.id,revision:a.decision.revision,state:'offline',error:'Agent API 未配置，请配置后重试。'},a.id);continue;}
   let request:CognitionRequest|null;
   try{request=this.host.cognitionPort(a.id).prepare();}catch{this.host.command({type:'agentDecisionState',agentId:a.id,revision:a.decision.revision,state:'error',error:'必要任务上下文超出预算；未提交模型请求。'},a.id);continue;}
   if(!request)continue;
   const controller=new AbortController(),flight={controller,revision:request.revision,configuration};
   if(!this.host.command({type:'agentDecisionState',agentId:a.id,revision:request.revision,state:'waiting',error:null},a.id).ok)continue;
   this.flights.set(a.id,flight);
   void this.client.cognize(config,request,a.modelConfig,controller.signal,state=>{if(!this.disposed&&!controller.signal.aborted&&this.flights.get(a.id)===flight)this.host.command({type:'agentDecisionState',agentId:a.id,revision:request!.revision,state,error:null},a.id);}).then(response=>{
    if(this.disposed||controller.signal.aborted||this.flights.get(a.id)!==flight)return;
    const result=this.host.command({type:'cognitionDecision',agentId:a.id,requestId:request!.requestId,response},a.id);
    if(!result.ok)this.host.command({type:'agentDecisionState',agentId:a.id,revision:request!.revision,state:'error',error:('认知结果拒绝：'+result.reason).slice(0,400)},a.id);
   }).catch(error=>{
    if(this.disposed||controller.signal.aborted||this.flights.get(a.id)!==flight)return;
    this.host.cognitionPort(a.id).cancel();
    this.host.command({type:'agentDecisionState',agentId:a.id,revision:request!.revision,state:'error',error:(error instanceof AgentApiError?error.message:'模型请求失败，请重试。').slice(0,400)},a.id);
   }).finally(()=>{if(this.flights.get(a.id)===flight)this.flights.delete(a.id);});
  }
 }
}
