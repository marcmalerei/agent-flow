import { describe, expect, it } from 'vitest';
import { refreshPipelineAfterWorkspaceChange } from '../src/webview/pipelineRefresh';
import { AgentPipeline } from '../src/pipeline/types';

describe('pipeline workspace refresh', () => {
  it('keeps the current non-empty pipeline when a transient file scan is empty', async () => {
    const current: AgentPipeline = {
      version: 1,
      name: 'Current',
      nodes: [{ id: 'router', type: 'agent', label: 'router', tools: [], calls: [], outputs: [] }],
      edges: []
    };

    const result = await refreshPipelineAfterWorkspaceChange('/workspace', current, async () => ({
      version: 1,
      name: 'Transient empty',
      nodes: [],
      edges: []
    }));

    expect(result.pipeline).toBe(current);
    expect(result.changed).toBe(false);
  });

  it('accepts a non-empty inferred pipeline after an external file change', async () => {
    const current: AgentPipeline = {
      version: 1,
      name: 'Current',
      nodes: [{ id: 'router', type: 'agent', label: 'router', tools: [], calls: [], outputs: [] }],
      edges: []
    };
    const next: AgentPipeline = {
      version: 1,
      name: 'Next',
      nodes: [{ id: 'worker', type: 'agent', label: 'worker', tools: [], calls: [], outputs: [] }],
      edges: []
    };

    const result = await refreshPipelineAfterWorkspaceChange('/workspace', current, async () => next);

    expect(result.pipeline).toBe(next);
    expect(result.changed).toBe(true);
  });
});
