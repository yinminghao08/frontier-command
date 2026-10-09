import { z } from 'zod';
import { agentDecisionSchema } from './commands';
import { protocolSchema } from './structured-output';
export { protocolSchema } from './structured-output';
export const decisionJsonSchema = protocolSchema(agentDecisionSchema);
export function normalizeDecision(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = { ...value } as Record<string, unknown>;
  if (result.memory === '') result.memory = null;
  if (result.mode == null) result.mode = result.action || result.coordination ? 'act' : 'continue';
  if (result.action && typeof result.action === 'object' && !Array.isArray(result.action)) {
    const action = { ...result.action } as Record<string, unknown>;
    if (action.subsystem === null) delete action.subsystem;
    result.action = action;
  }
  return result;
}
export function decisionIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 6)
    .map((issue) => {
      const path = issue.path.join('.') || 'decision';
      // No provider text or received value enters diagnostics.
      const expected = issue.code === 'invalid_type' ? issue.expected : issue.code;
      return path + ': ' + expected;
    })
    .join('; ');
}
