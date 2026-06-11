import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentHandoff, AgentHookCommand, AgentHooks, AgentPipeline, ArtifactAction, ArtifactUsage, McpServerConfig, PipelineEdge, PipelineNode, ReferenceInstruction, PIPELINE_VERSION } from './types';
import { parsePipelineJson } from './parser';
import { normalizeAgentCalls, normalizePipelineAgentReferences, stripYamlQuotes } from './referenceResolver';
import { agentFilePath } from './generators/agentGenerator';
import { promptFilePath } from './generators/promptGenerator';
import { instructionFilePath } from './generators/instructionGenerator';
import { skillFilePath } from './generators/skillGenerator';
import { GENERATED_MARKER } from './generators/shared';

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

async function readIfExists(file: string): Promise<string | undefined> {
  try { return await fs.readFile(file, 'utf8'); } catch { return undefined; }
}

async function findFiles(dir: string, predicate: (file: string) => boolean): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await findFiles(full, predicate));
      else if (predicate(full)) files.push(full);
    }
    return files;
  } catch { return []; }
}

function rel(workspace: string, file: string): string {
  return path.relative(workspace, file).replace(/\\/g, '/');
}

function titleFromId(id: string): string {
  return id.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

type FrontmatterScalar = string | boolean;
type FrontmatterValue = FrontmatterScalar | string[] | AgentHandoff[] | AgentHooks | McpServerConfig[];

function frontmatter(source: string): Record<string, FrontmatterValue> {
  let content = source.trimStart();
  if (content.startsWith(GENERATED_MARKER)) content = content.slice(GENERATED_MARKER.length).replace(/^(?:\r?\n)+/, '');
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end < 0) return {};
  return parseFrontmatterBlock(content.slice(3, end).split(/\r?\n/));
}

function parseFrontmatterBlock(lines: string[]): Record<string, FrontmatterValue> {
  const data: Record<string, FrontmatterValue> = {};
  for (let index = 0; index < lines.length;) {
    const key = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!key) { index += 1; continue; }
    const name = key[1];
    const rest = key[2];
    if (rest.trim()) { data[name] = parseYamlScalar(rest); index += 1; continue; }
    const child: string[] = [];
    index += 1;
    while (index < lines.length && /^\s+/.test(lines[index])) child.push(lines[index++]);
    data[name] = parseYamlCollection(name, child);
  }
  return data;
}

function parseYamlCollection(name: string, lines: string[]): FrontmatterValue {
  if (name === 'hooks') return parseHooks(lines);
  if (name === 'handoffs') return parseObjectList(lines) as unknown as AgentHandoff[];
  if (name === 'mcp-servers') return parseObjectList(lines) as McpServerConfig[];
  return lines.map((line) => line.match(/^\s*-\s+(.+)$/)?.[1]).filter((item): item is string => Boolean(item)).map(stripYamlQuotes);
}

function parseObjectList(lines: string[]): Array<Record<string, string | boolean>> {
  const items: Array<Record<string, string | boolean>> = [];
  let current: Record<string, string | boolean> | undefined;
  for (const line of lines) {
    const first = line.match(/^\s*-\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (first) {
      current = { [first[1]]: parseYamlScalar(first[2]) };
      items.push(current);
      continue;
    }
    const field = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field && current) current[field[1]] = parseYamlScalar(field[2]);
  }
  return items;
}

function parseHooks(lines: string[]): AgentHooks {
  const hooks: AgentHooks = {};
  let trigger: string | undefined;
  let current: AgentHookCommand | undefined;
  for (const line of lines) {
    const triggerMatch = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*$/);
    if (triggerMatch) { trigger = triggerMatch[1]; hooks[trigger] = []; current = undefined; continue; }
    const first = line.match(/^\s*-\s+([A-Za-z0-9_-]+):\s*(.*)$/) ?? line.match(/^\s{4}-\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (first && trigger) {
      current = { [first[1]]: parseYamlScalar(first[2]) } as AgentHookCommand;
      hooks[trigger].push(current);
      continue;
    }
    const field = line.match(/^\s{6}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field && current) current[field[1]] = parseYamlScalar(field[2]);
  }
  return hooks;
}

