import {actionSchema} from '../action-schema';
import {executionSchema} from './model';
import type { Action,ReadonlyDeep } from '../types';
import { capabilities,cargoUsed } from '../capabilities';
import { available,inventory } from '../inventory';
import { dist } from '../navigation';
import { liveRequest } from '../contracts';
import type { GoalOf,ObjectiveKind,ObjectiveGoal,TaskHandler,TaskPlan,TaskState,TaskView,VerificationResult,DomainEvent,TaskTransition } from './model';

const waiting=(reason:string):TaskPlan=>({status:'blocked',reason});
const done=(reason:string,partial=false):TaskPlan=>({status:partial?'completed_partial':'completed',reason});
const stateOf=(task:ReadonlyDeep<TaskState>)=>executionSchema.parse(task.execution);
const custody=(task:ReadonlyDeep<TaskState>,view:TaskView,kind:'materials'|'photon'|'quantum'|'specialFinds')=>view.world.agentRuntime.cargoLots.filter(l=>l.taskId===task.taskId&&l.cargoKind===kind).reduce((n,l)=>n+l.amount,0);

function logistics(goal:ReadonlyDeep<GoalOf<'loadReturn'|'recovery'>>,task:ReadonlyDeep<TaskState>,view:TaskView):TaskPlan {
 const {world:w,ship}=view;if(!ship)return waiting('尚未分配可用舰船');
 if(goal.kind==='loadReturn'){
  const loaded=task.scope.carryIn[goal.cargoKind]+task.progress.loaded[goal.cargoKind]-task.scope.loadedBaseline[goal.cargoKind];
  const delivered=task.progress.delivered[goal.cargoKind]-task.scope.deliveredBaseline[goal.cargoKind],lost=task.progress.lost[goal.cargoKind]-task.scope.lostBaseline[goal.cargoKind];
  if(loaded<=1e-8)return {action:{type:'LOAD',sourceId:goal.sourceId,cargoKind:goal.cargoKind,route:goal.route}};
  const destination=inventory(w,goal.destinationId);if(!destination)return waiting('返航设施已失效；货物保留');
  if(dist(ship,destination)>12+1e-8)return {action:goal.destinationId==='base'?{type:'RETURN'}:{type:'DOCK',targetId:goal.destinationId}};
  if(task.progress.diverted[goal.cargoKind]>task.scope.divertedBaseline[goal.cargoKind]+1e-8)return waiting('任务材料已交付其他地点，尚未证明目标交付；需要修订或重新协调');
  if(goal.deliver&&delivered+1e-8<loaded-lost)return {action:{type:'UNLOAD',targetId:goal.destinationId}};
  if(!goal.deliver&&custody(task,view,goal.cargoKind)+1e-8<loaded&&lost===0)return waiting('无法证明本次装载货物仍在舰上');
  return done(goal.deliver?'本次实际装载货物已交付':'已装载真实库存并返回，货物保留',lost>0);
 }
 const remaining=w.wrecks.filter(x=>x.discovered&&x.id in task.progress.targetAmounts&&x.stock.materials>1e-8).sort((a,b)=>dist(ship,a)-dist(ship,b)||a.id.localeCompare(b.id));
 const carried=custody(task,view,'materials');
 if(remaining.length&&capabilities(ship).cargo-cargoUsed(ship)>=1)return {action:{type:'RECOVER',targetId:remaining[0].id}};
 if(goal.destinationId&&(carried>1e-8||remaining.length&&cargoUsed(ship)>=1))return {action:{type:'UNLOAD',targetId:goal.destinationId}};
 if(remaining.length)return waiting('货舱已满，尚有目标材料；需要交付设施');
 const expected=Object.values(task.progress.targetAmounts).reduce((n,v)=>n+v,0),collected=Object.values(task.progress.targetRecovered).reduce((n,v)=>n+v,0);
 if(expected>collected+1e-8)return waiting('部分目标库存由其他行动取走，缺少本任务回收证据');
 if(task.progress.legacyUnknown)return waiting('旧存档缺少材料来源证据，请核对后修订目标');
 if(task.progress.diverted.materials>0)return waiting('回收材料已交付其他地点，目标交付证据不足');
 if(goal.destinationId&&carried>1e-8)return waiting('任务材料尚未全部交付');
 return done(goal.destinationId?'所有已发现目标材料已实际回收并交付':'所有目标材料已回收并留舰',task.progress.lost.materials>0);
}
function surveyRoute(goal:ReadonlyDeep<GoalOf<'surveyRoute'>>,task:ReadonlyDeep<TaskState>,view:TaskView):TaskPlan {
 const execution=stateOf(task),w=view.world;
 while(execution.sectorIndex<goal.sectors.length){
  const coord=goal.sectors[execution.sectorIndex],sector=w.sectors.find(s=>s.discovered&&s.q===coord.q&&s.r===coord.r);
  if(!sector||!execution.scannedSectorIndices.includes(execution.sectorIndex))return {execution,action:{type:'EXPLORE',sector:coord,approach:'close'}};
  const systems=w.systems.filter(s=>s.discovered&&s.sectorId===sector.id),bodyIds=new Set(systems.flatMap(s=>s.bodyIds));
  const target=[...systems,...w.bodies.filter(b=>b.discovered&&bodyIds.has(b.id))].find(t=>t.survey<2);
  if(target)return {execution,action:{type:'SURVEY',targetId:target.id,approach:'close',deep:false}};
  execution.sectorIndex++;
 }
 return {...done('逐区测绘任务完成：所有指定星区已近距调查。'),execution};
}
function factionAssault(_goal:ReadonlyDeep<GoalOf<'factionAssault'>>,task:ReadonlyDeep<TaskState>,view:TaskView):TaskPlan {
 const {world:w,ship}=view;if(!ship)return waiting('尚未分配舰船');const execution=stateOf(task);
 const targets=[...w.intel.filter(i=>i.factionId==='orion'&&!i.resolved&&w.time-i.lastSeen<=30&&(execution.searchedTargets[i.id]??-1)<i.lastSeen),...w.locations.filter(l=>l.owner==='orion'&&l.discovered&&l.hull>0)];
 targets.sort((l,r)=>{const threat=(t:typeof targets[number])=>'lastAttackAt'in t&&t.lastAttackAt!==undefined&&w.time-t.lastAttackAt<=12?1:0;const live=(t:typeof targets[number])=>'live'in t?Number(t.live):1;return threat(r)-threat(l)||live(r)-live(l)||dist(ship,l)-dist(ship,r)||l.id.localeCompare(r.id);});
 if(!targets[0])return waiting('清剿保持中：暂无可攻击的已知 Orion 目标，等待新情报。');
 execution.selectedTargetId=targets[0].id;return {execution,action:{type:'ATTACK',targetId:targets[0].id}};
}
function construction(goal:ReadonlyDeep<GoalOf<'construction'>>,task:ReadonlyDeep<TaskState>,view:TaskView):TaskPlan {
 const {world:w,objective}=view;let ship=view.ship;const execution=stateOf(task);
 if(!ship)return waiting('尚未分配舰船');
 const facility=w.locations.find(l=>l.siteId===goal.siteId&&l.kind===goal.facilityKind&&l.owner==='starfleet'&&l.hull>0);
 if(facility)return done('建设完成：'+facility.name+' 已成为真实设施。');
 const project=w.projects.find(p=>p.siteId===goal.siteId&&p.kind===goal.facilityKind&&!p.complete);
 if(!project){const site=[...w.bodies,...w.systems].find(s=>s.id===goal.siteId&&s.discovered);if(!site)return waiting('建设目标尚未发现');if(site.survey<2)return {action:{type:'SURVEY',targetId:site.id,approach:'close',deep:false}};return {command:{type:'startConstruction',siteId:site.id,kind:goal.facilityKind,name:(site.name+' / '+goal.facilityKind.toUpperCase()).slice(0,80)}};}
 execution.projectId=project.id;const need=Math.max(0,project.cost.materials-project.stock.materials);
 if(need<1)return {execution,status:'running',reason:'物资已到位，等待实际施工'};
 const agent=w.agents.find(a=>a.id===objective.ownerAgentId);
 if(agent&&!execution.carrierAgentId&&capabilities(ship).cargo<need){
  const collaboration=w.escortRequests.find(r=>r.parentTaskId===objective.id&&r.kind==='logistics');
  if(collaboration&&liveRequest(collaboration))return {execution,...waiting('等待同僚自主接受或协商物流支援')};
  if(collaboration?.status==='completed')execution.carrierAgentId=collaboration.responderId;
  if(!collaboration){
   const peer=w.agents.filter(a=>a.id!==agent.id&&a.enabled&&a.personality.cooperation>=40&&a.fatigue<80&&!w.objectives.some(o=>o.ownerAgentId===a.id&&['active','blocked','interrupted'].includes(o.status))).sort((a,b)=>b.skills.logistics-a.skills.logistics||a.id.localeCompare(b.id)).map(a=>({agent:a,ship:w.ships.find(s=>s.id===a.assignedShipId)})).find(p=>p.ship&&!p.ship.current&&!p.ship.queue.length&&!p.ship.suspended.length&&capabilities(p.ship).cargo-cargoUsed(p.ship)>=need);
   const source=w.locations.filter(l=>l.owner==='starfleet'&&available(w,l.id,'materials')>=need).sort((a,b)=>dist(ship!,a)-dist(ship!,b)||a.id.localeCompare(b.id))[0];
   if(peer&&source)return {execution,request:{agentId:peer.agent.id,kind:'logistics',action:{type:'HAUL',sourceId:source.id,targetId:project.id,cargoKind:'materials',amount:need,loadPolicy:'auto',route:'safe',repeat:false}}};
  }
 }
 if(execution.carrierAgentId){const carrier=w.agents.find(a=>a.id===execution.carrierAgentId),assigned=w.ships.find(s=>s.id===carrier?.assignedShipId);if(!assigned)return {execution,...waiting('物流同僚失去舰船，请重新分配或接管任务')};ship=assigned;}
 const output=(action:Action):TaskPlan=>({execution,action,shipId:ship!.id});
 if(ship.cargo.materials>=1)return output({type:'UNLOAD',targetId:project.id});
 if(cargoUsed(ship)>=capabilities(ship).cargo)return output({type:'UNLOAD',targetId:'base'});
 const source=w.locations.filter(l=>l.owner==='starfleet'&&l.hull>0&&available(w,l.id,'materials')>=1).sort((a,b)=>dist(ship!,a)-dist(ship!,b)||a.id.localeCompare(b.id))[0];
 const amount=Math.floor(Math.min(need,capabilities(ship).cargo-cargoUsed(ship),source?available(w,source.id,'materials'):0));
 if(!source||amount<1)return {execution,...waiting('没有可运输的 Materials 或货舱空间不足')};
 return output({type:'HAUL',sourceId:source.id,targetId:project.id,cargoKind:'materials',amount,loadPolicy:'auto',route:'safe',repeat:false});
}
function fromPlan(plan:TaskPlan):VerificationResult {return {complete:plan.status==='completed',partial:plan.status==='completed_partial',reason:plan.reason??'完整目标尚无足够证据'};}
function handler<K extends ObjectiveKind>(kind:K,plan:TaskHandler<K>['plan'],verify?:TaskHandler<K>['verifyCompletion']):TaskHandler<K> {
 return {
  validate(goal,view){return goal.kind===kind&&(view.ship!==null||kind==='assignment'||kind==='cancel')?{ok:true,reason:'任务处理器可执行'}:{ok:false,reason:'目标类型或舰船绑定无效'};},
  plan,
  advance(goal,task,event,view){const execution=stateOf(task);if(event.type!=='directiveOutcome'||event.payload.failed||event.payload.interrupted)return {};
   if(goal.kind==='surveyRoute'&&event.payload.action.type==='EXPLORE'&&!execution.scannedSectorIndices.includes(execution.sectorIndex))execution.scannedSectorIndices.push(execution.sectorIndex);
   if(goal.kind==='factionAssault'&&execution.selectedTargetId)execution.searchedTargets[execution.selectedTargetId]=view.world.intel.find(i=>i.id===execution.selectedTargetId)?.lastSeen??view.world.time;
   return {execution};
  },
  verifyCompletion:verify??((goal,task,view)=>fromPlan(plan(goal,task,view))),
 };
}
/** Local typed registry. Handlers produce plans and evidence checks; the Runtime
 * alone commits lifecycle changes and submits Commands through its Gateway. */
