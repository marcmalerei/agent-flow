import { describe, expect, it } from 'vitest';
import { createActivityReplayPlan, parseActivityLogJsonl } from '../src/activity/importLog';
import { AgentPipeline } from '../src/pipeline/types';

const pipeline: AgentPipeline = {
  name: 'Import demo',
  version: 1,
  nodes: [
    { id: 'router', type: 'agent', label: 'router', agentFile: '.github/agents/router.agent.md', tools: [], calls: [], inputs: [], outputs: [] },
    { id: 'plan', type: 'artifact', label: 'plan', path: '.github/artifacts/plan.md' }
  ],
  edges: []
};

describe('activity log import', () => {
  it('imports normalized activity JSONL rows and maps files to nodes', () => {
    const result = parseActivityLogJsonl([
      JSON.stringify({ id: 'two', timestamp: '2026-06-15T10:00:02.000Z', sessionId: 's1', phase: 'artifact', nodeFile: '.github/artifacts/plan.md', summary: 'Wrote plan.' }),
      JSON.stringify({ id: 'one', timestamp: '2026-06-15T10:00:01.000Z', sessionId: 's1', phase: 'tool', nodeFile: '.github/agents/router.agent.md', toolName: 'read/readFile', summary: 'Read router.' })
    ].join('\n'), { sourceFile: '/tmp/activity.jsonl', pipeline });

    expect(result.diagnostics).toEqual([]);
    expect(result.events.map((event) => event.id)).toEqual(['one', 'two']);
    expect(result.events[0]).toMatchObject({ nodeId: 'router', sourceFile: '/tmp/activity.jsonl' });
    expect(result.events[1]).toMatchObject({ nodeId: 'plan' });
  });

  it('skips duplicate ids and reports invalid lines', () => {
    const result = parseActivityLogJsonl([
      JSON.stringify({ id: 'same', timestamp: '2026-06-15T10:00:01.000Z', sessionId: 's1', phase: 'started', nodeId: 'router', summary: 'Start.' }),
      JSON.stringify({ id: 'same', timestamp: '2026-06-15T10:00:02.000Z', sessionId: 's1', phase: 'completed', nodeId: 'router', summary: 'Done.' }),
      '{bad json'
    ].join('\n'), { sourceFile: '/tmp/activity.jsonl', pipeline });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].summary).toBe('Start.');
    expect(result.diagnostics).toEqual([
      '/tmp/activity.jsonl line 2 duplicates activity id same and was skipped.',
      '/tmp/activity.jsonl line 3 is not valid JSONL: Expected property name or \'}\' in JSON at position 1 (line 1 column 2)'
    ]);
  });

  it('creates replay delays from timestamps and speed', () => {
    const result = parseActivityLogJsonl([
      JSON.stringify({ id: 'one', timestamp: '2026-06-15T10:00:00.000Z', sessionId: 's1', phase: 'started', nodeId: 'router', summary: 'Start.' }),
      JSON.stringify({ id: 'two', timestamp: '2026-06-15T10:00:04.000Z', sessionId: 's1', phase: 'completed', nodeId: 'router', summary: 'Done.' })
    ].join('\n'), { pipeline });

    expect(createActivityReplayPlan(result.events, 2)).toEqual([
      { event: result.events[0], delayMs: 0 },
      { event: result.events[1], delayMs: 2000 }
    ]);
  });
});
