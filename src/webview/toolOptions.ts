export interface ToolInformation {
  readonly name: string;
}

export function listToolOptionNames(tools: readonly ToolInformation[]): string[] {
  return [...new Set(tools.map((tool) => tool.name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function partitionConfiguredTools({ availableTools, configuredTools }: { availableTools: string[]; configuredTools: string[] }): { available: string[]; unavailable: string[] } {
  const available = [...new Set(availableTools.map((tool) => tool.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const availableSet = new Set(available);
  const unavailable = [...new Set(configuredTools.map((tool) => tool.trim()).filter((tool) => tool && !availableSet.has(tool)))].sort((a, b) => a.localeCompare(b));
  return { available, unavailable };
}
