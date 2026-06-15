import { describe, expect, it } from 'vitest';
import { buildSetupValidationReport, renderSetupValidationReport } from '../src/setup/setupValidator';
import { AgentPipeline } from '../src/pipeline/types';

const pipeline: AgentPipeline = {
  name: 'Setup demo',
  version: 1,
  nodes: [
    { id: 'router', type: 'agent', label: 'router', tools: ['read/readFile', 'missing/tool'], calls: [], inputs: [], outputs: [] },
    { id: 'start', type: 'prompt', label: 'start', tools: ['agent/runSubagent'], workflow: [], constraints: [] }
  ],
  edges: []
};

describe('setup validator', () => {
  it('reports missing workspace structure and offers default pipeline creation', () => {
    const report = buildSetupValidationReport({
      vscodeVersion: '1.120.0',
      minimumVscodeVersion: '1.120.0',
      hasLanguageModelToolApi: true,
      workspace: {
        root: '/workspace',
        existingPaths: ['.github'],
        pipeline
      },
      registeredTools: ['read/readFile', 'agent/runSubagent'],
      activitySources: []
    });

    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workspace.agents-folder', severity: 'error', fix: 'createDefaultPipeline' }),
      expect.objectContaining({ id: 'workspace.pipeline-files', severity: 'warning', fix: 'createDefaultPipeline' })
    ]));
    expect(report.summary.errors).toBe(3);
  });

  it('maps configured tools to registered VS Code tools', () => {
    const report = buildSetupValidationReport({
      vscodeVersion: '1.120.0',
      minimumVscodeVersion: '1.120.0',
      hasLanguageModelToolApi: true,
      workspace: {
        root: '/workspace',
        existingPaths: ['.github/agents', '.github/prompts', '.github/instructions', '.github/artifacts', '.github/agents/router.agent.md'],
        pipeline
      },
      registeredTools: ['read/readFile', 'agent/runSubagent'],
      activitySources: []
    });

    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'tools.unavailable',
      severity: 'warning',
      detail: expect.stringContaining('missing/tool')
    }));
    expect(report.availableTools).toEqual(['agent/runSubagent', 'read/readFile']);
    expect(report.unavailableTools).toEqual(['missing/tool']);
  });

  it('flags missing VS Code APIs and degraded activity sources with actionable fixes', () => {
    const report = buildSetupValidationReport({
      vscodeVersion: '1.119.0',
      minimumVscodeVersion: '1.120.0',
      hasLanguageModelToolApi: false,
      workspace: {
        root: '/workspace',
        existingPaths: ['.github/agents', '.github/prompts', '.github/instructions', '.github/artifacts', '.github/agents/router.agent.md'],
        pipeline
      },
      registeredTools: [],
      activitySources: [
        {
          id: 'copilotDebugLogs',
          label: 'Copilot debug logs',
          state: 'degraded',
          detail: 'Enable GitHub Copilot file logging to import Copilot debug activity.',
          canReportReads: false,
          canReportWrites: false,
          metadata: { discoveredRoots: [] }
        },
        {
          id: 'codexRollouts',
          label: 'Codex rollout logs',
          state: 'degraded',
          detail: 'No recent Codex rollout sessions found for /workspace.',
          canReportReads: false,
          canReportWrites: false,
          metadata: { codexHome: '/home/user/.codex', discoveredFiles: [] }
        }
      ]
    });

    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'vscode.version', severity: 'error', fix: 'openDocs' }),
      expect.objectContaining({ id: 'vscode.lm-tools-api', severity: 'error', fix: 'openDocs' }),
      expect.objectContaining({ id: 'activity.copilotDebugLogs', severity: 'warning', fix: 'openSettings' }),
      expect.objectContaining({ id: 'activity.codexRollouts', severity: 'warning', fix: 'openDocs' })
    ]));
  });

  it('renders a setup report with selected fixes and tool mapping', () => {
    const report = buildSetupValidationReport({
      vscodeVersion: '1.120.0',
      minimumVscodeVersion: '1.120.0',
      hasLanguageModelToolApi: true,
      workspace: {
        root: '/workspace',
        existingPaths: ['.github/agents', '.github/prompts', '.github/instructions', '.github/artifacts', '.github/agents/router.agent.md'],
        pipeline
      },
      registeredTools: ['read/readFile', 'agent/runSubagent'],
      activitySources: []
    });

    const markdown = renderSetupValidationReport(report);
    expect(markdown).toContain('# Agent Flow Setup Check');
    expect(markdown).toContain('## Tool Availability');
    expect(markdown).toContain('- `read/readFile`');
    expect(markdown).toContain('- `missing/tool`');
    expect(markdown).toContain('Fix:');
  });
});
