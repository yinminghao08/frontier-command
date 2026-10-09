import type {SimulationEngine} from '../src/engine/engine';
import type {Action,CommandResult,CoordinationIntent,SocialInteraction,ChatMessage} from '../src/engine/types';
import {validateNegotiation,applyNegotiation} from '../src/engine/contracts';
import {chatReason,appendChat} from '../src/engine/chat';
import {capabilities,cargoUsed} from '../src/engine/capabilities';
import {available} from '../src/engine/inventory';
/** Domain fixtures call actual typed engine/coordination/store ports. They are
 * neither a model output schema nor a production fallback decision executor. */
export type ScenarioInputs={action?:Action|null;coordination?:CoordinationIntent|{type:'requestEscort';agentId:string;targetShipId:string}|{type:'answerEscort';requestId:string;accept:boolean};social?:SocialInteraction;goal?:string;rationale?:string;messages?:{channelId:string;content:string;mentions:string[];purpose?:ChatMessage['purpose'];replyTo?:number|null}[]};
export function runScenario(e:SimulationEngine,id:string,input:ScenarioInputs={}):CommandResult {
 const raw=input.coordination;const agent=e.state.agents.find(a=>a.id===id)!;let coordination:CoordinationIntent=raw?.type==='requestEscort'?{type:'requestTask',kind:'escort',agentId:raw.agentId,action:{type:'ESCORT',targetId:raw.targetShipId},followUp:null,conditions:[]}:raw?.type==='answerEscort'?{type:'answerRequest',requestId:raw.requestId,version:e.state.escortRequests.find(r=>r.id===raw!.requestId)?.conditionVersion??1,response:raw.accept?'accept':'reject',conditions:[],reason:'preference'}:raw??null;
 const ship=e.state.ships.find(s=>s.id===agent.assignedShipId),no=(reason:string)=>({ok:false,reason});
 if(raw?.type==='requestEscort'&&raw.targetShipId!==ship?.id)return no('只能请求己方舰船护航');
 if(raw?.type==='answerEscort'&&raw.accept){const request=e.state.escortRequests.find(r=>r.id===raw!.requestId);if(input.action?.type!=='ESCORT'||input.action.targetId!==request?.targetShipId)return no('护航响应与真实目标不一致');}
 const judgment={coordination,rationale:input.rationale??'领域测试条件判断',social:input.social,goal:input.goal,action:raw?.type==='answerEscort'?null:input.action};
 const valid=validateNegotiation(e,agent,judgment);if(!valid.ok)return valid;
 if(coordination&&(coordination.type==='answerTask'||coordination.type==='answerRequest')&&coordination.response!=='withdraw'){
  const request=e.cognition.prepare(id);const reply=(coordination.response==='reject'?'拒绝当前任务：':'')+(input.rationale??'依据公开状态判断承诺');
  if(request?.purpose==='judgment'&&coordination.type==='answerTask')return e.dispatchCommand({type:'cognitionDecision',agentId:id,requestId:request.requestId,response:{purpose:'judgment',decision:{response:coordination.response,reason:coordination.reason,conditions:coordination.conditions,reply}}},id);
  if(request?.purpose==='collaboration'&&coordination.type==='answerRequest')return e.dispatchCommand({type:'cognitionDecision',agentId:id,requestId:request.requestId,response:{purpose:'collaboration',decision:{requestId:coordination.requestId,version:coordination.version,response:coordination.response,reason:coordination.reason,conditions:coordination.conditions,reply}}},id);
 }

 for(const message of input.messages??[]){const reason=chatReason(e.state,id,message.channelId,message.content,message.mentions);if(reason)return no(reason);}
 if(input.action&&raw?.type!=='answerEscort'){
  if(!ship)return no('执行主体不可用');const allowed=e.validate({type:'issueDirective',shipIds:[ship.id],mode:'REPLACE',action:input.action},id);if(!allowed.ok)return allowed;
  if(input.action.type==='HAUL'&&input.action.loadPolicy!=='auto'&&(available(e.state,input.action.sourceId,input.action.cargoKind)<input.action.amount||cargoUsed(ship)+input.action.amount>capabilities(ship).cargo))return no('自主运输需要真实库存和空间');
  const result=e.controllerPort(id).submitAction(input.action);if(!result.ok)return result;
 }
 applyNegotiation(e,agent,judgment);
 for(const message of input.messages??[]){const parent=message.replyTo??[...e.state.chatMessages].reverse().find(m=>m.channelId===message.channelId&&m.sender!==id)?.id??null;appendChat(e,id,message.channelId,message.content,message.mentions,'message',{purpose:message.purpose??(/^收到/.test(message.content)?'acknowledgement':'information'),replyTo:parent});}
 if(input.goal)agent.currentGoal=input.goal;
 agent.decision.revision++;e.runtime.drain();
 if(!coordination)e.dispatchCommand({type:'agentDecisionState',agentId:id,revision:agent.decision.revision,state:'ready',error:null},id);
 return {ok:true,reason:'真实领域端口已提交'};
}
