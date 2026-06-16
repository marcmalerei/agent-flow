import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import { createVsCodeTestTempPaths } from './vscodeTestPaths.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(__dirname, '..');
const extensionTestsPath = join(extensionDevelopmentPath, 'dist-smoke', 'smoke', 'extensionHostSmoke.js');
const tempPaths = await createVsCodeTestTempPaths('agentflow-smoke');

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      tempPaths.workspacePath,
      '--disable-workspace-trust',
      '--disable-extensions',
      '--disable-gpu',
      `--user-data-dir=${tempPaths.userDataDir}`,
      `--extensions-dir=${tempPaths.extensionsDir}`
    ]
  });
} finally {
  await tempPaths.cleanup();
}
