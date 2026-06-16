import { describe, expect, test } from 'vitest';
import { deriveFlowEmptyState } from '../src/webview/emptyState';

describe('flow empty state', () => {
  test('does not show when graph nodes exist', () => {
    expect(deriveFlowEmptyState(1, { hasGithubFolder: false, supportedFileCount: 0 }).kind).toBe('none');
  });

  test('guides users to create a default pipeline when .github is missing', () => {
    const state = deriveFlowEmptyState(0, { hasGithubFolder: false, supportedFileCount: 0 });

    expect(state.kind).toBe('no-workspace-files');
    expect(state.title).toContain('No Agent Flow files');
    expect(state.primaryAction.command).toBe('agentflow.createDefaultPipeline');
    expect(state.secondaryActions.map((action) => action.command)).toContain('agentflow.checkSetup');
    expect(state.secondaryActions.map((action) => action.command)).toContain('agentflow.playDemoActivity');
  });

  test('explains when .github exists without supported customization files', () => {
    const state = deriveFlowEmptyState(0, { hasGithubFolder: true, supportedFileCount: 0 });

    expect(state.kind).toBe('no-supported-files');
    expect(state.detail).toContain('no agent, prompt, instruction, skill, role, or artifact files');
  });

  test('recommends setup validation when supported files produce no graph nodes', () => {
    const state = deriveFlowEmptyState(0, { hasGithubFolder: true, supportedFileCount: 2 });

    expect(state.kind).toBe('no-graphable-nodes');
    expect(state.primaryAction.command).toBe('agentflow.checkSetup');
    expect(state.secondaryActions.map((action) => action.command)).toContain('agentflow.scanWorkspace');
    expect(state.secondaryActions.map((action) => action.command)).toContain('agentflow.playDemoActivity');
  });
});
