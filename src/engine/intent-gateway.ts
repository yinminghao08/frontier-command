import type { Objective, ChatMessage, Observation } from './types';
import type { ObjectiveGoal } from './agent-runtime/model';
import type { ObjectiveProposal } from './cognition-protocol';
import { SECTOR_SIZE } from './definitions/locations';
export type TaskIntent = Pick<Objective,'kind'|'action'|'targetId'|'shipId'|'facilityKind'|'sectors'|'allowWormholes'|'factionId'> & {goal?:ObjectiveGoal};
export interface IntentResult {intent:TaskIntent|null;clarification:string|null;}
const base=():TaskIntent=>({kind:'action',action:null,targetId:null,shipId:null,facilityKind:null,sectors:[],allowWormholes:true});
const named=(ref:string,entities:readonly {id:string;name?:string|null;kind?:string}[])=>{
 const key=ref.trim().toLowerCase();const matches=entities.filter(e=>[e.id,e.name,e.id==='base'?'基地':null,e.kind==='mine'?'矿场':null].some(n=>n?.toLowerCase()===key));
 return matches.length===1?matches[0].id:null;
};
/** Resolve all semantic references against the public read model before granting authority. */
export function resolveProposal(o:Observation,p:ObjectiveProposal):TaskIntent {
 const b=base();const location=(id:string)=>{if(!o.locations.some(l=>l.id===id&&l.owner==='starfleet'&&l.hull>0))throw Error('目标设施未确认或不可用');return id;};
 const point=(id:string)=>{const t=[...o.locations,...o.systems,...o.bodies].find(t=>t.id===id);if(!t)throw Error('导航或测绘目标必须已发现');return t;};
 const operation=(action:NonNullable<TaskIntent['action']>,targetId:string|null=null):TaskIntent=>({...b,action,targetId,goal:{kind:'operation',action}});
 switch(p.kind){
 case 'loadReturn':return {...b,kind:'loadReturn',goal:{...p,sourceId:location(p.sourceId),destinationId:location(p.destinationId)}};
 case 'transport':return operation({type:'HAUL',sourceId:location(p.sourceId),targetId:location(p.destinationId),cargoKind:p.cargoKind,amount:p.amount??10000,loadPolicy:p.amount===null?'auto':'fixed',repeat:p.repeat,route:p.route},p.destinationId);
 case 'recovery':{
 if(p.wreckIds.some(id=>!o.wrecks.some(w=>w.id===id)))throw Error('只能回收已发现的残骸');
 if(p.sourceClassId!==null&&!o.wrecks.some(w=>w.sourceClassId===p.sourceClassId))throw Error('无法确认所指定舰级的残骸');
 if(p.wreckIds.length===0&&p.sourceClassId===null)throw Error('请指定回收目标集合');
 return {...b,kind:'salvage',goal:{...p,destinationId:p.destinationId===null?null:location(p.destinationId),cargoKind:'materials'}};}
 case 'navigate':if((p.targetId===null)===(p.sector===null))throw Error('导航需要唯一地点或星区');return p.targetId?operation({type:'MOVE',point:{x:point(p.targetId).x,y:point(p.targetId).y}},p.targetId):operation({type:'MOVE',point:{x:p.sector!.q*SECTOR_SIZE,y:p.sector!.r*SECTOR_SIZE}});
 case 'survey':point(p.targetId);return operation({type:'SURVEY',targetId:p.targetId,approach:'close',deep:p.deep},p.targetId);
 case 'explore':return operation({type:'EXPLORE',sector:p.sector,approach:'close'});
 case 'surveyRoute':return {...b,kind:'surveyRoute',sectors:p.sectors,goal:p};
 case 'patrol':return operation({type:'PATROL',targetId:location(p.targetId),duration:p.duration},p.targetId);
 case 'escort':if(!o.ownShips.some(s=>s.id===p.targetShipId&&s.id!==o.ship?.id))throw Error('护航目标需要另一艘真实己方舰船');return operation({type:'ESCORT',targetId:p.targetShipId},p.targetShipId);
 case 'engage':if(p.targetIds.some(id=>![...o.contacts,...o.locations].some(t=>t.id===id)))throw Error('交战对象未经公开确认');return operation(p.targetIds.length===1?{type:'ATTACK',targetId:p.targetIds[0]}:{type:'ATTACK_SET',targetIds:p.targetIds});
 case 'service':location(p.targetId);if(p.service==='return'&&p.targetId!=='base')throw Error('RETURN 的既有目的地是 Dawn Starbase');return operation(p.service==='return'?{type:'RETURN'}:{type:p.service==='repair'?'REPAIR':p.service==='dock'?'DOCK':p.service==='retreat'?'RETREAT':'UNLOAD',targetId:p.targetId},p.targetId);
 case 'construction':point(p.siteId);return {...b,kind:'construction',targetId:p.siteId,facilityKind:p.facilityKind,goal:p};
 case 'rest':return operation({type:'REST',targetId:location('base'),duration:p.duration},'base');
 case 'assignment':if(!o.ownShips.some(s=>s.id===p.shipId))throw Error('舰船不属于 Admiral');return {...b,kind:'assign',shipId:p.shipId,goal:p};
 case 'cancel':return {...b,kind:'cancel',goal:p};
 }
}
/** Exact, complete one-step grammar. Anything compound, conditional or referential
 * stays unclaimed for semantic interpretation; no substring can collapse a goal. */
