import { AgentPipeline } from '../pipeline/types';
import { ActivityStore, resolveActivityNodeId } from './store';
import { AgentFlowActivityEvent, AgentFlowActivityInput, ActivityPhase } from './types';

export interface ActivityToolContext {
  pipeline: AgentPipeline;
  store: ActivityStore;
}

export interface SelectNodeInput {
  node: string;
  sessionId?: string;
}

export interface ReportActivityInput {
  sessionId?: string;
  node?: string;
  nodeFile?: string;
  targetNode?: string;
  phase?: ActivityPhase;
  summary?: string;
  toolName?: string;
  artifactPath?: string;
  durationMs?: number;
  tokenEstimate?: number;
  severity?: 'info' | 'warning' | 'error';
  prompt?: string;
}

export interface CompleteNodeInput {
  sessionId?: string;
  node: string;
  failed?: boolean;
  summary?: string;
  durationMs?: number;
}

export function selectActivityNode(input: SelectNodeInput, context: ActivityToolContext): { nodeId: string; label: string } {
  const nodeId = resolveActivityNodeId(context.pipeline, { nodeId: input.node, nodeFile: input.node });
  const node = context.pipeline.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Agent Flow could not resolve node \`${input.node}\`.`);
  context.store.append({ sessionId: input.sessionId, nodeId: node.id, phase: 'queued', summary: `Selected ${node.label}.` });
  return { nodeId: node.id, label: node.label };
}

export function reportActivity(input: ReportActivityInput, context: ActivityToolContext): { event: AgentFlowActivityEvent } {
  const nodeId = resolveActivityNodeId(context.pipeline, { nodeId: input.node, nodeFile: input.nodeFile });
  const targetNodeId = resolveActivityNodeId(context.pipeline, { nodeId: input.targetNode });
  const event = context.store.append(sanitizedActivityInput({
    sessionId: input.sessionId,
    nodeId,
    nodeFile: input.nodeFile,
    targetNodeId,
    phase: input.phase ?? 'started',
    summary: input.summary,
    toolName: input.toolName,
    artifactPath: input.artifactPath,
    durationMs: input.durationMs,
    tokenEstimate: input.tokenEstimate,
    severity: input.severity
  }));
  return { event };
}

export function completeNodeActivity(input: CompleteNodeInput, context: ActivityToolContext): { event: AgentFlowActivityEvent } {
  const nodeId = resolveActivityNodeId(context.pipeline, { nodeId: input.node, nodeFile: input.node });
  const event = context.store.append({
    sessionId: input.sessionId,
    nodeId,
    phase: input.failed ? 'failed' : 'completed',
    summary: input.summary,
    durationMs: input.durationMs,
    severity: input.failed ? 'error' : 'info'
  });
  return { event };
}

function sanitizedActivityInput(input: AgentFlowActivityInput): AgentFlowActivityInput {
  return input;
}
