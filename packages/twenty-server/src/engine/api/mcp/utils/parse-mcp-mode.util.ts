import { type McpMode } from 'src/engine/api/mcp/types/mcp-mode.type';

// Only an exact `mode=direct` opts in; anything else, including repeated or
// misspelled values, keeps the meta-tool surface existing clients rely on.
export const parseMcpMode = (value: unknown): McpMode =>
  value === 'direct' ? 'direct' : 'meta';
