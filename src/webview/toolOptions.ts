import { normalizeToolsForVsCode } from '../pipeline/toolNormalization';
import { AgentPipeline, PipelineNode } from '../pipeline/types';

export interface ToolInformation {
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface ToolOption {
  readonly aliases?: readonly string[];
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly children?: readonly ToolOption[];
}

export interface ToolOptionGroup {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly options: readonly ToolOption[];
}

const builtInToolGroups: readonly ToolOption[] = [
  { value: 'agent', label: 'agent', description: 'Delegate tasks to other agents', icon: 'hubot' },
  { value: 'browser', label: 'browser', description: 'Open and interact with integrated browser pages', icon: 'globe' },
  { value: 'edit', label: 'edit', description: 'Edit files in your workspace', icon: 'edit' },
  { value: 'execute', label: 'execute', description: 'Execute code and applications on your machine', icon: 'terminal' },
  { value: 'read', label: 'read', description: 'Read files in your workspace', icon: 'book' },
  { value: 'search', label: 'search', description: 'Search files in your workspace', icon: 'search' },
  { value: 'todo', label: 'todo', description: 'Manage and track todo items for task planning', icon: 'checklist' },
  { value: 'vscode', label: 'vscode', description: 'Use VS Code features', icon: 'vscode' },
  { value: 'web', label: 'web', description: 'Fetch information from the web', icon: 'globe' }
];

const builtInValues = new Set(builtInToolGroups.map((tool) => tool.value));
const internalToolPrefixes = ['copilot_'];

export function listToolOptionNames(tools: readonly ToolInformation[]): string[] {
  return flattenToolOptionValues(buildToolOptionGroups(tools));
}

export function buildToolOptionGroups(tools: readonly ToolInformation[]): ToolOptionGroup[] {
  const concreteTools = tools.map(toConcreteToolOption).filter((tool): tool is ConcreteToolOption => Boolean(tool));
  const builtInChildren = new Map<string, ToolOption[]>();
  const extensionGroups = new Map<string, { label: string; options: ToolOption[] }>();

  for (const tool of concreteTools) {
    const builtInParent = builtInParentForTool(tool);
    if (builtInParent) {
      const children = builtInChildren.get(builtInParent) ?? [];
      children.push({ value: `${builtInParent}/${tool.label}`, aliases: [tool.value], label: tool.label, description: tool.description, icon: tool.icon });
      builtInChildren.set(builtInParent, children);
      continue;
    }

    const extensionGroup = extensionGroupForTool(tool);
    const group = extensionGroups.get(extensionGroup.id) ?? { label: extensionGroup.label, options: [] };
    group.options.push({ value: extensionGroup.value, aliases: extensionGroup.aliases, label: extensionGroup.optionLabel, description: tool.description, icon: tool.icon });
    extensionGroups.set(extensionGroup.id, group);
  }

  const builtInOptions = builtInToolGroups.map((tool) => {
    const children = sortToolOptions(dedupeToolOptions(builtInChildren.get(tool.value) ?? []));
    return children.length ? { ...tool, children } : tool;
  });

  const extensionOptionGroups = [...extensionGroups.entries()]
    .map(([id, group]) => ({ id, label: group.label, icon: 'extensions', options: sortToolOptions(dedupeToolOptions(group.options)) }))
    .filter((group) => group.options.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));

  return [{ id: 'built-in', label: 'Built-In', options: builtInOptions }, ...extensionOptionGroups];
}

export function flattenToolOptionValues(groups: readonly ToolOptionGroup[]): string[] {
  return [...new Set(groups.flatMap((group) => group.options.flatMap(flattenToolOption)))].sort((a, b) => a.localeCompare(b));
}

export function normalizeConfiguredTools(tools: readonly string[]): string[] {
  return normalizeToolsForVsCode(tools) ?? [];
}

export function normalizeConfiguredToolsForOptions(tools: readonly string[], groups: readonly ToolOptionGroup[]): string[] {
  const aliases = toolAliasMap(groups);
  return [...new Set(normalizeConfiguredTools(tools).map((tool) => aliases.get(tool) ?? tool))].sort((a, b) => a.localeCompare(b));
}

export function normalizePipelineToolsForOptions<T extends AgentPipeline>(pipeline: T, groups: readonly ToolOptionGroup[]): T {
  const nodes = pipeline.nodes.map((node) => {
    if ((node.type === 'agent' || node.type === 'prompt') && node.tools) {
      return { ...node, tools: normalizeConfiguredToolsForOptions(node.tools, groups) } as PipelineNode;
    }
    return node;
  });
  return { ...pipeline, nodes } as T;
}

export function toolOptionSelectionState(option: ToolOption, selectedSet: ReadonlySet<string>, parent?: ToolOption): { checked: boolean; disabled: boolean } {
  const directlySelected = toolOptionSelected(option, selectedSet);
  const parentSelected = Boolean(parent && toolOptionSelected(parent, selectedSet));
  const childSelected = Boolean(option.children?.some((child) => toolOptionHasSelectedDescendant(child, selectedSet)));
  return {
    checked: directlySelected || parentSelected || childSelected,
    disabled: (parentSelected || childSelected) && !directlySelected
  };
}

