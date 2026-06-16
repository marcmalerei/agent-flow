export type ActivityPhase = 'queued' | 'started' | 'thinking' | 'tool' | 'file' | 'artifact' | 'handoff' | 'completed' | 'failed' | 'cancelled';
export type ActivitySeverity = 'info' | 'warning' | 'error';

export interface AgentFlowActivityEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  phase: ActivityPhase;
  summary: string;
  nodeId?: string;
  nodeFile?: string;
  targetNodeId?: string;
  toolName?: string;
  artifactPath?: string;
  durationMs?: number;
  tokenEstimate?: number;
  inputTokens?: number;
  outputTokens?: number;
  aiCredits?: number;
  model?: string;
  sourceFile?: string;
  severity?: ActivitySeverity;
}

export type AgentFlowActivityInput = Partial<Omit<AgentFlowActivityEvent, 'id' | 'timestamp' | 'sessionId' | 'phase' | 'summary'>> & {
  id?: string;
  timestamp?: string;
  sessionId?: string;
  phase?: ActivityPhase;
  summary?: string;
  node?: string;
};

export interface NodeActivitySummary {
  nodeId: string;
  phase: ActivityPhase;
  summary: string;
  count: number;
  updatedAt: string;
  freshness?: 'fresh' | 'recent';
  toolName?: string;
  artifactPath?: string;
  severity?: ActivitySeverity;
}
