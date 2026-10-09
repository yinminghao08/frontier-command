import type { Objective, ChatMessage, Observation, SectorCoord } from './types';
import type { ObjectiveGoal } from './agent-runtime/model';
import { SECTOR_SIZE } from './definitions/locations';

export type TaskIntent = Pick<
  Objective,
  | 'kind'
  | 'action'
  | 'targetId'
  | 'shipId'
  | 'facilityKind'
  | 'sectors'
  | 'allowWormholes'
  | 'factionId'
> & { goal?: ObjectiveGoal };
export interface IntentResult {
  intent: TaskIntent | null;
  clarification: string | null;
}
const normalized = (s: string) => s.toLowerCase().replace(/[\s\-_/：:]/g, '');
function resolve<T extends { id: string; name?: string | null }>(
  text: string,
  entities: readonly T[],
) {
  const input = normalized(text);
  const matches = entities.filter((e) =>
    [e.id, e.name ?? '', ...(e.name ?? '').split(/\s+\/\s+/)].some(
      (alias) => alias.length >= 3 && input.includes(normalized(alias)),
    ),
  );
  return matches.length === 1 ? matches[0] : null;
}
/** Pure intent compiler: only authentic addressed Admiral messages can create authority.
 * Entity resolution uses the public observation, never enemy/world secrets. */
