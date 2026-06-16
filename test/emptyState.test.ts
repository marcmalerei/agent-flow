import { describe, expect, test } from 'vitest';
import { deriveFlowEmptyState } from '../src/webview/emptyState';

describe('flow empty state', () => {
  test('does not show when graph nodes exist', () => {
    expect(deriveFlowEmptyState(1, { hasGithubFolder: false, supportedFileCount: 0 }).kind).toBe('none');
  });

  test('guides users to create a default pipeline when .github is missing', () => {
    const state = deriveFlowEmptyState(0, { hasGithubFolder: false, supportedFileCount: 0 });

    expect(state.kind).toBe('no-workspace-files');
    expect(state.title).toContain('Start with a sample flow');
    expect(state.primaryAction.label).toBe('Create sample pipeline');
    expect(state.primaryAction.command).toBe('agentflow.createDefaultPipeline');
    expect(state.secondaryActions.map((action) => action.label)).toEqual(expect.arrayContaining(['Open existing .github pipeline', 'Start guided demo']));
    expect(state.secondaryActions.map((action) => action.command)).toContain('agentflow.startGuidedDemo');
  });

  test('explains when .github exists without supported customization files', () => {
    const state = deriveFlowEmptyState(0, { hasGithubFolder: true, supportedFileCount: 0 });

    expect(state.kind).toBe('no-supported-files');
    expect(state.title).toContain('Create a sample graph');
    expect(state.detail).toContain('no agent, prompt, instruction, skill, role, or artifact files');
    expect(state.primaryAction.label).toBe('Create sample pipeline');
  });

  test('recommends setup validation when supported files produce no graph nodes', () => {
    const state = deriveFlowEmptyState(0, { hasGithubFolder: true, supportedFileCount: 2 });

    expect(state.kind).toBe('no-graphable-nodes');
    expect(state.primaryAction.command).toBe('agentflow.checkSetup');
    expect(state.secondaryActions.map((action) => action.command)).toContain('agentflow.scanWorkspace');
    expect(state.secondaryActions.map((action) => action.command)).toContain('agentflow.startGuidedDemo');
  });
});
