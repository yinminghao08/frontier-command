import type { Command, CommandResult } from '../engine/types';
export type Page = 'overview' | 'missions' | 'fleet' | 'logs' | 'world' | 'system';
export type CommandSender = (command: Command, quiet?: boolean) => Promise<CommandResult>;
export interface Notice {
  text: string;
  error: boolean;
}
