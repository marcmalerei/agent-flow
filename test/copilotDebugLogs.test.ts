import { describe, expect, it } from 'vitest';
import { parseCopilotDebugLogContent } from '../src/activity/copilotDebugLogs';

describe('Copilot debug log parser', () => {
  it('parses usage rows into sanitized activity events and ignores zero-credit rows', () => {
    const content = [
      JSON.stringify({ type: 'llm_request', timestamp: '2026-06-12T10:00:00.000Z', attrs: { copilotUsageNanoAiu: 123000000, model: 'gpt-test', prompt_tokens: 12, completion_tokens: 8 }, sessionId: 'chat-1' }),
      JSON.stringify({ type: 'llm_request', timestamp: '2026-06-12T10:01:00.000Z', attrs: { copilotUsageNanoAiu: 0, model: 'ignored' }, sessionId: 'chat-1' })
    ].join('\n');

    const result = parseCopilotDebugLogContent(content, { sourceFile: '/tmp/debug.jsonl' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(expect.objectContaining({
      phase: 'thinking',
      sessionId: 'chat-1',
      aiCredits: 0.123,
      model: 'gpt-test',
      tokenEstimate: 20,
      sourceFile: '/tmp/debug.jsonl'
    }));
    expect(result.diagnostics).toEqual([]);
  });

  it('reports malformed rows and maps tool-call style rows when present', () => {
    const content = [
      '{broken',
      JSON.stringify({ type: 'tool_call', timestamp: '2026-06-12T10:02:00.000Z', name: 'run_in_terminal', sessionId: 'chat-2', nodeId: 'router', attrs: { filePath: '.github/agents/router.agent.md' } })
    ].join('\n');

    const result = parseCopilotDebugLogContent(content, { sourceFile: '/tmp/debug.jsonl' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(expect.objectContaining({ phase: 'tool', sessionId: 'chat-2', toolName: 'run_in_terminal', nodeId: 'router', nodeFile: '.github/agents/router.agent.md' }));
    expect(result.diagnostics[0]).toContain('line 1');
  });

  it('maps artifact paths from tool-call rows into artifact activity fields', () => {
    const content = JSON.stringify({ type: 'tool_call', timestamp: '2026-06-12T10:03:00.000Z', name: 'readFile', sessionId: 'chat-3', nodeId: 'router', attrs: { path: '.github/artifacts/plan.md' } });

    const result = parseCopilotDebugLogContent(content, { sourceFile: '/tmp/debug.jsonl' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(expect.objectContaining({
      phase: 'tool',
      sessionId: 'chat-3',
      toolName: 'readFile',
      nodeId: 'router',
      artifactPath: '.github/artifacts/plan.md'
    }));
  });

  it('parses generic Copilot debug spans without billing data', () => {
    const content = JSON.stringify({ type: 'session_start', name: 'session_start', ts: 1781290671370, sid: 'debug-1', status: 'ok', attrs: { copilotVersion: 'test' } });

    const result = parseCopilotDebugLogContent(content, { sourceFile: '/tmp/main.jsonl' });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(expect.objectContaining({
      phase: 'started',
      sessionId: 'debug-1',
      summary: 'Copilot debug session started.',
      sourceFile: '/tmp/main.jsonl'
    }));
    expect(result.events[0].timestamp).toBe('2026-06-12T18:57:51.370Z');
  });
});
