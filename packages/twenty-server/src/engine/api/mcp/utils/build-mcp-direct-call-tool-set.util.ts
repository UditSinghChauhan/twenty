import { jsonSchema, type ToolSet } from 'ai';

import { type ToolOutput } from 'src/engine/core-modules/tool/types/tool-output.type';

const DID_YOU_MEAN_PATTERN = / Did you mean: [^?]*\?/;

// The registry's not-found text points to learn_tools, which direct mode does
// not offer. Keep its suggestions and point to the listed tools instead,
// without changing the registry text meta mode and chat still rely on.
const rewriteUnknownToolOutput = (
  toolName: string,
  output: ToolOutput,
): ToolOutput => {
  if (
    output.success !== false ||
    output.message !== `Tool "${toolName}" not found`
  ) {
    return output;
  }

  const suggestions = output.error?.match(DID_YOU_MEAN_PATTERN)?.[0] ?? '';

  return {
    ...output,
    error: `Tool "${toolName}" not found.${suggestions} Check the tool list for the exact name.`,
  };
};

// A direct-mode call names a registry tool that is not in the fixed tool set.
// Rather than building every schema to find it, route that one name to the
// registry; excluded names stay unknown so the executor rejects them.
export const buildMcpDirectCallToolSet = ({
  toolName,
  fixedTools,
  isToolAllowed,
  executeByName,
}: {
  toolName: string;
  fixedTools: ToolSet;
  isToolAllowed: (toolName: string) => boolean;
  executeByName: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<ToolOutput>;
}): ToolSet => {
  if (toolName in fixedTools || !isToolAllowed(toolName)) {
    return fixedTools;
  }

  return {
    ...fixedTools,
    [toolName]: {
      inputSchema: jsonSchema({ type: 'object' }),
      execute: async (args: Record<string, unknown> | undefined) =>
        rewriteUnknownToolOutput(
          toolName,
          await executeByName(toolName, args ?? {}),
        ),
    },
  };
};
