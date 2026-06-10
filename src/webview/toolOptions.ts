export interface ToolInformation {
  readonly name: string;
}

export function listToolOptionNames(tools: readonly ToolInformation[]): string[] {
  return [...new Set(tools.map((tool) => tool.name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
