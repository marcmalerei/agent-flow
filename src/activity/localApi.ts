import { AgentPipeline } from '../pipeline/types';
import { aggregateActivityMetrics } from './metrics';
import { AgentFlowActivityEvent } from './types';

export interface LocalApiStatus {
  enabled: boolean;
  host: '127.0.0.1';
  port: number;
}

export interface LocalApiContext {
  pipeline: AgentPipeline;
  events: AgentFlowActivityEvent[];
  status: LocalApiStatus;
}

export const localApiEndpoints = ['/api/pipeline', '/api/activity', '/api/metrics', '/api/status'] as const;

export function createLocalApiPayload(path: string, context: LocalApiContext): unknown {
  if (path === '/api/pipeline') return redactedPipeline(context.pipeline);
  if (path === '/api/activity') return context.events.map(redactedActivityEvent);
  if (path === '/api/metrics') return aggregateActivityMetrics(context.pipeline, context.events);
  if (path === '/api/status') return { ...context.status, endpoints: [...localApiEndpoints] };
  return undefined;
}

export function createWebhookPayload(event: AgentFlowActivityEvent): Record<string, unknown> {
  return redactedActivityEvent(event);
}

function redactedPipeline(pipeline: AgentPipeline): Record<string, unknown> {
  return {
    name: pipeline.name,
    version: pipeline.version,
    nodes: pipeline.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label
    })),
    edges: pipeline.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      kind: edge.kind
    }))
  };
}

function redactedActivityEvent(event: AgentFlowActivityEvent): Record<string, unknown> {
  return pruneUndefined({
    id: event.id,
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    phase: event.phase,
    summary: redactSummary(event.summary),
    nodeId: event.nodeId,
    targetNodeId: event.targetNodeId,
    toolName: event.toolName,
    artifactPath: event.artifactPath,
    durationMs: event.durationMs,
    tokenEstimate: event.tokenEstimate,
    aiCredits: event.aiCredits,
    model: event.model,
    severity: event.severity
  });
}

export function redactSummary(summary: string): string {
  const withoutCodeBlocks = summary.replace(/\s*```[\s\S]*?```\s*/g, ' [redacted code block]').replace(/\s+/g, ' ').trim();
  return withoutCodeBlocks.length > 280 ? `${withoutCodeBlocks.slice(0, 277)}...` : withoutCodeBlocks;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
