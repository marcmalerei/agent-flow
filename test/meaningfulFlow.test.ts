import { describe, expect, it } from 'vitest';
import { createDefaultPipeline } from '../src/pipeline/defaultPipeline';
import { meaningfulFlowNodeIds } from '../src/webview/meaningfulFlow';
import type { AgentPipeline } from '../src/pipeline/types';

describe('meaningful graph flow', () => {
  it('keeps the default pipeline execution path ahead of support nodes', () => {
    expect(meaningfulFlowNodeIds(createDefaultPipeline())).toEqual([
      'start-implementation',
      'router',
      'implementer',
      'reviewer',
      'fixer',
      'router-handoff-hand-off-to-implementer',
      'implementer-handoff-hand-off-to-reviewer',
      'reviewer-handoff-hand-off-to-fixer'
    ]);
  });

  it('falls back to all nodes when a graph has only support nodes', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'support only',
      edges: [],
      nodes: [
        { id: 'artifact-result', type: 'artifact', label: 'result', path: '.github/artifacts/result.md' },
        { id: 'guidelines', type: 'instruction', label: 'guidelines', instructionFile: '.github/instructions/guidelines.instructions.md' }
      ]
    };

    expect(meaningfulFlowNodeIds(pipeline)).toEqual(['artifact-result', 'guidelines']);
  });
});
