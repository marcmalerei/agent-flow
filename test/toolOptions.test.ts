import { describe, expect, it } from 'vitest';
import { listToolOptionNames, normalizeConfiguredTools, partitionConfiguredTools } from '../src/webview/toolOptions';

describe('VS Code tool options', () => {
  it('uses VS Code tool groups instead of raw language model tool ids', () => {
    expect(listToolOptionNames([
      { name: 'copilot_readFile', description: '', inputSchema: undefined, tags: [] },
      { name: 'copilot_editFiles', description: '', inputSchema: undefined, tags: [] },
      { name: '  ', description: 'ignored', inputSchema: undefined, tags: [] }
    ])).toEqual(['agent', 'browser', 'edit', 'execute', 'read', 'search', 'todo', 'vscode', 'web']);
  });

  it('adds detected MCP server wildcard groups', () => {
    expect(listToolOptionNames([
      { name: 'mcp_nx_mcp_server_nx_docs', description: '', inputSchema: undefined, tags: [] },
      { name: 'mcp_nx_mcp_server_nx_projects', description: '', inputSchema: undefined, tags: [] }
    ])).toContain('nx_mcp_server/*');
  });

  it('normalizes legacy AgentFlow tool names to VS Code groups', () => {
    expect(normalizeConfiguredTools(['codebase', 'editFiles', 'runCommands', 'terminal'])).toEqual(['edit', 'execute', 'read', 'search']);
  });

  it('partitions configured tools into available and unavailable groups', () => {
    expect(partitionConfiguredTools({
      availableTools: ['read', 'search', 'execute'],
      configuredTools: ['legacyTool', 'terminal', 'missingTool', 'legacyTool', 'codebase']
    })).toEqual({
      available: ['execute', 'read', 'search'],
      unavailable: ['legacyTool', 'missingTool']
    });
  });
});
