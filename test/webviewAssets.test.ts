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

  test('organizes the inspector around task workflows', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('InspectorSection');
    expect(webviewSource).toContain('InspectorQuickActions');
    expect(webviewSource).toContain('ToolSelectionSummary');
    expect(webviewSource).toContain('inspector-sticky-header');
    expect(webviewSource).toContain('Identity');
    expect(webviewSource).toContain('Run behavior');
    expect(webviewSource).toContain('Context');
    expect(webviewSource).toContain('Artifacts');
    expect(webviewSource).toContain("command: 'openWorkspaceFile'");
    expect(css).toContain('.inspector-sticky-header');
    expect(css).toContain('.inspector-quick-actions');
    expect(css).toContain('.tool-selection-summary');
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
    expect(css).toContain('.graph-edge.support-edge');
    expect(css).toContain('.graph-edge.focus-muted');
    expect(css).toContain('.agentflow-node.focus-muted');
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

  test('adds selected-node focus classes to mute unrelated graph content', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(webviewSource).toContain('focusNodeSet');
    expect(webviewSource).toContain('focus-related');
    expect(webviewSource).toContain('focus-muted');
    expect(webviewSource).toContain('support-edge');
    expect(webviewSource).toContain('isSupportEdge');
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
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(tokenNodeSource).toContain('has-activity');
    expect(tokenNodeSource).toContain('activity-node-');
    expect(tokenNodeSource).toContain('activity-freshness-');
    expect(tokenNodeSource).toContain('runtime-');
    expect(tokenNodeSource).toContain('runtime-badge');
    expect(webviewSource).toContain('freshActivityEvents');
    expect(webviewSource).toContain('ActivityHud');
    expect(webviewSource).toContain('activityTrail');
    expect(webviewSource).toContain('canReportReads');
    expect(css).toContain('.flow-node.has-activity');
    expect(css).toContain('.flow-node.activity-freshness-fresh');
    expect(css).toContain('.flow-node.activity-freshness-recent');
    expect(css).toContain('.flow-node.runtime-error');
    expect(css).toContain('.activity-file');
    expect(css).toContain('.activity-artifact');
    expect(css).toContain('nodeActivityPulse');
  });

  test('organizes inspector as task-oriented editing flow', () => {
    const source = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(source).toContain('inspector-section-identity');
    expect(source).toContain('Run behavior');
    expect(source).toContain('Routing');
    expect(source).toContain('Context');
    expect(source).toContain('Artifacts');
    expect(source).toContain('Open file');
    expect(source).toContain('selectedToolSummary');
    expect(css).toContain('.config-header.sticky');
    expect(css).toContain('.inspector-section-summary');
  });

  test('turns validation diagnostics into actionable workflows', () => {
    const source = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(source).toContain('Ready to run');
    expect(source).toContain('validation-filter-bar');
    expect(source).toContain('diagnostic-workflow-card');
    expect(source).toContain('Focus node');
    expect(source).toContain('Apply quick fix');
    expect(source).toContain('openInspectorSection');
    expect(source).toContain('finding.entity');
    expect(css).toContain('.validation-ready-summary');
    expect(css).toContain('.validation-filter-bar');
    expect(css).toContain('.diagnostic-workflow-card');
    expect(css).toContain('.diagnostic-actions');
  });

  test('offers guided connection creation from the inspector', () => {
    const source = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(source).toContain('GuidedConnectionPanel');
    expect(source).toContain('ConnectionIntentChooser');
    expect(source).toContain('buildConnectionIntentOptions');
    expect(source).toContain('applyConnectionIntent');
    expect(source).toContain('Connect from selected');
    expect(source).toContain('Create without connection');
    expect(source).toContain('Create and connect');
    expect(source).toContain('Add connection');
    expect(source).toContain('Connection preview');
    expect(source).toContain('placeholder token');
    expect(source).toContain('invalid-connection-option');
    expect(css).toContain('.guided-connection-panel');
    expect(css).toContain('.connection-intent-chooser');
    expect(css).toContain('.connection-intent-preview');
  });

  test('documents and exposes keyboard accessible graph controls', () => {
    const source = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');
    const docs = readFileSync('docs/development.md', 'utf8');
    const readme = readFileSync('README.md', 'utf8');

    expect(source).toContain('ShortcutsHelp');
    expect(source).toContain('KeyboardShortcutsPopover');
    expect(source).toContain('spatialNeighborNodeId');
    expect(source).toContain('ArrowLeft');
    expect(source).toContain('ArrowRight');
    expect(source).toContain('ArrowUp');
    expect(source).toContain('ArrowDown');
    expect(source).toContain("event.key.toLowerCase() === 'f'");
    expect(source).toContain("event.key === 'Enter'");
    expect(source).toContain('aria-label={`Graph node ${node.data.label}');
    expect(source).toContain('aria-label="Zoom in graph"');
    expect(source).toContain('aria-keyshortcuts');
    expect(css).toContain('.shortcut-help');
    expect(css).toContain('.keyboard-shortcuts-popover');
    expect(css).toContain('@media (forced-colors: active)');
    expect(docs).toContain('Keyboard shortcuts');
    expect(docs).toContain('Arrow keys');
    expect(docs).toContain('Backspace/Delete');
    expect(readme).toContain('Keyboard shortcuts');
    expect(readme).toContain('Arrow keys');
    expect(readme).toContain('Backspace');
  });

  test('reserves node header space so badges do not overlap labels', () => {
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(css).toContain('padding: 38px 18px 14px');
    expect(css).toContain('-webkit-line-clamp: 2');
    expect(css).toContain('.flow-node.has-activity.is-dirty');
    expect(css).toContain('.flow-node.has-activity.is-dirty .runtime-badge');
  });
});
