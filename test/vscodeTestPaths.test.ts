import { describe, expect, it } from 'vitest';

import { createVsCodeTestTempPaths } from '../scripts/vscodeTestPaths.mjs';

describe('createVsCodeTestTempPaths', () => {
  it('creates short temp directories for vscode test runtime state', async () => {
    const paths = await createVsCodeTestTempPaths('agentflow-smoke');

    expect(paths.workspacePath.startsWith('/tmp/')).toBe(true);
    expect(paths.userDataDir.startsWith('/tmp/')).toBe(true);
    expect(paths.extensionsDir.startsWith('/tmp/')).toBe(true);
    expect(paths.userDataDir.length).toBeLessThan(80);
    expect(paths.extensionsDir.length).toBeLessThan(80);
    expect(paths.cleanup).toBeTypeOf('function');

    await paths.cleanup();
  });
});
