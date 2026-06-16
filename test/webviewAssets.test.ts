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
    expect(webviewSource).toContain('nodePaletteGroups');
    expect(webviewSource).toContain('Add Node');
    expect(webviewSource).not.toContain('className="node-buttons"');
  });

  test('exposes builder clipboard and complete undo redo controls', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(webviewSource).toContain('duplicatePipelineSelection');
    expect(webviewSource).toContain('copySelection');
    expect(webviewSource).toContain('pasteSelection');
    expect(webviewSource).toContain('redoLast');
    expect(webviewSource).toContain('canRedo');
  });

  test('uses compact TipTap editors for reference instructions', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(webviewSource).toContain('ReferenceMarkdownEditor');
    expect(webviewSource).toContain('variant="compact"');
    expect(webviewSource).not.toContain('placeholder="Add the instruction for this artifact." onChange');
    expect(webviewSource).not.toContain('placeholder={`How should this node apply');
  });

  test('uses a native graph renderer instead of React Flow inside VS Code webviews', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');
    const panelSource = readFileSync('src/webview/panel.ts', 'utf8');
    const packageJson = readFileSync('package.json', 'utf8');

    expect(packageJson).not.toContain('@xyflow/react');
    expect(webviewSource).not.toContain('@xyflow/react');
    expect(webviewSource).not.toContain('ReactFlow');
    expect(webviewSource).not.toContain('react-flow');
    expect(webviewSource).toContain('NativeGraph');
    expect(webviewSource).toContain('graph-viewport');
    expect(webviewSource).toContain('agentflow-node');
    expect(webviewSource).toContain('activeNodeIds');
    expect(webviewSource).toContain('graph-edge-path');
    expect(webviewSource).toContain('edgePathBetweenNodes');
    expect(webviewSource).toContain('graph-edge-tracer');
    expect(webviewSource).toContain('animateMotion');
    expect(webviewSource).toContain('fitNativeGraphViewport');
    expect(webviewSource).toContain('focusViewportOnNode');
    expect(webviewSource).toContain('normalizeGraphNodePositions');
    expect(webviewSource).toContain('shouldAutoFitGraph');
    expect(webviewSource).toContain('postFlowRenderStatus');
    expect(webviewSource).toContain('renderedNativeNodeIds');
    expect(webviewSource).toContain('webviewBootId');
    expect(webviewSource).toContain("command: 'webviewReady'");
    expect(webviewSource).toContain('DebugOverlay');
    expect(webviewSource).toContain('graphTransform');
    expect(webviewSource).toContain('preferredVisibleNodeCount');
    expect(webviewSource).toContain('nodeRuntime');
    expect(webviewSource).toContain('visibleNativeNodeCount');
    expect(webviewSource).toContain('minimumUsefulVisibleNodeCount');
    expect(webviewSource).toContain('ResizeObserver');
    expect(css).toContain('#root { position: fixed; inset: 0; }');
    expect(css).toContain('--agentflow-canvas-min-height: 360px');
    expect(css).toContain('grid-template-rows: 56px minmax(var(--agentflow-canvas-min-height), 1fr) 42px');
    expect(css).toContain('min-height: var(--agentflow-canvas-min-height)');
    expect(css).toContain('.debug-overlay');
    expect(css).toContain('.native-graph');
    expect(css).toContain('.graph-edge-path');
    expect(css).toContain('.graph-edge.activity-edge');
    expect(css).toContain('.graph-edge.loop-edge');
    expect(css).toContain('.graph-edge.error-edge');
    expect(css).toContain('.graph-edge-tracer');
    expect(css).toContain('.agentflow-node');
    expect(css).toContain('.agentflow-node.active');
    expect(css).not.toContain('react-flow__');
    expect(panelSource).toContain('onDidChangeViewState');
    expect(panelSource).toContain('retainContextWhenHidden: true');
    expect(panelSource).toContain('initial-pipeline-recovery');
    expect(panelSource).toContain('scheduleStartupTask');
    expect(panelSource).toContain('webviewRenderedNodeIds');
    expect(panelSource).toContain('webviewReadyBootId');
    expect(panelSource).toContain('webviewRootHeight');
    expect(panelSource).toContain('webviewGraphTransform');
    expect(panelSource).not.toContain('webviewReactFlowTransform');
    expect(panelSource).toContain("message?.command === 'webviewRenderStatus'");
    expect(panelSource).toContain("message?.command === 'webviewReady'");
    expect(panelSource).toContain("command: 'stateUpdated'");
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

  test('shows recoverable empty states with command actions instead of a blank canvas', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const panelSource = readFileSync('src/webview/panel.ts', 'utf8');
    const extensionSource = readFileSync('src/extension.ts', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('deriveFlowEmptyState');
    expect(webviewSource).toContain('FlowEmptyStateView');
    expect(webviewSource).toContain("command: 'runCommand'");
    expect(webviewSource).toContain('flow-empty-state');
    expect(panelSource).toContain('summarizeWorkspaceFiles');
    expect(panelSource).toContain('isAllowedWebviewCommand');
    expect(panelSource).toContain('agentflow.createDefaultPipeline');
    expect(panelSource).toContain('agentflow.playDemoActivity');
    expect(panelSource).toContain('agentflow.openDocs');
    expect(extensionSource).toContain('Agent Flow needs graph nodes before demo activity can be shown.');
    expect(css).toContain('.flow-empty-state');
    expect(css).toContain('.flow-empty-card');
  });

  test('animates node-level file and artifact activity', () => {
    const tokenNodeSource = readFileSync('src/webview/TokenNode.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(tokenNodeSource).toContain('has-activity');
    expect(tokenNodeSource).toContain('activity-node-');
    expect(tokenNodeSource).toContain('runtime-');
    expect(tokenNodeSource).toContain('runtime-badge');
    expect(css).toContain('.flow-node.has-activity');
    expect(css).toContain('.flow-node.runtime-error');
    expect(css).toContain('.activity-file');
    expect(css).toContain('.activity-artifact');
    expect(css).toContain('nodeActivityPulse');
  });

  test('reserves node header space so badges do not overlap labels', () => {
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(css).toContain('padding: 38px 18px 14px');
    expect(css).toContain('-webkit-line-clamp: 2');
    expect(css).toContain('.flow-node.has-activity.is-dirty');
    expect(css).toContain('.flow-node.has-activity.is-dirty .runtime-badge');
  });
});
