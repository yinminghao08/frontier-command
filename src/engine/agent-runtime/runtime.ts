import { wakeAgent } from '../chat';
import { directiveSchema } from '../directive-schema';
import { validateAction, validateContinuation } from '../command-system';
import type { SimulationEngine } from '../engine';
import type { Action, Command, CommandResult, Directive, Objective, Ship } from '../types';
import { capabilities, cargoUsed } from '../capabilities';
import { dist } from '../navigation';
import { available, inventory } from '../inventory';
import { receiveObjective } from '../objectives';
import { planTask } from './handlers';
import { advanceCoordination, contractDirectiveOutcome, readyConditions, settleContract } from '../contracts';
import { commitPrimaryReply, notifyTask, replyRecord } from './replies';
import { emitDomainEvent, seedCargoLots, transitionEvent } from './journal';
import { criterionFor, createTask, terminalTask, type DomainEvent, type ObjectiveGoal, type TaskState, type TaskStatus, type TaskDependency } from './model';

export function goalFromProposal(p: Pick<Objective,'kind'|'action'|'targetId'|'shipId'|'facilityKind'|'sectors'|'factionId'>): ObjectiveGoal {
  if(p.kind==='assign'&&p.shipId)return {kind:'assignment',shipId:p.shipId};
  if(p.kind==='cancel')return {kind:'cancel'};
  if(p.kind==='construction'&&p.targetId&&p.facilityKind)return {kind:'construction',siteId:p.targetId,facilityKind:p.facilityKind};
  if(p.kind==='surveyRoute')return {kind:'surveyRoute',sectors:p.sectors};
  if(p.kind==='factionAssault')return {kind:'factionAssault',factionId:'orion'};
  if(p.action)return {kind:'operation',action:p.action};
  throw Error('Objective proposal has no complete goal');
}

