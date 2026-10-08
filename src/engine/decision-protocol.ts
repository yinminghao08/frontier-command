import { z } from 'zod';
import { agentDecisionSchema } from './commands';
import { actionSchema } from './action-schema';

/** Provider schema is derived from the actual validator; local validation remains authoritative. */
export function protocolSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodEffects) return protocolSchema(schema.innerType());
  if (schema instanceof z.ZodDefault) return protocolSchema(schema.removeDefault());
  if (schema instanceof z.ZodOptional)
    return { anyOf: [protocolSchema(schema.unwrap()), { type: 'null' }] };
  if (schema instanceof z.ZodNullable)
    return { anyOf: [protocolSchema(schema.unwrap()), { type: 'null' }] };
  if (schema instanceof z.ZodObject) {
    const properties = Object.fromEntries(
      Object.entries(schema.shape as Record<string, z.ZodTypeAny>).map(([key, value]) => [
        key,
        protocolSchema(value),
      ]),
    );
    return {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodArray)
    return {
      type: 'array',
      items: protocolSchema(schema.element),
      ...(schema._def.maxLength ? { maxItems: schema._def.maxLength.value } : {}),
    };
  if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion)
    return { anyOf: Array.from(schema.options as z.ZodTypeAny[]).map(protocolSchema) };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { type: typeof schema.value, enum: [schema.value] };
  if (schema instanceof z.ZodString)
    return {
      type: 'string',
      ...(schema.minLength !== null ? { minLength: schema.minLength } : {}),
      ...(schema.maxLength !== null ? { maxLength: schema.maxLength } : {}),
    };
  if (schema instanceof z.ZodNumber)
    return {
      type: schema.isInt ? 'integer' : 'number',
      ...(schema.minValue !== null ? { minimum: schema.minValue } : {}),
      ...(schema.maxValue !== null ? { maximum: schema.maxValue } : {}),
    };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  throw Error('Unsupported decision schema: ' + schema.constructor.name);
}
export const decisionJsonSchema = protocolSchema(agentDecisionSchema);
/** Compact field contracts also reach providers that support only JSON object mode. */
function fieldContract(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodOptional) return { optional: fieldContract(schema.unwrap()) };
  if (schema instanceof z.ZodDefault) return { optional: fieldContract(schema.removeDefault()) };
  if (schema instanceof z.ZodNullable) return { nullable: fieldContract(schema.unwrap()) };
  if (schema instanceof z.ZodEffects) return fieldContract(schema.innerType());
  if (schema instanceof z.ZodObject)
    return Object.fromEntries(Object.entries(schema.shape as Record<string, z.ZodTypeAny>)
      .map(([key, value]) => [key, fieldContract(value)]));
  if (schema instanceof z.ZodArray) return [fieldContract(schema.element)];
  if (schema instanceof z.ZodEnum) return schema.options.join('|');
  if (schema instanceof z.ZodLiteral) return schema.value;
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return schema.isInt ? 'integer' : 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  throw Error('Unsupported field contract');
}
export const actionFieldContracts = Object.fromEntries(actionSchema.options.flatMap((option) => {
  const type = option.shape.type;
  const names = type instanceof z.ZodEnum ? type.options : [type.value];
  const { type: _type, ...fields } = option.shape;
  const contract = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fieldContract(value)]));
  return names.map((name) => [name, contract]);
}));
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
      const expected = issue.code === 'invalid_type'
        ? issue.expected + (issue.received === 'undefined' ? ' (required field missing)' : ' (received ' + issue.received + ')')
        : issue.code;
      return path + ': ' + expected;
    })
    .join('; ');
}
