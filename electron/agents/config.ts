import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { reasoningSchema } from '../../src/engine/agent-schema';
import type { AgentApiInput, AgentApiSettings } from '../../src/engine/agent-api';
export interface SecretVault {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
const urlSchema = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, 'Base URL 必须为不含凭据的 HTTP(S) 地址');
const fields = {
  baseUrl: urlSchema,
  defaultModel: z.string().trim().min(1).max(120),
  reasoningEffort: reasoningSchema,
  thinking: z.enum(['provider-default', 'on', 'off']).default('provider-default'),
  connectionTimeoutMs: z.number().int().min(1000).max(120000).default(30000),
  idleTimeoutMs: z.number().int().min(1000).max(600000).default(120000),
  thinkingBudget: z.number().int().min(256).max(32768).default(4096),
  compatibilityRetries: z.number().int().min(0).max(2).default(0),
  modelPricesCny: z
    .record(
      z.string().min(1).max(120),
      z
        .object({
          input: z.number().finite().nonnegative().max(100000),
          cacheHit: z.number().finite().nonnegative().max(100000),
          output: z.number().finite().nonnegative().max(100000),
        })
        .strict(),
    )
    .default({}),
};
export const apiInputSchema = z
  .object({
    ...fields,
    apiKey: z.string().trim().max(4000).optional(),
    clearKey: z.boolean().optional(),
  })
  .strict();
const storedSchema = z
  .object({ version: z.literal(1), ...fields, encryptedKey: z.string().max(20000).nullable() })
  .strict();
export interface ConnectionConfig {
  baseUrl: string;
  defaultModel: string;
  reasoningEffort: AgentApiSettings['reasoningEffort'];
  apiKey: string;
  thinking?: AgentApiSettings['thinking'];
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  thinkingBudget?: number;
  compatibilityRetries?: number;
  modelPricesCny?: AgentApiSettings['modelPricesCny'];
}
export class AgentConfigStore {
  private config: z.infer<typeof storedSchema> = {
    version: 1,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    reasoningEffort: 'provider-default',
    thinking: 'provider-default',
    connectionTimeoutMs: 30000,
    idleTimeoutMs: 120000,
    thinkingBudget: 4096,
    compatibilityRetries: 0,
    modelPricesCny: {},
    encryptedKey: null,
  };
  private key = '';
  private readonly path: string;
  constructor(
    directory: string,
    private readonly vault: SecretVault,
  ) {
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, 'agent-api.v1.json');
    if (existsSync(this.path))
      try {
        const saved = storedSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
        this.config = {
          ...saved,
          reasoningEffort:
            saved.reasoningEffort === 'none' ? 'provider-default' : saved.reasoningEffort,
        };
        if (saved.encryptedKey && vault.isEncryptionAvailable())
          this.key = vault.decryptString(Buffer.from(saved.encryptedKey, 'base64'));
      } catch {
        /* A broken key/config does not block the world or expose its contents. */
      }
  }
  publicSettings(): AgentApiSettings {
    return {
      baseUrl: this.config.baseUrl,
      defaultModel: this.config.defaultModel,
      reasoningEffort: this.config.reasoningEffort,
      thinking: this.config.thinking,
      connectionTimeoutMs: this.config.connectionTimeoutMs,
      idleTimeoutMs: this.config.idleTimeoutMs,
      thinkingBudget: this.config.thinkingBudget,
      compatibilityRetries: this.config.compatibilityRetries,
      modelPricesCny: this.config.modelPricesCny,
      hasKey: !!this.key,
      encryptionAvailable: this.vault.isEncryptionAvailable(),
    };
  }
  connection(input?: AgentApiInput): ConnectionConfig {
    const draft = input ? apiInputSchema.parse(input) : this.config;
    return {
      baseUrl: draft.baseUrl.replace(/\/+$/, ''),
      defaultModel: draft.defaultModel,
      reasoningEffort:
        draft.reasoningEffort === 'none' ? 'provider-default' : draft.reasoningEffort,
      thinking: draft.thinking,
      connectionTimeoutMs: draft.connectionTimeoutMs,
      idleTimeoutMs: draft.idleTimeoutMs,
      thinkingBudget: draft.thinkingBudget,
      compatibilityRetries: draft.compatibilityRetries,
      modelPricesCny: draft.modelPricesCny,
      apiKey:
        'clearKey' in draft && draft.clearKey
          ? ''
          : 'apiKey' in draft && draft.apiKey
            ? draft.apiKey
            : this.key,
    };
  }
  update(input: unknown) {
    const draft = apiInputSchema.parse(input),
      key = draft.clearKey ? '' : draft.apiKey || this.key;
    if (key && !this.vault.isEncryptionAvailable())
      throw Error('系统加密不可用，无法安全保存 API Key');
    const next = {
      version: 1 as const,
      baseUrl: draft.baseUrl.replace(/\/+$/, ''),
      defaultModel: draft.defaultModel,
      reasoningEffort:
        draft.reasoningEffort === 'none' ? 'provider-default' : draft.reasoningEffort,
      thinking: draft.thinking,
      connectionTimeoutMs: draft.connectionTimeoutMs,
      idleTimeoutMs: draft.idleTimeoutMs,
      thinkingBudget: draft.thinkingBudget,
      compatibilityRetries: draft.compatibilityRetries,
      modelPricesCny: draft.modelPricesCny,
      encryptedKey: key ? this.vault.encryptString(key).toString('base64') : null,
    };
    writeFileSync(this.path + '.tmp', JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
    renameSync(this.path + '.tmp', this.path);
    this.config = next;
    this.key = key;
  }
}
