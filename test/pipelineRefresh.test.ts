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
    expect(result.reason).toBe('transient-empty');
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
    expect(result.reason).toBe('accepted');
  });

  it('retries a suspicious partial scan before replacing the current pipeline', async () => {
    const current: AgentPipeline = {
      version: 1,
      name: 'Current',
      nodes: [
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', tools: [], calls: ['worker'], outputs: [] },
        { id: 'worker', type: 'agent', label: 'worker', agentFile: '.github/agents/worker.agent.md', tools: [], calls: [], outputs: ['.github/artifacts/result.md'] },
        { id: 'result', type: 'artifact', label: 'result', path: '.github/artifacts/result.md' }
      ],
      edges: []
    };
    const partial: AgentPipeline = {
      version: 1,
      name: 'Partial',
      nodes: [
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], outputs: [] }
      ],
      edges: []
    };
    const recovered: AgentPipeline = {
      ...current,
      name: 'Recovered',
      nodes: current.nodes.map((node) => node.id === 'worker' ? { ...node, label: 'worker updated' } : node)
    };
    const scans = [partial, recovered];

    const result = await refreshPipelineAfterWorkspaceChange('/workspace', current, async () => scans.shift()!, {
      retryDelayMs: 0,
      sleep: async () => undefined
    });

    expect(result.pipeline).toBe(recovered);
    expect(result.changed).toBe(true);
    expect(result.reason).toBe('accepted');
    expect(result.attempts).toBe(2);
  });

  it('keeps the current pipeline when repeated scans only return a suspicious subset', async () => {
    const current: AgentPipeline = {
      version: 1,
      name: 'Current',
      nodes: [
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', tools: [], calls: ['worker'], outputs: [] },
        { id: 'worker', type: 'agent', label: 'worker', agentFile: '.github/agents/worker.agent.md', tools: [], calls: [], outputs: ['.github/artifacts/result.md'] },
        { id: 'result', type: 'artifact', label: 'result', path: '.github/artifacts/result.md' }
      ],
      edges: []
    };
    const partial: AgentPipeline = {
      version: 1,
      name: 'Partial',
      nodes: [
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], outputs: [] }
      ],
      edges: []
    };

    const result = await refreshPipelineAfterWorkspaceChange('/workspace', current, async () => partial, {
      maxAttempts: 2,
      retryDelayMs: 0,
      sleep: async () => undefined
    });

    expect(result.pipeline).toBe(current);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('transient-partial');
    expect(result.attempts).toBe(2);
  });
});
