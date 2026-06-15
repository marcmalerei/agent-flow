import { describe, expect, it } from 'vitest';
import { AgentPipeline } from '../src/pipeline/types';
import { duplicatePipelineSelection } from '../src/webview/builderMutations';

describe('builder mutations', () => {
  it('duplicates selected nodes and internal edges with collision-safe managed file names', () => {
    const pipeline: AgentPipeline = {
      name: 'builder',
      nodes: [
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', position: { x: 10, y: 20 } },
        { id: 'plan', type: 'artifact', label: 'plan', path: '.github/artifacts/plan.md', position: { x: 300, y: 20 } },
        { id: 'router-copy', type: 'agent', label: 'router copy', agentFile: '.github/agents/router-copy.agent.md' }
      ],
      edges: [
        { id: 'router-artifact-plan', from: 'router', to: 'plan', kind: 'artifact', label: 'writes', artifact: '.github/artifacts/plan.md' }
      ]
    };

    const result = duplicatePipelineSelection(pipeline, ['router', 'plan']);
    const duplicatedAgent = result.pipeline.nodes.find((node) => node.type === 'agent' && node.id === 'router-copy-2');
    const duplicatedArtifact = result.pipeline.nodes.find((node) => node.type === 'artifact' && node.id === 'plan-copy');

    expect(result.selectedIds).toEqual(['router-copy-2', 'plan-copy']);
    expect(duplicatedAgent).toMatchObject({
      label: 'router copy',
      agentFile: '.github/agents/router-copy-2.agent.md',
      position: { x: 52, y: 62 }
    });
    expect(duplicatedArtifact).toMatchObject({
      label: 'plan copy',
      path: '.github/artifacts/plan-copy.md'
    });
    expect(result.pipeline.edges).toContainEqual(expect.objectContaining({
      from: 'router-copy-2',
      to: 'plan-copy',
      kind: 'artifact'
    }));
  });
});
