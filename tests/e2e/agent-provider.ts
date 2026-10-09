import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Agent, CollaborationRequest, Observation } from '../../src/engine/types';
interface FixtureContext {
 self:Agent;
 input?:string;
 activeObjectives?:{id:string;goal:Observation['objectiveContext'][number]['goal']}[];
 ship?:{id:string;hull:number;capacity?:{hull:number}}|null;
 publicFacts?:Pick<Observation,'inventories'|'fleet'|'locations'|'bodies'|'contacts'>;
 opportunities?:Observation['opportunities'];
 maintenanceOptions?:{id:string}[];
 rescueChoices?:{id:string}[];
 request?:CollaborationRequest;
 decisionContext?:Observation['decisionContext'];
}
export interface TestCompletionRequest {
  model: string;
  stream?: boolean;
  reasoning_effort?: string;
  response_format?: unknown;
  messages: { role: string; content: string }[];
}
/** A local protocol fixture, never used by the application as a decision fallback. */
export class AgentTestProvider {
  server: Server;
  delayMs = 0;
  failHttp = false;
  requests: TestCompletionRequest[] = [];
  mode: 'cooperate' | 'refuse' | 'invalid' | 'negotiate' | 'piracy' | 'piracyRefuse' | 'hang' =
    'cooperate';
  constructor() {
    this.server = createServer((request, response) => {
      let text = '';
      request.on('data', (data) => {
        text += data.toString();
      });
      request.on('end', () => {
        const input = JSON.parse(text) as TestCompletionRequest;
        this.requests.push(input);
        response.setHeader('Content-Type', 'application/json');
        if (request.url !== '/v1/chat/completions') {
          response.writeHead(404);
          response.end('{}');
          return;
        }
        if (input.reasoning_effort) {
          response.writeHead(400);
          response.end(
            JSON.stringify({
              error: {
                message: 'Unsupported parameter: reasoning_effort',
                param: 'reasoning_effort',
              },
            }),
          );
          return;
        }
        if (this.failHttp) {
          response.writeHead(503);
          response.end('{}');
          return;
        }
        let content: string;
        if (this.mode === 'hang') return; // Deliberately stalled local socket for deadline tests.
        if (input.messages[0].content.includes('Reply only JSON:')) content = '{"ok":true}';
        else if(this.mode==='invalid')content='{"invalidPurpose":true}';
        else content=JSON.stringify(this.choose(input.messages[0].content,JSON.parse(input.messages[1].content) as FixtureContext));
        const send = () => {
          if (input.stream) {
            response.setHeader('Content-Type', 'text/event-stream');
            response.end(
              'data: ' +
                JSON.stringify({
                  choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
                }) +
                '\n\n' +
                'data: ' +
                JSON.stringify({ choices: [], usage: { total_tokens: 17 } }) +
                '\n\ndata: [DONE]\n\n',
            );
          } else
            response.end(
              JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 17 } }),
            );
        };
        if (this.delayMs) {
          const timer = setTimeout(send, this.delayMs);
          response.on('close', () => clearTimeout(timer));
        } else send();
      });
    });
  }
  async start() {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + (this.server.address() as AddressInfo).port + '/v1';
  }
  async close() {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
  private choose(prompt:string,context:FixtureContext):unknown {
    const self=context.self;
    if(prompt.startsWith('TaskJudgment:'))return {response:this.mode==='refuse'?'reject':'accept',reason:this.mode==='refuse'?'fatigue':'preference',reply:this.mode==='refuse'?'当前状态不适合执行，需要先休整。':'接受完整目标；护航伙伴须独立同意并会合。',conditions:[]};
    if(prompt.startsWith('CollaborationDecision:')){
      const request=context.request!;
      const refusal=request.responderId===self.id&&(this.mode==='refuse'||this.mode==='piracyRefuse'||self.fatigue>=80);
      const damaged=context.ship&&context.ship.capacity&&context.ship.hull<context.ship.capacity.hull*0.9;
      const counter=request.responderId===self.id&&this.mode==='negotiate'&&damaged&&request.rounds===0;
      const response=refusal?'reject':counter?'counter':'accept';
      const location=context.publicFacts?.locations.find(l=>l.id==='demo-aurora-mine')??context.publicFacts?.locations.find(l=>l.owner==='starfleet');
      return {requestId:request.id,version:request.conditionVersion,response,reason:refusal?'fatigue':counter?'damage':'preference',reply:refusal?'疲劳使本轮支援不可靠。':counter?'舰损需要先实际维修，奖励由 Admiral 确认。':'接受当前协作条件。',conditions:counter&&location?[{type:'repair',when:'before',locationId:location.id,hullPercent:90},{type:'reward',when:'after',credits:25}]:[]};
    }
    if(prompt.startsWith('StrategicDecision:')){
      if((this.mode==='piracy'||this.mode==='piracyRefuse')&&context.rescueChoices?.length)return {opportunityId:null,supportAgentId:null,collaborationOptionId:context.rescueChoices[0].id,riskPreference:'cautious',reason:'已确认海盗威胁，请求伙伴独立决定是否支援。'};
      const opportunity=context.opportunities?.find(o=>o.kind==='logistics'&&['remote-mine','demo-aurora-mine'].includes(o.targetId))??context.opportunities?.find(o=>o.kind==='logistics');
      const peer=context.decisionContext?.preferredPeers.find(id=>context.publicFacts?.fleet.some(a=>a.id===id&&a.assignedShipId));
      return {opportunityId:self.id==='ops-meridian'?(opportunity?.id??null):null,supportAgentId:opportunity&&self.id==='ops-meridian'?(peer??'ops-horizon'):null,riskPreference:'cautious',reason:'公开库存与安全动机支持运输；护航须经过独立协商。'};
    }
    if(prompt.startsWith('CommunicationDecision:'))return {content:'你好，Admiral。',purpose:'information'};
    const text=context.input??'';
    if(/立即开火/.test(text)){const contact=context.publicFacts?.contacts.find(c=>c.id==='orion-scout');if(contact)return {disposition:'propose',proposal:{kind:'engage',targetIds:[contact.id]},objectiveId:null,allowWormholes:true,reply:'按直接授权交战，战果由引擎核验。'};}
    if(text.includes('一路测绘'))return {disposition:'propose',proposal:{kind:'surveyRoute',sectors:[{q:0,r:0},{q:0,r:1},{q:0,r:2}]},objectiveId:null,allowWormholes:false,reply:'依次测绘给定星区并禁止虫洞。'};
    if(text.includes('建设好')){const site=context.publicFacts?.bodies.find(body=>text.includes(body.name));if(site)return {disposition:'propose',proposal:{kind:'construction',siteId:site.id,facilityKind:'mine'},objectiveId:null,allowWormholes:true,reply:'提出矿场建设目标，物资支援需要独立同意。'};}
    if(text.includes('运输直接装满')){const previous=context.activeObjectives?.find(objective=>objective.goal.kind==='operation'&&objective.goal.action.type==='HAUL');if(previous&&previous.goal.kind==='operation'&&previous.goal.action.type==='HAUL'){const action=previous.goal.action;return {disposition:'revise',proposal:{kind:'transport',sourceId:action.sourceId,destinationId:action.targetId,cargoKind:action.cargoKind,amount:null,repeat:action.repeat,route:action.route},objectiveId:previous.id,allowWormholes:true,reply:'保留来源与交付地点，修订为可用货舱满载。'};}}
    const mine=context.publicFacts?.inventories.find(i=>['demo-aurora-mine','remote-mine'].includes(i.locationId)&&i.available.materials>=40);
    const peer=context.decisionContext?.preferredPeers.find(id=>context.publicFacts?.fleet.some(a=>a.id===id&&a.assignedShipId))??context.publicFacts?.fleet.find(a=>a.id==='ops-horizon'&&a.assignedShipId)?.id;
    if(mine&&self.id==='ops-meridian'&&/评估|第二轮|协作|风险/.test(text))return {disposition:'propose',proposal:{kind:'supportedTransport',sourceId:mine.locationId,destinationId:'base',cargoKind:'materials',amount:40,route:'safe',escortAgentId:peer??'ops-horizon'},objectiveId:null,allowWormholes:true,reply:'比较公开航线后提出运输与护航目标；同僚须独立同意。'};
    if(/休息/.test(text))return {disposition:'propose',proposal:{kind:'rest',duration:30},objectiveId:null,allowWormholes:true,reply:'先休整，再判断下一轮任务。'};
    return {disposition:'conversation',proposal:null,objectiveId:null,allowWormholes:true,reply:text.includes('群聊验证')?'收到群聊验证。当前运输与安全状态已记录。':'收到，我会依据当前公开事实与已有目标判断。'};
  }
}