const registry:{[K in ObjectiveKind]:TaskHandler<K>}={
 operation:handler('operation',(goal,task,view)=>task.completedRevision===view.objective.revision?{}:{action:actionSchema.parse(goal.action)},verifyOperation),
 loadReturn:handler<'loadReturn'>('loadReturn',logistics),recovery:handler<'recovery'>('recovery',logistics),
 surveyRoute:handler('surveyRoute',surveyRoute),construction:handler('construction',construction),factionAssault:handler('factionAssault',factionAssault),
 assignment:handler('assignment',(goal,_task,view)=>view.world.assignments.some(a=>a.operatorId===view.objective.ownerAgentId&&a.shipId===goal.shipId)?done('舰船已实际分配'): {command:{type:'assignAgent',agentId:view.objective.ownerAgentId!,shipId:goal.shipId}}),
 cancel:handler('cancel',(_goal,_task,view)=>view.world.agentRuntime.tasks.some(t=>t.ownerAgentId===view.objective.ownerAgentId&&t.objectiveId!==view.objective.id&&!['completed','completed_partial','failed','cancelled'].includes(t.status))?{command:{type:'cancelDirective',shipId:view.ship!.id}}:done('指定任务已取消，真实货物保留')),
};
export class TaskPlanner {
 private dispatch<R>(goal:ReadonlyDeep<ObjectiveGoal>,run:<K extends ObjectiveKind>(handler:TaskHandler<K>,goal:ReadonlyDeep<GoalOf<K>>)=>R):R {
  switch(goal.kind){case 'operation':return run(registry.operation,goal);case 'loadReturn':return run(registry.loadReturn,goal);case 'recovery':return run(registry.recovery,goal);case 'surveyRoute':return run(registry.surveyRoute,goal);case 'construction':return run(registry.construction,goal);case 'factionAssault':return run(registry.factionAssault,goal);case 'assignment':return run(registry.assignment,goal);case 'cancel':return run(registry.cancel,goal);}
 }
 validate(goal:ObjectiveGoal,view:TaskView){return this.dispatch(goal,(h,g)=>h.validate(g,view));}
 plan(goal:ObjectiveGoal,task:ReadonlyDeep<TaskState>,view:TaskView):TaskPlan{return this.dispatch(goal,(h,g)=>h.plan(g,task,view));}
 advance(goal:ObjectiveGoal,task:ReadonlyDeep<TaskState>,event:ReadonlyDeep<DomainEvent>,view:TaskView):TaskTransition{return this.dispatch(goal,(h,g)=>h.advance(g,task,event,view));}
 verifyCompletion(goal:ObjectiveGoal,task:ReadonlyDeep<TaskState>,view:TaskView):VerificationResult{return this.dispatch(goal,(h,g)=>h.verifyCompletion(g,task,view));}
}

