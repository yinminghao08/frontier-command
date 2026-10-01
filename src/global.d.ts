import type { Command, SessionCommand, CommandResult, Snapshot } from './engine/types';
import type { TimelineStatus } from './engine/timeline';
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
      onState(callback: (state: Snapshot) => void): () => void;
    };
  }
}
