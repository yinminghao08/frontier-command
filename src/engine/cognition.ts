import type { SimulationEngine } from './engine';
import type { AgentDecision, CommandResult, Observation } from './types';
import type { CognitionRequest, CognitionResponse } from './cognition-protocol';
import { cognitionJsonSchema } from './cognition-protocol';
import { resolveProposal } from './intent-gateway';
import { receiveObjective } from './objectives';
import { commitPrimaryReply } from './agent-runtime/replies';
import { wakeAgent,remember } from './chat';
import { goalFromProposal } from './agent-runtime/runtime';

let nextSession = 0;
interface Ticket {request:CognitionRequest;messageId:number|null;objectiveId:string|null;objectiveRevision:number|null;contractId:string|null;contractVersion:number|null;shipId:string|null;}
const rejected=(reason:string):CommandResult=>({ok:false,reason});
const accepted=():CommandResult=>({ok:true,reason:'认知结果已校验并提交'});
/** Ephemeral request authority belongs to this engine instance. Reloading creates
 * a new session; tickets never survive as permissions in a game save. */
export class CognitionGateway {
  private readonly session=++nextSession;
  private nextRequest=0;
  private readonly tickets=new Map<string,Ticket>();
  constructor(private readonly engine:SimulationEngine){}
  cancel(agentId:string){this.tickets.delete(agentId);}
  prepare(agentId:string):CognitionRequest|null {
    const e=this.engine,o=e.getObservation(agentId),a=e.state.agents.find(a=>a.id===agentId);
    if(!o?.self||!a?.enabled)return null;
    const message=e.state.chatMessages.find(m=>m.responses?.[agentId]==='pending');
    if(!o.ship&&!message)return null;
    const objective=e.state.objectives.find(t=>t.ownerAgentId===agentId&&['proposed','negotiating'].includes(t.consent)&&t.turnAgentId===agentId&&['active','blocked'].includes(t.status));
    const contract=e.state.escortRequests.find(r=>['pending','negotiating'].includes(r.status)&&r.turnAgentId===agentId);
    const purpose=objective?'judgment':message?'intent':contract?'collaboration':'strategy';
    const existing=this.tickets.get(agentId);
    if(existing&&existing.request.revision===a.decision.revision)return structuredClone(existing.request);
    const self={id:a.id,name:a.name,personality:a.personality,profile:a.profile,skills:a.skills,fatigue:a.fatigue,psychology:a.psychology,relationships:a.relationships,taskPreferences:a.taskPreferences,longTermGoal:a.longTermGoal};
    const active=e.state.objectives.filter(t=>t.ownerAgentId===agentId&&['active','blocked','interrupted'].includes(t.status)).map(t=>({id:t.id,goal:t.goal,originalInstruction:t.originalInstruction,constraints:t.constraints,consent:t.consent,status:t.status,revision:t.revision,conditions:t.conditions,task:e.state.agentRuntime.tasks.find(r=>r.objectiveId===t.id)}));
    const knowledge={locations:o.locations,systems:o.systems,bodies:o.bodies,ownShips:o.ownShips,wrecks:o.wrecks,inventories:o.inventories,contacts:o.contacts,opportunities:o.opportunities};
    let context:Record<string,unknown>,prompt:string;
    if(purpose==='judgment'){
      context={self,objective:active.find(t=>t.id===objective!.id),ship:o.ship,risks:o.contacts.filter(t=>t.live&&t.hostile),resources:o.inventories,constructionOptions:o.constructionOptions,commitments:o.commitments};
      prompt='TaskJudgment: 只判断这个自愿目标。response=accept/reject/counter。reply表达意图和真实原因，不能宣称执行完成。conditions只在counter时提出，其他情况为空数组；不生成物理动作。原始目标和约束必须保持完整。';
    }else if(purpose==='intent'){
      context={self,input:message!.content,authorizationMode:message!.controlMode??'voluntary',activeObjectives:active,publicFacts:knowledge,recentInteractions:o.recentChat.filter(m=>m.channelId===message!.channelId).slice(-8)};
      prompt='Intent: 理解 Admiral 的完整目标。只返回 disposition/proposal/allowWormholes/reply。复合装满后返航用loadReturn；RETURN保留货物，明确交付才deliver=true。回收指定全部Scout残骸用recovery并includeDiscoveries=true，舰级和ID只引用公开事实，不能猜测。Frontier q/r导航用navigate.sector，测绘具体天体用survey，不能互换。指代和催促必须引用持久原始目标：continue保留完整目标，不把最后一句话当作新行动。关键信息不足用clarify，普通聊天用conversation。无法完整表达的复合目标必须澄清，不降级为单一步骤。只有propose有非空proposal；其他情况proposal=null。reply不得声明尚未核验的物理结果。';
    }else if(purpose==='collaboration'){
      context={self,request:contract,ship:o.ship,activeObjectives:active,publicFacts:knowledge,commitments:o.commitments};
      prompt='CollaborationDecision: 只响应给定requestId和version，accept/reject/counter，reason及reply解释当前决定；仅counter可修改conditions。不生成物理动作或虚构履约。';
    }else{
      context={self,ship:o.ship,activeObjectives:active,opportunities:o.opportunities,decisionContext:o.decisionContext,publicFacts:knowledge};
      prompt='StrategicDecision: 仅选择给定opportunityId，或null表示保持当前目标/等待。riskPreference=cautious/balanced/bold，reason为简短真实理由。已有承诺和Admiral接管优先，不允许创建或猜测Action。';
    }
    if(JSON.stringify(context).length>100000)throw Error('必要目标上下文超出认知预算，未发出模型请求');
    const request:CognitionRequest={requestId:'cognition:'+this.session+':'+(++this.nextRequest),agentId,revision:a.decision.revision,purpose,schema:cognitionJsonSchema(purpose),context,prompt,outputBudget:purpose==='intent'?1800:900};
    this.tickets.set(agentId,{request,messageId:message?.id??null,objectiveId:objective?.id??null,objectiveRevision:objective?.revision??null,contractId:contract?.id??null,contractVersion:contract?.conditionVersion??null,shipId:o.ship?.id??null});
    return structuredClone(request);
  }
  private current(agentId:string,requestId:string,response:CognitionResponse):Ticket|CommandResult {
    const t=this.tickets.get(agentId),e=this.engine,a=e.state.agents.find(a=>a.id===agentId);
    if(!t||t.request.requestId!==requestId||t.request.purpose!==response.purpose||!a?.enabled||a.decision.revision!==t.request.revision)return rejected('请求已取消、过期或属于其他世界会话');
    const shipId=e.state.assignments.find(s=>s.operatorId===agentId)?.shipId??null;
    if(shipId!==t.shipId)return rejected('请求期间舰船分配已经改变');
    if(t.messageId&&!e.state.chatMessages.some(m=>m.id===t.messageId&&m.responses?.[agentId]==='pending'))return rejected('原交互已经处理或取消');
    if(t.objectiveId&&!e.state.objectives.some(o=>o.id===t.objectiveId&&o.revision===t.objectiveRevision&&['proposed','negotiating'].includes(o.consent)&&['active','blocked'].includes(o.status)))return rejected('目标或授权已经改变');
    return t;
  }
  validate(agentId:string,requestId:string,response:CognitionResponse):CommandResult {
    const t=this.current(agentId,requestId,response);if('ok' in t)return t;
    const o=this.engine.getObservation(agentId)!;
    try{
      if(response.purpose==='intent'){
        const d=response.decision;
        if((d.disposition==='propose')!==(d.proposal!==null))return rejected('意图阶段与目标参数不一致');
        if(d.proposal){const p=resolveProposal(o,d.proposal),goal=p.goal??goalFromProposal(p);if(o.ship&&!['assignment','cancel'].includes(goal.kind)){const valid=this.engine.runtime.validateGoal(goal,o.ship.id,'direct');if(!valid.ok)return valid;}}
        if(d.disposition==='continue'&&!this.engine.state.objectives.some(t=>t.ownerAgentId===agentId&&['active','blocked','interrupted'].includes(t.status)))return rejected('没有可以继承的持久目标，请澄清');
      }else if(response.purpose==='judgment'||response.purpose==='collaboration'){
        if(response.decision.response!=='counter'&&response.decision.conditions.length)return rejected('接受或拒绝不能偷偷修改约定条件');
        if(response.purpose==='collaboration'&&(response.decision.requestId!==t.contractId||response.decision.version!==t.contractVersion))return rejected('协作请求或版本不匹配');
        return this.engine.validate(this.negotiationCommand(t,response),agentId);
      }else if(response.purpose==='strategy'&&response.decision.opportunityId!==null){
        const goal=this.opportunityGoal(o,response.decision.opportunityId);
        if(!goal)return rejected('机会已失效或没有合法本地策略');
        return this.engine.validate({type:'issueDirective',shipIds:[o.ship!.id],mode:'REPLACE',action:goal},agentId);
      }
      return accepted();
    }catch(error){return rejected(error instanceof Error?error.message:'语义校验失败');}
  }
  // Temporary engine-local bridge to the existing negotiation ledger. It is never
  // an output schema or an execution port granted to the provider.
  private negotiationCommand(t:Ticket,response:Extract<CognitionResponse,{purpose:'judgment'|'collaboration'}>) {
    const d=response.decision;
    const decision:AgentDecision={goal:'判断自愿任务',rationale:d.reply,action:null,messages:[],memory:null,waitMinutes:30,coordination:response.purpose==='judgment'?{type:'answerTask',taskId:t.objectiveId!,version:this.engine.state.objectives.find(o=>o.id===t.objectiveId)!.conditionVersion,response:d.response,conditions:d.conditions,reason:d.reason}:{type:'answerRequest',requestId:t.contractId!,version:t.contractVersion!,response:d.response,conditions:d.conditions,reason:d.reason}};
    return {type:'agentDecision' as const,agentId:t.request.agentId,revision:t.request.revision,decision};
  }
  commit(agentId:string,requestId:string,response:CognitionResponse):CommandResult {
    const valid=this.validate(agentId,requestId,response);if(!valid.ok)return valid;
    const t=this.tickets.get(agentId)!,e=this.engine,a=e.state.agents.find(a=>a.id===agentId)!;
    this.tickets.delete(agentId);
    if(response.purpose==='judgment'||response.purpose==='collaboration'){
      if(t.messageId)commitPrimaryReply(e,agentId,t.messageId,response.decision.reply,response.decision.response==='counter'?'request':'reply');
      return e.dispatchCommand(this.negotiationCommand(t,response),agentId);
    }
    a.decision.pendingReasons=[];a.decision.events=[];a.decision.failures=0;a.decision.lastError=null;a.decision.nextAt=e.state.time+30;
    a.status=a.assignedShipId?'online':'unassigned';
    if(t.messageId){const interaction=e.state.agentRuntime.interactions.find(i=>i.sourceMessageId===t.messageId&&i.recipientAgentId===agentId);if(interaction)interaction.phase='committed';}
    if(response.purpose==='intent'){
      const d=response.decision;
      if(d.proposal){const p=resolveProposal(e.getObservation(agentId)!,d.proposal);p.allowWormholes=d.allowWormholes;receiveObjective(e,agentId,t.messageId!,p);}
      else if(d.disposition==='continue'){
        const target=[...e.state.objectives].reverse().find(o=>o.ownerAgentId===agentId&&['active','blocked','interrupted'].includes(o.status))!;
        if(target.status==='interrupted')commitPrimaryReply(e,agentId,t.messageId!,'原目标保留为中断状态。请在任务面板明确恢复后继续。','request');
        else {commitPrimaryReply(e,agentId,t.messageId!,d.reply);if(['proposed','negotiating'].includes(target.consent))wakeAgent(a,'proposal:'+target.id,e.state.time,true);e.runtime.drain();}
      }else commitPrimaryReply(e,agentId,t.messageId!,d.reply,d.disposition==='clarify'?'request':'reply');
    }else if(response.purpose==='communication'&&t.messageId)commitPrimaryReply(e,agentId,t.messageId,response.decision.content);
    else if(response.purpose==='strategy'&&response.decision.opportunityId){
      // ROE validation and deterministic task planning remain engine responsibilities.
      const action=this.opportunityGoal(e.getObservation(agentId)!,response.decision.opportunityId)!;
      return e.runtime.startCommand({type:'issueDirective',shipIds:[t.shipId!],mode:'REPLACE',action},agentId);
    }
    const explanation=response.purpose==='strategy'?response.decision.reason:response.purpose==='communication'?response.decision.content:response.purpose==='intent'?response.decision.reply:null;
    if(explanation)remember(e.state,a,'decision',explanation,null,5);
    return accepted();
  }
  private opportunityGoal(o:Observation,id:string) {
    const opportunity=o.opportunities.find(p=>p.id===id);if(!opportunity||!o.ship||o.objective&&['active','blocked','interrupted'].includes(o.objective.status))return null;
    if(opportunity.kind==='exploration'){const match=opportunity.targetId.match(/(-?\d+)[,:/](-?\d+)$/);if(match)return {type:'EXPLORE' as const,sector:{q:Number(match[1]),r:Number(match[2])},approach:'close' as const};}
    if(opportunity.kind==='logistics')return {type:'HAUL' as const,sourceId:opportunity.targetId,targetId:'base',cargoKind:'materials' as const,amount:10000,loadPolicy:'auto' as const,route:'safe' as const,repeat:false};
    if(opportunity.kind==='mining')return {type:'SURVEY' as const,targetId:opportunity.targetId,approach:'close' as const,deep:true};
    if(opportunity.kind==='security')return o.contacts.some(c=>c.id===opportunity.targetId&&c.hostile&&c.live)?{type:'ATTACK' as const,targetId:opportunity.targetId}:{type:'PATROL' as const,targetId:opportunity.targetId,duration:30};
    return null;
  }
}
