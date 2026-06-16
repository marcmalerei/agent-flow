import { AgentPipeline, PipelineNode } from '../pipeline/types';
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
  conflict?: EditingConflict;
}

export interface EditingConflict {
  filePath?: string;
  incomingPipeline: AgentPipeline;
  nodeId: string;
  nodeLabel: string;
}

export function mergeRemoteStateUpdate<TState extends WebviewStateLike>(input: {
  currentState: TState;
  currentDraft: AgentPipeline;
  incomingState: TState;
  dirty: boolean;
  selectedId?: string;
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
  const conflict = detectSelectedNodeConflict(input.currentDraft, input.incomingState.pipeline, input.selectedId);
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
    applyDraft: false,
    conflict
  };
}

function isTransientPipelineLoss(current: AgentPipeline, incoming: AgentPipeline): boolean {
  return isSuspiciousPipelineLoss(current, incoming);
}

function detectSelectedNodeConflict(currentDraft: AgentPipeline, incomingPipeline: AgentPipeline, selectedId: string | undefined): EditingConflict | undefined {
  if (!selectedId) return undefined;
  const currentNode = currentDraft.nodes.find((node) => node.id === selectedId);
  const incomingNode = incomingPipeline.nodes.find((node) => node.id === selectedId);
  if (!currentNode || !incomingNode) return undefined;
  if (JSON.stringify(currentNode) === JSON.stringify(incomingNode)) return undefined;
  return {
    filePath: nodeSourceFilePath(incomingNode) ?? nodeSourceFilePath(currentNode),
    incomingPipeline,
    nodeId: selectedId,
    nodeLabel: currentNode.label
  };
}

function nodeSourceFilePath(node: PipelineNode): string | undefined {
  if (node.type === 'agent') return node.agentFile ?? `.github/agents/${node.id}.agent.md`;
  if (node.type === 'prompt') return node.promptFile ?? `.github/prompts/${node.id}.prompt.md`;
  if (node.type === 'instruction') return node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`;
  if (node.type === 'skill') return node.skillFile ?? `.github/skills/${node.id}/SKILL.md`;
  if (node.type === 'role') return node.roleFile ?? `.github/roles/${node.id}.md`;
  if (node.type === 'artifact') return node.path;
  return undefined;
}
