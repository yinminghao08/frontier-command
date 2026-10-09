import { z } from 'zod';

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
