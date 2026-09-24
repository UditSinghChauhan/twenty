import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

import { type ToolSet, zodSchema } from 'ai';
import { type ActorMetadata, FieldActorSource } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { JSON_RPC_ERROR_CODE } from 'src/engine/api/mcp/constants/json-rpc-error-code.const';
import { MCP_CLOSED_WORLD_READ_ONLY_TOOL_ANNOTATIONS } from 'src/engine/api/mcp/constants/mcp-closed-world-read-only-tool-annotations.const';
import { MCP_EXCLUDED_TOOL_NAMES } from 'src/engine/api/mcp/constants/mcp-excluded-tool-names.const';
import { MCP_EXECUTE_TOOL_ANNOTATIONS } from 'src/engine/api/mcp/constants/mcp-execute-tool-annotations.const';
import { MCP_OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS } from 'src/engine/api/mcp/constants/mcp-open-world-read-only-tool-annotations.const';
import { MCP_PROTOCOL_VERSION } from 'src/engine/api/mcp/constants/mcp-protocol-version.const';
import { MCP_SERVER_INFO } from 'src/engine/api/mcp/constants/mcp-server-info.const';
import { MCP_TOOL_DISCOVERY_HINT } from 'src/engine/api/mcp/constants/mcp-tool-discovery-hint.const';
import { JsonRpc } from 'src/engine/api/mcp/dtos/json-rpc';
import { McpInstructionBuilderService } from 'src/engine/api/mcp/services/mcp-instruction-builder.service';
import { McpToolExecutorService } from 'src/engine/api/mcp/services/mcp-tool-executor.service';
import {
  createListObjectMetadataNamesTool,
  LIST_OBJECT_METADATA_NAMES_TOOL_NAME,
  listObjectMetadataNamesInputSchema,
} from 'src/engine/api/mcp/tools/list-object-metadata-names.tool';
import {
  createListSkillsTool,
  LIST_SKILLS_TOOL_NAME,
  listSkillsInputSchema,
} from 'src/engine/api/mcp/tools/list-skills.tool';
import { type McpMode } from 'src/engine/api/mcp/types/mcp-mode.type';
import { type McpToolAnnotations } from 'src/engine/api/mcp/types/mcp-tool-annotations.type';
import { buildMcpDirectCallToolSet } from 'src/engine/api/mcp/utils/build-mcp-direct-call-tool-set.util';
import { getMcpDirectToolAnnotations } from 'src/engine/api/mcp/utils/get-mcp-direct-tool-annotations.util';
import { wrapJsonRpcResponse } from 'src/engine/api/mcp/utils/wrap-jsonrpc-response.util';
import { ApiKeyRoleService } from 'src/engine/core-modules/api-key/services/api-key-role.service';
import { type FlatApiKey } from 'src/engine/core-modules/api-key/types/flat-api-key.type';
import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { buildApiKeyAuthContext } from 'src/engine/core-modules/auth/utils/build-api-key-auth-context.util';
import { COMMON_PRELOAD_TOOLS } from 'src/engine/core-modules/tool-provider/constants/common-preload-tools.const';
import { ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import {
  createLearnToolsTool,
  LEARN_TOOLS_TOOL_NAME,
  learnToolsInputSchema,
} from 'src/engine/core-modules/tool-provider/tools';
import {
  createExecuteToolTool,
  EXECUTE_TOOL_TOOL_NAME,
  executeToolInputSchema,
} from 'src/engine/core-modules/tool-provider/tools/execute-tool.tool';
import {
  createGetToolCatalogTool,
  GET_TOOL_CATALOG_TOOL_NAME,
  getToolCatalogInputSchema,
} from 'src/engine/core-modules/tool-provider/tools/get-tool-catalog.tool';
import {
  createLoadSkillTool,
  LOAD_SKILL_TOOL_NAME,
  loadSkillInputSchema,
} from 'src/engine/core-modules/tool-provider/tools/load-skill.tool';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolContext } from 'src/engine/core-modules/tool-provider/types/tool-context.type';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config.type';
import { resolveRoleIdsForUser } from 'src/engine/twenty-orm/utils/resolve-role-ids-for-user.util';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { SkillService } from 'src/engine/metadata-modules/skill/skill.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

