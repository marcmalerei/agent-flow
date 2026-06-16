import type { VisibleFlowEdge } from './graph';

type EdgeVisualInput = Pick<VisibleFlowEdge, 'data' | 'label'>;

export interface EdgeLabelVisibilityState {
  active: boolean;
  selected: boolean;
}

export function activeEdgeClass(edge: Pick<VisibleFlowEdge, 'data' | 'label'>): string {
  if (edge.data.kind === 'handoff' || edge.data.derivedFrom.includes('handoff')) return 'active-handoff';
  const label = (edge.label ?? '').toLowerCase();
  if (label.includes('read')) return 'active-read';
  if (label.includes('write') || label.includes('append')) return 'active-write';
  if (edge.data.artifact) return 'active-artifact';
  if (edge.data.kind === 'error') return 'active-error';
  return 'active-flow';
}

export function edgeLabelVisibilityClass(edge: EdgeVisualInput, state: EdgeLabelVisibilityState): 'edge-label-interactive' | 'edge-label-subtle' | 'edge-label-visible' {
  if (state.active || state.selected) return 'edge-label-visible';
  if (isSupportEdge(edge)) return 'edge-label-interactive';
  return 'edge-label-subtle';
}

export function isSupportEdge(edge: Pick<VisibleFlowEdge, 'data'>): boolean {
  return edge.data.derivedFrom.includes('artifact')
    || edge.data.derivedFrom.includes('instruction')
    || edge.data.derivedFrom.includes('role')
    || edge.data.derivedFrom.includes('skill')
    || edge.data.kind === 'reference';
}

export function edgeTooltip(edge: Pick<VisibleFlowEdge, 'source' | 'target' | 'label' | 'data'>, sourceLabel?: string, targetLabel?: string): string {
  const label = edge.label ? ` · ${edge.label}` : '';
  const origin = sourceLabel ?? edge.source;
  const target = targetLabel ?? edge.target;
  return `${origin} -> ${target}${label} · ${edgeProvenance(edge, origin, target)}`;
}

function edgeProvenance(edge: Pick<VisibleFlowEdge, 'label' | 'data'>, sourceLabel: string, targetLabel: string): string {
  const source = `Source: ${edge.data.derivedFrom}.`;
  const artifact = edge.data.artifact ? ` Artifact: ${edge.data.artifact}.` : '';
  if (edge.data.derivedFrom === 'agent.outputs') return `Why this edge exists: ${sourceLabel} declares ${edge.data.artifact ?? targetLabel} as an output artifact. ${source}${artifact}`;
  if (edge.data.derivedFrom === 'agent.inputs') return `Why this edge exists: ${sourceLabel} reads ${edge.data.artifact ?? targetLabel} as an input artifact. ${source}${artifact}`;
  if (edge.data.derivedFrom.includes('artifactUsages') || edge.data.derivedFrom.includes('requiredArtifacts')) {
    const action = edge.label ? `${edge.label} ` : 'references ';
    return `Why this edge exists: ${sourceLabel} ${action}${edge.data.artifact ?? targetLabel}. ${source}${artifact}`;
  }
  if (edge.data.derivedFrom === 'handoff.targetAgent' || edge.data.derivedFrom === 'agent.handoffs') return `Why this edge exists: ${sourceLabel} targets ${targetLabel}. ${source}`;
  if (edge.data.derivedFrom === 'agent.calls') return `Why this edge exists: ${sourceLabel} calls ${targetLabel}. ${source}`;
  if (edge.data.derivedFrom === 'prompt.startAgent') return `Why this edge exists: ${sourceLabel} starts ${targetLabel}. ${source}`;
  if (edge.data.derivedFrom.includes('instructionRefs')) return `Why this edge exists: ${sourceLabel} provides instructions for ${targetLabel}. ${source}`;
  if (edge.data.derivedFrom.includes('roleRefs')) return `Why this edge exists: ${sourceLabel} provides role context for ${targetLabel}. ${source}`;
  if (edge.data.derivedFrom.includes('gate.')) return `Why this edge exists: ${sourceLabel} routes to ${targetLabel} through the ${edge.label ?? edge.data.kind} branch. ${source}`;
  if (edge.data.derivedFrom === 'agent.hooks') return `Why this edge exists: ${sourceLabel} uses ${targetLabel} as a hook. ${source}`;
  if (edge.data.derivedFrom === 'agent.mcpServers') return `Why this edge exists: ${sourceLabel} uses ${targetLabel} as an MCP server. ${source}`;
  if (edge.data.derivedFrom === 'pipeline.edges') return `Why this edge exists: this connection is stored directly in the pipeline edge list. ${source}${artifact}`;
  return `Why this edge exists: this relationship was inferred from ${edge.data.derivedFrom}. ${source}${artifact}`;
}