function verifyOperation(goal:ReadonlyDeep<GoalOf<'operation'>>,task:ReadonlyDeep<TaskState>,view:TaskView):VerificationResult {
 const event=[...view.world.agentRuntime.events].reverse().find((e):e is Extract<DomainEvent,{type:'directiveOutcome'}>=>e.type==='directiveOutcome'&&e.taskId===task.taskId&&!e.payload.interrupted&&!e.payload.failed);
 if(!event||task.completedRevision!==view.objective.revision)return {complete:false,partial:false,reason:'尚无本次目标的真实执行结果'};
    const a=goal.action;
    const w=view.world,ship=w.ships.find(s=>s.id===event.payload.shipId);
    if(!ship)return {complete:false,partial:false,reason:'任务舰船不存在'};
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
    if(a.type==='HAIL')complete=(ship.cooldowns.hail??0)>0&&w.history.some(h=>h.kind==='diplomacy'&&h.entityId===a.targetId&&h.time>=view.objective.createdAt);
    if(a.type==='RETURN')complete=dist(ship,w.locations.find(l=>l.id==='base')!)<=12+1e-8;
    if(a.type==='MOVE')complete=dist(ship,a.point)<=8+1e-8;
    if(a.type==='HAUL') {
      const loaded=task.scope.carryIn[a.cargoKind]+task.progress.loaded[a.cargoKind]-task.scope.loadedBaseline[a.cargoKind],delivered=task.progress.delivered[a.cargoKind]-task.scope.deliveredBaseline[a.cargoKind],lost=task.progress.lost[a.cargoKind]-task.scope.lostBaseline[a.cargoKind];
      if(task.progress.diverted[a.cargoKind]>task.scope.divertedBaseline[a.cargoKind]+1e-8)return {complete:false,partial:false,reason:'运输材料实际交付其他地点，缺少目标交付证据'};
      const required=a.loadPolicy==='auto'?loaded:a.amount;
      complete=required>0&&delivered+1e-8>=required&&lost===0;
      if(a.repeat)return {complete:false,partial:false,reason:'持续运输保持运行'};
      if(!complete&&(delivered>0||lost>0))return {complete:false,partial:true,reason:'实际交付 '+delivered+' '+a.cargoKind+'；当前目标 '+required+'，损失 '+lost};
      if(complete)return {complete:true,partial:false,reason:'当前运输目标已核验：实际交付 '+delivered+' '+a.cargoKind};
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
    return {complete,partial:false,reason:complete?event.payload.text:'Directive 已结束，但完整目标尚无足够证据'};
}
