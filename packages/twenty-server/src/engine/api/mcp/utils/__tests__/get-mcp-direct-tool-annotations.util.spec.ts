import { MCP_EXECUTE_TOOL_ANNOTATIONS } from 'src/engine/api/mcp/constants/mcp-execute-tool-annotations.const';
import { getMcpDirectToolAnnotations } from 'src/engine/api/mcp/utils/get-mcp-direct-tool-annotations.util';

describe('getMcpDirectToolAnnotations', () => {
  it.each([
    'find_many_companies',
    'find_one_company',
    'group_by_opportunities',
    'get_views',
    'list_workflows',
  ])('marks %s as read-only', (toolName) => {
    expect(getMcpDirectToolAnnotations(toolName)).toEqual({
      ...MCP_EXECUTE_TOOL_ANNOTATIONS,
      readOnlyHint: true,
    });
  });

  it.each(['delete_one_company', 'delete_many_people', 'destroy_one_note'])(
    'marks %s as destructive',
    (toolName) => {
      expect(getMcpDirectToolAnnotations(toolName)).toEqual({
        ...MCP_EXECUTE_TOOL_ANNOTATIONS,
        destructiveHint: true,
      });
    },
  );

  it.each(['create_one_company', 'update_many_people', 'send_email'])(
    'keeps the execute_tool defaults for %s',
    (toolName) => {
      expect(getMcpDirectToolAnnotations(toolName)).toEqual(
        MCP_EXECUTE_TOOL_ANNOTATIONS,
      );
    },
  );
});
