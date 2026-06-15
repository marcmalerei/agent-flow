import { AgentPipeline } from '../pipeline/types';
import { isSuspiciousPipelineLoss } from './pipelineRefresh';
import { mergeNodeRuntimeState, type NodeRuntimeStateMap } from './nodeRuntimeState';

export interface WebviewStateLike {
  pipeline: AgentPipeline;
  findings: unknown;
  risk: unknown;
  generatedFiles: unknown;
  activityEvents?: unknown;
  nodeRuntime?: NodeRuntimeStateMap;
}

export interface RemoteStateMergeResult<TState extends WebviewStateLike> {
  state: TState;
  draft: AgentPipeline;
  applyDraft: boolean;
}

export function mergeRemoteStateUpdate<TState extends WebviewStateLike>(input: {
  currentState: TState;
  currentDraft: AgentPipeline;
  incomingState: TState;
  dirty: boolean;
}): RemoteStateMergeResult<TState> {
  if (isTransientPipelineLoss(input.currentState.pipeline, input.incomingState.pipeline)) {
    const nodeRuntime = mergeNodeRuntimeState(input.currentState.nodeRuntime, input.incomingState.nodeRuntime, input.currentState.pipeline);
    return {
      state: {
        ...input.incomingState,
        pipeline: input.currentState.pipeline,
        findings: input.currentState.findings,
        risk: input.currentState.risk,
        generatedFiles: input.currentState.generatedFiles,
        nodeRuntime
      } as TState,
      draft: input.currentDraft,
      applyDraft: false
    };
  }

  if (!input.dirty) {
    return {
      state: {
        ...input.incomingState,
        nodeRuntime: mergeNodeRuntimeState(input.currentState.nodeRuntime, input.incomingState.nodeRuntime, input.incomingState.pipeline)
      } as TState,
      draft: input.incomingState.pipeline,
      applyDraft: true
    };
  }

  const nodeRuntime = mergeNodeRuntimeState(input.currentState.nodeRuntime, input.incomingState.nodeRuntime, input.currentState.pipeline);
  return {
    state: {
      ...input.incomingState,
      pipeline: input.currentState.pipeline,
      findings: input.currentState.findings,
      risk: input.currentState.risk,
      generatedFiles: input.currentState.generatedFiles,
      nodeRuntime
    } as TState,
    draft: input.currentDraft,
    applyDraft: false
  };
}

function isTransientPipelineLoss(current: AgentPipeline, incoming: AgentPipeline): boolean {
  return isSuspiciousPipelineLoss(current, incoming);
}
