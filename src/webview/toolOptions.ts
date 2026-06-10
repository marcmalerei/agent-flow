import { normalizeToolsForVsCode } from '../pipeline/toolNormalization';

export interface ToolInformation {
  readonly name: string;
  readonly tags?: readonly string[];
}

const builtInToolGroups = ['agent', 'browser', 'edit', 'execute', 'read', 'search', 'todo', 'vscode', 'web'];

export function listToolOptionNames(tools: readonly ToolInformation[]): string[] {
  return [...new Set([...builtInToolGroups, ...mcpServerToolGroups(tools)])].sort((a, b) => a.localeCompare(b));
}

export function normalizeConfiguredTools(tools: readonly string[]): string[] {
  return normalizeToolsForVsCode(tools) ?? [];
}

export function partitionConfiguredTools({ availableTools, configuredTools }: { availableTools: string[]; configuredTools: string[] }): { available: string[]; unavailable: string[] } {
  const available = [...new Set(availableTools.map((tool) => tool.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const availableSet = new Set(available);
  const normalizedConfigured = normalizeConfiguredTools(configuredTools);
  const unavailable = normalizedConfigured.filter((tool) => tool && !availableSet.has(tool)).sort((a, b) => a.localeCompare(b));
  return { available, unavailable };
}

function mcpServerToolGroups(tools: readonly ToolInformation[]): string[] {
  return tools
    .map((tool) => tool.name.trim())
    .filter((name) => name.startsWith('mcp_'))
    .map((name) => {
      const parts = name.slice(4).split('_').filter(Boolean);
      if (parts.length < 2) return undefined;
      const serverIndex = parts.indexOf('server');
      const serverParts = serverIndex > 0 ? parts.slice(0, serverIndex + 1) : parts.slice(0, -1);
      return `${serverParts.join('_')}/*`;
    })
    .filter((value): value is string => Boolean(value));
}
