import { jsonSchema } from 'ai';
import { type JSONSchema7 } from 'json-schema';
import { z } from 'zod';

import { normalizeMcpToolInputSchema } from 'src/engine/api/mcp/utils/normalize-mcp-tool-input-schema.util';
import { toToolJsonSchema } from 'src/engine/core-modules/record-crud/utils/to-tool-json-schema.util';

const OBJECT_VARIANTS: JSONSchema7[] = [
  {
    type: 'object',
    properties: { type: { const: 'LINK' }, link: { type: 'string' } },
  },
  {
    type: 'object',
    properties: { type: { const: 'FOLDER' }, name: { type: 'string' } },
  },
];

describe('normalizeMcpToolInputSchema', () => {
  it('declares type "object" next to a top-level anyOf without touching the variants', () => {
    const schema = { anyOf: OBJECT_VARIANTS, $defs: { shared: {} } };

    expect(normalizeMcpToolInputSchema(schema)).toEqual({
      type: 'object',
      anyOf: OBJECT_VARIANTS,
      $defs: { shared: {} },
    });
  });

  it('declares type "object" next to a top-level oneOf', () => {
    expect(normalizeMcpToolInputSchema({ oneOf: OBJECT_VARIANTS })).toEqual({
      type: 'object',
      oneOf: OBJECT_VARIANTS,
    });
  });

  it('fixes the schema z.toJSONSchema emits for a discriminated union', () => {
    const discriminatedUnion = z.discriminatedUnion('type', [
      z.object({ type: z.literal('LINK'), link: z.string() }),
      z.object({ type: z.literal('FOLDER'), name: z.string() }),
    ]);
    const rawSchema = toToolJsonSchema(discriminatedUnion) as Record<
      string,
      unknown
    >;

    expect(rawSchema.type).toBeUndefined();

    const normalized = normalizeMcpToolInputSchema(rawSchema);

    expect(normalized.type).toBe('object');
    expect(normalized.anyOf ?? normalized.oneOf).toEqual(
      rawSchema.anyOf ?? rawSchema.oneOf,
    );
  });

  it('unwraps the AI SDK jsonSchema wrapper', () => {
    expect(
      normalizeMcpToolInputSchema(jsonSchema({ anyOf: OBJECT_VARIANTS })),
    ).toEqual({ type: 'object', anyOf: OBJECT_VARIANTS });
  });

  it('returns an object schema as is', () => {
    const schema = { type: 'object', properties: {} };

    expect(normalizeMcpToolInputSchema(schema)).toBe(schema);
  });

  it('falls back to an empty object schema when there is none', () => {
    expect(normalizeMcpToolInputSchema(undefined)).toEqual({ type: 'object' });
  });
});
