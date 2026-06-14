import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('webview assets', () => {
  test('loads Codicons from packaged webview resources', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies?: Record<string, string> };
    const viteConfig = readFileSync('vite.webview.config.mts', 'utf8');
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const componentSource = readFileSync('src/webview/components.tsx', 'utf8');
    const panelSource = readFileSync('src/webview/panel.ts', 'utf8');

    expect(packageJson.devDependencies).toHaveProperty('@vscode/codicons');
    expect(viteConfig).toContain("base: './'");
    expect(webviewSource).toContain("@vscode/codicons/dist/codicon.css");
    expect(componentSource).toContain('codicon codicon-');
    expect(panelSource).toContain('font-src ${webview.cspSource};');
  });

  test('uses a compact Add Node menu instead of a node button strip', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(webviewSource).toContain('add-node-menu');
    expect(webviewSource).toContain('Add Node');
    expect(webviewSource).not.toContain('className="node-buttons"');
  });

  test('uses compact TipTap editors for reference instructions', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(webviewSource).toContain('ReferenceMarkdownEditor');
    expect(webviewSource).toContain('variant="compact"');
    expect(webviewSource).not.toContain('placeholder="Add the instruction for this artifact." onChange');
    expect(webviewSource).not.toContain('placeholder={`How should this node apply');
  });

  test('stabilizes React Flow sizing inside VS Code webviews', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');
    const panelSource = readFileSync('src/webview/panel.ts', 'utf8');

    expect(webviewSource).toContain('scheduleFlowFit');
    expect(webviewSource).toContain('postFlowRenderStatus');
    expect(webviewSource).toContain('renderedFlowNodeIds');
    expect(webviewSource).toContain('webviewBootId');
    expect(webviewSource).toContain("command: 'webviewReady'");
    expect(webviewSource).toContain('visibleFlowNodeCount');
    expect(webviewSource).toContain('flowMountRevision');
    expect(webviewSource).toContain('flowRenderKey');
    expect(webviewSource).toContain('visibilityWatchdog');
    expect(webviewSource).toContain('shouldRecoverFlowRender');
    expect(webviewSource).toContain("event.data?.command === 'refitFlow'");
    expect(webviewSource).toContain('ResizeObserver');
    expect(css).toContain('.canvas .react-flow');
    expect(panelSource).toContain('onDidChangeViewState');
    expect(panelSource).toContain('retainContextWhenHidden: true');
    expect(panelSource).toContain('initial-pipeline-recovery');
    expect(panelSource).toContain('scheduleStartupTask');
    expect(panelSource).toContain('webviewRenderedNodeIds');
    expect(panelSource).toContain('webviewReadyBootId');
    expect(panelSource).toContain("message?.command === 'webviewRenderStatus'");
    expect(panelSource).toContain("message?.command === 'webviewReady'");
    expect(panelSource).toContain("command: 'stateUpdated'");
    expect(panelSource).toContain("command: 'refitFlow'");
  });

  test('surfaces webview bundle load and runtime failures instead of a blank panel', () => {
    const panelSource = readFileSync('src/webview/panel.ts', 'utf8');

    expect(panelSource).toContain('webviewRuntimeError');
    expect(panelSource).toContain('Agent Flow webview failed to load');
    expect(panelSource).toContain("document.createElement('script')");
    expect(panelSource).toContain('script.onerror');
    expect(panelSource).toContain('ResizeObserver loop');
    expect(panelSource).toContain('__AGENTFLOW_APP_BOOTED__');
  });

  test('animates node-level file and artifact activity', () => {
    const tokenNodeSource = readFileSync('src/webview/TokenNode.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(tokenNodeSource).toContain('has-activity');
    expect(tokenNodeSource).toContain('activity-node-');
    expect(css).toContain('.flow-node.has-activity');
    expect(css).toContain('.activity-file');
    expect(css).toContain('.activity-artifact');
    expect(css).toContain('nodeActivityPulse');
  });
});
