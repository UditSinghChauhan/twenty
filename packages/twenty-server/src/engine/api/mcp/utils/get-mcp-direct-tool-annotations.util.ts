import { MCP_EXECUTE_TOOL_ANNOTATIONS } from 'src/engine/api/mcp/constants/mcp-execute-tool-annotations.const';
import { type McpToolAnnotations } from 'src/engine/api/mcp/types/mcp-tool-annotations.type';

const READ_ONLY_TOOL_NAME_PREFIXES = ['find_', 'group_by_', 'get_', 'list_'];
const DESTRUCTIVE_TOOL_NAME_PREFIXES = ['delete_', 'destroy_'];

// Name prefixes are the only signal the registry offers for every provider;
// anything unrecognized keeps the execute_tool defaults.
export const getMcpDirectToolAnnotations = (
  toolName: string,
): McpToolAnnotations => {
  if (
    READ_ONLY_TOOL_NAME_PREFIXES.some((prefix) => toolName.startsWith(prefix))
  ) {
    return { ...MCP_EXECUTE_TOOL_ANNOTATIONS, readOnlyHint: true };
  }

  if (
    DESTRUCTIVE_TOOL_NAME_PREFIXES.some((prefix) => toolName.startsWith(prefix))
  ) {
    return { ...MCP_EXECUTE_TOOL_ANNOTATIONS, destructiveHint: true };
  }

  return MCP_EXECUTE_TOOL_ANNOTATIONS;
};