export class FrontierAgentRuntime {
  private draining=false;
  private readonly submittingObjectives=new Set<string>();
  private readonly tasksByObjective=new Map<string,TaskState>();
  private readonly tasksById=new Map<string,TaskState>();
  private readonly activeObjectives=new Map<string,Objective>();
  constructor(private readonly e: SimulationEngine) {
    for(const objective of e.state.objectives)this.register(objective);
  }
  register(objective: Objective): TaskState {
    const r=this.e.state.agentRuntime;
    let task=this.tasksByObjective.get(objective.id);if(task)return task;
    task=r.tasks.find(t=>t.objectiveId===objective.id);
    if(task){this.tasksByObjective.set(objective.id,task);this.tasksById.set(task.taskId,task);if(!terminalTask(task.status))this.activeObjectives.set(objective.id,objective);return task;}
    const agent=this.e.state.agents.find(a=>a.id===objective.ownerAgentId);
    const shipId=objective.shipId??agent?.assignedShipId;
    task=createTask(objective,shipId??null);
    r.tasks.push(task);this.tasksByObjective.set(objective.id,task);this.tasksById.set(task.taskId,task);if(!terminalTask(task.status))this.activeObjectives.set(objective.id,objective);
    const interaction=r.interactions.find(i=>i.interactionId===objective.originInteractionId);
    if(interaction){interaction.objectiveId=objective.id;interaction.phase='committed';}
    else r.interactions.push({
      interactionId:objective.originInteractionId,source:objective.messageId?'chat':'ui',senderId:objective.issuerId,
      recipientAgentId:objective.ownerAgentId,sourceMessageId:objective.messageId||null,instruction:objective.originalInstruction,
      authorizationMode:objective.controlMode,objectiveId:objective.id,phase:'committed',createdAt:this.e.state.time});
    if(objective.goal.kind==='recovery')this.enroll(task,objective.goal);
    return task;
  }
  receiveMessage(agentId: string, messageId: number) {
    if(this.e.state.agentRuntime.interactions.some(i=>i.sourceMessageId===messageId&&i.recipientAgentId===agentId))return;
    replyRecord(this.e,messageId,agentId);
    receiveObjective(this.e,agentId,messageId);
    if(!this.e.state.agentRuntime.interactions.some(i=>i.sourceMessageId===messageId&&i.recipientAgentId===agentId)) {
      const message=this.e.state.chatMessages.find(m=>m.id===messageId)!;
      this.e.state.agentRuntime.interactions.push({interactionId:`interaction:${messageId}:${agentId}`,source:'chat',senderId:message.sender,
        recipientAgentId:agentId,sourceMessageId:messageId,instruction:message.content,authorizationMode:message.controlMode??'voluntary',
        objectiveId:null,phase:'interpreting',createdAt:this.e.state.time});
    }
  }
  validateGoal(goal: ObjectiveGoal,shipId: string,mode:Objective['controlMode']): CommandResult {
    const w=this.e.state,ship=w.ships.find(s=>s.id===shipId);
    if(!ship)return {ok:false,reason:'需要真实可用的己方舰船'};
    if(mode==='voluntary'&&!w.assignments.some(a=>a.shipId===shipId&&w.agents.some(agent=>agent.id===a.operatorId)))return {ok:false,reason:'自愿任务需要已分配 Agent'};
    if(goal.kind==='operation')return validateAction(this.e,ship,goal.action);
    if(goal.kind==='loadReturn'&&(!inventory(w,goal.sourceId)||!inventory(w,goal.destinationId)||goal.sourceId===goal.destinationId))return {ok:false,reason:'装载或返航设施无效'};
    if(goal.kind==='recovery'&&(goal.wreckIds.some(id=>!w.wrecks.some(x=>x.id===id&&x.discovered))||goal.destinationId!==null&&!inventory(w,goal.destinationId)))return {ok:false,reason:'目标必须来自已发现残骸和己方设施'};
    if(goal.kind==='construction'&&!w.bodies.some(b=>b.id===goal.siteId&&b.discovered))return {ok:false,reason:'建设目标未发现'};
    return {ok:true,reason:'目标参数通过本地验证'};
  }
  submitGoal(goal: ObjectiveGoal,shipId: string,mode:'direct'|'voluntary',instruction: string): CommandResult {
    const valid=this.validateGoal(goal,shipId,mode);if(!valid.ok)return valid;
    const owner=this.e.state.assignments.find(a=>a.shipId===shipId&&this.e.state.agents.some(agent=>agent.id===a.operatorId))?.operatorId??null;
    if(mode==='direct')this.interrupt(shipId);
    const objective=this.start(goal,shipId,this.e.state.commander.id,owner,instruction);
    if(mode==='voluntary'){objective.controlMode='voluntary';objective.consent='proposed';const task=this.register(objective);task.status='proposed';const agent=this.e.state.agents.find(a=>a.id===owner)!;wakeAgent(agent,'proposal:'+objective.id,this.e.state.time,true);}
    this.drain();return {ok:true,reason:'已创建完整目标 '+objective.id};
  }
  revise(id:string,revision:number,goal:ObjectiveGoal,instruction:string,authorizationMode?:'direct'|'voluntary',allowWormholes?:boolean):CommandResult {
    this.drain();
    const e=this.e,objective=e.state.objectives.find(o=>o.id===id),task=this.taskForObjective(id);
    if(!objective||!task||objective.revision!==revision||terminalTask(task.status))return {ok:false,reason:'目标版本已改变或已经结束'};
    const ship=e.state.ships.find(s=>s.id===task.assignedShipIds[0]);if(!ship)return {ok:false,reason:'任务舰船已失效'};
    const valid=this.validateGoal(goal,ship.id,objective.controlMode);if(!valid.ok)return valid;
    const previous=objective.goal;
    // A cargo source change cannot reinterpret already loaded batches as another
    // source. It must be expressed as a separate goal with explicit custody.
    if(previous.kind==='loadReturn'&&goal.kind==='loadReturn'&&task.progress.loaded[previous.cargoKind]>0&&(previous.sourceId!==goal.sourceId||previous.cargoKind!==goal.cargoKind))return {ok:false,reason:'已装货物的来源与种类不能改写；请保留此交付责任或新建目标'};
    if(previous.kind!==goal.kind)return {ok:false,reason:'目标族改变需要新建目标；当前任务货物与历史不会被改写'};
    if(goal.kind==='recovery'&&previous.kind==='recovery'&&(goal.sourceClassId!==previous.sourceClassId||previous.wreckIds.some(id=>!goal.wreckIds.includes(id))))return {ok:false,reason:'回收修订可以扩展目标或改变交付设施，不能删除已承担的来源责任'};
    const interrupted=task.status==='interrupted';
    const held=[ship.current,...ship.queue,...ship.suspended].find(d=>d?.taskId===task.taskId);
    if(held)task.checkpoint=directiveSchema.parse(held);
    if(task.checkpoint){
      const old=task.checkpoint.action;
      const compatible=goal.kind==='operation'&&previous.kind==='operation'&&(JSON.stringify(old)===JSON.stringify(goal.action)||old.type==='HAUL'&&goal.action.type==='HAUL'&&old.sourceId===goal.action.sourceId&&old.cargoKind===goal.action.cargoKind);
      if(compatible&&goal.kind==='operation')task.checkpoint=directiveSchema.parse({...task.checkpoint,action:goal.action,journey:null});
      else if(goal.kind==='loadReturn'&&previous.kind==='loadReturn'&&old.type==='LOAD')task.checkpoint=directiveSchema.parse({...task.checkpoint,action:{...old,route:goal.route},journey:null});
      else if(!(goal.kind==='loadReturn'&&previous.kind==='loadReturn'&&goal.destinationId===previous.destinationId&&(old.type==='RETURN'||old.type==='DOCK'||old.type==='UNLOAD')))task.checkpoint=null;
    }
    if(ship.current?.taskId===task.taskId){ship.current=null;ship.path=[];ship.tracking=null;ship.status='idle';}
    ship.queue=ship.queue.filter(d=>d.taskId!==task.taskId);ship.suspended=ship.suspended.filter(d=>d.taskId!==task.taskId);
    for(const step of task.steps.filter(s=>s.status==='running'))step.status='cancelled';
    objective.goal=structuredClone(goal);objective.revision++;objective.updatedAt=e.state.time;objective.completionCriteria=criterionFor(goal);
    objective.amendments.push({revision:objective.revision,instruction,goal:structuredClone(goal),time:e.state.time});
    objective.action=goal.kind==='operation'?goal.action:null;
    if(goal.kind==='operation')objective.targetId='targetId'in goal.action?goal.action.targetId:null;
    if(goal.kind==='construction'){objective.targetId=goal.siteId;objective.facilityKind=goal.facilityKind;}
    if(goal.kind==='surveyRoute'){objective.sectors=goal.sectors;objective.sectorIndex=0;objective.scannedSectorIndices=[];}
    task.completedRevision=null;task.progress.verified=false;task.activeDirectiveId=null;task.currentStep=task.steps.length;task.revision++;task.updatedAt=e.state.time;
    const agent=e.state.agents.find(a=>a.id===objective.ownerAgentId);if(agent){agent.decision.revision++;agent.decision.pendingReasons=[];agent.decision.events=[];}
    if(authorizationMode)objective.controlMode=authorizationMode;
    if(allowWormholes!==undefined){objective.allowWormholes=allowWormholes;objective.constraints.allowWormholes=allowWormholes;}
    if(task.checkpoint){task.checkpoint.controlMode=objective.controlMode;task.checkpoint.executorAgentId=objective.ownerAgentId;task.checkpoint.allowWormholes=objective.constraints.allowWormholes;if(allowWormholes!==undefined)task.checkpoint.journey=null;}
    if(objective.controlMode==='voluntary'){
      objective.consent='proposed';objective.conditionVersion++;objective.turnAgentId=objective.ownerAgentId!;
      this.transition(task,interrupted?'interrupted':'proposed','目标已修订，等待重新同意');
      if(agent&&!interrupted)wakeAgent(agent,'proposal:'+id,e.state.time,true);
    }else this.transition(task,interrupted?'interrupted':'accepted','目标已按 Admiral 授权修订');
    emitDomainEvent(e,{type:'objectiveRevised',sourceId:e.state.commander.id,objectiveId:id,taskId:task.taskId,directiveId:null,payload:{revision:objective.revision,previousGoal:previous,goal:structuredClone(goal),instruction}});
    this.drain();return {ok:true,reason:'目标已修订；实际货物、付费、承诺与交易记录保留'};
  }
  start(goal: ObjectiveGoal, shipId: string, issuerId=this.e.state.commander.id, ownerAgentId: string|null=null, instruction=criterionFor(goal), mode: 'REPLACE'|'QUEUE'|'INTERRUPT'='REPLACE'): Objective {
    const w=this.e.state;
    const id='objective-'+w.nextId++;
    const objective: Objective={id,schemaVersion:1,originInteractionId:'interaction:'+id,issuerId,ownerAgentId,goal,
      constraints:{allowWormholes:true},completionCriteria:criterionFor(goal),revision:0,createdAt:w.time,updatedAt:w.time,originalInstruction:instruction,amendments:[],
      agentId:ownerAgentId??w.commander.id,messageId:0,channelId:'system-reports',kind:goal.kind==='loadReturn'?'loadReturn':goal.kind==='recovery'?'salvage':goal.kind==='operation'?'action':goal.kind==='assignment'?'assign':goal.kind,
      action:goal.kind==='operation'?goal.action:null,targetId:goal.kind==='construction'?goal.siteId:null,shipId,facilityKind:goal.kind==='construction'?goal.facilityKind:null,sectors:goal.kind==='surveyRoute'?goal.sectors:[],
      sectorIndex:0,scannedSectorIndices:[],allowWormholes:true,projectId:null,carrierAgentId:null,reason:null,controlMode:issuerId===w.commander.id?'direct':this.e.executingContractId?'voluntary':'autonomous',consent:'accepted',conditions:[],conditionVersion:1,rounds:0,turnAgentId:ownerAgentId??w.commander.id,creditsApproved:false,directiveMode:mode,status:'active',searchedTargets:{},...(goal.kind==='factionAssault'?{factionId:'orion' as const}:{})};
    w.objectives.push(objective);this.register(objective);return objective;
  }
  startCommand(command: Extract<Command,{type:'issueDirective'}>, actorId: string): CommandResult {
    const valid=this.e.validate(command,actorId);if(!valid.ok)return valid;
    // A multi-ship transaction is validated before creating any task; group spacing
    // is retained by the authoritative command implementation.
    const objectives=command.shipIds.map(id=>this.start({kind:'operation',action:command.action},id,actorId,this.e.state.assignments.find(a=>a.shipId===id&&this.e.state.agents.some(agent=>agent.id===a.operatorId))?.operatorId??null,command.action.type,command.mode));
    const first=objectives[0];for(const o of objectives)this.submittingObjectives.add(o.id);
    const previous=this.e.executingObjectiveId;this.e.executingObjectiveId=first.id;
    let result:CommandResult;
    try {result=this.e.dispatchCommand(command,actorId);} finally {this.e.executingObjectiveId=previous;this.submittingObjectives.clear();}
    if(!result.ok){for(const objective of objectives)this.transition(this.register(objective),'failed',result.reason);return result;}
    for(const objective of objectives) {
      const task=this.register(objective);task.coordinationId=this.e.executingContractId;this.attachCoordination(task,actorId);const ship=this.e.state.ships.find(s=>s.id===objective.shipId)!;
      const d=[ship.current,...ship.queue,...ship.suspended].find(d=>d?.taskId===first.id);
      if(!d)throw Error('Accepted command did not produce its Directive');
      d.taskId=task.taskId;d.objectiveId=objective.id;d.originInteractionId=objective.originInteractionId;d.submissionKey='step:0';
      task.activeDirectiveId=d.id;task.directiveIds.push(d.id);task.steps.push({label:this.stepLabel(d.action),action:structuredClone(d.action),status:'running'});task.submissionKeys['step:0']=d.id;this.transition(task,'running');
    }
    return result;
  }
  private priority(objective: Objective|undefined) {return !objective?0:objective.controlMode==='direct'?100:objective.issuerId===this.e.state.commander.id?80:objective.issuerId.startsWith('standing:')?10:40;}
  startStanding(ship:Ship,action:Action):CommandResult {
    if(ship.current||ship.queue.length||ship.suspended.length||this.e.state.agents.some(a=>a.assignedShipId===ship.id&&a.enabled))return {ok:false,reason:'已有执行所有者'};
    const valid=validateAction(this.e,ship,action);if(!valid.ok)return valid;
    const objective=this.start({kind:'operation',action},ship.id,'standing:'+ship.id,null,'Standing Order: '+action.type);
    const task=this.register(objective),result=this.submitDirective(task.taskId,objective.issuerId,{type:'issueDirective',shipIds:[ship.id],mode:'REPLACE',action},task.revision);
    if(!result.ok)this.transition(task,'failed',result.reason);
    return result;
  }
  interruptForSafety(ship:Ship) {
    const directive=ship.current;if(!directive)return;
    const task=directive.taskId?this.tasksById.get(directive.taskId):undefined;
    if(task&&!terminalTask(task.status)){task.checkpoint=directiveSchema.parse(directive);this.transition(task,'interrupted','重大危险触发紧急脱离，等待显式恢复');}
    this.outcome(ship,directive,'紧急脱离中断当前操作',false,true);
  }
  linkDependency(parent:TaskState,child:TaskState,criterion:TaskDependency['criterion'],targetShipId:string|null=null):CommandResult {
    const reaches=(id:string,visited=new Set<string>()):boolean=>{if(id===parent.taskId)return true;if(visited.has(id))return false;visited.add(id);return this.tasksById.get(id)?.dependencyTaskIds.some(next=>reaches(next,visited))??false;};
    if(terminalTask(parent.status)||reaches(child.taskId))return {ok:false,reason:'任务依赖已结束或会形成循环'};
    if(!parent.dependencies.some(d=>d.taskId===child.taskId&&d.criterion===criterion&&d.targetShipId===targetShipId))parent.dependencies.push({taskId:child.taskId,criterion,targetShipId,status:'pending',evidenceEventId:null});
    if(!parent.dependencyTaskIds.includes(child.taskId))parent.dependencyTaskIds.push(child.taskId);
    return {ok:true,reason:'真实任务依赖已关联'};
  }
  private dependenciesReady(task:TaskState):boolean {
    for(const dependency of task.dependencies.filter(d=>d.status==='pending')){
      const child=this.tasksById.get(dependency.taskId);
      if(!child||['cancelled','failed','completed_partial'].includes(child.status)){this.transition(task,'blocked','依赖任务失效；需要明确修订或重新协调');return false;}
      const escort=this.e.state.ships.find(s=>child.assignedShipIds.includes(s.id)&&s.current?.taskId===child.taskId),target=this.e.state.ships.find(s=>s.id===dependency.targetShipId);
      const fulfilled=dependency.criterion==='completed'?child.status==='completed':!!(escort&&target&&escort.current?.action.type==='ESCORT'&&escort.current.action.targetId===target.id&&dist(escort,target)<60);
      if(!fulfilled){this.transition(task,'blocked',dependency.criterion==='rendezvous'?'等待已承诺的实际护航会合':'等待准备或物流子任务完成');return false;}
      const event=emitDomainEvent(this.e,{type:'taskDependency',sourceId:child.taskId,objectiveId:task.objectiveId,taskId:task.taskId,directiveId:child.activeDirectiveId,payload:{childTaskId:child.taskId,criterion:dependency.criterion,targetShipId:dependency.targetShipId}});
      dependency.status='fulfilled';dependency.evidenceEventId=event.eventId;
      task.completionEvidence.push({eventId:event.eventId,tick:event.simulationTick,kind:'directive',sourceId:child.taskId,targetId:dependency.targetShipId,cargoKind:null,amount:0,description:dependency.criterion==='rendezvous'?'已核验真实护航会合':'已核验依赖任务完成'});
    }
    return true;
  }
  private attachCoordination(task:TaskState,actorId:string) {
    const id=task.coordinationId;if(!id)return;
    const parent=this.tasksByObjective.get(id),request=this.e.state.escortRequests.find(r=>r.id===id);
    if(parent&&parent.taskId!==task.taskId)this.linkDependency(parent,task,'completed');
    if(request?.parentTaskId){const root=this.tasksByObjective.get(request.parentTaskId);if(root&&actorId===request.responderId)this.linkDependency(root,task,request.kind==='escort'?'rendezvous':'completed',request.kind==='escort'?request.targetShipId:null);}
    if(request?.kind==='escort'&&actorId===request.requesterId){const escort=this.e.state.agentRuntime.tasks.find(t=>t.taskId!==task.taskId&&t.coordinationId===id&&t.ownerAgentId===request.responderId&&this.e.state.objectives.find(o=>o.id===t.objectiveId)?.goal.kind==='operation');if(escort)this.linkDependency(task,escort,'rendezvous',request.targetShipId);}
  }
  taskForObjective(id: string) {return this.tasksByObjective.get(id);}
  transition(task: TaskState, status: TaskStatus, reason: string|null=null) {
    const blockReason=['blocked','interrupted','failed'].includes(status)?reason:null;
    if(terminalTask(task.status)||task.status===status&&task.blockReason===blockReason)return;
    const from=task.status;
    task.status=status;task.blockReason=blockReason;task.revision++;task.updatedAt=this.e.state.time;
    const objective=this.e.state.objectives.find(o=>o.id===task.objectiveId);
    if(objective){objective.status=status==='accepted'||status==='running'||status==='proposed'?'active':status;objective.reason=reason;objective.updatedAt=this.e.state.time;}
    if(status==='completed'&&objective?.controlMode==='voluntary'&&this.e.state.commitments.some(p=>p.contractId===objective.id&&p.condition.when==='after'&&p.condition.type!=='reward'&&p.status==='pending')) {
      task.progress.verified=true;task.status='blocked';task.blockReason='等待已承诺的后置条件';objective.status='blocked';
      return;
    }
    const event=transitionEvent(this.e,task.taskId,task.objectiveId,from,status,reason);
    if(terminalTask(status)&&objective) {
      this.activeObjectives.delete(objective.id);
      task.progress.verified=status==='completed';
      if(status==='completed')task.completionEvidence.push({eventId:event.eventId,tick:event.simulationTick,kind:'verified',sourceId:null,targetId:null,cargoKind:null,amount:0,description:reason??objective.completionCriteria});
      settleContract(this.e,objective,status==='completed',reason??status,status==='cancelled'?'cancel':'failure');
      if(objective.messageId)notifyTask(this.e,objective.ownerAgentId,objective.channelId,event.eventId,objective.id,
        (status==='completed'?'目标已核验完成：':status==='completed_partial'?'目标部分完成：':'目标结束：')+(reason??objective.originalInstruction),status==='failed');
    }
  }
  submitDirective(taskId: string, actorId: string, command: Command, expectedRevision: number): CommandResult {
    const task=this.tasksById.get(taskId);
    if(!task||task.revision!==expectedRevision||terminalTask(task.status)||task.status==='interrupted')return {ok:false,reason:'任务版本已改变或不允许执行'};
    const objective=this.e.state.objectives.find(o=>o.id===task.objectiveId)!;
    if(objective.consent!=='accepted')return {ok:false,reason:'自愿任务尚未获得同意'};
    if(actorId!==objective.issuerId&&actorId!==objective.ownerAgentId)return {ok:false,reason:'执行者不属于目标授权'};
    if(command.type==='issueDirective'&&command.shipIds.some(id=>!task.assignedShipIds.includes(id)))return {ok:false,reason:'舰船不属于任务绑定'};
    const key='revision:'+objective.revision+':step:'+task.currentStep;
    const existing=task.submissionKeys[key];
    if(existing&&this.e.state.ships.some(s=>[s.current,...s.queue,...s.suspended].some(d=>d?.id===existing)))return {ok:true,reason:'既有步骤提交已复用'};
    const previous=this.e.executingObjectiveId;
    this.e.executingObjectiveId=objective.id;
    try {
      const result=this.e.dispatchCommand(command,actorId);
      if(!result.ok)return result;
      for(const ship of this.e.state.ships)for(const d of [ship.current,...ship.queue,...ship.suspended]) {
        if(!d||d.taskId!==objective.id)continue;
        d.taskId=task.taskId;d.objectiveId=objective.id;d.originInteractionId=objective.originInteractionId;d.submissionKey=key;
        task.submissionKeys[key]=d.id;task.activeDirectiveId=d.id;
        if(!task.directiveIds.includes(d.id))task.directiveIds.push(d.id);
        task.steps.push({label:this.stepLabel(d.action),action:structuredClone(d.action),status:'running'});
      }
      this.transition(task,'running');
      return result;
    } finally {this.e.executingObjectiveId=previous;}
  }
  issue(objective: Objective, ship: Ship, action: Action): CommandResult {
    const task=this.register(objective);
    if(!task.assignedShipIds.includes(ship.id))task.assignedShipIds.push(ship.id);
    return this.submitDirective(task.taskId,objective.issuerId,{type:'issueDirective',shipIds:[ship.id],mode:objective.directiveMode??'REPLACE',action},task.revision);
  }
  outcome(ship: Ship, d: Directive, text: string, failed: boolean, interrupted=false) {
    emitDomainEvent(this.e,{type:'directiveOutcome',sourceId:ship.id,objectiveId:d.objectiveId??null,taskId:d.taskId,
      directiveId:d.id,payload:{shipId:ship.id,actorId:d.actorId,executorAgentId:d.executorAgentId,contractId:d.contractId,work:d.work,carried:d.carried,delivered:d.delivered,lost:d.lost??0,cycle:d.cycle,paidCredits:d.paidCredits,action:d.action,failed,interrupted,text:text.slice(0,2000)}});
  }
  interrupt(shipId: string|null, agentId?: string) {
    for(const task of this.e.state.agentRuntime.tasks) {
      if(task.objectiveId===this.e.executingObjectiveId||this.submittingObjectives.has(task.objectiveId)||terminalTask(task.status))continue;
      if(!task.assignedShipIds.includes(shipId??'')&&task.ownerAgentId!==agentId)continue;
      const directive=this.e.state.ships.flatMap(s=>[s.current,...s.queue,...s.suspended]).find(d=>d?.taskId===task.taskId);
      if(directive){const checkpoint=directiveSchema.parse(directive);if(directive.action.type==='REST')checkpoint.work=0;task.checkpoint=checkpoint;}
      this.transition(task,'interrupted','Admiral 已接管，等待显式恢复');
      const objective=this.e.state.objectives.find(o=>o.id===task.objectiveId);
      if(objective?.messageId&&objective.ownerAgentId){const message=this.e.state.chatMessages.find(m=>m.id===objective.messageId);if(message?.responses?.[objective.ownerAgentId]==='pending'){message.responses[objective.ownerAgentId]='cancelled';const reply=replyRecord(this.e,message.id,objective.ownerAgentId);if(reply.primaryMessageId===null){reply.phase='cancelled';reply.revision++;}}}
      const agent=this.e.state.agents.find(a=>a.id===task.ownerAgentId);
      if(agent){agent.decision.revision++;agent.decision.pendingReasons=[];agent.decision.events=[];agent.status=agent.assignedShipId?'admiral':'unassigned';}
    }
  }
  resume(objectiveId: string, revision: number): CommandResult {
    const objective=this.e.state.objectives.find(o=>o.id===objectiveId);
    const task=this.taskForObjective(objectiveId);
    if(!objective||!task||objective.revision!==revision||task.status!=='interrupted')return {ok:false,reason:'目标不存在、版本已改变或不处于中断状态'};
    const ship=this.e.state.ships.find(s=>s.id===task.assignedShipIds[0]);
    if(!ship)return {ok:false,reason:'任务舰船已失效'};
    if(objective.ownerAgentId&&!this.e.state.assignments.some(a=>a.operatorId===objective.ownerAgentId&&a.shipId===ship.id))return {ok:false,reason:'舰船分配已改变，需重新确认目标绑定'};
    if(ship.current||ship.queue.length)return {ok:false,reason:'请先结束当前 Admiral 指挥'};
    if(task.checkpoint&&objective.consent==='accepted') {
      const d=structuredClone(task.checkpoint),valid=validateContinuation(this.e,ship,d);
      if(!valid.ok)return valid;
      const reserved=Object.entries(d.reserved).some(([kind,n])=>n>0&&available(this.e.state,'sourceId'in d.action?d.action.sourceId:'targetId'in d.action?d.action.targetId:'',kind as keyof typeof d.reserved)<n);
      if(reserved)return {ok:false,reason:'中断期间预留库存已改变，请修订目标'};
      ship.current=d;ship.path=[];ship.status='active';task.activeDirectiveId=d.id;task.checkpoint=null;
    } else {task.activeDirectiveId=null;}
    objective.revision++;
    if(objective.consent!=='accepted'&&objective.ownerAgentId) {
      const agent=this.e.state.agents.find(a=>a.id===objective.ownerAgentId)!;
      this.transition(task,'proposed');wakeAgent(agent,'proposal:'+objective.id,this.e.state.time,true);
      const message=this.e.state.chatMessages.find(m=>m.id===objective.messageId);
      if(message?.responses){message.responses[agent.id]='pending';const record=replyRecord(this.e,message.id,agent.id);if(record.primaryMessageId===null)record.phase='pending';}
    } else this.transition(task,'accepted');
    this.drain();return {ok:true,reason:'目标已重新验证并恢复'};
  }
  cancel(objectiveId: string, revision: number): CommandResult {
    const objective=this.e.state.objectives.find(o=>o.id===objectiveId);
    const task=this.taskForObjective(objectiveId);
    if(!objective||!task||objective.revision!==revision||terminalTask(task.status))return {ok:false,reason:'目标版本已改变或已经结束'};
    task.checkpoint=null;
    this.transition(task,'cancelled','Admiral 取消目标；实际货物保留');objective.revision++;
    const agent=this.e.state.agents.find(a=>a.id===task.ownerAgentId);if(agent){agent.decision.revision++;this.e.cognition.cancel(agent.id);}
    for(const ship of this.e.state.ships){ship.queue=ship.queue.filter(d=>d.taskId!==task.taskId);ship.suspended=ship.suspended.filter(d=>d.taskId!==task.taskId);if(ship.current?.taskId===task.taskId)this.e.complete(ship,'目标已取消',true);}
    task.activeDirectiveId=null;
    return {ok:true,reason:'目标已取消'};
  }
  drain() {
    if(this.draining)return;
    this.draining=true;
    try {
      for(const ship of this.e.state.ships)seedCargoLots(this.e,ship.id,ship.cargo);
      const journal=this.e.state.agentRuntime;
      const consume=()=>{while(journal.consumedSequence<journal.events.length)this.consume(journal.events[journal.consumedSequence++]);};
      consume();advanceCoordination(this.e);consume();
      for(const objective of this.activeObjectives.values()) {
        const task=this.register(objective);
        if(terminalTask(task.status)||task.status==='interrupted')continue;
        if(objective.status==='cancelled'||objective.status==='failed'){this.transition(task,objective.status,objective.reason);continue;}
        if(objective.consent==='rejected'||objective.consent==='withdrawn'){this.transition(task,'cancelled','自愿任务未获同意');continue;}
        if(objective.consent!=='accepted')continue;
        if(task.status==='proposed')this.transition(task,'accepted');
        if(task.progress.verified&&task.status==='blocked'){if(readyConditions(this.e,objective,'after'))this.transition(task,'completed',objective.completionCriteria);continue;}
        if(objective.controlMode==='voluntary'&&(objective.conditions.some(c=>c.type==='reward')&&!objective.creditsApproved||!readyConditions(this.e,objective,'before'))){this.transition(task,'blocked','等待已承诺的准备条件或预算批准');continue;}
        if(!this.dependenciesReady(task))continue;
        const agent=this.e.state.agents.find(a=>a.id===objective.ownerAgentId);
        const ship=this.e.state.ships.find(s=>s.id===(agent?.assignedShipId??task.assignedShipIds[0]));
        if(ship&&!task.assignedShipIds.includes(ship.id))task.assignedShipIds.push(ship.id);
        const held=this.e.state.ships.flatMap(s=>[s.current,...s.queue,...s.suspended]).find(d=>d?.taskId===task.taskId);
        if(held){task.activeDirectiveId=held.id;task.blockReason=/等待|已满|不足|失效/.test(held.note)?held.note:null;continue;}
        task.activeDirectiveId=null;
        if(ship&&task.checkpoint&&!ship.current){
          const checkpoint=structuredClone(task.checkpoint),valid=validateContinuation(this.e,ship,checkpoint);
          const reserved=Object.entries(checkpoint.reserved).some(([kind,amount])=>amount>0&&available(this.e.state,'sourceId'in checkpoint.action?checkpoint.action.sourceId:'targetId'in checkpoint.action?checkpoint.action.targetId:'',kind as keyof typeof checkpoint.reserved)<amount);
          if(!valid.ok||reserved){this.transition(task,'blocked',valid.ok?'预留库存已改变，等待调整':valid.reason);continue;}
          ship.current=checkpoint;ship.path=[];ship.status='active';task.activeDirectiveId=checkpoint.id;task.checkpoint=null;
          task.steps.push({label:this.stepLabel(checkpoint.action),action:structuredClone(checkpoint.action),status:'running'});this.transition(task,'running');continue;
        }
        if(ship?.current&&ship.current.objectiveId!==objective.id&&objective.directiveMode!=='INTERRUPT'&&(task.directiveIds.length>0||objective.controlMode==='voluntary'&&!(objective.issuerId===this.e.state.commander.id&&objective.directiveMode==='REPLACE')&&this.priority(objective)<=this.priority(this.e.state.objectives.find(o=>o.id===ship.current?.objectiveId))))continue;
        if(objective.goal.kind==='loadReturn'||objective.goal.kind==='recovery') {
          if(!ship){this.transition(task,'blocked','尚未分配可用舰船');continue;}
          this.runLogistics(objective,task,ship);
        } else if(objective.goal.kind!=='operation'||task.completedRevision!==objective.revision)planTask(this.e,objective);
      }
    } finally {this.draining=false;}
  }
  private consume(event: DomainEvent) {
    if(!event.taskId)return;
    const task=this.tasksById.get(event.taskId);
    if(!task||task.processedEventIds.includes(event.eventId))return;
    task.processedEventIds.push(event.eventId);
    if(terminalTask(task.status))return;
    const objective=this.e.state.objectives.find(o=>o.id===task.objectiveId)!;
    if(event.type==='cargoTransfer') {
      const p=event.payload;
      if(p.disposition==='loaded') {
        task.progress.loaded[p.cargoKind]+=p.amount;
        if(p.sourceId&&(objective.goal.kind!=='recovery'||p.cargoKind==='materials'))task.progress.targetRecovered[p.sourceId]=(task.progress.targetRecovered[p.sourceId]??0)+p.amount;
      } else if(p.disposition==='delivered') {
        const goal=objective.goal;
        const destination=goal.kind==='loadReturn'||goal.kind==='recovery'?goal.destinationId:
          goal.kind==='operation'&&'targetId'in goal.action?goal.action.targetId:null;
        if(p.targetId===(destination?inventory(this.e.state,destination)?.id??destination:null))task.progress.delivered[p.cargoKind]+=p.amount;
        else task.progress.lost[p.cargoKind]+=p.amount;
      } else task.progress.lost[p.cargoKind]+=p.amount;
      task.completionEvidence.push({eventId:event.eventId,tick:event.simulationTick,kind:p.disposition==='loaded'?'loaded':p.disposition==='delivered'?'delivered':'lost',
        sourceId:p.sourceId,targetId:p.targetId,cargoKind:p.cargoKind,amount:p.amount,description:p.disposition});
      task.updatedAt=this.e.state.time;
    }
    if(event.type==='directiveCycle') {
      task.progress.cycles++;
      task.completionEvidence.push({eventId:event.eventId,tick:event.simulationTick,kind:'directive',sourceId:event.payload.shipId,targetId:null,cargoKind:null,amount:event.payload.delivered,description:'真实运输循环 '+(event.payload.cycle+1)+'：交付 '+event.payload.delivered+'，损失 '+event.payload.lost});
      task.updatedAt=this.e.state.time;
    }
    if(event.type==='directiveOutcome') {
      const p=event.payload;
      if(p.interrupted){const step=task.steps.find(s=>s.status==='running');if(step)step.status='cancelled';return;}
      task.completedRevision=objective.revision;
      if(event.directiveId&&!task.progress.completedDirectives.includes(event.directiveId))task.progress.completedDirectives.push(event.directiveId);
      const step=task.steps.find(s=>s.status==='running');if(step)step.status=p.failed?'failed':'completed';
      task.completionEvidence.push({eventId:event.eventId,tick:event.simulationTick,kind:'directive',sourceId:p.shipId,targetId:'targetId'in p.action?p.action.targetId:null,cargoKind:null,amount:0,description:p.text});
      task.activeDirectiveId=null;task.currentStep++;task.revision++;
      if(task.status==='interrupted'||p.interrupted)return;
      if(p.contractId)contractDirectiveOutcome(this.e,event.directiveId!,p.contractId,p.failed,p.executorAgentId??p.actorId);
      if(p.failed){this.transition(task,'failed',p.text);return;}
      if(objective.goal.kind==='operation')this.verifyOperation(objective,task,event);
      if(objective.goal.kind==='surveyRoute'&&p.action.type==='EXPLORE'&&!objective.scannedSectorIndices.includes(objective.sectorIndex))objective.scannedSectorIndices.push(objective.sectorIndex);
      if(objective.goal.kind==='factionAssault'&&objective.targetId)(objective.searchedTargets??={})[objective.targetId]=this.e.state.intel.find(i=>i.id===objective.targetId)?.lastSeen??this.e.state.time;

    }
  }
  private verifyOperation(objective: Objective, task: TaskState, event: Extract<DomainEvent,{type:'directiveOutcome'}>) {
    const a=objective.goal.kind==='operation'?objective.goal.action:event.payload.action;
    const w=this.e.state,ship=w.ships.find(s=>s.id===event.payload.shipId);
    if(!ship){this.transition(task,'failed','任务舰船不存在');return;}
    const proof=event.payload;
    let complete=false;
    if(a.type==='PATROL')complete=proof.work+1e-8>=a.duration&&w.locations.some(l=>l.id===a.targetId&&l.hull>0);
    if(a.type==='REST')complete=proof.work+1e-8>=a.duration&&w.locations.some(l=>l.id===a.targetId&&l.hull>0&&dist(ship,l)<=12+1e-8);
    if(a.type==='DOCK'||a.type==='RETREAT'){const facility=inventory(w,a.targetId);complete=!!facility&&dist(ship,facility)<=12+1e-8;}
    if(a.type==='REPAIR')complete=ship.hull+1e-8>=capabilities(ship).hull&&ship.engines>=100&&ship.weapons>=100;
    if(a.type==='REARM')complete=ship.photon>=a.load.photon&&ship.quantum>=a.load.quantum;
    if(a.type==='REFIT')complete=a.remove?!ship.modules.includes(a.moduleId):ship.modules.includes(a.moduleId);
    if(a.type==='ESCORT'){const target=[...w.ships,...w.civilians].find(s=>s.id===a.targetId);complete=!!target&&!target.current&&dist(ship,target)<60&&w.locations.some(l=>l.owner==='starfleet'&&l.hull>0&&dist(target,l)<40);}
    if(a.type==='INTERCEPT')complete=w.intel.some(i=>i.id===a.targetId&&i.live&&!i.resolved&&dist(ship,i)<90);
    if(a.type==='DISABLE')complete=w.enemies.some(s=>s.id===a.targetId&&s[a.subsystem??'engines']<=0&&w.intel.some(i=>i.id===s.id&&i.live));
    if(a.type==='DRIVE_OFF')complete=w.enemies.some(s=>s.id===a.targetId&&s.intent==='retreat'&&w.intel.some(i=>i.id===s.id&&i.live));
    if(a.type==='SHADOW')complete=false; // Continuous tracking requires explicit cancellation.
    if(a.type==='ASSIST_EVENT')complete=w.events.some(v=>v.id===a.targetId&&v.stage==='resolved');
    if(a.type==='CAPTURE')complete=w.locations.some(l=>l.id===a.targetId&&l.owner==='starfleet'&&l.occupation==='secured');
    if(a.type==='TRANSIT')complete=proof.work>=2&&w.wormholes.some(h=>h.id===a.targetId&&h.discovered&&h.transits>0&&dist(ship,h.exit)<1e-8);
    if(a.type==='HAIL')complete=(ship.cooldowns.hail??0)>0&&w.history.some(h=>h.kind==='diplomacy'&&h.entityId===a.targetId&&h.time>=objective.createdAt);
    if(a.type==='RETURN')complete=dist(ship,this.e.base)<=12+1e-8;
    if(a.type==='MOVE')complete=dist(ship,a.point)<=8+1e-8;
    if(a.type==='HAUL') {
      complete=task.progress.loaded[a.cargoKind]>0&&task.progress.delivered[a.cargoKind]+1e-8>=task.progress.loaded[a.cargoKind];
      if(!complete&&task.progress.delivered[a.cargoKind]>0&&task.progress.lost[a.cargoKind]>0){this.transition(task,'completed_partial','真实交付有货损');return;}
      if(a.repeat)return;
    }
    if(a.type==='RECOVER')complete=w.wrecks.some(x=>x.id===a.targetId&&x.discovered)&&Object.values(task.progress.loaded).some(n=>n>0);
    if(a.type==='ATTACK'||a.type==='ATTACK_SET') {
      const ids=a.type==='ATTACK_SET'?a.targetIds:[a.targetId];
      complete=ids.every(id=>w.intel.some(i=>i.id===id&&i.resolved)||w.wrecks.some(x=>x.id==='wreck:'+id&&x.discovered)||w.locations.some(l=>l.id===id&&l.discovered&&l.hull===0));
    }
    if(a.type==='SURVEY'){const target=[...w.systems,...w.bodies].find(t=>t.id===a.targetId&&t.discovered);complete=!!target&&target.survey>=(a.deep||a.approach==='close'?2:1);}
    if(a.type==='EXPLORE')complete=w.sectors.some(s=>s.discovered&&s.q===a.sector.q&&s.r===a.sector.r);
    if(a.type==='UNLOAD')complete=cargoUsed(ship)<=1e-8;
    if(a.type==='LOAD')complete=task.progress.loaded[a.cargoKind]>0;
    if(!complete){this.transition(task,'blocked','Directive 已结束，但完整目标尚无足够证据');return;}
    this.transition(task,'completed',event.payload.text);
  }
  private enroll(task: TaskState, goal: Extract<ObjectiveGoal,{kind:'recovery'}>) {
    for(const wreck of this.e.state.wrecks.filter(x=>x.discovered&&(goal.wreckIds.includes(x.id)||goal.includeDiscoveries&&goal.sourceClassId!==null&&x.sourceClassId===goal.sourceClassId))) {
      if(!(wreck.id in task.progress.targetAmounts))task.progress.targetAmounts[wreck.id]=wreck.stock.materials;
    }
  }
  private runLogistics(objective: Objective, task: TaskState, ship: Ship) {
    const goal=objective.goal;
    const issue=(action: Action)=>{const result=this.issue(objective,ship,action);if(!result.ok)this.transition(task,'blocked',result.reason);};
    if(goal.kind==='loadReturn') {
      if(task.progress.loaded[goal.cargoKind]===0){issue({type:'LOAD',sourceId:goal.sourceId,cargoKind:goal.cargoKind,route:goal.route});return;}
      const destination=inventory(this.e.state,goal.destinationId);
      if(!destination){this.transition(task,'blocked','返航设施已失效；货物保留');return;}
      if(dist(ship,destination)>12+1e-8){issue(goal.destinationId==='base'?{type:'RETURN'}:{type:'DOCK',targetId:goal.destinationId});return;}
      if(goal.deliver&&task.progress.delivered[goal.cargoKind]+1e-8<task.progress.loaded[goal.cargoKind]-task.progress.lost[goal.cargoKind]){issue({type:'UNLOAD',targetId:goal.destinationId});return;}
      const remaining=this.e.state.agentRuntime.cargoLots.filter(l=>l.taskId===task.taskId&&l.shipId===ship.id&&l.cargoKind===goal.cargoKind).reduce((n,l)=>n+l.amount,0);
      if(!goal.deliver&&remaining+1e-8<task.progress.loaded[goal.cargoKind]&&task.progress.lost[goal.cargoKind]===0){this.transition(task,'blocked','无法证明装载货物仍在舰上');return;}
      this.transition(task,task.progress.lost[goal.cargoKind]>0?'completed_partial':'completed',goal.deliver?'实际装载货物已交付':'已装载真实库存并返回，货物保留');
    }
    if(goal.kind==='recovery') {
      this.enroll(task,goal);
      const remaining=this.e.state.wrecks.filter(x=>x.discovered&&x.id in task.progress.targetAmounts&&x.stock.materials>1e-8)
        .sort((a,b)=>dist(ship,a)-dist(ship,b)||a.id.localeCompare(b.id));
      const carried=this.e.state.agentRuntime.cargoLots.filter(l=>l.taskId===task.taskId&&l.cargoKind==='materials').reduce((n,l)=>n+l.amount,0);
      if(remaining.length&&capabilities(ship).cargo-cargoUsed(ship)>=1){issue({type:'RECOVER',targetId:remaining[0].id});return;}
      if(goal.destinationId&&(carried>1e-8||remaining.length&&cargoUsed(ship)>=1)){issue({type:'UNLOAD',targetId:goal.destinationId});return;}
      if(remaining.length){this.transition(task,'blocked','货舱已满，尚有目标材料；需要交付设施');return;}
      const expected=Object.values(task.progress.targetAmounts).reduce((n,v)=>n+v,0);
      const collected=Object.values(task.progress.targetRecovered).reduce((n,v)=>n+v,0);
      if(expected>collected+1e-8){this.transition(task,'blocked','部分目标库存由其他行动取走，缺少本任务回收证据');return;}
      if(task.progress.legacyUnknown){this.transition(task,'blocked','旧存档缺少材料来源证据，请核对后修订目标');return;}
      if(goal.destinationId&&carried>1e-8){this.transition(task,'blocked','任务材料尚未全部交付');return;}
      this.transition(task,task.progress.lost.materials>0?'completed_partial':'completed',goal.destinationId?'所有已发现目标材料已实际回收并交付':'所有目标材料已回收并留舰');
    }
  }
  private stepLabel(a: Action) {return a.type==='LOAD'?'到达来源并装载实际库存':a.type==='RETURN'?'返航，保留货物':a.type==='UNLOAD'?'实际交付货物':a.type==='RECOVER'?'回收真实残骸库存':a.type;}
}
