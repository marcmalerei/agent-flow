import React from 'react';
import { Handle, Position } from '@xyflow/react';

export interface TokenNodeData {
  label: string;
  type: string;
  tokenBadge: string;
  sourcePosition: Position;
  targetPosition: Position;
}

export function TokenNode({ data }: { data: TokenNodeData }) {
  return <div className="flow-node">
    <Handle type="target" position={data.targetPosition} />
    <span className="token-badge" title="Estimated token count">{data.tokenBadge}</span>
    <span>{data.label}</span>
    <small>{data.type}</small>
    <Handle type="source" position={data.sourcePosition} />
  </div>;
}

export function flowHandlePositions(layout: string): Pick<TokenNodeData, 'sourcePosition' | 'targetPosition'> {
  return layout === 'vertical'
    ? { sourcePosition: Position.Bottom, targetPosition: Position.Top }
    : { sourcePosition: Position.Right, targetPosition: Position.Left };
}
