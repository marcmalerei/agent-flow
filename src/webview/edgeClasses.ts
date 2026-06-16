import type { VisibleFlowEdge } from './graph';

export function activeEdgeClass(edge: Pick<VisibleFlowEdge, 'data' | 'label'>): string {
  if (edge.data.kind === 'handoff' || edge.data.derivedFrom.includes('handoff')) return 'active-handoff';
  const label = (edge.label ?? '').toLowerCase();
  if (label.includes('read')) return 'active-read';
  if (label.includes('write') || label.includes('append')) return 'active-write';
  if (edge.data.artifact) return 'active-artifact';
  if (edge.data.kind === 'error') return 'active-error';
  return 'active-flow';
}

export function edgeTooltip(edge: Pick<VisibleFlowEdge, 'source' | 'target' | 'label' | 'data'>, sourceLabel?: string, targetLabel?: string): string {
  const label = edge.label ? ` · ${edge.label}` : '';
  const origin = sourceLabel ?? edge.source;
  const target = targetLabel ?? edge.target;
  return `${origin} -> ${target}${label} · ${edge.data.derivedFrom}`;
}
