import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { NodeActivitySummary } from '../activity/types';

export interface TokenNodeData {
  label: string;
  type: string;
  tokenBadge: string;
  tokenColor: string;
  activity?: NodeActivitySummary;
  sourcePosition: Position;
  targetPosition: Position;
}

export function TokenNode({ data }: { data: TokenNodeData }) {
  const tokenBadgeStyle = { '--agentflow-token-color': data.tokenColor } as React.CSSProperties;

  return <div className="flow-node">
    <Handle type="target" position={data.targetPosition} />
    <span className="token-badge" style={tokenBadgeStyle} title="Estimated token count">{data.tokenBadge}</span>
    {data.activity && <span className={`activity-badge activity-${data.activity.phase}`} title={data.activity.summary}>{activityIcon(data.activity.phase)} {activityLabel(data.activity)}</span>}
    <span>{data.label}</span>
    <small>{data.type}</small>
    <Handle type="source" position={data.sourcePosition} />
  </div>;
}

function activityLabel(activity: NodeActivitySummary): string {
  if (activity.toolName) return activity.toolName;
  if (activity.artifactPath) return activity.artifactPath.split('/').at(-1) ?? activity.phase;
  return activity.phase;
}

function activityIcon(phase: string): string {
  if (phase === 'completed') return 'ok';
  if (phase === 'failed') return '!';
  if (phase === 'tool') return 'tool';
  if (phase === 'artifact') return 'io';
  return 'run';
}

export function flowHandlePositions(layout: string): Pick<TokenNodeData, 'sourcePosition' | 'targetPosition'> {
  return layout === 'vertical'
    ? { sourcePosition: Position.Bottom, targetPosition: Position.Top }
    : { sourcePosition: Position.Right, targetPosition: Position.Left };
}
