import { isPlainObject } from 'twenty-shared/utils';

// Registry tools may carry the AI SDK's { jsonSchema } wrapper or a plain
// JSON Schema object.
const getJsonSchema = (inputSchema: unknown): unknown =>
  isPlainObject(inputSchema) && 'jsonSchema' in inputSchema
    ? inputSchema.jsonSchema
    : inputSchema;

// MCP requires a tool's inputSchema to be an object schema at the top level,
// and clients reject the whole tools/list otherwise. z.toJSONSchema turns a
// top-level union into { anyOf: [...] } with no type, even when every variant
// is an object; declaring type "object" alongside keeps the variants intact.
export const normalizeMcpToolInputSchema = (
  inputSchema: unknown,
): Record<string, unknown> => {
  const jsonSchema = getJsonSchema(inputSchema);

  if (!isPlainObject(jsonSchema)) {
    return { type: 'object' };
  }

  if ('type' in jsonSchema) {
    return jsonSchema;
  }

  return { type: 'object', ...jsonSchema };
};
