import { describe, expect, it } from 'vitest';
import { parseClaudeCodeHookLogContent } from '../src/activity/claudeCodeHooks';
import { AgentPipeline } from '../src/pipeline/types';

const pipeline: AgentPipeline = {
  version: 1,
  name: 'Claude hook demo',
  nodes: [
    { id: 'reader', type: 'agent', label: 'reader', agentFile: '.github/agents/reader.agent.md', inputs: ['.github/artifacts/plan.md'], outputs: [] },
    { id: 'plan', type: 'artifact', label: 'plan', path: '.github/artifacts/plan.md' }
  ],
  edges: []
};

describe('Claude Code hook activity parser', () => {
  it('maps hook tool events to pipeline file and artifact activity', () => {
    const result = parseClaudeCodeHookLogContent([
      JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'claude-1', timestamp: '2026-06-15T12:00:00.000Z', tool_name: 'Read', tool_input: { file_path: '/workspace/.github/agents/reader.agent.md' } }),
      JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'claude-1', timestamp: '2026-06-15T12:00:01.000Z', tool_name: 'Write', tool_input: { file_path: '/workspace/.github/artifacts/plan.md' } })
    ].join('\n'), { sourceFile: '/tmp/claude-hooks/activity.jsonl', workspace: '/workspace', pipeline });

    expect(result.diagnostics).toEqual([]);
    expect(result.events).toEqual([
      expect.objectContaining({ sessionId: 'claude-1', phase: 'file', nodeId: 'reader', nodeFile: '.github/agents/reader.agent.md', toolName: 'Read' }),
      expect.objectContaining({ sessionId: 'claude-1', phase: 'artifact', nodeId: 'plan', artifactPath: '.github/artifacts/plan.md', toolName: 'Write' })
    ]);
  });

  it('keeps malformed rows diagnostic and avoids raw prompt contents', () => {
    const result = parseClaudeCodeHookLogContent([
      '{bad json',
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'claude-2', prompt: 'secret prompt text' })
    ].join('\n'), { sourceFile: '/tmp/claude-hooks/activity.jsonl' });

    expect(result.diagnostics[0]).toContain('line 1');
    expect(result.events).toEqual([
      expect.objectContaining({ sessionId: 'claude-2', phase: 'thinking', summary: 'Claude Code prompt submitted.' })
    ]);
    expect(result.events[0].summary).not.toContain('secret prompt text');
  });
});
