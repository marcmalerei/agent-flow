import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(__dirname, '..');
const extensionTestsPath = join(extensionDevelopmentPath, 'dist-smoke', 'smoke', 'extensionHostSmoke.js');
const workspacePath = await mkdtemp(join(tmpdir(), 'agentflow-smoke-'));

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspacePath,
      '--disable-workspace-trust',
      '--disable-extensions',
      '--disable-gpu'
    ]
  });
} finally {
  await rm(workspacePath, { recursive: true, force: true });
}
