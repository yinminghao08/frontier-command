export interface TimelineSummary {
  id: string;
  parent: { id: string; day: number } | null;
  status: 'active' | 'commandLost';
  tick: number;
  lossCount: number;
}
/** Public catalogue metadata only; no world state or filesystem paths. */
export interface SaveSummary {
  id: string;
  name: string;
  parent: { id: string; day: number } | null;
  availability: 'ready' | 'backup' | 'corrupt' | 'unsupported';
  reason: string;
  status: 'active' | 'commandLost' | null;
  tick: number | null;
  lossCount: number | null;
  savedAt: number | null;
}
export interface SaveCatalog {
  activeId: string | null;
  blocked: boolean;
  message: string;
  saves: SaveSummary[];
}
export type SaveAction =
  | { type: 'create'; name: string }
  | { type: 'demo'; name: string }
  | { type: 'copy'; name: string }
  | { type: 'load'; id: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'delete'; id: string }
  | { type: 'openManager' }
  | { type: 'closeManager' };
export interface TimelineStatus {
  activeId: string | null;
  previousDay: number | null;
  branches: TimelineSummary[];
}