export function compileIntent(
  observation: Observation,
  message: Pick<ChatMessage, 'content'>,
): IntentResult {
  const text = message.content;
  const base: TaskIntent = {
    kind: 'action',
    action: null,
    targetId: null,
    shipId: null,
    facilityKind: null,
    sectors: [],
    allowWormholes: !/不.*虫洞|禁.*虫洞|别.*虫洞|不要.*wormhole|no wormhole|without wormhole/i.test(
      text,
    ),
  };
  const yes = (intent: TaskIntent): IntentResult => ({ intent, clarification: null });
  const ask = (clarification: string): IntentResult => ({ intent: null, clarification });
  if (/怎么|如何|为什么|打算|假如|如果|what if|how do|why |explain/i.test(text))
    return { intent: null, clarification: null };
  if (
    /取消.*任务|取消.*指令|停止开火|不要开火|别开火|停飞|stop firing|cancel (?:the )?(?:task|order)/i.test(
      text,
    )
  )
    return yes({ ...base, kind: 'cancel' });
  if (
    /不要建设|别建设|禁止建设|不要攻击|禁止攻击|别攻击|do not attack|don't attack|do not build/i.test(
      text,
    )
  )
    return { intent: null, clarification: null };
  if (/给你了|给你用|分配给|接管|接领|assign .* to you|take command of/i.test(text)) {
    const ship = resolve(text, observation.ownShips);
    return ship
      ? yes({ ...base, kind: 'assign', shipId: ship.id })
      : ask('请明确要分配的舰船名称；当前无法唯一识别。');
  }
  if (
    /开火|干掉|消灭|摧毁|歼灭|清剿|打击|攻击|击毁|attack|open fire|destroy|kill/i.test(text) &&
    !/不要开火|停止开火|别开火|do not fire|don't fire/i.test(text)
  ) {
    if (
      /所有|全部|清剿|剩下|剩余|继续|all|remaining/i.test(text) &&
      (/orion|猎户座/i.test(text) || observation.objective?.kind === 'factionAssault')
    )
      return yes({ ...base, kind: 'factionAssault', factionId: 'orion' });
    const targets = [
      ...observation.contacts,
      ...observation.locations.filter((l) => l.owner !== 'starfleet'),
    ];
    const target = resolve(text, targets);
    const context =
      observation.objective?.targetId ??
      (observation.currentTask?.action && 'targetId' in observation.currentTask.action
        ? observation.currentTask.action.targetId
        : null);
    const id = target?.id ?? (context && targets.some((t) => t.id === context) ? context : null);
    return id
      ? yes({ ...base, targetId: id, action: { type: 'ATTACK', targetId: id } })
      : ask('开火命令已收到，请明确目标；我不会猜测攻击对象。');
  }
  if (/建设|建造.*矿|建矿|修建|build .*mine|construct/i.test(text)) {
    const site = resolve(text, [...observation.bodies, ...observation.systems]);
    const kind = /殖民|colony/i.test(text)
      ? 'colony'
      : /平台|platform/i.test(text)
        ? 'platform'
        : /前哨|outpost/i.test(text)
          ? 'outpost'
          : 'mine';
    const context =
      observation.objective?.kind === 'construction' ? observation.objective.targetId : null;
    const candidates = observation.bodies.filter(
      (b) => b.kind === (kind === 'mine' ? 'resource' : 'planet'),
    );
    const id = site?.id ?? context ?? (candidates.length === 1 ? candidates[0].id : null);
    return id
      ? yes({ ...base, kind: 'construction', targetId: id, facilityKind: kind })
      : ask('请明确建设地点和设施类型；发现的地点有多个。');
  }
  if (/测绘|调查|勘测|survey|explore/i.test(text)) {
    const coords = [...text.matchAll(/(-?\d+)\s*[/／]\s*(-?\d+)/g)].map((m) => ({
      q: Number(m[1]),
      r: Number(m[2]),
    }));
    if (coords.some((c) => !Number.isSafeInteger(c.q) || !Number.isSafeInteger(c.r)))
      return ask('星区坐标超出可表示范围。');
    if (/一路|逐.*区|沿|直到|回来|返航|return|along/i.test(text)) {
      const start = coords[0] ?? {
        q: Math.round((observation.ship?.x ?? 0) / SECTOR_SIZE),
        r: Number(
          text.match(/从\s*(\d+)/)?.[1] ?? Math.round((observation.ship?.y ?? 0) / SECTOR_SIZE),
        ),
      };
      const end = coords.length > 1 ? coords.at(-1)! : { q: 0, r: 0 };
      if (
        !Number.isSafeInteger(start.q) ||
        !Number.isSafeInteger(start.r) ||
        start.q !== end.q ||
        Math.abs(start.r - end.r) > 64
      )
        return ask('请明确逐区返航的路线；当前支持同一列内最多 65 个连续星区。');
      const sectors: SectorCoord[] = [];
      const step = start.r <= end.r ? 1 : -1;
      for (let r = start.r; ; r += step) {
        sectors.push({ q: start.q, r });
        if (r === end.r) break;
      }
      return yes({ ...base, kind: 'surveyRoute', sectors });
    }
    const site = resolve(text, [...observation.bodies, ...observation.systems]);
    if (site)
      return yes({
        ...base,
        targetId: site.id,
        action: { type: 'SURVEY', targetId: site.id, approach: 'close', deep: false },
      });
    if (coords.length === 1) return yes({ ...base, kind: 'surveyRoute', sectors: coords });
    return ask('请明确要测绘的地点或星区坐标。');
  }
  if (/返回基地|回基地|回来.*卸货|return to base|return home/i.test(text))
    return yes({
      ...base,
      targetId: 'base',
      action: /卸货|unload/i.test(text) ? { type: 'UNLOAD', targetId: 'base' } : { type: 'RETURN' },
    });
  if (/运输|运送|搬运|运回|装满|满载|haul|deliver|full cargo/i.test(text)) {
    const ongoing =
      observation.currentTask?.action.type === 'HAUL'
        ? observation.currentTask.action
        : observation.objective?.action?.type === 'HAUL'
          ? observation.objective.action
          : null;
    const requestedKind = /quantum|量子/i.test(text)
      ? 'quantum'
      : /photon|光子/i.test(text)
        ? 'photon'
        : /special.?find|特殊发现/i.test(text)
          ? 'specialFinds'
          : /materials|材料|物资/i.test(text)
            ? 'materials'
            : (ongoing?.cargoKind ?? 'materials');
    const sourceClause = text.match(/(?:从|from\s+)\s*(.+?)(?=运|装|搬|送|到|至|\bto\b)/i)?.[1];
    const destinationClause = text.match(/(?:到|至|\bto\s+)\s*(.+?)(?=[，,。！!]|$)/i)?.[1];
    const sources = observation.inventories;
    const named = sources.filter(
      (i) =>
        normalized(sourceClause ?? text).includes(normalized(i.locationId)) ||
        observation.locations.some(
          (l) =>
            l.id === i.locationId && normalized(sourceClause ?? text).includes(normalized(l.name)),
        ),
    );
    const source =
      named.length === 1
        ? named[0]
        : sourceClause
          ? /矿场|mine/i.test(sourceClause) &&
            sources.filter((i) =>
              observation.locations.some((l) => l.id === i.locationId && l.kind === 'mine'),
            ).length === 1
            ? sources.find((i) =>
                observation.locations.some((l) => l.id === i.locationId && l.kind === 'mine'),
              )
            : null
          : ongoing
            ? observation.inventories.find((i) => i.locationId === ongoing.sourceId)
            : sources.filter((i) =>
                  observation.locations.some((l) => l.id === i.locationId && l.kind === 'mine'),
                ).length === 1
              ? sources.find((i) =>
                  observation.locations.some((l) => l.id === i.locationId && l.kind === 'mine'),
                )
              : null;
    const destination = /基地|Dawn|base|运回/i.test(destinationClause ?? (sourceClause ? '' : text))
      ? observation.locations.find((l) => l.id === 'base')
      : (resolve(
          destinationClause ?? (sourceClause ? '' : text),
          observation.locations.filter((l) => l.id !== source?.locationId),
        ) ??
        (destinationClause
          ? /矿场|mine/i.test(destinationClause) &&
            observation.locations.filter((l) => l.kind === 'mine').length === 1
            ? observation.locations.find((l) => l.kind === 'mine')
            : null
          : ongoing
            ? (observation.locations.find((l) => l.id === ongoing.targetId) ??
              observation.projects.find((p) => p.id === ongoing.targetId))
            : null));
    if (!source || !destination || source.locationId === destination.id)
      return ask('请明确货物运输的起点和目的地。');
    const requested =
      text.match(
        /(\d+)\s*(?:Materials|材料|物资|Photon|光子|Quantum|量子|Special.?Finds|特殊发现)/i,
      )?.[1] ?? text.match(/(?:运送?|运输|装载)\s*(\d+)/)?.[1];
    const amount = requested
      ? Number(requested)
      : Math.max(1, observation.ship ? 10000 : Math.floor(source.available.materials));
    return yes({
      ...base,
      targetId: destination.id,
      action: {
        type: 'HAUL',
        sourceId: source.locationId,
        targetId: destination.id,
        cargoKind: requestedKind,
        amount,
        loadPolicy: requested ? 'fixed' : 'auto',
        route: /直达|direct/i.test(text)
          ? 'direct'
          : /冒险|risky/i.test(text)
            ? 'risky'
            : /安全|safe/i.test(text)
              ? 'safe'
              : (ongoing?.route ?? 'safe'),
        repeat: /循环|持续|repeat/i.test(text) || (ongoing?.repeat ?? false),
      },
    });
  }
  if (/巡逻|patrol/i.test(text)) {
    const location =
      resolve(
        text,
        observation.locations.filter((l) => l.owner === 'starfleet'),
      ) ??
      (/基地/i.test(text)
        ? observation.locations.find((l) => l.id === 'base')
        : /矿场/i.test(text)
          ? observation.locations.find((l) => l.id === 'mine')
          : null);
    return location
      ? yes({
          ...base,
          targetId: location.id,
          action: {
            type: 'PATROL',
            targetId: location.id,
            duration: Number(text.match(/(\d+)\s*分钟/)?.[1] ?? 30),
          },
        })
      : ask('请明确巡逻设施或基地名称。');
  }
  if (/撤退|retreat|维修|repair|停靠|dock/i.test(text)) {
    const location =
      resolve(
        text,
        observation.locations.filter((l) => l.owner === 'starfleet'),
      ) ?? observation.locations.find((l) => l.id === 'base');
    return location
      ? yes({
          ...base,
          targetId: location.id,
          action: {
            type: /维修|repair/i.test(text)
              ? 'REPAIR'
              : /停靠|dock/i.test(text)
                ? 'DOCK'
                : 'RETREAT',
            targetId: location.id,
          },
        })
      : ask('己方撤退或维修设施不可用。');
  }
  if (/护航|escort/i.test(text) && !/请求|request/i.test(text)) {
    const ship = resolve(
      text,
      observation.ownShips.filter((s) => s.id !== observation.ship?.id),
    );
    return ship
      ? yes({ ...base, targetId: ship.id, action: { type: 'ESCORT', targetId: ship.id } })
      : ask('请明确要护航的舰船。');
  }
  if (/前往|去|移动|move|go to/i.test(text)) {
    const target = resolve(text, [
      ...observation.locations,
      ...observation.bodies,
      ...observation.systems,
    ]);
    if (target)
      return yes({
        ...base,
        targetId: target.id,
        action: { type: 'MOVE', point: { x: target.x, y: target.y } },
      });
  }
  return { intent: null, clarification: null };
}
