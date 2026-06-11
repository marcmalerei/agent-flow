import { AgentPipeline, PipelineNode, Position, PIPELINE_VERSION } from './types';

export interface AgentFlowNodeViewState {
  id: string;
  type: PipelineNode['type'];
  file?: string;
  path?: string;
  position?: Position;
}

export interface AgentFlowViewState {
  version: typeof PIPELINE_VERSION;
  name?: string;
  nodes: AgentFlowNodeViewState[];
}

export function viewStateForPipeline(pipeline: AgentPipeline): AgentFlowViewState {
  return {
    version: PIPELINE_VERSION,
    name: pipeline.name,
    nodes: pipeline.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      file: fileForNode(node),
      path: node.type === 'artifact' ? node.path : undefined,
      position: node.position
    }))
  };
}

export function stringifyViewState(pipeline: AgentPipeline): string {
  return `${JSON.stringify(viewStateForPipeline(pipeline), null, 2)}\n`;
}

export function parseViewState(source: string): AgentFlowViewState | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { return undefined; }
  if (!isObject(parsed) || parsed.version !== PIPELINE_VERSION || !Array.isArray(parsed.nodes)) return undefined;
  return {
    version: PIPELINE_VERSION,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : undefined,
    nodes: parsed.nodes.flatMap((node): AgentFlowNodeViewState[] => {
      if (!isObject(node) || typeof node.id !== 'string' || typeof node.type !== 'string') return [];
      return [{
        id: node.id,
        type: node.type as PipelineNode['type'],
        file: typeof node.file === 'string' ? node.file : undefined,
        path: typeof node.path === 'string' ? node.path : undefined,
        position: isObject(node.position) ? { x: Number(node.position.x ?? 0), y: Number(node.position.y ?? 0) } : undefined
      }];
    })
  };
}

export function applyViewState(pipeline: AgentPipeline, viewState: AgentFlowViewState | undefined): AgentPipeline {
  if (!viewState) return pipeline;
  const byId = new Map(viewState.nodes.map((node) => [node.id, node]));
  const byFile = new Map(viewState.nodes.filter((node) => node.file).map((node) => [node.file, node]));
  const byPath = new Map(viewState.nodes.filter((node) => node.path).map((node) => [node.path, node]));
  return {
    ...pipeline,
    name: viewState.name ?? pipeline.name,
    nodes: pipeline.nodes.map((node) => {
      const viewNode = byId.get(node.id) ?? byFile.get(fileForNode(node) ?? '') ?? (node.type === 'artifact' ? byPath.get(node.path) : undefined);
      return viewNode?.position ? { ...node, position: viewNode.position } : node;
    })
  };
}

function fileForNode(node: PipelineNode): string | undefined {
  if (node.type === 'agent') return node.agentFile;
  if (node.type === 'prompt') return node.promptFile;
  if (node.type === 'instruction') return node.instructionFile;
  if (node.type === 'skill') return node.skillFile;
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
