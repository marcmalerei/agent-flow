import { describe, expect, it } from 'vitest';
import { graphModePanelTarget, graphModes } from '../src/webview/graphModes';

describe('graph workflow modes', () => {
  it('defines edit, run, and diagnose modes with toolbar metadata', () => {
    expect(graphModes).toEqual([
      expect.objectContaining({ id: 'edit', label: 'Edit', icon: 'edit', description: expect.stringContaining('Create') }),
      expect.objectContaining({ id: 'run', label: 'Run', icon: 'pulse', description: expect.stringContaining('activity') }),
      expect.objectContaining({ id: 'diagnose', label: 'Diagnose', icon: 'warning', description: expect.stringContaining('diagnostics') })
    ]);
  });

  it('opens the task-relevant bottom panel when switching run or diagnose mode', () => {
    expect(graphModePanelTarget('edit')).toBeUndefined();
    expect(graphModePanelTarget('run')).toBe('activity');
    expect(graphModePanelTarget('diagnose')).toBe('validation');
  });
});
