import { describe, expect, it } from 'vitest';
import { PipelineRefreshCoordinator, refreshPipelineAfterWorkspaceChange } from '../src/webview/pipelineRefresh';
import { AgentPipeline } from '../src/pipeline/types';

describe('pipeline workspace refresh', () => {
  it('drops stale refresh results when a newer refresh finishes first', async () => {
    const current: AgentPipeline = {
      version: 1,
      name: 'Current',
      nodes: [{ id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], outputs: [] }],
      edges: []
    };
    const stale: AgentPipeline = {
      version: 1,
      name: 'Stale',
      nodes: [{ id: 'router', type: 'agent', label: 'old router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], outputs: [] }],
      edges: []
    };
    const fresh: AgentPipeline = {
      version: 1,
      name: 'Fresh',
      nodes: [{ id: 'router', type: 'agent', label: 'fresh router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], outputs: [] }],
      edges: []
    };
    let releaseStale: (() => void) | undefined;
    const coordinator = new PipelineRefreshCoordinator();

    const first = coordinator.run(current, async () => {
      await new Promise<void>((resolve) => { releaseStale = resolve; });
      return { pipeline: stale, changed: true, reason: 'accepted', attempts: 1 };
    });
    const second = await coordinator.run(current, async () => ({ pipeline: fresh, changed: true, reason: 'accepted', attempts: 1 }));
    releaseStale?.();
    const firstResult = await first;

    expect(second.applied).toBe(true);
    expect(second.result.pipeline).toBe(fresh);
    expect(firstResult.applied).toBe(false);
    expect(firstResult.stale).toBe(true);
    expect(firstResult.result.pipeline).toBe(stale);
  });

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

  it('keeps a small current pipeline when a scan loses one of its file-backed nodes', async () => {
    const current: AgentPipeline = {
      version: 1,
      name: 'Small current',
      nodes: [
        { id: 'agent', type: 'agent', label: 'agent', agentFile: '.github/agents/agent.agent.md', tools: [], calls: [], outputs: [] },
        { id: 'instruction', type: 'instruction', label: 'instruction', instructionFile: '.github/instructions/instruction.instructions.md' }
      ],
      edges: []
    };
    const partial: AgentPipeline = {
      version: 1,
      name: 'Small partial',
      nodes: [
        { id: 'agent', type: 'agent', label: 'agent', agentFile: '.github/agents/agent.agent.md', tools: [], calls: [], outputs: [] }
      ],
      edges: []
    };

    const result = await refreshPipelineAfterWorkspaceChange('/workspace', current, async () => partial, {
      maxAttempts: 1
    });

    expect(result.pipeline).toBe(current);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('transient-partial');
  });
});