export function partitionConfiguredTools({ availableTools, configuredTools }: { availableTools: string[]; configuredTools: string[] }): { available: string[]; unavailable: string[] } {
  const availableSet = new Set(availableTools.map((tool) => tool.trim()).filter(Boolean));
  const normalizedConfigured = normalizeConfiguredTools(configuredTools);
  const available = normalizedConfigured.filter((tool) => availableSet.has(tool)).sort((a, b) => a.localeCompare(b));
  const unavailable = normalizedConfigured.filter((tool) => tool && !availableSet.has(tool)).sort((a, b) => a.localeCompare(b));
  return { available, unavailable };
}

type ConcreteToolOption = ToolOption & { readonly tags: readonly string[] };

function toConcreteToolOption(tool: ToolInformation): ConcreteToolOption | undefined {
  const value = tool.name.trim();
  if (!value || builtInValues.has(value)) return undefined;
  return { value, label: formatToolLabel(value), description: tool.description?.trim() || undefined, tags: tool.tags ?? [] };
}

function builtInParentForTool(tool: ConcreteToolOption): string | undefined {
  const tags = tool.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const lowerName = stripInternalToolPrefix(tool.value).toLowerCase();
  if (tags.includes('agent') || lowerName.includes('subagent')) return 'agent';
  const taggedGroup = builtInToolGroups.find((group) => tags.includes(group.value))?.value;
  if (taggedGroup) return taggedGroup;
  if (hasAny(lowerName, ['fetchwebpage', 'webpage', 'web'])) return 'web';
  if (hasAny(lowerName, ['browser', 'page', 'element', 'click', 'hover', 'drag', 'dialog', 'playwright'])) return 'browser';
  if (hasAny(lowerName, ['edit', 'insert', 'replace', 'createfile', 'createdirectory', 'createnew'])) return 'edit';
  if (hasAny(lowerName, ['execute', 'terminal', 'runcommand', 'run_task', 'runtask', 'runinterminal', 'killterminal', 'getterminaloutput', 'gettaskoutput'])) return 'execute';
  if (hasAny(lowerName, ['find', 'search', 'workspacesymbol', 'githubtextsearch', 'testfile', 'error'])) return 'search';
  if (hasAny(lowerName, ['todo', 'taskplanning'])) return 'todo';
  if (hasAny(lowerName, ['vscode', 'extension', 'memory', 'session', 'resolve'])) return 'vscode';
  if (hasAny(lowerName, ['read', 'environment', 'details', 'listdirectory', 'projectstructure', 'changedfile', 'notebooksummary', 'viewimage'])) return 'read';
  return undefined;
}

function extensionGroupForTool(tool: ConcreteToolOption): { id: string; label: string; optionLabel: string; value: string; aliases?: string[] } {
  if (tool.value.startsWith('mcp_')) {
    const parts = tool.value.slice(4).split('_').filter(Boolean);
    const serverIndex = parts.indexOf('server');
    const groupParts = serverIndex > 0 ? parts.slice(0, serverIndex + 1) : parts.slice(0, Math.max(1, parts.length - 1));
    const optionParts = parts.slice(groupParts.length);
    const id = `mcp:${groupParts.join('_')}`;
    return { id, label: formatVendorLabel(groupParts.join(' ')), optionLabel: optionParts.length ? optionParts.join(' ') : tool.value, value: tool.value };
  }

  const parts = tool.value.split('_').filter(Boolean);
  if (parts.length > 1) {
    const [vendor, ...rest] = parts;
    const optionLabel = rest.join('_');
    if (vendor.toLowerCase() !== 'agentflow') {
      return { id: `extension:${vendor.toLowerCase()}`, label: formatVendorLabel(vendor), optionLabel, value: tool.value };
    }
    return {
      id: `extension:${vendor.toLowerCase()}`,
      label: formatVendorLabel(vendor),
      optionLabel,
      value: `${vendor}/${optionLabel}`,
      aliases: [tool.value]
    };
  }

  return { id: 'extension:tools', label: 'Extension Tools', optionLabel: tool.value, value: tool.value };
}

function flattenToolOption(option: ToolOption): string[] {
  return [option.value, ...(option.aliases ?? []), ...(option.children?.flatMap(flattenToolOption) ?? [])];
}

function toolOptionHasSelectedDescendant(option: ToolOption, selectedSet: ReadonlySet<string>): boolean {
  return toolOptionSelected(option, selectedSet) || Boolean(option.children?.some((child) => toolOptionHasSelectedDescendant(child, selectedSet)));
}

function toolOptionSelected(option: ToolOption, selectedSet: ReadonlySet<string>): boolean {
  return selectedSet.has(option.value) || Boolean(option.aliases?.some((alias) => selectedSet.has(alias)));
}

function toolAliasMap(groups: readonly ToolOptionGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const option of group.options) addAliases(option, map);
  }
  return map;
}

function addAliases(option: ToolOption, map: Map<string, string>): void {
  for (const alias of option.aliases ?? []) map.set(alias, option.value);
  for (const child of option.children ?? []) addAliases(child, map);
}

function sortToolOptions(options: readonly ToolOption[]): ToolOption[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label));
}

function dedupeToolOptions(options: readonly ToolOption[]): ToolOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function formatVendorLabel(value: string): string {
  const lower = value.toLowerCase();
  if (lower === 'dbcode') return 'DBCode';
  if (lower === 'gitkraken') return 'GitKraken';
  return value.split(/[\s_-]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function formatToolLabel(value: string): string {
  return stripInternalToolPrefix(value);
}

function stripInternalToolPrefix(value: string): string {
  return internalToolPrefixes.reduce((current, prefix) => current.startsWith(prefix) ? current.slice(prefix.length) : current, value);
}

function hasAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