function parseYamlScalar(value: string): string | boolean {
  const stripped = stripYamlQuotes(value.trim());
  if (stripped === 'true') return true;
  if (stripped === 'false') return false;
  return stripped;
}


function customizationKind(filePath: string): 'agent' | 'prompt' | 'instruction' | 'skill' | undefined {
  if (filePath.endsWith('.agent.md')) return 'agent';
  if (filePath.endsWith('.prompt.md')) return 'prompt';
  if (filePath.endsWith('.instructions.md')) return 'instruction';
  if (/^\.github\/skills\/[^/]+\/SKILL\.md$/i.test(filePath)) return 'skill';
  return undefined;
}

function isArtifactPath(filePath: string): boolean {
  return customizationKind(filePath) === undefined;
}

function customizationNodeId(filePath: string): string {
  if (filePath.endsWith('.agent.md')) return path.basename(filePath, '.agent.md');
  if (filePath.endsWith('.prompt.md')) return path.basename(filePath, '.prompt.md');
  if (filePath.endsWith('.instructions.md')) return path.basename(filePath, '.instructions.md');
  if (/^\.github\/skills\/[^/]+\/SKILL\.md$/i.test(filePath)) return path.basename(path.dirname(filePath));
  return filePath.replace(/[^A-Za-z0-9_-]/g, '-');
}

function parseCustomizationRefs(source: string): Array<{ path: string; kind: 'agent' | 'prompt' | 'instruction' | 'skill' }> {
  const refs: Array<{ path: string; kind: 'agent' | 'prompt' | 'instruction' | 'skill' }> = [];
  const pattern = /`([^`]+(?:\.(?:agent|prompt|instructions)\.md|\/SKILL\.md))`/gi;
  for (const match of source.matchAll(pattern)) {
    const kind = customizationKind(match[1]);
    if (kind) refs.push({ path: match[1], kind });
  }
  return [...new Map(refs.map((ref) => [`${ref.kind}:${ref.path}`, ref])).values()];
}

function frontmatterHandoffs(value: FrontmatterValue | undefined): AgentHandoff[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const handoffs = value.filter((item): item is AgentHandoff => typeof item === 'object' && item !== null && !Array.isArray(item) && typeof item.label === 'string' && typeof item.agent === 'string');
  return handoffs.length ? handoffs : undefined;
}

function parseArtifactUsages(source: string, heading: 'Artifact work' | 'Required artifacts'): ArtifactUsage[] | undefined {
  const section = markdownSection(source, heading);
  const scoped = section ? parseArtifactUsageLines(section) : undefined;
  return mergeArtifactUsages(scoped, parseMarkdownFileUsages(source));
}

function parseArtifactUsageLines(source: string): ArtifactUsage[] | undefined {
  const usages = source.split(/\r?\n/).map((line): ArtifactUsage | undefined => {
    const match = line.match(/^\s*-\s+(Read|Write|Append to|Validate)\s+`([^`]+)`(?::\s*(.+)|\.)?\s*$/i);
    if (!match) return undefined;
    if (!isArtifactPath(match[2])) return undefined;
    const usage: ArtifactUsage = {
      path: match[2],
      action: artifactAction(match[1])
    };
    if (match[3]?.trim()) usage.instruction = match[3].trim();
    return usage;
  }).filter((usage): usage is ArtifactUsage => Boolean(usage));
  return usages.length ? usages : undefined;
}

