import type { ReasoningEffort, ThinkingMode } from './types';
export interface ModelPriceCny {
  input: number;
  cacheHit: number;
  output: number;
}
/** IPC read model. No key, ciphertext, filesystem path or provider response is returned. */
export interface AgentApiSettings {
  baseUrl: string;
  defaultModel: string;
  reasoningEffort: ReasoningEffort;
  thinking?: ThinkingMode;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  thinkingBudget?: number;
  compatibilityRetries?: number;
  modelPricesCny?: Record<string, ModelPriceCny>;
  hasKey: boolean;
  encryptionAvailable: boolean;
}
export interface AgentApiInput {
  baseUrl: string;
  defaultModel: string;
  reasoningEffort: ReasoningEffort;
  thinking?: ThinkingMode;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  thinkingBudget?: number;
  compatibilityRetries?: number;
  modelPricesCny?: Record<string, ModelPriceCny>;
  apiKey?: string;
  clearKey?: boolean;
}
export interface AgentApiResult {
  ok: boolean;
  reason: string;
}
export interface AgentRuntimeStats {
  activeRequests: AgentRequestTiming[];
  recentRequests: AgentRequestTiming[];
  concurrency: number;
  requests: number;
  repairs: number;
  cancellations: number;
  failures: number;
  tokens: number | null;
  windowRequests: number;
  byAgent: Record<string, number>;
  costCny?: number | null;
  knownCostCny?: number;
  unknownCostRequests?: number;
  byAgentCostCny?: Record<string, number | null>;
}
export type AgentFailureKind =
  | 'cancelled'
  | 'network'
  | 'disconnected'
  | 'authentication'
  | 'rate-limit'
  | 'provider'
  | 'protocol'
  | 'empty'
  | 'truncated'
  | 'oversized'
  | 'credentials'
  | 'validation';
export interface AgentRequestTiming {
  id: number;
  agentId: string;
  kind: string;
  phase: 'requesting' | 'receiving' | 'validating' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  decisionStartedAt: number;
  httpStatus: number | null;
  responseFormat: 'sse' | 'json' | null;
  choiceCount: number | null;
  finishReason:
    | 'stop'
    | 'length'
    | 'content_filter'
    | 'tool_calls'
    | 'function_call'
    | 'other'
    | null;
  failureKind: AgentFailureKind | null;
  requestBytes: number;
  firstByteAt: number | null;
  connectedAt?: number | null;
  generationEndedAt?: number | null;
  validatedAt?: number | null;
  firstContentAt?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cacheHitTokens?: number | null;
  cacheMissTokens?: number | null;
  costCny?: number | null;
  priceCny?: ModelPriceCny;
  effective?: {
    provider: string;
    model: string;
    thinking: 'on' | 'off' | 'unknown';
    thinkingSource: ThinkingMode;
    effort: string;
    maxTokens: number;
  };
  endedAt: number | null;
  validationMs: number;
  reason: string | null;
}

export type CapabilityStatus = 'supported' | 'unsupported' | 'unknown';
export interface ModelCapabilities {
  thinkingOn: CapabilityStatus;
  thinkingOff: CapabilityStatus;
  reasoningEffort: CapabilityStatus;
  strictSchema: CapabilityStatus;
  jsonObject: CapabilityStatus;
  toolCalling: CapabilityStatus;
  streaming: CapabilityStatus;
  evidence: 'official-documentation' | 'model-directory' | 'unknown';
  effortLevels?: string[];
  defaultEffort?: string;
  defaultThinking?: 'on' | 'off';
  maxOutputTokens?: number;
}
export interface ModelInfo {
  id: string;
  capabilities: ModelCapabilities;
}
export interface ModelsResult {
  ok: boolean;
  models: ModelInfo[];
  reason: string;
  directory: CapabilityStatus;
}
