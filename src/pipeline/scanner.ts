import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentPipeline, PipelineEdge, PipelineNode, PIPELINE_VERSION } from './types';
import { parsePipelineJson } from './parser';
import { normalizeAgentCalls, normalizePipelineAgentReferences, stripYamlQuotes } from './referenceResolver';

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

function frontmatter(source: string): Record<string, string | string[]> {
  if (!source.startsWith('---')) return {};
  const end = source.indexOf('\n---', 3);
  if (end < 0) return {};
  const data: Record<string, string | string[]> = {};
  let current: string | undefined;
  for (const line of source.slice(3, end).split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (key) { current = key[1]; data[current] = key[2] ? stripYamlQuotes(key[2]) : []; continue; }
    const item = line.match(/^\s*-\s+(.+)$/);
    if (item && current) data[current] = [...(Array.isArray(data[current]) ? data[current] as string[] : []), stripYamlQuotes(item[1])];
  }
  return data;
}

export async function loadOrInferPipeline(workspace: string): Promise<AgentPipeline> {
  const pipelineFile = path.join(workspace, '.agent-pipeline/pipeline.json');
  if (await exists(pipelineFile)) return normalizePipelineAgentReferences(parsePipelineJson(await fs.readFile(pipelineFile, 'utf8')));
  return inferPipelineFromWorkspace(workspace);
}

export async function inferPipelineFromWorkspace(workspace: string): Promise<AgentPipeline> {
  const nodes: PipelineNode[] = [];
  const edges: PipelineEdge[] = [];
  let x = 80;
  const addPosition = () => { const pos = { x, y: 160 + (nodes.length % 4) * 120 }; x += nodes.length % 4 === 3 ? 180 : 0; return pos; };

  const agentFiles = await findFiles(path.join(workspace, '.github/agents'), (file) => file.endsWith('.agent.md'));
  const pendingAgentCalls: Array<{ id: string; calls: string[] }> = [];
  for (const file of agentFiles.sort()) {
    const content = await fs.readFile(file, 'utf8');
    const fm = frontmatter(content);
    const id = path.basename(file, '.agent.md');
    const calls = Array.isArray(fm.agents) ? fm.agents : [];
    nodes.push({ id, type: 'agent', label: typeof fm.name === 'string' && fm.name ? fm.name : titleFromId(id), agentFile: rel(workspace, file), description: typeof fm.description === 'string' ? fm.description : undefined, tools: Array.isArray(fm.tools) ? fm.tools : [], calls: [], outputs: [], inputs: [], position: addPosition() });
    pendingAgentCalls.push({ id, calls });
  }
  for (const pending of pendingAgentCalls) {
    const normalizedCalls = normalizeAgentCalls(pending.calls, nodes);
    const node = nodes.find((item) => item.id === pending.id);
    if (node?.type === 'agent') node.calls = normalizedCalls;
    for (const call of normalizedCalls) edges.push({ id: `${pending.id}-calls-${call}`, from: pending.id, to: call, kind: 'flow' });
  }

  const promptFiles = await findFiles(path.join(workspace, '.github/prompts'), (file) => file.endsWith('.prompt.md'));
  for (const file of promptFiles.sort()) {
    const id = path.basename(file, '.prompt.md');
    const content = await fs.readFile(file, 'utf8');
    const fm = frontmatter(content);
    const startAgent = content.match(/Start with `([^`]+)`/)?.[1];
    nodes.push({ id, type: 'prompt', label: titleFromId(id), promptFile: rel(workspace, file), description: typeof fm.description === 'string' ? fm.description : undefined, startAgent, position: addPosition() });
    if (startAgent) edges.push({ id: `${id}-starts-${startAgent}`, from: id, to: startAgent, kind: 'prompt' });
  }

  const instructionFiles = await findFiles(path.join(workspace, '.github/instructions'), (file) => file.endsWith('.instructions.md'));
  for (const file of instructionFiles.sort()) {
    const id = path.basename(file, '.instructions.md');
    const fm = frontmatter(await fs.readFile(file, 'utf8'));
    nodes.push({ id, type: 'instruction', label: titleFromId(id), instructionFile: rel(workspace, file), applyTo: typeof fm.applyTo === 'string' ? stripYamlQuotes(fm.applyTo) : '**/*', description: typeof fm.description === 'string' ? stripYamlQuotes(fm.description) : undefined, position: addPosition() });
  }

  const skillFiles = await findFiles(path.join(workspace, '.github/skills'), (file) => path.basename(file) === 'SKILL.md');
  for (const file of skillFiles.sort()) {
    const id = path.basename(path.dirname(file));
    const content = await fs.readFile(file, 'utf8');
    nodes.push({ id, type: 'skill', label: titleFromId(id), skillFile: rel(workspace, file), description: content.match(/## Description\s+([\s\S]*?)(\n##|$)/)?.[1]?.trim(), position: addPosition() });
  }

  const outputFiles = await findFiles(path.join(workspace, '.agent-output'), (file) => file.endsWith('.md') || file.endsWith('.json') || file.endsWith('.txt'));
  for (const file of outputFiles.sort()) {
    const id = rel(workspace, file).replace(/[^A-Za-z0-9_-]/g, '-');
    nodes.push({ id, type: 'artifact', label: rel(workspace, file), path: rel(workspace, file), position: addPosition() });
  }

  const pipeline: AgentPipeline = { version: PIPELINE_VERSION, name: 'Inferred Agent Pipeline', nodes, edges };
  return normalizePipelineAgentReferences(pipeline);
}

export async function countCopilotInstructionLines(workspace: string): Promise<number> {
  const content = await readIfExists(path.join(workspace, '.github/copilot-instructions.md'));
  return content ? content.split(/\r?\n/).length : 0;
}
