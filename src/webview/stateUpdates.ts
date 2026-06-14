import { AgentPipeline } from '../pipeline/types';
import { isSuspiciousPipelineLoss } from './pipelineRefresh';

export interface WebviewStateLike {
  pipeline: AgentPipeline;
  findings: unknown;
  risk: unknown;
  generatedFiles: unknown;
  activityEvents?: unknown;
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
    return {
      state: {
        ...input.incomingState,
        pipeline: input.currentState.pipeline,
        findings: input.currentState.findings,
        risk: input.currentState.risk,
        generatedFiles: input.currentState.generatedFiles
      } as TState,
      draft: input.currentDraft,
      applyDraft: false
    };
  }

  if (!input.dirty) {
    return { state: input.incomingState, draft: input.incomingState.pipeline, applyDraft: true };
  }

  return {
    state: {
      ...input.incomingState,
      pipeline: input.currentState.pipeline,
      findings: input.currentState.findings,
      risk: input.currentState.risk,
      generatedFiles: input.currentState.generatedFiles
    } as TState,
    draft: input.currentDraft,
    applyDraft: false
  };
}

function isTransientPipelineLoss(current: AgentPipeline, incoming: AgentPipeline): boolean {
  return isSuspiciousPipelineLoss(current, incoming);
}
