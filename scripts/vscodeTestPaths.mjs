import { mkdtemp, rm } from 'node:fs/promises';

export async function createVsCodeTestTempPaths(prefix = 'agentflow-smoke') {
  const workspacePath = await mkdtemp(`/tmp/${prefix}-workspace-`);
  const userDataDir = await mkdtemp(`/tmp/${prefix}-user-`);
  const extensionsDir = await mkdtemp(`/tmp/${prefix}-ext-`);

  return {
    workspacePath,
    userDataDir,
    extensionsDir,
    async cleanup() {
      await Promise.all([
        rm(workspacePath, { recursive: true, force: true }),
        rm(userDataDir, { recursive: true, force: true }),
        rm(extensionsDir, { recursive: true, force: true })
      ]);
    }
  };
}
