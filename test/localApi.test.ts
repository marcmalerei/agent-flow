import { describe, expect, it } from 'vitest';
import { createLocalApiPayload, createWebhookPayload } from '../src/activity/localApi';
import { AgentPipeline } from '../src/pipeline/types';
import { AgentFlowActivityEvent } from '../src/activity/types';

const pipeline: AgentPipeline = {
  name: 'API demo',
  version: 1,
  nodes: [{ id: 'router', type: 'agent', label: 'router', tools: [], calls: [], inputs: [], outputs: [] }],
  edges: []
};

const events: AgentFlowActivityEvent[] = [
  { id: '1', timestamp: '2026-06-15T10:00:00.000Z', sessionId: 's1', phase: 'tool', nodeId: 'router', summary: 'Read ticket.\n```secret prompt text```', toolName: 'read/readFile', tokenEstimate: 12 },
  { id: '2', timestamp: '2026-06-15T10:00:01.000Z', sessionId: 's1', phase: 'completed', nodeId: 'router', summary: 'Done.' }
];

describe('local API payloads', () => {
  it('returns redacted pipeline, activity, metrics, and status payloads', () => {
    expect(createLocalApiPayload('/api/pipeline', { pipeline, events, status: { enabled: true, host: '127.0.0.1', port: 0 } })).toMatchObject({
      name: 'API demo',
      nodes: [{ id: 'router', type: 'agent', label: 'router' }]
    });
    expect(createLocalApiPayload('/api/activity', { pipeline, events, status: { enabled: true, host: '127.0.0.1', port: 0 } })).toEqual([
      expect.objectContaining({ id: '1', summary: 'Read ticket. [redacted code block]', toolName: 'read/readFile' }),
      expect.objectContaining({ id: '2', summary: 'Done.' })
    ]);
    expect(createLocalApiPayload('/api/metrics', { pipeline, events, status: { enabled: true, host: '127.0.0.1', port: 0 } })).toMatchObject({
      summary: { sessions: 1, activeNodes: 1, tokenEstimate: 12 }
    });
    expect(createLocalApiPayload('/api/status', { pipeline, events, status: { enabled: true, host: '127.0.0.1', port: 4987 } })).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 4987,
      endpoints: ['/api/pipeline', '/api/activity', '/api/metrics', '/api/status']
    });
  });

  it('returns undefined for unsupported endpoints', () => {
    expect(createLocalApiPayload('/api/unknown', { pipeline, events, status: { enabled: true, host: '127.0.0.1', port: 0 } })).toBeUndefined();
  });

  it('formats webhook payloads without raw long output', () => {
    const payload = createWebhookPayload(events[0]);
    expect(payload).toEqual(expect.objectContaining({
      id: '1',
      phase: 'tool',
      nodeId: 'router',
      summary: 'Read ticket. [redacted code block]'
    }));
    expect(JSON.stringify(payload)).not.toContain('secret prompt text');
  });
});
