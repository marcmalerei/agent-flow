import { PipelineNode, PipelineNodeType } from '../pipeline/types';

export const nodeTypeColors: Record<PipelineNodeType, string> = {
  agent: 'var(--vscode-charts-blue)',
  prompt: 'var(--vscode-charts-purple)',
  instruction: 'var(--vscode-charts-orange)',
  skill: 'var(--vscode-testing-iconPassed, #2ea043)',
  role: 'var(--vscode-charts-cyan, #00b7c3)',
  artifact: 'var(--vscode-charts-green)',
  gate: 'var(--vscode-charts-yellow)',
  hook: 'var(--vscode-charts-red)',
  handoff: 'var(--vscode-editorWarning-foreground, #cca700)',
  'mcp-server': 'var(--vscode-charts-cyan, #00b7c3)'
};

export function graphNodeDisplayLabel(node: PipelineNode): string {
  if (node.type !== 'artifact') return node.label;
  return artifactDisplayPath(node.path);
}

export function graphNodeFullLabel(node: PipelineNode): string {
  if (node.type === 'artifact') return node.path;
  return node.label;
}

export function artifactDisplayPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.github\/artifacts\//, '');
}

export function nodeTypeColor(type: PipelineNodeType | string): string {
  return isPipelineNodeType(type) ? nodeTypeColors[type] : 'var(--vscode-focusBorder)';
}

export function edgeGradientId(edgeId: string): string {
  return `agentflow-edge-gradient-${edgeId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function edgeMarkerColor(target: PipelineNode | undefined): string {
  return target ? nodeTypeColor(target.type) : 'var(--vscode-editor-foreground)';
}

function isPipelineNodeType(value: string): value is PipelineNodeType {
  return value in nodeTypeColors;
}
