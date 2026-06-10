import { describe, expect, it } from 'vitest';
import { handleSavePipelineMessage } from '../src/webview/panelMessages';
import { AgentPipeline } from '../src/pipeline/types';

describe('webview save handling', () => {
  it('writes only the pipeline JSON when saving from the webview', async () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Save only',
      nodes: [{ id: 'agent', type: 'agent', label: 'Agent', calls: ['"Worker"'], outputs: [] }, { id: 'worker', type: 'agent', label: 'Worker', outputs: [] }],
      edges: []
    };
    const calls: string[] = [];

    await handleSavePipelineMessage({
      message: { command: 'savePipeline', pipeline, selectedId: 'agent' },
      workspace: '/workspace',
      writePipeline: async (_workspace, saved) => {
        calls.push(`pipeline:${saved.nodes[0].type === 'agent' ? saved.nodes[0].calls?.[0] : ''}`);
      },
      postState: async () => {
        calls.push('state');
      },
      showSavedMessage: async () => {
        calls.push('message');
      }
    });

    expect(calls).toEqual(['pipeline:worker', 'state', 'message']);
  });
});
