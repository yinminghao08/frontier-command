import type { Command, CommandResult } from '../engine/types';
export type Page = 'SECTOR' | 'OPERATIONS' | 'PERSONNEL' | 'STARBASE' | 'COLONIES' | 'ARCHIVE';
export type CommandSender = (command: Command, quiet?: boolean) => Promise<CommandResult>;
export interface Notice {
  text: string;
  error: boolean;
}
