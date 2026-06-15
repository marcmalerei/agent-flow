import React from 'react';
import { NodeActivitySummary } from '../activity/types';

export type NodePortPosition = 'left' | 'top' | 'right' | 'bottom';

export interface TokenNodeData {
  label: string;
  type: string;
  tokenBadge: string;
  tokenColor: string;
  activity?: NodeActivitySummary;
  runtimeStatus?: string;
  dirty?: boolean;
  sourcePosition: NodePortPosition;
  targetPosition: NodePortPosition;
}

export function TokenNode({ data }: { data: TokenNodeData }) {
  const tokenBadgeStyle = { '--agentflow-token-color': data.tokenColor } as React.CSSProperties;

  return <div className={`flow-node runtime-${data.runtimeStatus ?? 'clean'}${data.dirty ? ' is-dirty' : ''}${data.activity ? ` has-activity activity-node-${data.activity.phase}` : ''}`} style={tokenBadgeStyle}>
    <span className={`node-port node-port-target node-port-${data.targetPosition}`} aria-hidden="true" />
    <span className="token-badge" title="Estimated token count">{data.tokenBadge}</span>
    {data.activity && <span className={`activity-badge activity-${data.activity.phase}`} title={data.activity.summary}>{activityIcon(data.activity.phase)} {activityLabel(data.activity)}</span>}
    {data.dirty && <span className="runtime-badge" title="Unsaved node changes">stale</span>}
    <span className="flow-node-label" title={data.label}>{data.label}</span>
    <small>{data.type}</small>
    <span className={`node-port node-port-source node-port-${data.sourcePosition}`} aria-hidden="true" />
  </div>;
}

function activityLabel(activity: NodeActivitySummary): string {
  if (activity.phase === 'handoff') return 'handoff';
  if (activity.toolName) return compactToolName(activity.toolName);
  if (activity.artifactPath) return activity.artifactPath.split('/').at(-1) ?? activity.phase;
  return activity.phase;
}

function activityIcon(phase: string): string {
  if (phase === 'completed') return 'ok';
  if (phase === 'failed') return '!';
  if (phase === 'tool') return 'tool';
  if (phase === 'file') return 'file';
  if (phase === 'artifact') return 'io';
  if (phase === 'handoff') return 'handoff';
  return 'run';
}

function compactToolName(toolName: string): string {
  const normalized = toolName.replace(/^tool[_/-]/, '').replace(/^copilot[_/-]/, '');
  const parts = normalized.split('/');
  return parts.at(-1)?.replace(/_/g, ' ') || normalized.replace(/_/g, ' ');
}

export function flowHandlePositions(layout: string): Pick<TokenNodeData, 'sourcePosition' | 'targetPosition'> {
  return layout === 'vertical'
    ? { sourcePosition: 'bottom', targetPosition: 'top' }
    : { sourcePosition: 'right', targetPosition: 'left' };
}
