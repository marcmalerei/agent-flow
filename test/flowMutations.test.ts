import { describe, expect, it } from 'vitest';
import { AgentPipeline } from '../src/pipeline/types';
import { connectPipelineNodes } from '../src/webview/flowMutations';

function basePipeline(): AgentPipeline {
  return {
    version: 1,
    name: 'Mutable flow',
    nodes: [
      { id: 'start', type: 'prompt', label: 'Start', tools: [] },
      { id: 'router', type: 'agent', label: 'Router', calls: [], inputs: [], outputs: [] },
      { id: 'worker', type: 'agent', label: 'Worker', calls: [], inputs: [], outputs: [] },
      { id: 'artifact', type: 'artifact', label: 'Result', path: '.agent-output/result.md' }
    ],
    edges: []
  };
}

describe('flow mutations', () => {
  it('syncs an agent-to-agent canvas connection into agent calls', () => {
    const next = connectPipelineNodes(basePipeline(), 'router', 'worker');
    const router = next.nodes.find((node) => node.id === 'router' && node.type === 'agent');

    expect(router?.type).toBe('agent');
    expect(router?.calls).toEqual(['worker']);
    expect(next.edges).toEqual([{ id: 'router-flow-worker', from: 'router', to: 'worker', kind: 'flow', artifact: undefined }]);
  });

  it('syncs a prompt-to-agent canvas connection into the prompt start agent', () => {
    const next = connectPipelineNodes(basePipeline(), 'start', 'router');
    const start = next.nodes.find((node) => node.id === 'start' && node.type === 'prompt');

    expect(start?.type).toBe('prompt');
    expect(start?.startAgent).toBe('router');
    expect(next.edges).toEqual([{ id: 'start-prompt-router', from: 'start', to: 'router', kind: 'prompt', artifact: undefined }]);
  });

  it('syncs artifact connections into producer outputs and consumer inputs', () => {
    const produced = connectPipelineNodes(basePipeline(), 'router', 'artifact');
    const consumed = connectPipelineNodes(produced, 'artifact', 'worker');
    const router = consumed.nodes.find((node) => node.id === 'router' && node.type === 'agent');
    const worker = consumed.nodes.find((node) => node.id === 'worker' && node.type === 'agent');

    expect(router?.type).toBe('agent');
    expect(worker?.type).toBe('agent');
    expect(router?.outputs).toEqual(['.agent-output/result.md']);
    expect(worker?.inputs).toEqual(['.agent-output/result.md']);
    expect(consumed.edges.map((edge) => [edge.id, edge.from, edge.to, edge.kind, edge.artifact])).toEqual([
      ['router-artifact-artifact', 'router', 'artifact', 'artifact', '.agent-output/result.md'],
      ['artifact-artifact-worker', 'artifact', 'worker', 'artifact', '.agent-output/result.md']
    ]);
  });

  it('does not duplicate references or edges when the same connection is made twice', () => {
    const once = connectPipelineNodes(basePipeline(), 'router', 'worker');
    const twice = connectPipelineNodes(once, 'router', 'worker');
    const router = twice.nodes.find((node) => node.id === 'router' && node.type === 'agent');

    expect(router?.type).toBe('agent');
    expect(router?.calls).toEqual(['worker']);
    expect(twice.edges).toHaveLength(1);
  });
});
