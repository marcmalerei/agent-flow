import { describe, expect, it } from 'vitest';
import { AgentPipeline } from '../src/pipeline/types';
import { deriveVisibleFlowEdges } from '../src/webview/graph';
import { countGraphNodeTypes, relationshipNeighborhood, searchGraphNodes, summarizeGraphRelationships, visibleNodeIdsForTypes } from '../src/webview/graphReading';

const pipeline: AgentPipeline = {
  version: 1,
  name: 'reading',
  nodes: [
    { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', tools: ['read/readFile'], outputs: ['.github/artifacts/plan.md'], handoffs: [{ label: 'Plan', agent: 'planner' }] },
    { id: 'planner', type: 'agent', label: 'planner', agentFile: '.github/agents/planner.agent.md', tools: ['agent/runSubagent'], inputs: ['.github/artifacts/plan.md'] },
    { id: 'plan', type: 'artifact', label: 'plan', path: '.github/artifacts/plan.md' },
    { id: 'docs', type: 'instruction', label: 'docs', instructionFile: '.github/instructions/docs.instructions.md' }
  ],
  edges: []
};

describe('graph reading tools', () => {
  it('searches labels, paths, types, tools, and validation findings', () => {
    expect(searchGraphNodes(pipeline, [], 'planner')).toEqual([expect.objectContaining({ nodeId: 'planner', reason: 'label' })]);
    expect(searchGraphNodes(pipeline, [], 'artifacts/plan')).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'router', reason: 'path' }),
      expect.objectContaining({ nodeId: 'planner', reason: 'path' }),
      expect.objectContaining({ nodeId: 'plan', reason: 'path' })
    ]));
    expect(searchGraphNodes(pipeline, [], 'readfile')).toEqual([expect.objectContaining({ nodeId: 'router', reason: 'tool' })]);
    expect(searchGraphNodes(pipeline, [
      { severity: 'warning', ruleId: 'agent-no-output', message: 'planner has no output artifact', nodeId: 'planner' }
    ], 'no output')).toEqual([expect.objectContaining({ nodeId: 'planner', reason: 'warning' })]);
  });

  it('derives an immediate relationship neighborhood for the selected node', () => {
    const edges = deriveVisibleFlowEdges(pipeline);
    const neighborhood = relationshipNeighborhood('router', edges);

    expect([...neighborhood.nodeIds].sort()).toEqual(['plan', 'planner', 'router']);
    expect([...neighborhood.edgeIds]).toEqual(expect.arrayContaining([
      expect.stringContaining('handoff'),
      expect.stringContaining('artifact-output')
    ]));
  });

  it('summarizes relationships and type-filter visibility for graph reading panels', () => {
    const edges = deriveVisibleFlowEdges(pipeline);

    expect(summarizeGraphRelationships('router', pipeline, edges)).toMatchObject({
      writesTo: ['plan'],
      handsOffTo: ['planner']
    });
    expect(countGraphNodeTypes(pipeline.nodes)).toMatchObject({ agent: 2, artifact: 1, instruction: 1 });
    expect([...visibleNodeIdsForTypes(pipeline.nodes, ['artifact'])].sort()).toEqual(['docs', 'planner', 'router']);
  });
});
