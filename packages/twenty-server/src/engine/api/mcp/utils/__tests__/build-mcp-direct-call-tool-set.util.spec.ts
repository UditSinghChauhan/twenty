import { jsonSchema, type ToolExecuteFunction, type ToolSet } from 'ai';

import { buildMcpDirectCallToolSet } from 'src/engine/api/mcp/utils/build-mcp-direct-call-tool-set.util';

const FIXED_TOOLS: ToolSet = {
  load_skills: {
    inputSchema: jsonSchema({ type: 'object' }),
    execute: async () => ({ skills: [] }),
  },
};

const isToolAllowed = (toolName: string) => toolName !== 'code_interpreter';

const buildExecuteByName = () =>
  jest.fn().mockResolvedValue({ success: true, message: 'done' });

const runTool = (toolSet: ToolSet, toolName: string, args: unknown) =>
  (
    toolSet[toolName].execute as ToolExecuteFunction<
      unknown,
      unknown,
      undefined
    >
  )(args, { toolCallId: '1', messages: [], context: undefined });

describe('buildMcpDirectCallToolSet', () => {
  it('keeps fixed tools as they are without touching the registry', () => {
    const executeByName = buildExecuteByName();

    const toolSet = buildMcpDirectCallToolSet({
      toolName: 'load_skills',
      fixedTools: FIXED_TOOLS,
      isToolAllowed,
      executeByName,
    });

    expect(toolSet).toBe(FIXED_TOOLS);
    expect(executeByName).not.toHaveBeenCalled();
  });

  it('routes an allowed registry tool to the registry by name', async () => {
    const executeByName = buildExecuteByName();

    const toolSet = buildMcpDirectCallToolSet({
      toolName: 'find_many_companies',
      fixedTools: FIXED_TOOLS,
      isToolAllowed,
      executeByName,
    });

    const result = await runTool(toolSet, 'find_many_companies', {
      limit: 2,
    });

    expect(executeByName).toHaveBeenCalledWith('find_many_companies', {
      limit: 2,
    });
    expect(result).toEqual({ success: true, message: 'done' });
  });

  it('passes empty arguments when the client sends none', async () => {
    const executeByName = buildExecuteByName();

    const toolSet = buildMcpDirectCallToolSet({
      toolName: 'list_workflows',
      fixedTools: FIXED_TOOLS,
      isToolAllowed,
      executeByName,
    });

    await runTool(toolSet, 'list_workflows', undefined);

    expect(executeByName).toHaveBeenCalledWith('list_workflows', {});
  });

  it('leaves excluded tools unknown so they are never dispatched', () => {
    const executeByName = buildExecuteByName();

    const toolSet = buildMcpDirectCallToolSet({
      toolName: 'code_interpreter',
      fixedTools: FIXED_TOOLS,
      isToolAllowed,
      executeByName,
    });

    expect(toolSet).toBe(FIXED_TOOLS);
    expect(toolSet).not.toHaveProperty('code_interpreter');
    expect(executeByName).not.toHaveBeenCalled();
  });

  describe('when the registry does not know the tool', () => {
    const callUnknownTool = async (registryOutput: object) => {
      const toolSet = buildMcpDirectCallToolSet({
        toolName: 'find_many_persons',
        fixedTools: FIXED_TOOLS,
        isToolAllowed,
        executeByName: jest.fn().mockResolvedValue(registryOutput),
      });

      return runTool(toolSet, 'find_many_persons', {});
    };

    it('keeps the suggestions and points to the tool list instead of learn_tools', async () => {
      const result = await callUnknownTool({
        success: false,
        message: 'Tool "find_many_persons" not found',
        error:
          'Tool "find_many_persons" not found. Did you mean: find_many_people, find_many_pets? learn_tools confirms exact tool names and suggests close matches.',
      });

      expect(result).toEqual({
        success: false,
        message: 'Tool "find_many_persons" not found',
        error:
          'Tool "find_many_persons" not found. Did you mean: find_many_people, find_many_pets? Check the tool list for the exact name.',
      });
    });

    it('omits the suggestion part when the registry has none', async () => {
      const result = await callUnknownTool({
        success: false,
        message: 'Tool "find_many_persons" not found',
        error:
          'Tool "find_many_persons" not found. learn_tools confirms exact tool names and suggests close matches.',
      });

      expect(result).toMatchObject({
        error:
          'Tool "find_many_persons" not found. Check the tool list for the exact name.',
      });
    });

    it('leaves other failures and successes untouched', async () => {
      const executionFailure = {
        success: false,
        message: 'Failed to execute find_many_persons',
        error: 'Invalid filter',
      };
      const success = { success: true, message: 'Found 0 records' };

      expect(await callUnknownTool(executionFailure)).toEqual(executionFailure);
      expect(await callUnknownTool(success)).toEqual(success);
    });
  });
});
