import { describe, expect, it } from 'vitest';
import { activityInputForPipelineDocumentPath, activityInputsForChangedFiles } from '../src/activity/fileActivity';
import { AgentPipeline } from '../src/pipeline/types';
import { activeEdgeIds } from '../src/webview/activity';

describe('filesystem activity projection', () => {
  const pipeline: AgentPipeline = {
    version: 1,
    name: 'Activity files',
    nodes: [
      {
        id: 'writer',
        type: 'agent',
        label: 'writer',
        agentFile: '.github/agents/writer.agent.md',
        tools: [],
        calls: [],
        outputs: ['.github/artifacts/plan.md']
      },
      {
        id: 'reader',
        type: 'agent',
        label: 'reader',
        agentFile: '.github/agents/reader.agent.md',
        tools: [],
        calls: [],
        inputs: ['.github/artifacts/plan.md'],
        outputs: []
      },
      { id: 'plan', type: 'artifact', label: 'plan', path: '.github/artifacts/plan.md' },
      { id: 'docs', type: 'instruction', label: 'docs', instructionFile: '.github/instructions/docs.instructions.md' }
    ],
    edges: []
  };

  it('turns changed artifact files into producer activity that can animate artifact edges', () => {
    const inputs = activityInputsForChangedFiles(pipeline, ['/workspace/.github/artifacts/plan.md'], '/workspace');

    expect(inputs).toMatchObject([
      {
        nodeId: 'writer',
        phase: 'artifact',
        artifactPath: '.github/artifacts/plan.md',
        summary: 'Updated artifact .github/artifacts/plan.md'
      }
    ]);
    expect(activeEdgeIds(pipeline, inputs.map((input, index) => ({
      id: `activity-${index}`,
      timestamp: new Date().toISOString(),
      sessionId: 'filesystem',
      phase: input.phase ?? 'artifact',
      summary: input.summary ?? '',
      nodeId: input.nodeId,
      artifactPath: input.artifactPath
    })))).toContain('ref:artifact-output:writer:plan');
  });

  it('turns changed node backing files into file activity on that node', () => {
    const inputs = activityInputsForChangedFiles(pipeline, ['.github/instructions/docs.instructions.md']);

    expect(inputs).toMatchObject([
      {
        nodeId: 'docs',
        phase: 'file',
        nodeFile: '.github/instructions/docs.instructions.md',
        summary: 'Updated .github/instructions/docs.instructions.md'
      }
    ]);
  });

  it('turns opened pipeline files into file read activity', () => {
    const inputs = activityInputsForChangedFiles(pipeline, ['.github/agents/reader.agent.md'], undefined, 'read');

    expect(inputs).toMatchObject([
      {
        nodeId: 'reader',
        phase: 'file',
        nodeFile: '.github/agents/reader.agent.md',
        summary: 'Read .github/agents/reader.agent.md'
      }
    ]);
  });

  it('creates path-only activity for VS Code document events', () => {
    expect(activityInputForPipelineDocumentPath('/workspace/.github/prompts/start.prompt.md', '/workspace', 'read')).toMatchObject({
      sessionId: 'vscode-documents',
      phase: 'file',
      nodeFile: '.github/prompts/start.prompt.md',
      summary: 'Read .github/prompts/start.prompt.md'
    });
    expect(activityInputForPipelineDocumentPath('/workspace/.github/artifacts/plan.md', '/workspace', 'read')).toMatchObject({
      sessionId: 'vscode-documents',
      phase: 'artifact',
      artifactPath: '.github/artifacts/plan.md',
      summary: 'Read artifact .github/artifacts/plan.md'
    });
    expect(activityInputForPipelineDocumentPath('/workspace/README.md', '/workspace', 'read')).toBeUndefined();
  });
});
