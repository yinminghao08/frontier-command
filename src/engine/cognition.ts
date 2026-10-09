import type { SimulationEngine } from './engine';
import type { CoordinationIntent, CommandResult, Observation, Agent } from './types';
import type { CognitionRequest, CognitionResponse } from './cognition-protocol';
import { cognitionJsonSchema } from './cognition-protocol';
import { resolveProposal } from './intent-gateway';
import { receiveObjective } from './objectives';
import { commitPrimaryReply } from './agent-runtime/replies';
import { wakeAgent,remember } from './chat';
import { actionSchema } from './action-schema';
import { capabilities,cargoUsed } from './capabilities';
import { validateNegotiation,applyNegotiation,makeRequest } from './contracts';
import { decisionWorldKey } from './personality';
import { goalFromProposal } from './agent-runtime/runtime';

let nextSession = 0;
interface Ticket {reasons:string[];triggers:Agent['decision']['events'];claimed:boolean;request:CognitionRequest;messageId:number|null;objectiveId:string|null;objectiveRevision:number|null;objectiveConditionVersion:number|null;contractId:string|null;contractVersion:number|null;shipId:string|null;}
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
  /** Configuration revokes old request authority; it is not a world opportunity.
   * Only an existing player/coordination request is requeued under the new mode. */
  configurationChanged(agentId?:string):void {
    for(const agent of this.engine.state.agents.filter(a=>agentId===undefined||a.id===agentId)){
      this.cancel(agent.id);agent.decision.revision++;
      agent.decision.pendingReasons=agent.decision.events.map(event=>event.id);
      const pending=this.engine.state.chatMessages.some(m=>m.responses?.[agent.id]==='pending')||this.engine.state.objectives.some(o=>o.ownerAgentId===agent.id&&['proposed','negotiating'].includes(o.consent)&&o.turnAgentId===agent.id&&['active','blocked'].includes(o.status))||this.engine.state.escortRequests.some(r=>r.turnAgentId===agent.id&&['pending','negotiating'].includes(r.status));
      if(pending&&agent.enabled)wakeAgent(agent,'configuration:pending-request',this.engine.state.time);
      this.finish(agent);
    }
  }
  /** Claim only the events represented by this request. Newly arriving events
   * remain queued; cancellation never replays an already dispatched trigger. */
  claim(agentId:string):void {
    const ticket=this.tickets.get(agentId),agent=this.engine.state.agents.find(a=>a.id===agentId);
    if(!ticket||!agent||ticket.claimed||ticket.request.revision!==agent.decision.revision)return;
    ticket.claimed=true;
    const claimed=new Set(ticket.triggers);
    agent.decision.events=agent.decision.events.filter(event=>!claimed.has(event));
    const ids=new Set(ticket.reasons);
    agent.decision.pendingReasons=agent.decision.pendingReasons.filter(id=>!ids.has(id)||agent.decision.events.some(event=>event.id===id));
    agent.decision.contextKey=decisionWorldKey(agent,this.engine.state);
  }
  private finish(agent:Agent):void {
    agent.decision.failures=0;agent.decision.lastError=null;
    agent.decision.nextAt=agent.decision.pendingReasons.length?this.engine.state.time:this.engine.state.time+30;
    agent.decision.lastChatId=this.engine.state.nextChat-1;
    const ship=this.engine.state.ships.find(s=>s.id===agent.assignedShipId);
    agent.status=!agent.enabled?'offline':ship?.current?.source==='admiral'&&ship.current.controlMode==='direct'?'admiral':ship?.current?'executing':ship?'online':'unassigned';
  }
  prepare(agentId:string):CognitionRequest|null {
    const e=this.engine,o=e.getObservation(agentId,false),a=e.state.agents.find(a=>a.id===agentId);
    if(!o?.self||!a?.enabled)return null;
    const message=e.state.chatMessages.find(m=>m.responses?.[agentId]==='pending');
    if(!o.ship&&!message)return null;
    const objective=e.state.objectives.find(t=>t.ownerAgentId===agentId&&['proposed','negotiating'].includes(t.consent)&&t.turnAgentId===agentId&&['active','blocked'].includes(t.status));
    const contract=e.state.escortRequests.find(r=>['pending','negotiating'].includes(r.status)&&r.turnAgentId===agentId);
    const smallTalk=message&&/^(?:你好|您好|早上好|晚上好|谢谢|你是谁|你怎么样|hi|hello|thanks|how are you|who are you)[!！?.。？\s]*$/i.test(message.content.trim());
    const purpose=objective?'judgment':message?(smallTalk?'communication':'intent'):contract?'collaboration':'strategy';
    const existing=this.tickets.get(agentId);
    if(existing&&existing.request.revision===a.decision.revision)return structuredClone(existing.request);
    const self={id:a.id,name:a.name,career:a.career,experience:a.experience,morale:a.morale,trust:a.trust,personality:a.personality,profile:a.profile,skills:a.skills,fatigue:a.fatigue,psychology:a.psychology,relationships:a.relationships,taskPreferences:a.taskPreferences,longTermGoal:a.longTermGoal,memory:[...o.self.memory].sort((l,r)=>r.salience-l.salience||r.time-l.time).slice(0,8)};
    const active=o.objectiveContext.map(t=>({id:t.id,goal:t.goal,originalInstruction:t.originalInstruction,amendments:t.amendments,constraints:t.constraints,consent:t.consent,status:t.status,revision:t.revision,conditions:t.conditions,task:this.taskFacts(o,t.id)}));
    const ship=o.ship?{id:o.ship.id,name:o.ship.name,classId:o.ship.classId,hull:o.ship.hull,shield:o.ship.shield,core:o.ship.core,capacity:capabilities(o.ship),cargo:o.ship.cargo,cargoUsed:cargoUsed(o.ship),modules:o.ship.modules,position:{x:o.ship.x,y:o.ship.y},current:o.ship.current?.action??null,standing:o.ship.standing}:null;
    const knowledge={events:o.events,locations:o.locations,systems:o.systems,bodies:o.bodies,ownShips:o.ownShips.map(s=>({id:s.id,name:s.name,classId:s.classId,x:s.x,y:s.y})),fleet:o.fleet,wormholes:o.wormholes,wrecks:o.wrecks,inventories:o.inventories,contacts:o.contacts,opportunities:o.opportunities};
    let context:Record<string,unknown>,prompt:string;
    if(purpose==='judgment'){
      context={self,objective:active.find(t=>t.id===objective!.id),ship,risks:o.contacts.filter(t=>t.live&&t.hostile),resources:o.inventories,constructionOptions:o.constructionOptions,commitments:o.commitments};
      prompt='TaskJudgment: 只判断这个自愿目标。response=accept/reject/counter。reply表达意图和真实原因，不能宣称执行完成。conditions只在counter时提出，其他情况为空数组；不生成物理动作。原始目标和约束必须保持完整。';
    }else if(purpose==='communication'){
      context={self,input:message!.content,activeObjectives:active,ship:o.ship?{id:o.ship.id,name:o.ship.name,hull:o.ship.hull,cargo:o.ship.cargo}:null,recentInteractions:o.recentChat.filter(m=>m.channelId===message!.channelId).slice(-6)};
      prompt='CommunicationDecision: 仅回应这条玩家聊天。content表达性格与真实主观判断，purpose=information/acknowledgement。不创建目标、不发送协作、不宣称未核验的物理行动。';
    }else if(purpose==='intent'){
      context={self,input:message!.content,authorizationMode:message!.controlMode??'voluntary',activeObjectives:active,publicFacts:knowledge,recentInteractions:o.recentChat.filter(m=>m.channelId===message!.channelId).slice(-8)};
      prompt='Intent: 理解 Admiral 的完整目标。只返回 disposition/proposal/objectiveId/allowWormholes/reply。复合装满后返航用loadReturn；RETURN保留货物，明确交付才deliver=true。回收指定全部Scout残骸用recovery并includeDiscoveries=true，舰级和ID只引用公开事实，不能猜测。Frontier q/r导航用navigate.sector，测绘具体天体用survey，不能互换。指代和催促必须引用持久原始目标：continue保留完整目标，不把最后一句话当作新行动。关键信息不足用clarify，普通聊天用conversation。无法完整表达的复合目标必须澄清，不降级为单一步骤。补充修改现有任务用revise，objectiveId必须引用给定目标，完整proposal继承其路线、来源和真实货物约束。propose/revise有非空proposal；其他情况proposal=null。revise必须提供objectiveId；continue可提供目标ID，仅在唯一已有目标时允许为空。reply不得声明尚未核验的物理结果。';
    }else if(purpose==='collaboration'){
      context={self,request:contract,ship,activeObjectives:active,publicFacts:knowledge,commitments:o.commitments};
      prompt='CollaborationDecision: 只响应给定requestId和version，accept/reject/counter，reason及reply解释当前决定；仅counter可修改conditions。不生成物理动作或虚构履约。';
    }else{
      context={self,ship,activeObjectives:active,opportunities:o.opportunities,maintenanceOptions:this.maintenanceOptions(o),rescueChoices:this.rescueChoices(o),supportCandidates:o.fleet.filter(peer=>peer.id!==agentId&&peer.assignedShipId),decisionContext:o.decisionContext,publicFacts:knowledge};
      prompt='StrategicDecision: 仅选择给定opportunityId，或null表示保持当前目标/等待。riskPreference=cautious/balanced/bold，reason为简短真实理由。已有承诺和Admiral接管优先，不允许创建或猜测Action。maintenanceOptions中的ID可选择已核验的维修或休整；运输需要护航时supportAgentId引用supportCandidates中的另一位伙伴，伙伴独立同意后才执行。风险偏好会由本地代码映射路线。重大海盗事件可选rescueChoices中的collaborationOptionId，opportunityId及supportAgentId必须为空；只请求伙伴救援，不取代当前已授权目标。';
    }
    if(JSON.stringify(context).length>100000)throw Error('必要目标上下文超出认知预算，未发出模型请求');
    const request:CognitionRequest={requestId:'cognition:'+this.session+':'+(++this.nextRequest),agentId,revision:a.decision.revision,purpose,schema:cognitionJsonSchema(purpose),context,prompt,outputBudget:purpose==='intent'?1800:900};
    this.tickets.set(agentId,{reasons:[...a.decision.pendingReasons],triggers:[...a.decision.events],claimed:false,request,messageId:message?.id??null,objectiveId:objective?.id??null,objectiveRevision:objective?.revision??null,objectiveConditionVersion:objective?.conditionVersion??null,contractId:contract?.id??null,contractVersion:contract?.conditionVersion??null,shipId:o.ship?.id??null});
    return structuredClone(request);
  }
  private current(agentId:string,requestId:string,response:CognitionResponse):Ticket|CommandResult {
    const t=this.tickets.get(agentId),e=this.engine,a=e.state.agents.find(a=>a.id===agentId);
    if(!t||t.request.requestId!==requestId||t.request.purpose!==response.purpose||!a?.enabled||a.decision.revision!==t.request.revision)return rejected('请求已取消、过期或属于其他世界会话');
    const shipId=e.state.assignments.find(s=>s.operatorId===agentId)?.shipId??null;
    if(shipId!==t.shipId)return rejected('请求期间舰船分配已经改变');
    if(t.messageId&&!e.state.chatMessages.some(m=>m.id===t.messageId&&m.responses?.[agentId]==='pending'))return rejected('原交互已经处理或取消');
    if(t.objectiveId&&!e.state.objectives.some(o=>o.id===t.objectiveId&&o.revision===t.objectiveRevision&&o.conditionVersion===t.objectiveConditionVersion&&['proposed','negotiating'].includes(o.consent)&&['active','blocked'].includes(o.status)))return rejected('目标或授权已经改变');
    return t;
  }
  validate(agentId:string,requestId:string,response:CognitionResponse):CommandResult {
    const t=this.current(agentId,requestId,response);if('ok' in t)return t;
    const o=this.engine.getObservation(agentId,false)!;
    try{
      if(response.purpose==='intent'){
        const d=response.decision;
        if(['propose','revise'].includes(d.disposition)!==(d.proposal!==null))return rejected('意图阶段与目标参数不一致');
        if(d.disposition==='revise'&&d.objectiveId===null||d.objectiveId!==null&&!['revise','continue'].includes(d.disposition))return rejected('目标修订必须引用唯一已有目标');
        if(d.disposition==='revise'){const observed=t.request.context.activeObjectives;if(!Array.isArray(observed))return rejected('修订缺少原始目标上下文');const origin=observed.find((item:unknown)=>item!==null&&typeof item==='object'&&'id'in item&&item.id===d.objectiveId);const target=this.engine.state.objectives.find(o=>o.id===d.objectiveId);if(!origin||!target||target.ownerAgentId!==agentId||!['active','blocked','interrupted'].includes(target.status)||!('revision'in origin)||origin.revision!==target.revision)return rejected('待修订目标已改变或不属于此交互');}
        if(d.proposal&&['assignment','cancel'].includes(d.proposal.kind))return rejected('舰船分配与取消需要明确的简单命令或 Admiral 控制按钮；当前语义请求未授予这种权限');
        if(d.proposal){const p=resolveProposal(o,d.proposal),goal=p.goal??goalFromProposal(p);if(d.proposal.kind==='supportedTransport'&&!this.engine.state.agents.some(peer=>peer.id===p.conditions?.find(c=>c.type==='escort')?.agentId&&peer.id!==agentId&&peer.enabled&&peer.assignedShipId))return rejected('护航伙伴当前不可接收协作');if(!o.ship&&!['assignment','cancel'].includes(goal.kind))return rejected('尚未分配舰船；请指定可用舰船，再确认这个目标');if(o.ship&&!['assignment','cancel'].includes(goal.kind)){const valid=this.engine.runtime.validateGoal(goal,o.ship.id,'direct');if(!valid.ok)return valid;}}
        if(d.disposition==='continue'){const targets=this.engine.state.objectives.filter(t=>t.ownerAgentId===agentId&&['active','blocked','interrupted'].includes(t.status));if(d.objectiveId!==null&&!targets.some(t=>t.id===d.objectiveId)||d.objectiveId===null&&targets.length!==1)return rejected(targets.length?'存在多个目标；请明确继续哪一个':'没有可以继承的持久目标，请澄清');}
      }else if(response.purpose==='judgment'||response.purpose==='collaboration'){
        if(response.decision.response!=='counter'&&response.decision.conditions.length)return rejected('接受或拒绝不能偷偷修改约定条件');
        if(response.purpose==='collaboration'&&(response.decision.requestId!==t.contractId||response.decision.version!==t.contractVersion))return rejected('协作请求或版本不匹配');
        return validateNegotiation(this.engine,this.engine.state.agents.find(a=>a.id===agentId)!,{coordination:this.negotiation(t,response),rationale:response.decision.reply});
      }else if(response.purpose==='communication'&&response.decision.social){return validateNegotiation(this.engine,this.engine.state.agents.find(a=>a.id===agentId)!,{coordination:null,social:response.decision.social,rationale:response.decision.content});
       }else if(response.purpose==='strategy'&&response.decision.collaborationOptionId){
        if(response.decision.opportunityId!==null||response.decision.supportAgentId)return rejected('救援选项不能同时改写自主目标');
        const coordination=this.rescueIntent(o,response.decision.collaborationOptionId);
        if(!coordination)return rejected('救援事件、伙伴或授权已经失效');
        return validateNegotiation(this.engine,this.engine.state.agents.find(a=>a.id===agentId)!,{coordination,rationale:response.decision.reason});
      }else if(response.purpose==='strategy'&&response.decision.opportunityId!==null){
        const goal=this.opportunityGoal(o,response.decision.opportunityId,response.decision.riskPreference);
        if(!goal)return rejected('机会已失效或没有合法本地策略');
        const actionCheck=this.engine.validate({type:'issueDirective',shipIds:[o.ship!.id],mode:'REPLACE',action:goal},agentId);if(!actionCheck.ok)return actionCheck;
        if(response.decision.supportAgentId)return validateNegotiation(this.engine,this.engine.state.agents.find(a=>a.id===agentId)!,{coordination:{type:'requestTask',kind:'escort',agentId:response.decision.supportAgentId,action:{type:'ESCORT',targetId:o.ship!.id},followUp:goal,conditions:[]},rationale:response.decision.reason});
        return actionCheck;
      }
      return accepted();
    }catch(error){return rejected(error instanceof Error?error.message:'语义校验失败');}
  }
  private negotiation(t:Ticket,response:Extract<CognitionResponse,{purpose:'judgment'|'collaboration'}>):CoordinationIntent {
    const d=response.decision;
    return response.purpose==='judgment'?{type:'answerTask',taskId:t.objectiveId!,version:t.objectiveConditionVersion!,response:d.response,conditions:d.conditions,reason:d.reason}:{type:'answerRequest',requestId:t.contractId!,version:t.contractVersion!,response:d.response,conditions:d.conditions,reason:d.reason};
  }
  commit(agentId:string,requestId:string,response:CognitionResponse):CommandResult {
    const valid=this.validate(agentId,requestId,response);if(!valid.ok){const ticket=this.current(agentId,requestId,response);if(response.purpose==='intent'&&!('ok'in ticket)&&ticket.messageId){commitPrimaryReply(this.engine,agentId,ticket.messageId,valid.reason,'request');this.tickets.delete(agentId);}return valid;}
    const t=this.tickets.get(agentId)!,e=this.engine,a=e.state.agents.find(a=>a.id===agentId)!;
    this.claim(agentId);
    this.tickets.delete(agentId);
    if(response.purpose==='judgment'||response.purpose==='collaboration'){
      if(t.messageId)commitPrimaryReply(e,agentId,t.messageId,response.decision.reply,response.decision.response==='counter'?'request':'reply');
      a.currentGoal=(e.state.objectives.find(o=>o.id===t.objectiveId)?.originalInstruction??'判断协作承诺').slice(0,240);
      applyNegotiation(e,a,{coordination:this.negotiation(t,response),rationale:response.decision.reply});
      a.decision.revision++;this.finish(a);a.decision.contextKey=decisionWorldKey(a,e.state);
      remember(e.state,a,'decision',response.decision.reply,null,5);
      const next=e.state.objectives.find(o=>o.ownerAgentId===agentId&&['proposed','negotiating'].includes(o.consent)&&['active','blocked'].includes(o.status)&&o.turnAgentId===agentId)??e.state.escortRequests.find(r=>['pending','negotiating'].includes(r.status)&&r.turnAgentId===agentId);
      if(next)wakeAgent(a,'request:'+next.id,e.state.time,true);
      return accepted();
    }
    this.finish(a);
    if(t.messageId){const interaction=e.state.agentRuntime.interactions.find(i=>i.sourceMessageId===t.messageId&&i.recipientAgentId===agentId);if(interaction)interaction.phase='committed';}
    if(response.purpose==='intent'){
      const d=response.decision;
      if(d.proposal){
        const p=resolveProposal(e.getObservation(agentId,false)!,d.proposal);p.allowWormholes=d.allowWormholes;
        if(d.disposition==='revise'){
          const target=e.state.objectives.find(o=>o.id===d.objectiveId)!,message=e.state.chatMessages.find(m=>m.id===t.messageId)!;
          const revised=e.runtime.revise(target.id,target.revision,p.goal??goalFromProposal(p),message.content,message.controlMode??'voluntary',d.allowWormholes,p.conditions);
          if(!revised.ok){commitPrimaryReply(e,agentId,t.messageId!,revised.reason,'request');return revised;}
          const interaction=e.state.agentRuntime.interactions.find(i=>i.sourceMessageId===message.id&&i.recipientAgentId===agentId);if(interaction)interaction.objectiveId=target.id;
          if(target.controlMode==='direct')commitPrimaryReply(e,agentId,message.id,'已按直接授权修订完整目标，现有物资与历史保留。');
        }else receiveObjective(e,agentId,t.messageId!,p);
      }
      else if(d.disposition==='continue'){
        const target=e.state.objectives.find(o=>o.ownerAgentId===agentId&&['active','blocked','interrupted'].includes(o.status)&&(d.objectiveId===null||o.id===d.objectiveId))!;
        if(target.status==='interrupted')commitPrimaryReply(e,agentId,t.messageId!,'原目标保留为中断状态。请在任务面板明确恢复后继续。','request');
        else {commitPrimaryReply(e,agentId,t.messageId!,d.reply);if(['proposed','negotiating'].includes(target.consent))wakeAgent(a,'proposal:'+target.id,e.state.time,true);e.runtime.drain();}
      }else commitPrimaryReply(e,agentId,t.messageId!,d.reply,d.disposition==='clarify'?'request':'reply');
    }else if(response.purpose==='communication'&&t.messageId){commitPrimaryReply(e,agentId,t.messageId,response.decision.content);if(response.decision.social)applyNegotiation(e,a,{coordination:null,social:response.decision.social,rationale:response.decision.content});}
    else if(response.purpose==='strategy'&&response.decision.collaborationOptionId){
      const coordination=this.rescueIntent(e.getObservation(agentId,false)!,response.decision.collaborationOptionId);
      if(!coordination)return rejected('救援事件、伙伴或授权已经失效');
      makeRequest(e,agentId,coordination.agentId,coordination.kind,coordination.action,coordination.followUp,coordination.conditions);
      remember(e.state,a,'decision',response.decision.reason,null,5);this.finish(a);return accepted();
    }else if(response.purpose==='strategy'&&response.decision.opportunityId){
      // ROE validation and deterministic task planning remain engine responsibilities.
      const observation=e.getObservation(agentId,false)!,action=this.opportunityGoal(observation,response.decision.opportunityId,response.decision.riskPreference);
      if(!action)return rejected('机会已失效或没有合法本地策略');
      remember(e.state,a,'decision',response.decision.reason,null,5);
      if(response.decision.supportAgentId){makeRequest(e,agentId,response.decision.supportAgentId,'escort',{type:'ESCORT',targetId:t.shipId!},action);this.finish(a);return accepted();}
      const result=e.runtime.startCommand({type:'issueDirective',shipIds:[t.shipId!],mode:'REPLACE',action},agentId);this.finish(a);return result;
    }
    const explanation=response.purpose==='strategy'?response.decision.reason:response.purpose==='communication'?response.decision.content:response.purpose==='intent'?response.decision.reply:null;
    if(explanation)remember(e.state,a,'decision',explanation,null,5);
    this.finish(a);return accepted();
  }
  private taskFacts(o:Observation,objectiveId:string) {
    const task=o.taskContext.find(t=>t.objectiveId===objectiveId);
    if(!task)return null;
    return {taskId:task.taskId,status:task.status,revision:task.revision,currentStep:task.currentStep,
      assignedShipIds:task.assignedShipIds,dependencyTaskIds:task.dependencyTaskIds,blockReason:task.blockReason,
      execution:task.execution,scope:task.scope,dependencies:task.dependencies,progress:task.progress,steps:task.steps,completionEvidence:task.completionEvidence,
      retainedAction:task.checkpoint?.action??null};
  }
  private rescueChoices(o:Observation) {
    if(!o.ship)return [];
    return o.piracyIncidents.filter(i=>i.shipId===o.ship!.id&&i.stage!=='resolved').flatMap(i=>o.rescueOptions.filter(option=>o.fleet.some(peer=>peer.id===option.agentId&&peer.assignedShipId)&&this.engine.state.agents.some(peer=>peer.id===option.agentId&&peer.enabled)).map(option=>({id:'rescue:'+i.id+':'+option.agentId,incidentId:i.id,agentId:option.agentId,kind:'reinforce' as const})));
  }
  private rescueIntent(o:Observation,id:string):Extract<CoordinationIntent,{type:'requestTask'}>|null {
    const choice=this.rescueChoices(o).find(choice=>choice.id===id),option=o.rescueOptions.find(option=>option.agentId===choice?.agentId);
    if(!choice||!option||!o.ship)return null;
    // Only idle, uncommitted captains may choose a refuge. Existing Admiral and
    // accepted objectives retain their physical execution and authorization.
    const free=!o.ship.current&&!o.objectiveContext.some(objective=>['active','blocked','interrupted'].includes(objective.status));
    const refuge=free?o.locations.filter(location=>location.owner==='starfleet'&&location.hull>0).sort((a,b)=>Math.hypot(a.x-o.ship!.x,a.y-o.ship!.y)-Math.hypot(b.x-o.ship!.x,b.y-o.ship!.y)||a.id.localeCompare(b.id))[0]:null;
    return {type:'requestTask',kind:'reinforce',agentId:choice.agentId,action:actionSchema.parse(option.action),followUp:refuge?{type:'DOCK',targetId:refuge.id}:null,conditions:[]};
  }
  private maintenanceOptions(o:Observation) {
    if(!o.ship||!o.self)return [];
    const nearby=o.locations.filter(l=>l.owner==='starfleet'&&l.hull>0).sort((a,b)=>Math.hypot(a.x-o.ship!.x,a.y-o.ship!.y)-Math.hypot(b.x-o.ship!.x,b.y-o.ship!.y)||a.id.localeCompare(b.id));
    const target=nearby[0];if(!target)return [];
    return [...(o.ship.hull<capabilities(o.ship).hull||o.ship.engines<100||o.ship.weapons<100?[{id:'maintenance:repair:'+target.id,kind:'repair',targetId:target.id}]:[]),...(o.self.fatigue>=80||o.self.psychology.stress>=60?[{id:'maintenance:rest:'+target.id,kind:'rest',targetId:target.id}]:[])];
  }
  private opportunityGoal(o:Observation,id:string,risk:'cautious'|'balanced'|'bold'='cautious') {
    const maintenance=this.maintenanceOptions(o).find(option=>option.id===id);
    if(maintenance&&(!o.objective||!['active','blocked','interrupted'].includes(o.objective.status)))return maintenance.kind==='repair'?{type:'REPAIR' as const,targetId:maintenance.targetId}:{type:'REST' as const,targetId:maintenance.targetId,duration:30};
    const opportunity=o.opportunities.find(p=>p.id===id);if(!opportunity||!o.ship||o.objective&&['active','blocked','interrupted'].includes(o.objective.status))return null;
    if(opportunity.kind==='exploration'){const match=opportunity.targetId.match(/(-?\d+)[,:/](-?\d+)$/);if(match)return {type:'EXPLORE' as const,sector:{q:Number(match[1]),r:Number(match[2])},approach:'close' as const};}
    if(opportunity.kind==='logistics')return {type:'HAUL' as const,sourceId:opportunity.targetId,targetId:'base',cargoKind:'materials' as const,amount:10000,loadPolicy:'auto' as const,route:risk==='bold'?'risky' as const:risk==='balanced'?'direct' as const:'safe' as const,repeat:false};
    if(opportunity.kind==='mining')return {type:'SURVEY' as const,targetId:opportunity.targetId,approach:'close' as const,deep:true};
    if(opportunity.kind==='security')return o.contacts.some(c=>c.id===opportunity.targetId&&c.hostile&&c.live)?{type:'ATTACK' as const,targetId:opportunity.targetId}:{type:'PATROL' as const,targetId:opportunity.targetId,duration:30};
    return null;
  }
}
