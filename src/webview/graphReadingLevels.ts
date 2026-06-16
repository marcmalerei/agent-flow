import type { PipelineNodeType } from '../pipeline/types';

export type GraphReadingLevel = 'overview' | 'data-flow' | 'references' | 'run-activity' | 'selected-path';

export interface GraphReadingLevelOption {
  id: GraphReadingLevel;
  label: string;
  icon: string;
  description: string;
}

type ReadingClass = 'reading-primary' | 'reading-muted' | 'reading-related';

interface ReadingState {
  active: boolean;
  related?: boolean;
  selected: boolean;
}

interface EdgeReadingInput {
  label?: string;
  data: { derivedFrom: string; artifact?: string };
}

export const graphReadingLevels: readonly GraphReadingLevelOption[] = [
  { id: 'overview', label: 'Overview', icon: 'list-tree', description: 'Show the primary prompt, agent, handoff, and gate flow first.' },
  { id: 'data-flow', label: 'Data flow', icon: 'symbol-field', description: 'Emphasize artifact reads and writes.' },
  { id: 'references', label: 'References', icon: 'references', description: 'Emphasize instructions, roles, skills, prompts, hooks, and MCP references.' },
  { id: 'run-activity', label: 'Run activity', icon: 'pulse', description: 'Emphasize live and recent runtime activity.' },
  { id: 'selected-path', label: 'Selected path', icon: 'symbol-interface', description: 'Keep the selected node and its direct neighborhood bright.' }
] as const;

const primaryOverviewTypes = new Set<PipelineNodeType>(['agent', 'prompt', 'handoff', 'gate']);
const dataFlowTypes = new Set<PipelineNodeType>(['agent', 'prompt', 'artifact']);
const referenceTypes = new Set<PipelineNodeType>(['agent', 'prompt', 'instruction', 'role', 'skill', 'hook', 'mcp-server']);

export function graphReadingLevelClassName(level: GraphReadingLevel): string {
  return `reading-level-${level}`;
}

export function nodeReadingLevelClass(type: PipelineNodeType, level: GraphReadingLevel, state: ReadingState): ReadingClass {
  if (level === 'selected-path') return state.selected ? 'reading-primary' : state.related ? 'reading-related' : 'reading-muted';
  if (level === 'run-activity') return state.active || state.selected ? 'reading-primary' : 'reading-muted';
  if (level === 'data-flow') return dataFlowTypes.has(type) || state.selected ? 'reading-primary' : 'reading-muted';
  if (level === 'references') return referenceTypes.has(type) || state.selected ? 'reading-primary' : 'reading-muted';
  return primaryOverviewTypes.has(type) || state.selected ? 'reading-primary' : 'reading-muted';
}

export function edgeReadingLevelClass(edge: EdgeReadingInput, level: GraphReadingLevel, state: ReadingState): string {
  if (level === 'selected-path') return state.selected ? 'reading-primary' : 'reading-muted';
  if (level === 'run-activity') return state.active || state.selected ? 'reading-primary' : 'reading-muted';
  if (level === 'data-flow') {
    if (isWriteEdge(edge)) return 'reading-primary reading-write';
    if (isReadEdge(edge)) return 'reading-primary reading-read';
    if (isArtifactEdge(edge)) return 'reading-primary';
    return 'reading-muted';
  }
  if (level === 'references') return isReferenceContextEdge(edge) ? 'reading-primary' : 'reading-muted';
  return isPrimaryFlowEdge(edge) ? 'reading-primary' : 'reading-muted';
}

function isReadEdge(edge: EdgeReadingInput): boolean {
  return edge.data.derivedFrom.includes('inputs') || edge.label?.toLowerCase().includes('read') === true;
}

function isWriteEdge(edge: EdgeReadingInput): boolean {
  const label = edge.label?.toLowerCase() ?? '';
  return edge.data.derivedFrom.includes('outputs') || label.includes('write') || label.includes('append');
}

function isArtifactEdge(edge: EdgeReadingInput): boolean {
  return Boolean(edge.data.artifact) || edge.data.derivedFrom.includes('artifact') || isReadEdge(edge) || isWriteEdge(edge);
}

function isReferenceContextEdge(edge: EdgeReadingInput): boolean {
  return edge.data.derivedFrom.includes('instruction')
    || edge.data.derivedFrom.includes('role')
    || edge.data.derivedFrom.includes('skill')
    || edge.data.derivedFrom.includes('prompt')
    || edge.data.derivedFrom.includes('hooks')
    || edge.data.derivedFrom.includes('mcpServers');
}

function isPrimaryFlowEdge(edge: EdgeReadingInput): boolean {
  return edge.data.derivedFrom === 'pipeline.edges'
    || edge.data.derivedFrom.includes('handoff')
    || edge.data.derivedFrom.includes('gate.')
    || edge.data.derivedFrom === 'agent.calls'
    || edge.data.derivedFrom === 'prompt.startAgent';
}
