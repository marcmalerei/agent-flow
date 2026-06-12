import { AgentPipeline, PipelineNode } from '../pipeline/types';
import { AgentFlowActivityEvent, AgentFlowActivityInput, ActivityPhase } from './types';

export type ActivityListener = (events: AgentFlowActivityEvent[]) => void;

export interface ActivityStoreOptions {
  maxEvents?: number;
  pipelineProvider?: () => AgentPipeline | undefined;
}

const phases = new Set<ActivityPhase>(['queued', 'started', 'thinking', 'tool', 'file', 'artifact', 'handoff', 'completed', 'failed', 'cancelled']);

export class ActivityStore {
  private events: AgentFlowActivityEvent[] = [];
  private readonly listeners = new Set<ActivityListener>();
  private sequence = 0;
  private readonly maxEvents: number;
  private readonly pipelineProvider?: () => AgentPipeline | undefined;

  constructor(options: ActivityStoreOptions = {}) {
    this.maxEvents = options.maxEvents ?? 500;
    this.pipelineProvider = options.pipelineProvider;
  }

  append(input: AgentFlowActivityInput): AgentFlowActivityEvent {
    const pipeline = this.pipelineProvider?.();
    const event = normalizeActivityInput(input, () => this.nextId(), pipeline);
    this.events = [...this.events, event].slice(-this.maxEvents);
    this.emit();
    return event;
  }

  getEvents(): AgentFlowActivityEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    this.emit();
  }

  subscribe(listener: ActivityListener): { dispose(): void } {
    this.listeners.add(listener);
    listener(this.getEvents());
    return { dispose: () => this.listeners.delete(listener) };
  }

  private nextId(): string {
    this.sequence += 1;
    return `activity-${this.sequence}`;
  }

  private emit(): void {
    const events = this.getEvents();
    for (const listener of this.listeners) listener(events);
  }
}

export function normalizeActivityInput(input: AgentFlowActivityInput, nextId: () => string = () => `activity-${Date.now()}`, pipeline?: AgentPipeline): AgentFlowActivityEvent {
  const phase = input.phase && phases.has(input.phase) ? input.phase : 'started';
  const nodeId = pipeline ? resolveActivityNodeId(pipeline, input) : clean(input.nodeId ?? input.node);
  const targetNodeId = pipeline ? resolveActivityNodeId(pipeline, { nodeId: input.targetNodeId }) : clean(input.targetNodeId);
  return pruneUndefined({
    id: clean(input.id) ?? nextId(),
    timestamp: validTimestamp(input.timestamp) ?? new Date().toISOString(),
    sessionId: clean(input.sessionId) ?? 'default',
    phase,
    summary: clean(input.summary) ?? defaultSummary(phase),
    nodeId,
    nodeFile: clean(input.nodeFile),
    targetNodeId,
    toolName: clean(input.toolName),
    artifactPath: clean(input.artifactPath),
    durationMs: nonNegative(input.durationMs),
    tokenEstimate: nonNegative(input.tokenEstimate),
    aiCredits: nonNegative(input.aiCredits),
    model: clean(input.model),
    sourceFile: clean(input.sourceFile),
    severity: input.severity === 'error' || input.severity === 'warning' || input.severity === 'info' ? input.severity : phase === 'failed' ? 'error' : undefined
  });
}

export function resolveActivityNodeId(pipeline: AgentPipeline, input: Pick<AgentFlowActivityInput, 'node' | 'nodeId' | 'nodeFile'>): string | undefined {
  const identifier = clean(input.nodeId ?? input.node);
  if (identifier) {
    const byIdOrLabel = pipeline.nodes.find((node) => node.id === identifier || node.label === identifier);
    if (byIdOrLabel) return byIdOrLabel.id;
  }
  const file = clean(input.nodeFile ?? identifier);
  if (file) {
    const byFile = pipeline.nodes.find((node) => nodeBackingFile(node) === file);
    if (byFile) return byFile.id;
  }
  return identifier;
}

export function nodeBackingFile(node: PipelineNode): string | undefined {
  if (node.type === 'agent') return node.agentFile;
  if (node.type === 'prompt') return node.promptFile;
  if (node.type === 'instruction') return node.instructionFile;
  if (node.type === 'skill') return node.skillFile;
  if (node.type === 'role') return node.roleFile;
  if (node.type === 'artifact') return node.path;
  return undefined;
}

function defaultSummary(phase: ActivityPhase): string {
  if (phase === 'tool') return 'Tool call reported.';
  if (phase === 'artifact') return 'Artifact activity reported.';
  if (phase === 'handoff') return 'Handoff reported.';
  if (phase === 'completed') return 'Node completed.';
  if (phase === 'failed') return 'Node failed.';
  return 'Node activity reported.';
}

function validTimestamp(value: unknown): string | undefined {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