function parseMarkdownFileUsages(source: string): ArtifactUsage[] | undefined {
  const usages: ArtifactUsage[] = [];
  const pattern = /\b(Read|Write|Append to|Validate)\s+`([^`]+)`(?::\s*([^\n]+))?/gi;
  for (const match of source.matchAll(pattern)) {
    if (!isArtifactPath(match[2])) continue;
    usages.push({ path: match[2], action: artifactAction(match[1]), instruction: match[3]?.trim().replace(/\.$/, '') || undefined });
  }
  return usages.length ? usages : undefined;
}

function mergeArtifactUsages(...groups: Array<ArtifactUsage[] | undefined>): ArtifactUsage[] | undefined {
  const byKey = new Map<string, ArtifactUsage>();
  for (const usage of groups.flatMap((group) => group ?? [])) {
    const key = `${usage.action}:${usage.path}`;
    byKey.set(key, { ...usage, instruction: byKey.get(key)?.instruction ?? usage.instruction });
  }
  return byKey.size ? [...byKey.values()] : undefined;
}

function parsePromptStartAgent(fm: Record<string, FrontmatterValue>, source: string): string | undefined {
  return typeof fm.agent === 'string' ? stripYamlQuotes(fm.agent) : source.match(/Start with `([^`]+)`/)?.[1];
}

