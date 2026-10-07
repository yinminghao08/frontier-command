import type { ReasoningEffort } from './types';
/** IPC read model. No key, ciphertext, filesystem path or provider response is returned. */
export interface AgentApiSettings {
  baseUrl: string;
  defaultModel: string;
  reasoningEffort: ReasoningEffort;
  hasKey: boolean;
  encryptionAvailable: boolean;
}
export interface AgentApiInput {
  baseUrl: string;
  defaultModel: string;
  reasoningEffort: ReasoningEffort;
  apiKey?: string;
  clearKey?: boolean;
}
export interface AgentApiResult {
  ok: boolean;
  reason: string;
}
