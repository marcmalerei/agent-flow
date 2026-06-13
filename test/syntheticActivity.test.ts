import { describe, expect, it } from 'vitest';
import { createSyntheticActivity } from '../src/activity/synthetic';
import { AgentPipeline } from '../src/pipeline/types';
import { activeEdgeIds, resolveActivityEventsForPipeline } from '../src/webview/activity';
import { normalizeActivityInput } from '../src/activity/store';

describe('synthetic activity', () => {
  it('creates node, file, handoff, and artifact events from a pipeline without Copilot', () => {
    const pipeline: AgentPipeline = {
      version: 1,
      name: 'Synthetic',
      nodes: [
        { id: 'prompt', type: 'prompt', label: 'Prompt', promptFile: '.github/prompts/prompt.prompt.md', startAgent: 'router' },
        { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', calls: ['worker'], outputs: ['.github/artifacts/plan.md'] },
        { id: 'worker', type: 'agent', label: 'worker', agentFile: '.github/agents/worker.agent.md', inputs: ['.github/artifacts/plan.md'], outputs: [] },
        { id: 'plan', type: 'artifact', label: 'Plan', path: '.github/artifacts/plan.md' }
      ],
      edges: []
    };

    const inputs = createSyntheticActivity(pipeline, 'demo');
    const events = resolveActivityEventsForPipeline(pipeline, inputs.map((input, index) => normalizeActivityInput({
      ...input,
      id: `event-${index}`,
      timestamp: '2026-06-13T18:00:00.000Z'
    })));

    expect(inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'demo', nodeId: 'prompt', phase: 'started' }),
      expect.objectContaining({ sessionId: 'demo', nodeFile: '.github/prompts/prompt.prompt.md', phase: 'file' }),
      expect.objectContaining({ sessionId: 'demo', nodeId: 'router', targetNodeId: 'worker', phase: 'handoff' }),
      expect.objectContaining({ sessionId: 'demo', nodeId: 'router', artifactPath: '.github/artifacts/plan.md', phase: 'artifact' })
    ]));
    expect(events.find((event) => event.nodeFile === '.github/prompts/prompt.prompt.md')?.nodeId).toBe('prompt');
    expect(activeEdgeIds(pipeline, events)).toEqual(expect.arrayContaining([
      'ref:prompt:prompt:startAgent:router',
      'ref:agent:router:calls:worker',
      'ref:artifact-output:router:plan'
    ]));
  });
});
