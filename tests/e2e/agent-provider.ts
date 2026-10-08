import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentDecision, Observation } from '../../src/engine/types';
import { COMMAND_CHANNEL, privateChannel } from '../../src/engine/chat';
import { capabilities } from '../../src/engine/capabilities';
export interface TestCompletionRequest {
  model: string;
  reasoning_effort?: string;
  response_format?: unknown;
  messages: { role: string; content: string }[];
}
/** A local protocol fixture, never used by the application as a decision fallback. */
export class AgentTestProvider {
  server: Server;
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
        let content: string;
        if (this.mode === 'hang') return; // Deliberately stalled local socket for deadline tests.
        if (input.messages[0].content.includes('Reply only JSON:')) content = '{"ok":true}';
        else if (input.messages[0].content.startsWith('TASK_JUDGMENT:')) {
          content = JSON.stringify({
            accept: this.mode !== 'refuse',
            reason: this.mode === 'refuse' ? 'fatigue' : 'preference',
            rationale: this.mode === 'refuse' ? '当前状态不适合执行' : '当前状态支持执行',
          });
        } else if (this.mode === 'invalid')
          content = '{"goal":"破坏世界","rationale":"非法输出测试","action":{"type":"CHEAT"}}';
        else
          content = JSON.stringify(
            this.choose(JSON.parse(input.messages[1].content) as Observation),
          );
        response.end(
          JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 17 } }),
        );
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
  private choose(obs: Observation): AgentDecision {
    const self = obs.self!;
    const d: AgentDecision = {
      goal: '等待新机会',
      rationale: '公开世界状态与近期交流支持当前判断',
      action: null,
      messages: [],
      memory: null,
      waitMinutes: 180,
      coordination: null,
    };
    const latest = [...obs.recentChat]
      .reverse()
      .find((m) => m.sender === 'commander' && m.channelId === privateChannel(self.id));
    const task = obs.admiralTask;
    if (
      task &&
      ['proposed', 'negotiating'].includes(task.consent) &&
      task.turnAgentId === self.id
    ) {
      d.goal = '自主评估 Admiral 的任务提议';
      d.coordination = {
        type: 'answerTask',
        taskId: task.id,
        version: task.conditionVersion,
        response: this.mode === 'refuse' ? 'reject' : 'accept',
        conditions: [],
        reason: self.fatigue >= 80 ? 'fatigue' : 'preference',
      };
      return d;
    }
    const proposal = obs.escortRequests.find(
      (r) => ['pending', 'negotiating'].includes(r.status) && r.turnAgentId === self.id,
    );
    if (proposal && proposal.action) {
      const response =
        proposal.responderId === self.id &&
        (this.mode === 'refuse' || this.mode === 'piracyRefuse' || self.fatigue >= 80)
          ? 'reject'
          : 'accept';
      // Public class capacities are part of the ship catalogue; no hidden simulation values.
      const damaged = obs.ship && obs.ship.hull < capabilities(obs.ship).hull * 0.9;
      const choice =
        proposal.responderId === self.id &&
        this.mode === 'negotiate' &&
        damaged &&
        proposal.rounds === 0
          ? 'counter'
          : response;
      const location = obs.locations.find(
        (l) =>
          l.owner === 'starfleet' &&
          Math.hypot(l.x - (obs.ship?.x ?? 0), l.y - (obs.ship?.y ?? 0)) < 40,
      );
      d.goal =
        choice === 'reject'
          ? '拒绝本轮协作，先恢复状态'
          : choice === 'counter'
            ? '提出维修及奖励条件'
            : '接受经校验的协作计划';
      d.rationale =
        choice === 'reject'
          ? '公开疲劳使本轮支援不可靠'
          : choice === 'counter'
            ? '舰损降低护航可靠性；需要先消耗现场材料维修，奖励由 Admiral 确认'
            : '公开状态、个人责任动机及既有信任支持合作';
      d.coordination = {
        type: 'answerRequest',
        requestId: proposal.id,
        version: proposal.conditionVersion,
        response: choice,
        conditions:
          choice === 'counter' && location
            ? [
                { type: 'repair', when: 'before', locationId: location.id, hullPercent: 90 },
                { type: 'reward', when: 'after', credits: 25 },
              ]
            : [],
        reason: choice === 'reject' ? 'fatigue' : choice === 'counter' ? 'damage' : 'preference',
      };
      return d;
    }
    if (
      (this.mode === 'piracy' || this.mode === 'piracyRefuse') &&
      self.career === 'logistics' &&
      obs.ship
    ) {
      const incident = obs.piracyIncidents.find(
        (i) => i.shipId === obs.ship!.id && i.stage !== 'resolved',
      );
      const peer = obs.rescueOptions[0];
      if (
        incident &&
        peer &&
        !obs.escortRequests.some((r) => r.kind === 'reinforce' && r.created >= incident.created)
      ) {
        const refuge = obs.locations.find((l) => l.id === 'rescue-refuge');
        d.goal = '请求同僚应对实际 Orion 袭击';
        d.coordination = {
          type: 'requestTask',
          kind: 'reinforce',
          agentId: peer.agentId,
          action: peer.action,
          followUp: refuge ? { type: 'DOCK', targetId: refuge.id } : null,
          conditions: [],
        };
        return d;
      }
    }
    const aurora = obs.inventories.find(
      (i) =>
        ['demo-aurora-mine', 'remote-mine'].includes(i.locationId) && i.available.materials >= 40,
    );
    if (
      self.id === 'ops-meridian' &&
      aurora &&
      obs.ship &&
      !obs.currentTask &&
      (!obs.escortRequests.some((r) => r.requesterId === self.id) ||
        (latest?.content.includes('第二轮') && latest.id > self.decision.lastChatId))
    ) {
      const peer =
        obs.decisionContext?.preferredPeers.find((id) =>
          obs.fleet.some((a) => a.id === id && a.assignedShipId),
        ) ?? 'ops-horizon';
      d.goal = '评估公开航线风险后，请求可靠同僚护航';
      d.rationale = `安全动机 ${self.profile.motivations.safety}；公开远疆航段存在风险，当前优先合作对象 ${peer}，信任 ${self.relationships[peer]?.trust ?? 50}`;
      d.coordination = {
        type: 'requestTask',
        kind: 'escort',
        agentId: peer,
        action: { type: 'ESCORT', targetId: obs.ship.id },
        followUp: {
          type: 'HAUL',
          sourceId: aurora.locationId,
          targetId: 'base',
          cargoKind: 'materials',
          amount: 40,
          route: 'safe',
          repeat: false,
        },
        conditions: [],
      };
      d.messages = [
        {
          channelId: privateChannel(self.id),
          content:
            self.profile.style === 'warm'
              ? 'Admiral，我比较了航线风险，准备邀请可靠同僚一起完成。'
              : '需要护航；请求已提交。',
          mentions: [],
        },
      ];
      return d;
    }
    if (latest?.content.includes('先休息') && obs.ship && !obs.currentTask) {
      d.goal = '遵照私聊，先回基地休息';
      d.action = { type: 'DOCK', targetId: 'base' };
      d.messages = [
        {
          channelId: privateChannel(self.id),
          content: '收到私聊。先回基地休息，下一轮再运输。',
          mentions: [],
        },
      ];
      d.memory = 'Admiral 要求先休息；之后重新评估风险';
      return d;
    }
    if (self.id === 'ops-horizon') {
      const request = obs.escortRequests.find(
        (r) => r.responderId === self.id && r.status === 'pending',
      );
      if (request) {
        const accept = this.mode !== 'refuse' && self.fatigue < 80 && self.morale >= 40;
        d.goal = accept ? '护送 Mira 运回真实材料' : '拒绝本轮护航，先恢复状态';
        d.rationale = accept
          ? '舰船状态良好，合作倾向高，值得支援同僚。'
          : '疲劳较高，无法可靠护航，需要先休息。';
        d.coordination = { type: 'answerEscort', requestId: request.id, accept };
        if (accept) d.action = { type: 'ESCORT', targetId: request.targetShipId };
      }
      return d;
    }
    if (self.id === 'ops-meridian') {
      if (obs.currentTask || self.experience > 0) {
        d.goal = obs.currentTask ? '继续完成实际运输' : '交付完成，等待下轮需求';
        if (
          obs.recentChat.some(
            (m) =>
              m.sender === 'commander' &&
              m.channelId === COMMAND_CHANNEL &&
              m.content.includes('群聊验证'),
          )
        )
          d.messages = [
            {
              channelId: COMMAND_CHANNEL,
              content: '收到群聊验证。当前运输与安全状态已记录。',
              mentions: [],
            },
          ];
        return d;
      }
      const request = [...obs.escortRequests].reverse().find((r) => r.requesterId === self.id);
      if (!request && obs.ship && obs.inventories.some((i) => i.locationId === 'remote-mine')) {
        d.goal = '远方矿区存在 Materials，比较虫洞航线并请求护航';
        d.rationale = '跨越未知航段存在风险；已确认的虫洞出口能缩短 ETA。';
        d.coordination = {
          type: 'requestEscort',
          agentId: 'ops-horizon',
          targetShipId: obs.ship.id,
        };
        return d;
      }
      if (request?.status === 'accepted') {
        const source = obs.inventories.find(
          (i) => i.locationId === 'remote-mine' && i.available.materials >= 40,
        );
        if (source) {
          d.goal = '通过已确认虫洞将 40 Materials 运回 Dawn';
          d.action = {
            type: 'HAUL',
            sourceId: source.locationId,
            targetId: 'base',
            cargoKind: 'materials',
            amount: 40,
            route: 'safe',
            repeat: false,
          };
        }
      } else if (request?.status === 'rejected') {
        d.goal = '护航被拒绝，暂缓高风险货运';
        d.memory = 'Talia 因疲劳拒绝；下一轮需重新安排护航';
        d.messages = [
          {
            channelId: COMMAND_CHANNEL,
            content: '护航被拒绝，我会暂缓此次货运，等待安全条件改善。',
            mentions: [],
          },
        ];
      }
      return d;
    }
    d.goal = obs.ship ? '新 Agent 等待正式任务' : '训练完成，等待 Admiral 分配舰船';
    return d;
  }
}
