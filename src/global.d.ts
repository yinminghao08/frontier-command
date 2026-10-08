import type {
  Command,
  SessionCommand,
  CommandResult,
  Snapshot,
  PublicSimulationEvent,
} from './engine/types';
import type { SaveAction, SaveCatalog, TimelineStatus } from './engine/timeline';
import type { AgentApiInput, AgentApiSettings, AgentApiResult } from './engine/agent-api';
declare global {
  interface Window {
    frontier: {
      getState(): Promise<{
        state: Snapshot;
        saveMessage: string;
        saveBlocked: boolean;
        timeline: TimelineStatus;
      }>;
      command(command: Command | SessionCommand): Promise<CommandResult>;
      save(): Promise<CommandResult>;
      timeline(): Promise<TimelineStatus>;
      listSaves(): Promise<SaveCatalog>;
      saveAction(action: SaveAction): Promise<CommandResult>;
      onState(callback: (state: Snapshot) => void): () => void;
      onEvents(callback: (events: PublicSimulationEvent[]) => void): () => void;
      setDisplayZoom(factor: number): Promise<number>;
      agentSettings(): Promise<AgentApiSettings>;
      agentRuntime(): Promise<import('./engine/agent-api').AgentRuntimeStats>;
      configureAgentApi(settings: AgentApiInput): Promise<AgentApiResult>;
      testAgentApi(settings?: AgentApiInput): Promise<AgentApiResult>;
    };
  }
}
