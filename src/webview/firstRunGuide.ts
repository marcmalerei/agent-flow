import type { AgentPipeline } from '../pipeline/types';

export function isDefaultSamplePipeline(pipeline: AgentPipeline): boolean {
  const ids = new Set(pipeline.nodes.map((node) => node.id));
  return pipeline.name === 'default agent pipeline'
    && ids.has('start-implementation')
    && ids.has('router')
    && ids.has('implementer')
    && ids.has('reviewer')
    && ids.has('fixer')
    && ids.has('artifact-result-md');
}
