import { AgentPipeline, PipelineNode } from '../types';

function nodeShape(node: PipelineNode): string {
  const label = node.label.replace(/[\[\]{}|]/g, '');
  if (node.type === 'gate') return `${node.id}{${label}}`;
  if (node.type === 'artifact') return `${node.id}[/${label}/]`;
  return `${node.id}[${label}]`;
}

export function generateMermaid(pipeline: AgentPipeline): string {
  const lines = ['flowchart TD'];
  for (const node of [...pipeline.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`    ${nodeShape(node)}`);
  }
  for (const edge of [...pipeline.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const label = edge.label ?? edge.artifact;
    lines.push(label ? `    ${edge.from} -- "${label.replace(/"/g, '\\"')}" --> ${edge.to}` : `    ${edge.from} --> ${edge.to}`);
  }
  return `${lines.join('\n')}\n`;
}
