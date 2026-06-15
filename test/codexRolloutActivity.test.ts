import { describe, expect, it } from 'vitest';
import { AgentPipeline } from '../src/pipeline/types';
import { createCodexRolloutParserState, parseCodexRolloutChunk, recentCodexSessionDirs } from '../src/activity/codexRolloutLogs';

const pipeline: AgentPipeline = {
  version: 1,
  name: 'Codex rollout activity',
  nodes: [
    { id: 'reader', type: 'agent', label: 'reader', agentFile: '.github/agents/reader.agent.md', inputs: ['.github/artifacts/plan.md'], outputs: [] },
    { id: 'writer', type: 'agent', label: 'writer', agentFile: '.github/agents/writer.agent.md', outputs: ['.github/artifacts/plan.md'] },
    { id: 'plan', type: 'artifact', label: 'plan', path: '.github/artifacts/plan.md' }
  ],
  edges: []
};

function row(type: string, payload: unknown, timestamp = '2026-06-15T10:00:00.000Z'): string {
  return `${JSON.stringify({ timestamp, type, payload })}\n`;
}

describe('Codex rollout activity parser', () => {
  it('filters sessions to the active workspace and emits read, write, shell, reasoning, completion, and token events', () => {
    const state = createCodexRolloutParserState();
    const content = [
      row('session_meta', { id: 'session-1', cwd: '/workspace/project' }),
      row('event_msg', { type: 'task_started' }),
      row('event_msg', { type: 'agent_reasoning', text: 'Inspecting the pipeline files.' }),
      row('response_item', { type: 'function_call', name: 'exec_command', call_id: 'shell-1', arguments: JSON.stringify({ cmd: 'npm test', workdir: '/workspace/project' }) }),
      row('response_item', { type: 'function_call_output', call_id: 'shell-1', output: 'ok' }),
      row('response_item', { type: 'function_call', name: 'read_file', call_id: 'read-1', arguments: JSON.stringify({ path: '/workspace/project/.github/agents/reader.agent.md' }) }),
      row('response_item', { type: 'function_call_output', call_id: 'read-1', output: 'name: reader' }),
      row('response_item', { type: 'function_call', name: 'apply_patch', call_id: 'patch-1', arguments: JSON.stringify({ patch: '*** Begin Patch\n*** Update File: .github/artifacts/plan.md\n+done\n*** End Patch' }) }),
      row('response_item', { type: 'function_call_output', call_id: 'patch-1', output: 'Success' }),
      row('event_msg', { type: 'token_count', info: { last_token_usage: { input_tokens: 1234, output_tokens: 99 }, model_context_window: 258400 } }),
      row('event_msg', { type: 'task_complete' })
    ].join('');

    const result = parseCodexRolloutChunk(content, state, { sourceFile: '/logs/rollout.jsonl', workspace: '/workspace', pipeline });

    expect(result.events.map((event) => event.phase)).toEqual(expect.arrayContaining(['started', 'thinking', 'tool', 'file', 'artifact', 'completed']));
    expect(result.events).toContainEqual(expect.objectContaining({ sessionId: 'session-1', phase: 'file', nodeId: 'reader', nodeFile: '.github/agents/reader.agent.md', toolName: 'read_file' }));
    expect(result.events).toContainEqual(expect.objectContaining({ sessionId: 'session-1', phase: 'artifact', nodeId: 'writer', artifactPath: '.github/artifacts/plan.md', toolName: 'apply_patch' }));
    expect(result.events).toContainEqual(expect.objectContaining({ phase: 'tool', toolName: 'exec_command', summary: 'Ran shell command `npm test`.' }));
    expect(result.events).toContainEqual(expect.objectContaining({ phase: 'thinking', summary: 'Inspecting the pipeline files.' }));
    expect(result.events).toContainEqual(expect.objectContaining({ phase: 'thinking', tokenEstimate: 1333, inputTokens: 1234, outputTokens: 99, summary: 'Codex token usage: 1234 input / 99 output tokens.' }));
  });

  it('skips rollout records for unrelated workspaces', () => {
    const state = createCodexRolloutParserState();
    const result = parseCodexRolloutChunk([
      row('session_meta', { id: 'session-2', cwd: '/other/project' }),
      row('response_item', { type: 'function_call', name: 'read_file', call_id: 'read-1', arguments: JSON.stringify({ path: '/other/project/.github/agents/reader.agent.md' }) })
    ].join(''), state, { sourceFile: '/logs/rollout.jsonl', workspace: '/workspace', pipeline });

    expect(result.events).toEqual([]);
  });

  it('keeps partial JSONL lines until a later chunk and does not duplicate previously parsed rows', () => {
    const state = createCodexRolloutParserState();
    const first = parseCodexRolloutChunk(row('session_meta', { id: 'session-3', cwd: '/workspace' }) + '{"timestamp":"2026-06-15T10:00:01.000Z","type":"event_msg","payload":{"type":"agent_reasoning","text":"half', state, { sourceFile: '/logs/rollout.jsonl', workspace: '/workspace', pipeline });
    const second = parseCodexRolloutChunk(' done"}}\n', state, { sourceFile: '/logs/rollout.jsonl', workspace: '/workspace', pipeline });
    const third = parseCodexRolloutChunk('', state, { sourceFile: '/logs/rollout.jsonl', workspace: '/workspace', pipeline });

    expect(first.events).toEqual([expect.objectContaining({ phase: 'started' })]);
    expect(second.events).toEqual([expect.objectContaining({ phase: 'thinking', summary: 'half done' })]);
    expect(third.events).toEqual([]);
  });

  it('returns recent Codex session directories from CODEX_HOME style roots', () => {
    expect(recentCodexSessionDirs('/home/me/.codex', new Date('2026-06-15T02:00:00.000Z'))).toContain('/home/me/.codex/sessions/2026/06/15');
    expect(recentCodexSessionDirs('/home/me/.codex', new Date('2026-06-15T02:00:00.000Z'))).toContain('/home/me/.codex/sessions/2026/06/14');
  });
});
