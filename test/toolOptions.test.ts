import { describe, expect, it } from 'vitest';
import { buildToolOptionGroups, filterToolOptionGroups, flattenToolOptionValues, listToolOptionNames, normalizeConfiguredTools, normalizeConfiguredToolsForOptions, partitionConfiguredTools, toolOptionGroupSelectionSummary, toolOptionSelectionState } from '../src/webview/toolOptions';

describe('VS Code tool options', () => {
  it('builds a VS Code-like Built-In tool tree with concrete child tools', () => {
    const groups = buildToolOptionGroups([
      { name: 'runSubagent', description: 'Run a task within an isolated subagent context.', inputSchema: undefined, tags: ['agent'] },
      { name: 'open_browser_page', description: 'Open a browser page.', inputSchema: undefined, tags: [] },
      { name: 'copilot_readFile', description: 'Read a file.', inputSchema: undefined, tags: [] },
      { name: 'copilot_editFiles', description: 'Edit files.', inputSchema: undefined, tags: [] },
      { name: 'run_in_terminal', description: 'Run a command.', inputSchema: undefined, tags: [] },
      { name: 'copilot_searchWorkspaceSymbols', description: 'Find symbols.', inputSchema: undefined, tags: [] },
      { name: 'manage_todo_list', description: 'Manage todos.', inputSchema: undefined, tags: [] },
      { name: 'copilot_getVSCodeAPI', description: 'Use VS Code API.', inputSchema: undefined, tags: [] },
      { name: 'copilot_fetchWebPage', description: 'Fetch a web page.', inputSchema: undefined, tags: [] },
      { name: 'get_python_environment_details', description: 'Read Python environment details.', inputSchema: undefined, tags: [] },
      { name: '  ', description: 'ignored', inputSchema: undefined, tags: [] }
    ]);

    expect(groups[0].label).toBe('Built-In');
    expect(groups[0].options.map((option) => option.value)).toEqual(['agent', 'browser', 'edit', 'execute', 'read', 'search', 'todo', 'vscode', 'web']);
    expect(groups[0].options.find((option) => option.value === 'agent')?.children).toEqual([
      expect.objectContaining({ value: 'agent/runSubagent', aliases: ['runSubagent'], label: 'runSubagent', description: 'Run a task within an isolated subagent context.' })
    ]);
    expect(groups[0].options.find((option) => option.value === 'browser')?.children).toEqual([
      expect.objectContaining({ value: 'browser/open_browser_page', aliases: ['open_browser_page'], label: 'open_browser_page' })
    ]);
    expect(groups[0].options.find((option) => option.value === 'edit')?.children).toEqual([
      expect.objectContaining({ value: 'edit/editFiles', aliases: ['copilot_editFiles'], label: 'editFiles' })
    ]);
    expect(groups[0].options.find((option) => option.value === 'execute')?.children).toEqual([
      expect.objectContaining({ value: 'execute/run_in_terminal', aliases: ['run_in_terminal'], label: 'run_in_terminal' })
    ]);
    expect(groups[0].options.find((option) => option.value === 'read')?.children).toEqual([
      expect.objectContaining({ value: 'read/get_python_environment_details', aliases: ['get_python_environment_details'], label: 'get_python_environment_details' }),
      expect.objectContaining({ value: 'read/readFile', aliases: ['copilot_readFile'], label: 'readFile' })
    ]);
    expect(groups[0].options.find((option) => option.value === 'search')?.children).toEqual([
      expect.objectContaining({ value: 'search/searchWorkspaceSymbols', aliases: ['copilot_searchWorkspaceSymbols'], label: 'searchWorkspaceSymbols' })
    ]);
    expect(groups[0].options.find((option) => option.value === 'todo')?.children).toEqual([
      expect.objectContaining({ value: 'todo/manage_todo_list', aliases: ['manage_todo_list'], label: 'manage_todo_list' })
    ]);
    expect(groups[0].options.find((option) => option.value === 'vscode')?.children).toEqual([
      expect.objectContaining({ value: 'vscode/getVSCodeAPI', aliases: ['copilot_getVSCodeAPI'], label: 'getVSCodeAPI' })
    ]);
    expect(groups[0].options.find((option) => option.value === 'web')?.children).toEqual([
      expect.objectContaining({ value: 'web/fetchWebPage', aliases: ['copilot_fetchWebPage'], label: 'fetchWebPage' })
    ]);
  });

  it('adds detected extension/MCP tool groups with child tools', () => {
    const groups = buildToolOptionGroups([
      { name: 'mcp_nx_mcp_server_nx_docs', description: '', inputSchema: undefined, tags: [] },
      { name: 'mcp_nx_mcp_server_nx_projects', description: 'List projects.', inputSchema: undefined, tags: [] },
      { name: 'dbcode_updateTools', description: 'Update database tools.', inputSchema: undefined, tags: [] }
    ]);

    expect(groups.find((group) => group.label === 'Nx Mcp Server')?.options).toEqual([
      expect.objectContaining({ value: 'mcp_nx_mcp_server_nx_docs' }),
      expect.objectContaining({ value: 'mcp_nx_mcp_server_nx_projects', description: 'List projects.' })
    ]);
    expect(groups.find((group) => group.label === 'DBCode')?.options).toEqual([
      expect.objectContaining({ value: 'dbcode_updateTools', label: 'updateTools' })
    ]);
  });

  it('keeps a flat compatibility list for persistence checks', () => {
    expect(listToolOptionNames([
      { name: 'runSubagent', description: '', inputSchema: undefined, tags: ['agent'] },
      { name: 'mcp_nx_mcp_server_nx_docs', description: '', inputSchema: undefined, tags: [] }
    ])).toEqual(expect.arrayContaining(['agent', 'agent/runSubagent', 'runSubagent', 'mcp_nx_mcp_server_nx_docs']));
  });

  it('marks a built-in parent checked when frontmatter selects one of its concrete child tools', () => {
    const [builtIns] = buildToolOptionGroups([
      { name: 'copilot_readFile', description: 'Read a file.', inputSchema: undefined, tags: [] }
    ]);
    const read = builtIns.options.find((option) => option.value === 'read');
    const child = read?.children?.find((option) => option.value === 'read/readFile');
    expect(read).toBeDefined();
    expect(child).toBeDefined();

    const selectedSet = new Set(normalizeConfiguredToolsForOptions(['read/readFile'], [builtIns]));
    expect(toolOptionSelectionState(read!, selectedSet)).toEqual({ checked: true, disabled: true });
    expect(toolOptionSelectionState(child!, selectedSet, read)).toEqual({ checked: true, disabled: false });
  });

  it('filters tool groups by labels, canonical ids, aliases, and descriptions', () => {
    const groups = buildToolOptionGroups([
      { name: 'copilot_readFile', description: 'Read a workspace file.', inputSchema: undefined, tags: [] },
      { name: 'agentflow_report_activity', description: 'Report node activity.', inputSchema: undefined, tags: [] },
      { name: 'mcp_docs_server_search_docs', description: 'Search documentation.', inputSchema: undefined, tags: [] }
    ]);

    expect(filterToolOptionGroups(groups, 'readFile')[0].options).toEqual([
      expect.objectContaining({ value: 'read', children: [expect.objectContaining({ value: 'read/readFile' })] })
    ]);
    expect(filterToolOptionGroups(groups, 'agentflow_report_activity').find((group) => group.label === 'Agentflow')?.options).toEqual([
      expect.objectContaining({ value: 'agentflow/report_activity', aliases: ['agentflow_report_activity'] })
    ]);
    expect(filterToolOptionGroups(groups, 'workspace file')[0].options).toEqual([
      expect.objectContaining({ value: 'read', children: [expect.objectContaining({ value: 'read/readFile' })] })
    ]);
  });

  it('summarizes selected tool counts per group without double-counting inherited parents', () => {
    const groups = buildToolOptionGroups([
      { name: 'copilot_readFile', description: 'Read a file.', inputSchema: undefined, tags: [] },
      { name: 'copilot_editFiles', description: 'Edit files.', inputSchema: undefined, tags: [] },
      { name: 'agentflow_report_activity', description: 'Report node activity.', inputSchema: undefined, tags: [] }
    ]);
    const selected = new Set(normalizeConfiguredToolsForOptions(['read/readFile', 'agentflow_report_activity'], groups));

    expect(toolOptionGroupSelectionSummary(groups[0], selected)).toEqual({ selected: 1, total: 11 });
    expect(toolOptionGroupSelectionSummary(groups.find((group) => group.label === 'Agentflow')!, selected)).toEqual({ selected: 1, total: 1 });
  });

  it('normalizes raw child tool frontmatter values to parent/tool values for UI edits', () => {
    const groups = buildToolOptionGroups([
      { name: 'run_in_terminal', description: 'Run a command.', inputSchema: undefined, tags: [] },
      { name: 'execution_subagent', description: 'Run an execution subagent.', inputSchema: undefined, tags: [] },
      { name: 'get_python_environment_details', description: 'Read Python environment details.', inputSchema: undefined, tags: [] }
    ]);

    expect(normalizeConfiguredToolsForOptions(['run_in_terminal', 'execution_subagent'], groups)).toEqual([
      'agent/execution_subagent',
      'execute/run_in_terminal'
    ]);
    expect(normalizeConfiguredToolsForOptions(['get_python_environment_details'], groups)).toEqual([
      'read/get_python_environment_details'
    ]);
  });

  it('uses extension/tool ids for Agent Flow tool options and aliases raw VS Code names', () => {
    const groups = buildToolOptionGroups([
      { name: 'agentflow_complete_node', description: 'Mark a node complete.', inputSchema: undefined, tags: [] },
      { name: 'agentflow_report_activity', description: 'Report node activity.', inputSchema: undefined, tags: [] },
      { name: 'agentflow_select_node', description: 'Select a node.', inputSchema: undefined, tags: [] }
    ]);

    expect(groups.find((group) => group.label === 'Agentflow')?.options).toEqual([
      expect.objectContaining({ value: 'agentflow/complete_node', aliases: ['agentflow_complete_node'], label: 'complete_node' }),
      expect.objectContaining({ value: 'agentflow/report_activity', aliases: ['agentflow_report_activity'], label: 'report_activity' }),
      expect.objectContaining({ value: 'agentflow/select_node', aliases: ['agentflow_select_node'], label: 'select_node' })
    ]);
    expect(normalizeConfiguredToolsForOptions(['agentflow_complete_node'], groups)).toEqual(['agentflow/complete_node']);
  });

  it('normalizes legacy Agent Flow tool names to VS Code groups', () => {
    expect(normalizeConfiguredTools(['codebase', 'editFiles', 'runCommands', 'terminal'])).toEqual(['edit', 'execute', 'read', 'search']);
  });

  it('normalizes internal Copilot tool ids to public VS Code frontmatter ids', () => {
    expect(normalizeConfiguredTools([
      'read/copilot_readFile',
      'search/copilot_searchWorkspaceSymbols',
      'edit/copilot_editFiles',
      'web/copilot_fetchWebPage',
      'vscode/copilot_getVSCodeAPI'
    ])).toEqual([
      'edit/editFiles',
      'read/readFile',
      'search/searchWorkspaceSymbols',
      'vscode/getVSCodeAPI',
      'web/fetchWebPage'
    ]);
  });

  it('partitions configured tools into available and unavailable groups', () => {
    expect(partitionConfiguredTools({
      availableTools: flattenToolOptionValues(buildToolOptionGroups([{ name: 'runSubagent', description: '', inputSchema: undefined, tags: ['agent'] }])),
      configuredTools: ['legacyTool', 'terminal', 'missingTool', 'legacyTool', 'codebase']
    })).toEqual({
      available: ['execute', 'read', 'search'],
      unavailable: ['legacyTool', 'missingTool']
    });
  });
});
