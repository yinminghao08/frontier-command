import type { Command, CommandResult, Snapshot } from './engine/types';
declare global {
  interface Window {
    frontier: {
      getState(): Promise<{ state: Snapshot; saveMessage: string; saveBlocked: boolean }>;
      command(command: Command): Promise<CommandResult>;
      save(): Promise<CommandResult>;
      reset(): Promise<CommandResult>;
      onState(callback: (state: Snapshot) => void): () => void;
    };
  }
}
