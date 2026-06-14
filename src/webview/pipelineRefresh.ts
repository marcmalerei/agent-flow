import { loadOrInferPipeline } from '../pipeline/scanner';
import { AgentPipeline, PipelineNode } from '../pipeline/types';

export interface PipelineRefreshResult {
  pipeline: AgentPipeline;
  changed: boolean;
  reason: 'accepted' | 'transient-empty' | 'transient-partial';
  attempts: number;
}

export interface PipelineRefreshOptions {
  maxAttempts?: number;
  minRetainedNodeRatio?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CoordinatedPipelineRefreshResult {
  result: PipelineRefreshResult;
  generation: number;
  applied: boolean;
  stale: boolean;
}

export class PipelineRefreshCoordinator {
  private generation = 0;

  async run(
    current: AgentPipeline,
    refresh: (current: AgentPipeline) => Promise<PipelineRefreshResult>
  ): Promise<CoordinatedPipelineRefreshResult> {
    const generation = this.generation + 1;
    this.generation = generation;
    const result = await refresh(current);
    const stale = generation !== this.generation;
    return { result, generation, applied: !stale, stale };
  }
}

export async function loadInitialPipelineWhenStable(
  workspace: string,
  infer: (workspace: string) => Promise<AgentPipeline> = loadOrInferPipeline,
  options: PipelineRefreshOptions = {}
): Promise<PipelineRefreshResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const retryDelayMs = options.retryDelayMs ?? 250;
  const sleep = options.sleep ?? delay;
  let next = await infer(workspace);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (next.nodes.length > 0) return { pipeline: next, changed: true, reason: 'accepted', attempts: attempt };
    if (attempt === maxAttempts) return { pipeline: next, changed: false, reason: 'transient-empty', attempts: attempt };
    await sleep(retryDelayMs);
    next = await infer(workspace);
  }

  return { pipeline: next, changed: false, reason: 'transient-empty', attempts: maxAttempts };
}

export async function refreshPipelineAfterWorkspaceChange(
  workspace: string,
  current: AgentPipeline,
  infer: (workspace: string) => Promise<AgentPipeline> = loadOrInferPipeline,
  options: PipelineRefreshOptions = {}
): Promise<PipelineRefreshResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const minRetainedNodeRatio = options.minRetainedNodeRatio ?? 0.7;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const sleep = options.sleep ?? delay;
  let next = await infer(workspace);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const reason = suspiciousNodeLossReason(current, next, minRetainedNodeRatio);
    if (!reason) return { pipeline: next, changed: true, reason: 'accepted', attempts: attempt };
    if (attempt === maxAttempts) return { pipeline: current, changed: false, reason, attempts: attempt };
    await sleep(retryDelayMs);
    next = await infer(workspace);
  }

  return { pipeline: current, changed: false, reason: 'transient-partial', attempts: maxAttempts };
}

export function isSuspiciousPipelineLoss(current: AgentPipeline, next: AgentPipeline, minRetainedNodeRatio = 0.7): boolean {
  return Boolean(suspiciousNodeLossReason(current, next, minRetainedNodeRatio));
}

function suspiciousNodeLossReason(current: AgentPipeline, next: AgentPipeline, minRetainedNodeRatio: number): PipelineRefreshResult['reason'] | undefined {
  if (current.nodes.length === 0) return undefined;
  if (next.nodes.length === 0) return 'transient-empty';

  const currentFileBackedIds = fileBackedNodeIds(current);
  if (currentFileBackedIds.size < 2) return undefined;

  const nextIds = new Set(next.nodes.map((node) => node.id));
  const retained = [...currentFileBackedIds].filter((id) => nextIds.has(id)).length;
  const retainedRatio = retained / currentFileBackedIds.size;
  return retainedRatio < minRetainedNodeRatio ? 'transient-partial' : undefined;
}

function fileBackedNodeIds(pipeline: AgentPipeline): Set<string> {
  return new Set(pipeline.nodes.filter(hasBackingFile).map((node) => node.id));
}

function hasBackingFile(node: PipelineNode): boolean {
  if (node.type === 'agent') return Boolean(node.agentFile);
  if (node.type === 'prompt') return Boolean(node.promptFile);
  if (node.type === 'instruction') return Boolean(node.instructionFile);
  if (node.type === 'skill') return Boolean(node.skillFile);
  if (node.type === 'role') return Boolean(node.roleFile);
  if (node.type === 'artifact') return Boolean(node.path);
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