type McpAnnotatedTool = ToolSet[string] & {
  annotations: McpToolAnnotations;
};

const MCP_PRELOADED_TOOL_ANNOTATIONS: Record<string, McpToolAnnotations> = {
  search_help_center: MCP_OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
};

const annotatePreloadedMcpTools = (toolSet: ToolSet): ToolSet =>
  Object.fromEntries(
    Object.entries(toolSet).map(([name, toolDefinition]) => {
      const annotations = MCP_PRELOADED_TOOL_ANNOTATIONS[name];

      if (!isDefined(annotations)) {
        throw new Error(`Missing MCP annotations for preloaded tool "${name}"`);
      }

      return [
        name,
        {
          ...toolDefinition,
          annotations,
        } as McpAnnotatedTool,
      ];
    }),
  );

const isMcpToolAllowed = (toolName: string) =>
  !MCP_EXCLUDED_TOOL_NAMES.has(toolName);

type McpToolSetOptions = {
  authContext?: WorkspaceAuthContext;
  userId?: string;
  userWorkspaceId?: string;
  apiKey?: FlatApiKey;
  application?: FlatApplication;
};

@Injectable()
export class McpProtocolService {
  private readonly logger = new Logger(McpProtocolService.name);

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly userRoleService: UserRoleService,
    private readonly mcpToolExecutorService: McpToolExecutorService,
    private readonly apiKeyRoleService: ApiKeyRoleService,
    private readonly skillService: SkillService,
    private readonly mcpInstructionBuilderService: McpInstructionBuilderService,
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  async handleInitialize(
    requestId: string | number,
    {
      workspaceId,
      roleId,
      rolePermissionConfig,
      mode,
    }: {
      workspaceId: string;
      roleId: string;
      rolePermissionConfig: RolePermissionConfig;
      mode?: McpMode;
    },
  ) {
    const instructions =
      await this.mcpInstructionBuilderService.buildInstructions({
        workspaceId,
        roleId,
        rolePermissionConfig,
        mode,
      });

    return wrapJsonRpcResponse(requestId, {
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: MCP_SERVER_INFO,
        instructions,
      },
    });
  }

  async resolveCallerRoles({
    workspaceId,
    userWorkspaceId,
    apiKey,
    application,
  }: {
    workspaceId: string;
    userWorkspaceId?: string;
    apiKey?: FlatApiKey;
    application?: FlatApplication;
  }): Promise<{ roleId: string; rolePermissionConfig: RolePermissionConfig }> {
    if (isDefined(apiKey)) {
      const apiKeyRoleId = await this.apiKeyRoleService.getRoleIdForApiKeyId(
        apiKey.id,
        workspaceId,
      );

      return {
        roleId: apiKeyRoleId,
        rolePermissionConfig: { unionOf: [apiKeyRoleId] },
      };
    }

    if (!userWorkspaceId) {
      throw new HttpException(
        'User workspace ID missing',
        HttpStatus.FORBIDDEN,
      );
    }

    const userRoleId = await this.userRoleService.getRoleIdForUserWorkspace({
      workspaceId,
      userWorkspaceId,
    });

    return {
      roleId: userRoleId,
      rolePermissionConfig: {
        intersectionOf: resolveRoleIdsForUser({
          userRoleId,
          applicationRoleId: application?.defaultRoleId,
        }),
      },
    };
  }

  private async buildActorContext(
    workspaceId: string,
    userId?: string,
    apiKey?: FlatApiKey,
  ): Promise<ActorMetadata> {
    let actorContext: ActorMetadata = {
      source: FieldActorSource.AGENT,
      workspaceMemberId: null,
      name: 'Agent',
      context: {},
    };

    if (isDefined(apiKey)) {
      actorContext = {
        source: FieldActorSource.AGENT,
        workspaceMemberId: null,
        name: apiKey.name,
        context: {},
      };
    } else if (isDefined(userId)) {
      const { flatWorkspaceMemberMaps } =
        await this.workspaceCacheService.getOrRecompute(workspaceId, [
          'flatWorkspaceMemberMaps',
        ]);
      const workspaceMemberId = flatWorkspaceMemberMaps.idByUserId[userId];
      const workspaceMember = isDefined(workspaceMemberId)
        ? flatWorkspaceMemberMaps.byId[workspaceMemberId]
        : undefined;

      if (isDefined(workspaceMember)) {
        actorContext = {
          source: FieldActorSource.AGENT,
          workspaceMemberId: workspaceMember.id,
          name:
            `${workspaceMember.name?.firstName ?? ''} ${workspaceMember.name?.lastName ?? ''}`.trim() ||
            'Agent',
          context: {},
        };
      }
    }

    return actorContext;
  }

  private async buildToolContext(
    workspace: FlatWorkspace,
    roleId: string,
    rolePermissionConfig: RolePermissionConfig,
    options?: McpToolSetOptions,
  ): Promise<ToolProviderContext> {
    const actorContext = await this.buildActorContext(
      workspace.id,
      options?.userId,
      options?.apiKey,
    );

    return {
      workspaceId: workspace.id,
      roleId,
      rolePermissionConfig,
      authContext: options?.authContext,
      application: options?.application,
      userId: options?.userId,
      userWorkspaceId: options?.userWorkspaceId,
      actorContext,
    };
  }

  private createLoadSkillsMcpTool(workspaceId: string): McpAnnotatedTool {
    return {
      ...createLoadSkillTool(
        (names) => this.skillService.findFlatSkillsByNames(names, workspaceId),
        async () => {
          const allSkills =
            await this.skillService.findAllFlatSkills(workspaceId);

          return allSkills.map((skill) => skill.name);
        },
      ),
      inputSchema: zodSchema(loadSkillInputSchema),
      annotations: MCP_CLOSED_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    } as McpAnnotatedTool;
  }

  private createListObjectMetadataNamesMcpTool(
    workspaceId: string,
  ): McpAnnotatedTool {
    return {
      ...createListObjectMetadataNamesTool(
        this.flatEntityMapsCacheService,
        workspaceId,
      ),
      inputSchema: zodSchema(listObjectMetadataNamesInputSchema),
      annotations: MCP_CLOSED_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    } as McpAnnotatedTool;
  }

  private createListSkillsMcpTool(workspaceId: string): McpAnnotatedTool {
    return {
      ...createListSkillsTool(this.skillService, workspaceId),
      inputSchema: zodSchema(listSkillsInputSchema),
      annotations: MCP_CLOSED_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    } as McpAnnotatedTool;
  }

  private async buildMcpToolSet(
    workspace: FlatWorkspace,
    roleId: string,
    rolePermissionConfig: RolePermissionConfig,
    options?: McpToolSetOptions,
  ): Promise<ToolSet> {
    const toolContext = await this.buildToolContext(
      workspace,
      roleId,
      rolePermissionConfig,
      options,
    );

    const preloadedTools = await this.toolRegistry.getToolsByName(
      COMMON_PRELOAD_TOOLS,
      toolContext,
    );

    return {
      ...annotatePreloadedMcpTools(preloadedTools),
      [GET_TOOL_CATALOG_TOOL_NAME]: {
        ...createGetToolCatalogTool(this.toolRegistry, workspace.id, roleId, {
          rolePermissionConfig,
          userId: options?.userId,
          userWorkspaceId: options?.userWorkspaceId,
          excludeTools: MCP_EXCLUDED_TOOL_NAMES,
          application: options?.application,
        }),
        inputSchema: zodSchema(getToolCatalogInputSchema),
        annotations: MCP_CLOSED_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
      } as McpAnnotatedTool,
      [EXECUTE_TOOL_TOOL_NAME]: {
        ...createExecuteToolTool(this.toolRegistry, toolContext, {
          isToolAllowed: isMcpToolAllowed,
          discoveryHint: MCP_TOOL_DISCOVERY_HINT,
        }),
        inputSchema: executeToolInputSchema,
        annotations: MCP_EXECUTE_TOOL_ANNOTATIONS,
      } as McpAnnotatedTool,
      [LOAD_SKILL_TOOL_NAME]: this.createLoadSkillsMcpTool(workspace.id),
      [LIST_OBJECT_METADATA_NAMES_TOOL_NAME]:
        this.createListObjectMetadataNamesMcpTool(workspace.id),
      [LIST_SKILLS_TOOL_NAME]: this.createListSkillsMcpTool(workspace.id),
      [LEARN_TOOLS_TOOL_NAME]: {
        ...createLearnToolsTool(this.toolRegistry, toolContext, {
          isToolAllowed: isMcpToolAllowed,
          discoveryHint: MCP_TOOL_DISCOVERY_HINT,
        }),
        inputSchema: zodSchema(learnToolsInputSchema),
        annotations: MCP_CLOSED_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
      } as McpAnnotatedTool,
    };
  }

  private async buildDirectFixedMcpTools(
    workspaceId: string,
    toolContext: ToolContext,
  ): Promise<ToolSet> {
    const preloadedTools = await this.toolRegistry.getToolsByName(
      COMMON_PRELOAD_TOOLS,
      toolContext,
    );

    return {
      ...annotatePreloadedMcpTools(preloadedTools),
      [LOAD_SKILL_TOOL_NAME]: this.createLoadSkillsMcpTool(workspaceId),
      [LIST_OBJECT_METADATA_NAMES_TOOL_NAME]:
        this.createListObjectMetadataNamesMcpTool(workspaceId),
      [LIST_SKILLS_TOOL_NAME]: this.createListSkillsMcpTool(workspaceId),
    };
  }

  private async handleDirectToolsListing(
    id: string | number,
    workspace: FlatWorkspace,
    toolContext: ToolProviderContext,
  ) {
    const startedAt = performance.now();

    const [fixedTools, registryTools] = await Promise.all([
      this.buildDirectFixedMcpTools(workspace.id, toolContext),
      this.toolRegistry.getToolsByCategories(toolContext, {
        excludeTools: [...MCP_EXCLUDED_TOOL_NAMES],
      }),
    ]);

    const directTools: ToolSet = { ...fixedTools };

    for (const [toolName, toolDefinition] of Object.entries(registryTools)) {
      if (toolName in directTools) {
        continue;
      }

      directTools[toolName] = {
        ...toolDefinition,
        annotations: getMcpDirectToolAnnotations(toolName),
      } as McpAnnotatedTool;
    }

    const response = this.mcpToolExecutorService.handleToolsListing(
      id,
      directTools,
    );

    this.logger.debug(
      `Direct tools/list for workspace ${workspace.id}: ${Object.keys(directTools).length} tools, ${Buffer.byteLength(JSON.stringify(response))} bytes, ${Math.round(performance.now() - startedAt)} ms`,
    );

    return response;
  }

  private async handleDirectToolRequest(
    {
      id,
      method,
      params,
    }: Pick<JsonRpc, 'method' | 'params'> & {
      id: string | number;
    },
    workspace: FlatWorkspace,
    toolContext: ToolProviderContext,
    sseWriter?: (data: Record<string, unknown>) => void,
  ) {
    if (method !== 'tools/call') {
      return this.handleDirectToolsListing(id, workspace, toolContext);
    }

    if (!params) {
      return wrapJsonRpcResponse(id, {
        error: {
          code: JSON_RPC_ERROR_CODE.INVALID_PARAMS,
          message: 'tools/call requires params with name and arguments',
        },
      });
    }

    const fixedTools = await this.buildDirectFixedMcpTools(
      workspace.id,
      toolContext,
    );

    const toolSet =
      typeof params.name === 'string'
        ? buildMcpDirectCallToolSet({
            toolName: params.name,
            fixedTools,
            isToolAllowed: isMcpToolAllowed,
            executeByName: (toolName, args) =>
              this.toolRegistry.resolveAndExecute(toolName, args, toolContext),
          })
        : fixedTools;

    return this.mcpToolExecutorService.handleToolCall(
      id,
      toolSet,
      params,
      sseWriter,
    );
  }

  // Returns null for JSON-RPC notifications (no id), which require no response body
  async handleMCPCoreQuery(
    { id, method, params }: JsonRpc,
    {
      workspace,
      userId,
      userWorkspaceId,
      apiKey,
      application,
      mode = 'meta',
    }: {
      workspace: FlatWorkspace;
      userId?: string;
      userWorkspaceId?: string;
      apiKey: FlatApiKey | undefined;
      application?: FlatApplication;
      mode?: McpMode;
    },
    sseWriter?: (data: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown> | null> {
    try {
      // JSON-RPC notifications have no id and expect no response
      if (!isDefined(id)) {
        return null;
      }

      if (method === 'initialize') {
        const { roleId, rolePermissionConfig } = await this.resolveCallerRoles({
          workspaceId: workspace.id,
          userWorkspaceId,
          apiKey,
          application,
        });

        return this.handleInitialize(id, {
          workspaceId: workspace.id,
          roleId,
          rolePermissionConfig,
          mode,
        });
      }

      if (method === 'ping') {
        return wrapJsonRpcResponse(id, { result: {} });
      }

      if (method === 'prompts/list') {
        return wrapJsonRpcResponse(id, {
          result: { prompts: [] },
        });
      }

      if (method === 'resources/list') {
        return wrapJsonRpcResponse(id, {
          result: { resources: [] },
        });
      }

      if (method !== 'tools/list' && method !== 'tools/call') {
        return wrapJsonRpcResponse(id, {
          error: {
            code: JSON_RPC_ERROR_CODE.METHOD_NOT_FOUND,
            message: `Method '${method}' not found`,
          },
        });
      }

      const { roleId, rolePermissionConfig } = await this.resolveCallerRoles({
        workspaceId: workspace.id,
        userWorkspaceId,
        apiKey,
        application,
      });

      const authContext = isDefined(apiKey)
        ? buildApiKeyAuthContext({ workspace, apiKey })
        : undefined;

      if (mode === 'direct') {
        return await this.handleDirectToolRequest(
          { id, method, params },
          workspace,
          await this.buildToolContext(workspace, roleId, rolePermissionConfig, {
            authContext,
            application,
            userId,
            userWorkspaceId,
            apiKey,
          }),
          sseWriter,
        );
      }

      const toolSet = await this.buildMcpToolSet(
        workspace,
        roleId,
        rolePermissionConfig,
        {
          authContext,
          application,
          userId,
          userWorkspaceId,
          apiKey,
        },
      );

      if (method === 'tools/call') {
        if (!params) {
          return wrapJsonRpcResponse(id, {
            error: {
              code: JSON_RPC_ERROR_CODE.INVALID_PARAMS,
              message: 'tools/call requires params with name and arguments',
            },
          });
        }

        return await this.mcpToolExecutorService.handleToolCall(
          id,
          toolSet,
          params,
          sseWriter,
        );
      }

      return this.mcpToolExecutorService.handleToolsListing(id, toolSet);
    } catch (error) {
      if (error instanceof HttpException) {
        return wrapJsonRpcResponse(id ?? 0, {
          error: {
            code: JSON_RPC_ERROR_CODE.SERVER_ERROR,
            message: error.message || 'Request failed',
          },
        });
      }

      return wrapJsonRpcResponse(id ?? 0, {
        error: {
          code: JSON_RPC_ERROR_CODE.INTERNAL_ERROR,
          message:
            error instanceof Error ? error.message : 'Internal server error',
        },
      });
    }
  }
}
