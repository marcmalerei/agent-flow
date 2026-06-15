import { describe, expect, it } from 'vitest';
import { buildActivitySourceStatuses, type ActivitySourceRuntimeState } from '../src/activity/sources';

describe('activity source statuses', () => {
  it('reports independently disabled and watching activity sources', () => {
    const statuses = buildActivitySourceStatuses({
      filesystem: { enabled: true, watchingPatterns: ['.github/agents/**/*.agent.md'] },
      documents: { enabled: false },
      tools: { enabled: true, registered: true },
      copilotDebugLogs: {
        enabled: true,
        copilotFileLoggingEnabled: true,
        configuredPath: undefined,
        discoveredRoots: ['/tmp/debug-logs'],
        state: 'watching',
        detail: 'Watching 1 Copilot debug log folder.'
      },
      codexRollouts: {
        enabled: true,
        codexHome: '/tmp/.codex',
        discoveredFiles: ['/tmp/.codex/sessions/2026/06/15/rollout.jsonl'],
        state: 'watching',
        detail: 'Watching 1 Codex rollout file.'
      }
    });

    expect(statuses.map((source) => [source.id, source.state])).toEqual([
      ['filesystem', 'watching'],
      ['vscodeDocuments', 'disabled'],
      ['agentFlowTools', 'watching'],
      ['copilotDebugLogs', 'watching'],
      ['codexRollouts', 'watching'],
      ['readCoverage', 'watching']
    ]);
    expect(statuses.find((source) => source.id === 'vscodeDocuments')?.detail).toContain('disabled');
  });

  it('marks read coverage as degraded when no read-capable source is watching', () => {
    const statuses = buildActivitySourceStatuses({
      filesystem: { enabled: true, watchingPatterns: ['.github/agents/**/*.agent.md'] },
      documents: { enabled: false },
      tools: { enabled: false, registered: false },
      copilotDebugLogs: {
        enabled: true,
        copilotFileLoggingEnabled: false,
        configuredPath: undefined,
        discoveredRoots: [],
        state: 'waiting-for-copilot-logging',
        detail: 'Enable GitHub Copilot file logging to import Copilot debug activity.'
      },
      codexRollouts: {
        enabled: false,
        codexHome: '/tmp/.codex',
        discoveredFiles: [],
        state: 'disabled',
        detail: 'Codex rollout activity import is disabled.'
      }
    });

    expect(statuses.find((source) => source.id === 'readCoverage')).toEqual(expect.objectContaining({
      state: 'degraded',
      detail: expect.stringContaining('Reads require')
    } satisfies Partial<ActivitySourceRuntimeState>));
  });
});
