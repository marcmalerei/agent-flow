import { describe, expect, it } from 'vitest';
import { AgentPipeline } from '../src/pipeline/types';
import { createPipelineNode, duplicatePipelineSelection, previewNodeCreation } from '../src/webview/builderMutations';

describe('builder mutations', () => {
  it('previews file-first node creation with lower-case stable names and paths', () => {
    const pipeline: AgentPipeline = {
      name: 'builder',
      nodes: [
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md' }
      ],
      edges: []
    };

    expect(previewNodeCreation(pipeline, 'agent', 'Security Reviewer')).toMatchObject({
      id: 'security-reviewer',
      label: 'security reviewer',
      normalized: true,
      filePath: '.github/agents/security-reviewer.agent.md'
    });
    expect(previewNodeCreation(pipeline, 'prompt', 'Release Notes')).toMatchObject({ filePath: '.github/prompts/release-notes.prompt.md' });
    expect(previewNodeCreation(pipeline, 'instruction', 'Docs Scope')).toMatchObject({ filePath: '.github/instructions/docs-scope.instructions.md' });
    expect(previewNodeCreation(pipeline, 'role', 'Frontend Developer')).toMatchObject({ filePath: '.github/roles/frontend-developer.md' });
    expect(previewNodeCreation(pipeline, 'artifact', 'Plan JSON')).toMatchObject({ filePath: '.github/artifacts/plan-json.md' });
  });

  it('creates pipeline nodes from the file-first preview without writing on cancel', () => {
    const pipeline: AgentPipeline = {
      name: 'builder',
      nodes: [
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md' },
        { id: 'router-2', type: 'agent', label: 'router 2', agentFile: '.github/agents/router-2.agent.md' }
      ],
      edges: []
    };

    expect(previewNodeCreation(pipeline, 'agent', 'Router')).toMatchObject({
      id: 'router-3',
      label: 'router',
      filePath: '.github/agents/router-3.agent.md'
    });

    const node = createPipelineNode(pipeline, 'agent', { x: 10, y: 20 }, { name: 'Router', description: 'Reviews security changes.' });
    expect(node).toMatchObject({
      id: 'router-3',
      label: 'router',
      description: 'Reviews security changes.',
      agentFile: '.github/agents/router-3.agent.md',
      position: { x: 10, y: 20 }
    });
  });

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