export function compileIntent(o:Observation,m:Pick<ChatMessage,'content'>):IntentResult {
 const text=m.content.trim().replace(/[。！!]$/,'').trim();let p:ObjectiveProposal|null=null;
 if(/^(?:返回基地|回基地|return (?:to base|home))$/i.test(text))p={kind:'service',service:'return',targetId:'base'};
 else if(/^(?:取消任务|取消指令|停止开火|cancel (?:task|order)|stop firing)$/i.test(text))p={kind:'cancel'};
 else {
 let match=text.match(/^(?:前往|移动到|导航到|go to|move to)\s*(.+)$/i);
 if(match){const ref=match[1];const coord=ref.match(/^(?:Frontier\s+)?(-?\d+)\s*[/／]\s*(-?\d+)$/i);const id=named(ref,[...o.locations,...o.systems,...o.bodies]);if(coord)p={kind:'navigate',targetId:null,sector:{q:Number(coord[1]),r:Number(coord[2])}};else if(id)p={kind:'navigate',targetId:id,sector:null};}
 match=text.match(/^(?:测绘|survey)\s*(.+)$/i);if(match){const id=named(match[1],[...o.bodies,...o.systems]);if(id)p={kind:'survey',targetId:id,deep:false};}
 match=text.match(/^(?:维修|停靠|卸货|repair|dock|unload)\s*(.+)$/i);if(match){const id=named(match[1],o.locations);if(id)p={kind:'service',targetId:id,service:/^(?:维修|repair)/i.test(text)?'repair':/^(?:停靠|dock)/i.test(text)?'dock':'unload'};}
 match=text.match(/^(?:巡逻|patrol)\s*(.+?)\s+(\d+)\s*(?:分钟|minutes?)$/i);if(match){const id=named(match[1],o.locations);if(id)p={kind:'patrol',targetId:id,duration:Number(match[2])};}
 match=text.match(/^(?:护航|escort)\s*(.+)$/i);if(match){const id=named(match[1],o.ownShips);if(id)p={kind:'escort',targetShipId:id};}
 match=text.match(/^(?:攻击|attack)\s*(.+)$/i);if(match){const id=named(match[1],[...o.contacts,...o.locations]);if(id)p={kind:'engage',targetIds:[id]};}
 match=text.match(/^(?:休整|rest)\s+(\d+)\s*(?:分钟|minutes?)$/i);if(match)p={kind:'rest',duration:Number(match[1])};
 }
 if(!p)return {intent:null,clarification:null};
 try{return {intent:resolveProposal(o,p),clarification:null};}catch(error){return {intent:null,clarification:error instanceof Error?error.message:'目标无法验证'};}
}