function parseInstructionRefs(source: string): ReferenceInstruction[] | undefined {
  const section = markdownSection(source, 'Referenced instructions');
  const sectionRefs = section?.split(/\r?\n/).map((line): ReferenceInstruction | undefined => {
    const match = line.match(/^\s*-\s+Follow\s+`([^`]+)`(?::\s*(.+)|\.)?\s*$/i);
    if (!match) return undefined;
    const ref: ReferenceInstruction = { target: match[1] };
    if (match[2]?.trim()) ref.instruction = match[2].trim();
    return ref;
  }).filter((ref): ref is ReferenceInstruction => Boolean(ref));
  return mergeInstructionRefs(sectionRefs, parseMarkdownInstructionRefs(source));
}

function parseMarkdownInstructionRefs(source: string): ReferenceInstruction[] | undefined {
  const refs: ReferenceInstruction[] = [];
  const pattern = /`([^`]*\.github\/instructions\/[^`]+\.instructions\.md)`/gi;
  for (const match of source.matchAll(pattern)) refs.push({ target: match[1] });
  return refs.length ? refs : undefined;
}

function mergeInstructionRefs(...groups: Array<ReferenceInstruction[] | undefined>): ReferenceInstruction[] | undefined {
  const byTarget = new Map<string, ReferenceInstruction>();
  for (const ref of groups.flatMap((group) => group ?? [])) {
    byTarget.set(ref.target, { ...ref, instruction: byTarget.get(ref.target)?.instruction ?? ref.instruction });
  }
  return byTarget.size ? [...byTarget.values()] : undefined;
}

function markdownSection(source: string, heading: string): string | undefined {
  const content = stripGeneratedMarker(source);
  const pattern = new RegExp(`^# ${escapeRegExp(heading)}\\s*$`, 'm');
  const match = pattern.exec(content);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const rest = content.slice(start).replace(/^(?:\r?\n)+/, '');
  return rest.split(/\r?\n# /)[0]?.trim();
}

function stripGeneratedMarker(source: string): string {
  let content = source.trimStart();
  if (content.startsWith(GENERATED_MARKER)) content = content.slice(GENERATED_MARKER.length).replace(/^(?:\r?\n)+/, '');
  if (content.trimEnd().endsWith(GENERATED_MARKER)) content = content.trimEnd().slice(0, -GENERATED_MARKER.length).replace(/(?:\r?\n)+$/, '');
  return content;
}

function artifactAction(value: string): ArtifactAction {
  const normalized = value.toLowerCase();
  if (normalized === 'append to') return 'append';
  if (normalized === 'read' || normalized === 'write' || normalized === 'validate') return normalized;
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function loadOrInferPipeline(workspace: string): Promise<AgentPipeline> {
  const pipelineFile = path.join(workspace, '.agent-pipeline/pipeline.json');
  if (await exists(pipelineFile)) {
    return hydrateMarkdownContent(workspace, normalizePipelineAgentReferences(parsePipelineJson(await fs.readFile(pipelineFile, 'utf8'))));
  }
  return inferPipelineFromWorkspace(workspace);
}

async function hydrateMarkdownContent(workspace: string, pipeline: AgentPipeline): Promise<AgentPipeline> {
  const nodes = await Promise.all(pipeline.nodes.map(async (node) => {
    const markdownPath = markdownFileForNode(node);
    if (!markdownPath) return node;
    const markdown = await readIfExists(path.join(workspace, markdownPath));
    return markdown === undefined ? node : applyMarkdownToNode(node, markdown);
  }));
  const edges = [...pipeline.edges];
  addReferencedCustomizationNodes(nodes, edges, () => nextHydratedPosition(nodes));
  addReferencedArtifactNodes(nodes, () => nextHydratedPosition(nodes));
  addAgentConfigurationNodes(nodes, edges, () => nextHydratedPosition(nodes));
  return normalizePipelineAgentReferences({ ...pipeline, nodes, edges });
}

function applyMarkdownToNode(node: PipelineNode, markdown: string): PipelineNode {
  const fm = frontmatter(markdown);
  if (node.type === 'agent') {
    const artifactUsages = parseArtifactUsages(markdown, 'Artifact work');
    return {
      ...node,
      label: typeof fm.name === 'string' && fm.name ? fm.name : node.label,
      description: typeof fm.description === 'string' ? fm.description : node.description,
      argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : node.argumentHint,
      model: typeof fm.model === 'string' || Array.isArray(fm.model) ? fm.model as string | string[] : node.model,
      target: typeof fm.target === 'string' ? fm.target : node.target,
      userInvocable: typeof fm['user-invocable'] === 'boolean' ? fm['user-invocable'] : node.userInvocable,
      disableModelInvocation: typeof fm['disable-model-invocation'] === 'boolean' ? fm['disable-model-invocation'] : node.disableModelInvocation,
      hooks: isHooks(fm.hooks) ? fm.hooks : node.hooks,
      mcpServers: Array.isArray(fm['mcp-servers']) ? fm['mcp-servers'] as McpServerConfig[] : node.mcpServers,
      tools: Array.isArray(fm.tools) ? fm.tools as string[] : node.tools,
      calls: Array.isArray(fm.agents) ? fm.agents as string[] : node.calls,
      handoffs: frontmatterHandoffs(fm.handoffs) ?? node.handoffs,
      outputs: artifactUsages?.filter((usage) => usage.action === 'write' || usage.action === 'append').map((usage) => usage.path) ?? node.outputs,
      inputs: artifactUsages?.filter((usage) => usage.action === 'read' || usage.action === 'validate').map((usage) => usage.path) ?? node.inputs,
      artifactUsages: artifactUsages ?? node.artifactUsages,
      instructionRefs: parseInstructionRefs(markdown) ?? node.instructionRefs,
      markdown
    };
  }
  if (node.type === 'prompt') {
    const artifactUsages = parseArtifactUsages(markdown, 'Required artifacts');
    return {
      ...node,
      label: typeof fm.name === 'string' ? fm.name : node.label,
      description: typeof fm.description === 'string' ? fm.description : node.description,
      argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : node.argumentHint,
      model: typeof fm.model === 'string' || Array.isArray(fm.model) ? fm.model as string | string[] : node.model,
      startAgent: parsePromptStartAgent(fm, markdown) ?? node.startAgent,
      requiredArtifacts: artifactUsages?.map((usage) => usage.path) ?? node.requiredArtifacts,
      artifactUsages: artifactUsages ?? node.artifactUsages,
      instructionRefs: parseInstructionRefs(markdown) ?? node.instructionRefs,
      markdown
    };
  }
  if (node.type === 'instruction') {
    return {
      ...node,
      label: typeof fm.name === 'string' ? fm.name : node.label,
      description: typeof fm.description === 'string' ? stripYamlQuotes(fm.description) : node.description,
      applyTo: typeof fm.applyTo === 'string' ? stripYamlQuotes(fm.applyTo) : node.applyTo,
      excludeAgent: typeof fm.excludeAgent === 'string' ? stripYamlQuotes(fm.excludeAgent) : node.excludeAgent,
      instructionRefs: parseInstructionRefs(markdown) ?? node.instructionRefs,
      markdown
    };
  }
  if (node.type === 'skill') {
    return {
      ...node,
      label: typeof fm.name === 'string' ? fm.name : node.label,
      description: typeof fm.description === 'string' ? fm.description : markdown.match(/## Description\s+([\s\S]*?)(\n##|$)/)?.[1]?.trim() ?? node.description,
      argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : node.argumentHint,
      userInvocable: typeof fm['user-invocable'] === 'boolean' ? fm['user-invocable'] : node.userInvocable,
      disableModelInvocation: typeof fm['disable-model-invocation'] === 'boolean' ? fm['disable-model-invocation'] : node.disableModelInvocation,
      context: typeof fm.context === 'string' ? fm.context : node.context,
      markdown
    };
  }
  return { ...node, markdown };
}

function nextHydratedPosition(nodes: PipelineNode[]): { x: number; y: number } {
  const index = nodes.length;
  return { x: 80 + Math.floor(index / 4) * 180, y: 160 + (index % 4) * 120 };
}

function markdownFileForNode(node: PipelineNode): string | undefined {
  if (node.type === 'agent') return agentFilePath(node);
  if (node.type === 'prompt') return promptFilePath(node);
  if (node.type === 'instruction') return instructionFilePath(node);
  if (node.type === 'skill') return skillFilePath(node);
  return undefined;
}

export async function inferPipelineFromWorkspace(workspace: string): Promise<AgentPipeline> {
  const nodes: PipelineNode[] = [];
  const edges: PipelineEdge[] = [];
  let x = 80;
  const addPosition = () => { const pos = { x, y: 160 + (nodes.length % 4) * 120 }; x += nodes.length % 4 === 3 ? 180 : 0; return pos; };

  const agentFiles = await findFiles(path.join(workspace, '.github/agents'), (file) => file.endsWith('.agent.md'));
  const pendingAgentCalls: Array<{ id: string; calls: string[]; handoffs: AgentHandoff[] }> = [];
  for (const file of agentFiles.sort()) {
    const content = await fs.readFile(file, 'utf8');
    const fm = frontmatter(content);
    const id = path.basename(file, '.agent.md');
    const calls = Array.isArray(fm.agents) ? fm.agents : [];
    const handoffs = frontmatterHandoffs(fm.handoffs) ?? [];
    const artifactUsages = parseArtifactUsages(content, 'Artifact work');
    const instructionRefs = parseInstructionRefs(content);
    nodes.push({ id, type: 'agent', label: typeof fm.name === 'string' && fm.name ? fm.name : titleFromId(id), agentFile: rel(workspace, file), description: typeof fm.description === 'string' ? fm.description : undefined, argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : undefined, model: typeof fm.model === 'string' || Array.isArray(fm.model) ? fm.model as string | string[] : undefined, target: typeof fm.target === 'string' ? fm.target : undefined, userInvocable: typeof fm['user-invocable'] === 'boolean' ? fm['user-invocable'] : undefined, disableModelInvocation: typeof fm['disable-model-invocation'] === 'boolean' ? fm['disable-model-invocation'] : undefined, hooks: isHooks(fm.hooks) ? fm.hooks : undefined, mcpServers: Array.isArray(fm['mcp-servers']) ? fm['mcp-servers'] as McpServerConfig[] : undefined, markdown: content, tools: Array.isArray(fm.tools) ? fm.tools as string[] : [], calls: [], handoffs, outputs: artifactUsages?.filter((usage) => usage.action === 'write' || usage.action === 'append').map((usage) => usage.path) ?? [], inputs: artifactUsages?.filter((usage) => usage.action === 'read' || usage.action === 'validate').map((usage) => usage.path) ?? [], artifactUsages, instructionRefs, position: addPosition() });
    pendingAgentCalls.push({ id, calls: calls as string[], handoffs });
  }
  for (const pending of pendingAgentCalls) {
    const normalizedCalls = normalizeAgentCalls(pending.calls, nodes);
    const node = nodes.find((item) => item.id === pending.id);
    if (node?.type === 'agent') node.calls = normalizedCalls;
    for (const call of normalizedCalls) edges.push({ id: `${pending.id}-calls-${call}`, from: pending.id, to: call, kind: 'flow' });
    for (const handoff of pending.handoffs) {
      const target = normalizeAgentCalls([handoff.agent], nodes)[0];
      if (target) edges.push({ id: `${pending.id}-handoff-${target}-${slugPart(handoff.label)}`, from: pending.id, to: target, kind: 'handoff', label: handoff.label });
    }
  }

  const promptFiles = await findFiles(path.join(workspace, '.github/prompts'), (file) => file.endsWith('.prompt.md'));
  for (const file of promptFiles.sort()) {
    const id = path.basename(file, '.prompt.md');
    const content = await fs.readFile(file, 'utf8');
    const fm = frontmatter(content);
    const startAgent = parsePromptStartAgent(fm, content);
    const normalizedStartAgent = startAgent ? normalizeAgentCalls([startAgent], nodes)[0] : undefined;
    const artifactUsages = parseArtifactUsages(content, 'Required artifacts');
    const instructionRefs = parseInstructionRefs(content);
    nodes.push({ id, type: 'prompt', label: typeof fm.name === 'string' ? fm.name : titleFromId(id), promptFile: rel(workspace, file), description: typeof fm.description === 'string' ? fm.description : undefined, argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : undefined, model: typeof fm.model === 'string' || Array.isArray(fm.model) ? fm.model as string | string[] : undefined, markdown: content, startAgent: normalizedStartAgent, requiredArtifacts: artifactUsages?.map((usage) => usage.path), artifactUsages, instructionRefs, position: addPosition() });
    if (normalizedStartAgent) edges.push({ id: `${id}-starts-${normalizedStartAgent}`, from: id, to: normalizedStartAgent, kind: 'prompt' });
  }

  const instructionFiles = await findFiles(path.join(workspace, '.github/instructions'), (file) => file.endsWith('.instructions.md'));
  for (const file of instructionFiles.sort()) {
    const id = path.basename(file, '.instructions.md');
    const content = await fs.readFile(file, 'utf8');
    const fm = frontmatter(content);
    const instructionRefs = parseInstructionRefs(content);
    nodes.push({ id, type: 'instruction', label: titleFromId(id), instructionFile: rel(workspace, file), applyTo: typeof fm.applyTo === 'string' ? stripYamlQuotes(fm.applyTo) : '**/*', description: typeof fm.description === 'string' ? stripYamlQuotes(fm.description) : undefined, instructionRefs, markdown: content, position: addPosition() });
  }

  const skillFiles = await findFiles(path.join(workspace, '.github/skills'), (file) => path.basename(file) === 'SKILL.md');
  for (const file of skillFiles.sort()) {
    const id = path.basename(path.dirname(file));
    const content = await fs.readFile(file, 'utf8');
    const fm = frontmatter(content);
    nodes.push({ id, type: 'skill', label: typeof fm.name === 'string' ? fm.name : titleFromId(id), skillFile: rel(workspace, file), description: typeof fm.description === 'string' ? fm.description : content.match(/## Description\s+([\s\S]*?)(\n##|$)/)?.[1]?.trim(), argumentHint: typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : undefined, userInvocable: typeof fm['user-invocable'] === 'boolean' ? fm['user-invocable'] : undefined, disableModelInvocation: typeof fm['disable-model-invocation'] === 'boolean' ? fm['disable-model-invocation'] : undefined, context: typeof fm.context === 'string' ? fm.context : undefined, markdown: content, position: addPosition() });
  }

  const outputFiles = await findFiles(path.join(workspace, '.agent-output'), (file) => isArtifactPath(file) && (file.endsWith('.md') || file.endsWith('.json') || file.endsWith('.txt')));
  for (const file of outputFiles.sort()) {
    const id = rel(workspace, file).replace(/[^A-Za-z0-9_-]/g, '-');
    nodes.push({ id, type: 'artifact', label: rel(workspace, file), path: rel(workspace, file), position: addPosition() });
  }

  addReferencedCustomizationNodes(nodes, edges, addPosition);
  addReferencedArtifactNodes(nodes, addPosition);
  addAgentConfigurationNodes(nodes, edges, addPosition);

  const pipeline: AgentPipeline = { version: PIPELINE_VERSION, name: 'Inferred Agent Pipeline', nodes, edges };
  return normalizePipelineAgentReferences(pipeline);
}


function isHooks(value: FrontmatterValue | undefined): value is AgentHooks {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function addReferencedCustomizationNodes(nodes: PipelineNode[], edges: PipelineEdge[], addPosition: () => { x: number; y: number }): void {
  const nodesByFile = new Map<string, PipelineNode>();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (node.type === 'agent' && node.agentFile) nodesByFile.set(node.agentFile, node);
    if (node.type === 'prompt' && node.promptFile) nodesByFile.set(node.promptFile, node);
    if (node.type === 'instruction' && node.instructionFile) nodesByFile.set(node.instructionFile, node);
  }

  for (const source of [...nodes]) {
    if (!source.markdown) continue;
    for (const ref of parseCustomizationRefs(source.markdown)) {
      let target = nodesByFile.get(ref.path) ?? nodesById.get(customizationNodeId(ref.path));
      if (!target) {
        target = placeholderCustomizationNode(ref, addPosition());
        nodes.push(target);
        nodesById.set(target.id, target);
        nodesByFile.set(ref.path, target);
      }
      if (source.id === target.id) continue;
      if ((source.type === 'agent' || source.type === 'prompt' || source.type === 'instruction') && ref.kind === 'instruction') {
        source.instructionRefs = upsertReferenceInstruction(source.instructionRefs, ref.path);
        continue;
      }
      const edge = customizationReferenceEdge(source, target, ref.kind);
      if (!edges.some((item) => item.from === edge.from && item.to === edge.to)) edges.push(edge);
    }
  }
}

function placeholderCustomizationNode(ref: { path: string; kind: 'agent' | 'prompt' | 'instruction' | 'skill' }, position: { x: number; y: number }): PipelineNode {
  const id = customizationNodeId(ref.path);
  const base = { id, label: titleFromId(id), markdown: '', position };
  if (ref.kind === 'agent') return { ...base, type: 'agent', agentFile: ref.path, tools: [], calls: [], inputs: [], outputs: [] };
  if (ref.kind === 'prompt') return { ...base, type: 'prompt', promptFile: ref.path, tools: [], workflow: [], constraints: [] };
  if (ref.kind === 'skill') return { ...base, type: 'skill', skillFile: ref.path, activationCriteria: [], procedure: [] };
  return { ...base, type: 'instruction', instructionFile: ref.path, applyTo: '**/*', rules: [] };
}

function customizationReferenceEdge(source: PipelineNode, target: PipelineNode, kind: 'agent' | 'prompt' | 'instruction' | 'skill'): PipelineEdge {
  return {
    id: `${source.id}-references-${target.id}`,
    from: source.id,
    to: target.id,
    kind: kind === 'instruction' || kind === 'skill' ? kind : 'flow',
    label: 'references'
  };
}

function upsertReferenceInstruction(refs: ReferenceInstruction[] | undefined, target: string): ReferenceInstruction[] {
  if (refs?.some((ref) => ref.target === target)) return refs;
  return [...(refs ?? []), { target }];
}

function addReferencedArtifactNodes(nodes: PipelineNode[], addPosition: () => { x: number; y: number }): void {
  const existingPaths = new Set(nodes.filter((node): node is Extract<PipelineNode, { type: 'artifact' }> => node.type === 'artifact').map((node) => node.path));
  const referenced = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'agent') [...(node.inputs ?? []), ...(node.outputs ?? []), ...(node.artifactUsages ?? []).map((usage) => usage.path)].forEach((item) => referenced.add(item));
    if (node.type === 'prompt') [...(node.requiredArtifacts ?? []), ...(node.artifactUsages ?? []).map((usage) => usage.path)].forEach((item) => referenced.add(item));
  }
  for (const artifactPath of [...referenced].sort()) {
    if (!isArtifactPath(artifactPath) || existingPaths.has(artifactPath)) continue;
    const id = artifactPath.replace(/[^A-Za-z0-9_-]/g, '-');
    nodes.push({ id, type: 'artifact', label: artifactPath, path: artifactPath, position: addPosition() });
    existingPaths.add(artifactPath);
  }
}

function addAgentConfigurationNodes(nodes: PipelineNode[], edges: PipelineEdge[], addPosition: () => { x: number; y: number }): void {
  const agents = nodes.filter((node): node is Extract<PipelineNode, { type: 'agent' }> => node.type === 'agent');
  for (const agent of agents) {
    for (const handoff of agent.handoffs ?? []) {
      const handoffId = `${agent.id}-handoff-${slugPart(handoff.label)}`;
      if (!nodes.some((node) => node.id === handoffId)) nodes.push({ id: handoffId, type: 'handoff', label: handoff.label, sourceAgent: agent.id, targetAgent: handoff.agent, prompt: handoff.prompt, send: handoff.send, model: handoff.model, position: addPosition() });
      pushEdgeUnique(edges, { id: `${agent.id}-handoff-node-${handoffId}`, from: agent.id, to: handoffId, kind: 'handoff', label: handoff.label });
      const target = normalizeAgentCalls([handoff.agent], nodes)[0];
      if (target) pushEdgeUnique(edges, { id: `${handoffId}-handoff-target-${target}`, from: handoffId, to: target, kind: 'handoff', label: handoff.label });
    }
    for (const [trigger, commands] of Object.entries(agent.hooks ?? {})) {
      commands.forEach((command, index) => {
        const hookId = `${agent.id}-hook-${slugPart(trigger)}-${index + 1}`;
        if (!nodes.some((node) => node.id === hookId)) nodes.push({ id: hookId, type: 'hook', label: `${trigger} hook`, trigger, action: command.command, position: addPosition() });
        pushEdgeUnique(edges, { id: `${agent.id}-hook-${hookId}`, from: agent.id, to: hookId, kind: 'hook', label: trigger });
      });
    }
    for (const server of agent.mcpServers ?? []) {
      const serverId = `${agent.id}-mcp-${slugPart(server.name)}`;
      if (!nodes.some((node) => node.id === serverId)) nodes.push({ id: serverId, type: 'mcp-server', label: server.name, ownerAgent: agent.id, command: server.command, args: server.args, position: addPosition() });
      pushEdgeUnique(edges, { id: `${agent.id}-mcp-${serverId}`, from: agent.id, to: serverId, kind: 'mcp-server', label: server.name });
    }
  }
}


function pushEdgeUnique(edges: PipelineEdge[], edge: PipelineEdge): void {
  if (!edges.some((item) => item.id === edge.id)) edges.push(edge);
}

function slugPart(value: string): string {
  return stripYamlQuotes(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'handoff';
}

export async function countCopilotInstructionLines(workspace: string): Promise<number> {
  const content = await readIfExists(path.join(workspace, '.github/copilot-instructions.md'));
  return content ? content.split(/\r?\n/).length : 0;
}
