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

  test('wraps top toolbar groups so narrow widths keep controls reachable', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('toolbar-brand');
    expect(webviewSource).toContain('toolbar-workflow');
    expect(webviewSource).toContain('toolbar-actions');
    expect(webviewSource).toContain('toolbar-status-row');
    expect(css).toContain('--agentflow-toolbar-min-height: 56px');
    expect(css).toContain('grid-template-rows: minmax(var(--agentflow-toolbar-min-height), auto) minmax(var(--agentflow-canvas-min-height), 1fr) 42px');
    expect(css).toContain('.toolbar { grid-column: 1 / 3; display: flex; align-items: center; flex-wrap: wrap;');
    expect(css).toContain('@media (max-width: 720px) {');
    expect(css).toContain('.toolbar-brand, .toolbar-workflow, .toolbar-actions, .toolbar-status-row { flex: 1 1 100%; }');
    expect(css).toContain('.activity-hud { flex: 1 1 220px; max-width: none; }');
  });

  test('waits for Add Node palette headings with selector-based capture checks', () => {
    const captureScript = readFileSync('scripts/capture-preview-gif.mjs', 'utf8');

    expect(captureScript).toContain("await waitForSelectorText(cdp, '.node-palette-group h3', 'Execution');");
    expect(captureScript).toContain("await waitForSelectorText(cdp, '.node-creation-preview span', 'Generated file');");
    expect(captureScript).toContain('async function waitForSelectorText(cdp, selector, text) {');
  });

  test('previews file-first node creation before mutating the pipeline', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const builderSource = readFileSync('src/webview/builderMutations.ts', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('NodeCreationForm');
    expect(webviewSource).toContain('Generated file');
    expect(webviewSource).toContain('Name or id');
    expect(webviewSource).toContain('Created ');
    expect(webviewSource).toContain('createPipelineNode');
    expect(builderSource).toContain('previewNodeCreation');
    expect(builderSource).toContain('normalized');
    expect(css).toContain('.node-creation-form');
    expect(css).toContain('.creation-feedback');
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

  test('renders reference editors as full-width intent cards', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('ReferenceIntentCard');
    expect(webviewSource).toContain('RoleReferenceSelector');
    expect(webviewSource).toContain('Open referenced file');
    expect(webviewSource).toContain('writes Markdown block');
    expect(webviewSource).toContain('parsed from Markdown');
    expect(webviewSource).toContain('needs repair');
    expect(webviewSource).toContain('Generated Markdown');
    expect(webviewSource).toContain("command: 'openWorkspaceFile'");
    expect(css).toContain('.reference-intent-card');
    expect(css).toContain('.reference-intent-card.selected');
    expect(css).toContain('.reference-intent-header');
    expect(css).toContain('.reference-card-actions');
    expect(css).toContain('.reference-sync-status');
  });

  test('organizes the inspector around task workflows', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('InspectorSection');
    expect(webviewSource).toContain('InspectorQuickActions');
    expect(webviewSource).toContain('InspectorHeader');
    expect(webviewSource).toContain('deriveInspectorSyncStatus');
    expect(webviewSource).toContain('ToolSelectionSummary');
    expect(webviewSource).toContain('inspector-sticky-header');
    expect(webviewSource).toContain('inspector-sync-status');
    expect(webviewSource).toContain('Identity');
    expect(webviewSource).toContain('Run behavior');
    expect(webviewSource).toContain('Context');
    expect(webviewSource).toContain('Artifacts');
    expect(webviewSource).toContain('Content');
    expect(webviewSource).toContain('Health');
    expect(webviewSource).toContain("command: 'openWorkspaceFile'");
    expect(css).toContain('.inspector-sticky-header');
    expect(css).toContain('.inspector-sync-status');
    expect(css).toContain('.inspector-sync-external-change');
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
    expect(webviewSource).toContain('shouldFocusLiveActivity');
    expect(webviewSource).toContain('followLiveActivity');
    expect(webviewSource).toContain('Follow live');
    expect(webviewSource).toContain('graph-edge-path');
    expect(webviewSource).toContain('edgePathBetweenNodes');
    expect(webviewSource).toContain('graph-edge-tracer');
    expect(webviewSource).toContain('animateMotion');
    expect(webviewSource).toContain('edgeTooltip(edge');
    expect(webviewSource).toContain('activeEdgeClass(edge)');
    expect(webviewSource).toContain('edgeLabelVisibilityClass(edge');
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
    expect(css).toContain('grid-template-rows: minmax(var(--agentflow-toolbar-min-height), auto) minmax(var(--agentflow-canvas-min-height), 1fr) 42px');
    expect(css).toContain('min-height: var(--agentflow-canvas-min-height)');
    expect(css).toContain('.debug-overlay');
    expect(css).toContain('.native-graph');
    expect(css).toContain('.graph-edge-path');
    expect(css).toContain('.graph-edge.activity-edge');
    expect(css).toContain('.graph-edge.active-read');
    expect(css).toContain('.graph-edge.active-write');
    expect(css).toContain('.graph-edge.active-handoff');
    expect(css).toContain('.graph-edge.support-edge');
    expect(css).toContain('.graph-edge.edge-label-interactive .graph-edge-label');
    expect(css).toContain('.graph-edge.edge-label-visible .graph-edge-label');
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

  test('keeps graph arrowheads tiny when edge strokes get wider', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(webviewSource).toContain('markerWidth="3.5"');
    expect(webviewSource).toContain('markerHeight="3.5"');
    expect(webviewSource).toContain('refX="3.2"');
    expect(webviewSource).toContain('refY="1.75"');
    expect(webviewSource).toContain('markerUnits="userSpaceOnUse"');
    expect(webviewSource).toContain('M 0 0 L 3.5 1.75 L 0 3.5 z');
  });

  test('adds graph overview and navigation landmarks for large canvases', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('GraphOverview');
    expect(webviewSource).toContain('graphOverviewMetrics');
    expect(webviewSource).toContain('graph-navigation-landmarks');
    expect(webviewSource).toContain('Jump to start');
    expect(webviewSource).toContain('Jump to active node');
    expect(webviewSource).toContain('Jump to selected node');
    expect(webviewSource).toContain('Jump to first problem');
    expect(webviewSource).toContain('aria-label="Graph overview"');
    expect(css).toContain('.graph-overview');
    expect(css).toContain('.graph-navigation-landmarks');
    expect(css).toContain('.overview-node.problem');
    expect(css).toContain('.overview-viewport');
  });

  test('adds graph search and selected-neighborhood fitting controls', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('GraphSearchControl');
    expect(webviewSource).toContain('graphSearchResults');
    expect(webviewSource).toContain('graphNeighborhoodNodeIds');
    expect(webviewSource).toContain('fitGraphNodesViewport');
    expect(webviewSource).toContain('Search graph');
    expect(webviewSource).toContain('Fit selected neighborhood');
    expect(webviewSource).toContain('Search results');
    expect(webviewSource).toContain('Clear graph search');
    expect(css).toContain('.graph-search-control');
    expect(css).toContain('.graph-search-results');
  });

  test('adds a fit meaningful flow action for large graphs', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const meaningfulFlowSource = readFileSync('src/webview/meaningfulFlow.ts', 'utf8');

    expect(webviewSource).toContain('fitMeaningfulFlow');
    expect(webviewSource).toContain('Fit meaningful flow');
    expect(webviewSource).toContain('meaningfulFlowNodeIds');
    expect(meaningfulFlowSource).toContain('primaryMeaningfulFlowTypes');
  });

  test('adds graph type filters, focus clearing, and artifact relationship summaries', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('GraphTypeFilters');
    expect(webviewSource).toContain('graphTypeFilterOptions');
    expect(webviewSource).toContain('visibleGraphNodeIdsForTypes');
    expect(webviewSource).toContain('ArtifactRelationshipSummary');
    expect(webviewSource).toContain('artifactRelationshipSummary');
    expect(webviewSource).toContain('Clear graph focus');
    expect(webviewSource).toContain('No graph nodes match the active graph filters.');
    expect(webviewSource).toContain('aria-label="Graph type filters"');
    expect(webviewSource).toContain("event.key === 'Escape'");
    expect(css).toContain('.graph-type-filters');
    expect(css).toContain('.graph-focus-chip');
    expect(css).toContain('.graph-filter-empty');
    expect(css).toContain('.artifact-relationship-summary');
  });

  test('keeps graph controls compact and prevents accidental canvas text selection', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('graph-toolstrip');
    expect(css).toContain('.native-graph {');
    expect(css).toContain('user-select: none');
    expect(css).toContain('-webkit-user-select: none');
    expect(css).toContain('.native-graph input');
    expect(css).toContain('user-select: text');
    expect(css).toContain('.graph-toolstrip');
    expect(css).toContain('grid-template-columns: minmax(0, max-content) minmax(0, max-content) minmax(0, 1fr)');
    expect(css).toContain('.graph-toolstrip .graph-reading-level-switch');
  });

  test('adds semantic graph focus modes for investigative views', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const graphSearchSource = readFileSync('src/webview/graphSearch.ts', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('GraphFocusModeSwitch');
    expect(webviewSource).toContain('visibleGraphNodeIdsForFocus');
    expect(webviewSource).toContain('graphFocusMode');
    expect(graphSearchSource).toContain('graphFocusModes');
    expect(graphSearchSource).toContain('Selected neighborhood');
    expect(graphSearchSource).toContain('Active run');
    expect(graphSearchSource).toContain('Execution path');
    expect(css).toContain('.graph-focus-mode-switch');
  });

  test('adds selected-node external edit conflict banner actions', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const panelSource = readFileSync('src/webview/panel.ts', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('InspectorConflictBanner');
    expect(webviewSource).toContain('This file changed outside Agent Flow');
    expect(webviewSource).toContain('Apply external changes');
    expect(webviewSource).toContain('Keep my edit');
    expect(webviewSource).toContain('Open diff');
    expect(webviewSource).toContain('Cancel local edit');
    expect(webviewSource).toContain("command: 'openNodeDiff'");
    expect(panelSource).toContain("message?.command === 'openNodeDiff'");
    expect(panelSource).toContain('vscode.diff');
    expect(css).toContain('.inspector-conflict-banner');
  });

  test('surfaces graph sync state and stale-view recovery in the toolbar', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const panelSource = readFileSync('src/webview/panel.ts', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('SyncStatusIndicator');
    expect(webviewSource).toContain('SyncTrustBanner');
    expect(webviewSource).toContain('syncStatusForRemoteMerge');
    expect(webviewSource).toContain('merged.reason');
    expect(webviewSource).toContain('Stale view kept');
    expect(webviewSource).toContain('External changes detected');
    expect(webviewSource).toContain('Reload graph');
    expect(webviewSource).toContain('Open diagnostics');
    expect(panelSource).toContain('reason, state:');
    expect(css).toContain('.autosave-status.sync-status-stale-view');
    expect(css).toContain('.sync-trust-banner');
  });

  test('previews node renames before autosave rewrites files and references', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('RenamePreview');
    expect(webviewSource).toContain('deriveRenamePreview');
    expect(webviewSource).toContain('Rename preview');
    expect(webviewSource).toContain('References to update');
    expect(webviewSource).toContain('Normalized to lower-case');
    expect(webviewSource).toContain('onBlur={commitLabelDraft}');
    expect(css).toContain('.rename-preview');
    expect(css).toContain('.rename-preview-grid');
  });

  test('makes tool selection searchable with VS Code-style group counts', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const toolOptionsSource = readFileSync('src/webview/toolOptions.ts', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('Search tools');
    expect(webviewSource).toContain('filterToolOptionGroups');
    expect(webviewSource).toContain('toolOptionGroupSelectionSummary');
    expect(webviewSource).toContain('tool-search-empty');
    expect(toolOptionsSource).toContain('filterToolOptionGroups');
    expect(toolOptionsSource).toContain('toolOptionGroupSelectionSummary');
    expect(css).toContain('.tool-search');
    expect(css).toContain('.tool-group-count');
  });

  test('adds explicit graph workflow modes for edit, run, and diagnose', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('GraphModeSwitch');
    expect(webviewSource).toContain('graphModes');
    expect(webviewSource).toContain('graphModePanelTarget');
    expect(webviewSource).toContain('graph-mode-switch');
    expect(webviewSource).toContain('graph-mode-diagnose');
    expect(webviewSource).toContain('diagnose-muted');
    expect(webviewSource).toContain("setActiveTab('activity')");
    expect(webviewSource).toContain("setActiveTab('validation')");
    expect(css).toContain('.graph-mode-switch');
    expect(css).toContain('.app.graph-mode-run');
    expect(css).toContain('.app.graph-mode-diagnose');
    expect(css).toContain('.agentflow-node.diagnose-muted');
  });

  test('adds graph reading level controls for complex flow scanning', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const readingLevelSource = readFileSync('src/webview/graphReadingLevels.ts', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('GraphReadingLevelSwitch');
    expect(webviewSource).toContain('graphReadingLevels');
    expect(webviewSource).toContain('sessionStorage');
    expect(webviewSource).toContain('reading-level-selected-path');
    expect(readingLevelSource).toContain('Data flow');
    expect(readingLevelSource).toContain('reading-write');
    expect(readingLevelSource).toContain('reading-read');
    expect(css).toContain('.graph-reading-level-switch');
    expect(css).toContain('.reading-level-selected-path');
    expect(css).toContain('.graph-edge.reading-write');
  });

  test('adds selected-node focus classes to mute unrelated graph content', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(webviewSource).toContain('focusNodeSet');
    expect(webviewSource).toContain('focus-related');
    expect(webviewSource).toContain('focus-muted');
    expect(webviewSource).toContain('support-edge');
    expect(webviewSource).toContain('isSupportEdge');
  });

  test('defines visual collision priority classes for nodes, badges, labels, and edges', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');
    const prioritySource = readFileSync('src/webview/visualPriority.ts', 'utf8');

    expect(prioritySource).toContain('graphVisualPriorityOrder');
    expect(webviewSource).toContain('nodeVisualPriorityClass');
    expect(webviewSource).toContain('edgeVisualPriorityClass');
    expect(css).toContain('.agentflow-node.node-priority-selected');
    expect(css).toContain('.agentflow-node.node-priority-activity');
    expect(css).toContain('.agentflow-node.node-priority-status');
    expect(css).toContain('.graph-edge.edge-priority-active');
    expect(css).toContain('.graph-edge.edge-priority-support .graph-edge-label');
    expect(css).toContain('.flow-node-label');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('.node-meta-slot');
    expect(css).toContain('.node-status-slot');
    expect(css).toContain('.flow-node-type-handoff');
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
    expect(panelSource).toContain('agentflow.startGuidedDemo');
    expect(panelSource).toContain('agentflow.openDocs');
    expect(extensionSource).toContain('Agent Flow guided demo can use the current graph or create sample files only after you confirm.');
    expect(extensionSource).toContain('resetGuidedDemoCommand');
    expect(css).toContain('.flow-empty-state');
    expect(css).toContain('.flow-empty-card');
  });

  test('adds a dismissible first-run guide for the default sample pipeline', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('FirstRunGuideCallout');
    expect(webviewSource).toContain('isDefaultSamplePipeline');
    expect(webviewSource).toContain('agentflow.firstRunGuideDismissed');
    expect(webviewSource).toContain('Create artifact reference');
    expect(webviewSource).toContain('Start guided demo');
    expect(css).toContain('.first-run-guide');
  });

  test('shows graph startup and recovery states when parsed nodes are not visible', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const recoverySource = readFileSync('src/webview/graphRecoveryState.ts', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('deriveGraphRecoveryState');
    expect(webviewSource).toContain('FlowRecoveryStateView');
    expect(webviewSource).toContain("command: 'copyDebugSnapshot'");
    expect(recoverySource).toContain('Retry render');
    expect(recoverySource).toContain('Graph render needs attention');
    expect(css).toContain('.flow-recovery-state');
    expect(css).toContain('.flow-recovery-card');
  });

  test('reserves node badge regions so labels do not compete with status chips', () => {
    const nodeSource = readFileSync('src/webview/TokenNode.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');
    const geometrySource = readFileSync('src/webview/graphGeometry.ts', 'utf8');

    expect(nodeSource).toContain('flow-node-main');
    expect(nodeSource).toContain('node-meta-slot');
    expect(nodeSource).toContain('node-status-slot');
    expect(nodeSource).toContain('attention-badge');
    expect(css).toContain('.node-meta-slot');
    expect(css).toContain('.node-status-slot');
    expect(css).toContain('.flow-node-type-artifact .flow-node-label');
    expect(css).toContain('.flow-node-type-handoff');
    expect(geometrySource).not.toContain('handoffNodeWidth = 148');
  });

  test('treats handoff nodes as derived graph nodes instead of addable editable nodes', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');

    expect(webviewSource).toContain("types: ['agent', 'gate']");
    expect(webviewSource).not.toContain("types: ['agent', 'handoff', 'gate']");
    expect(webviewSource).toContain('graphNodeIdForSelection');
    expect(webviewSource).not.toContain("node.type === 'handoff' && <InspectorSection");
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
    expect(webviewSource).toContain('activity-now-card');
    expect(webviewSource).toContain('data-event-id');
    expect(webviewSource).toContain('activityTrail');
    expect(webviewSource).toContain('canReportReads');
    expect(css).toContain('.follow-live-toggle.active');
    expect(css).toContain('.activity-now-card');
    expect(css).toContain('.flow-node.has-activity');
    expect(css).toContain('.flow-node.activity-freshness-fresh');
    expect(css).toContain('.flow-node.activity-freshness-recent');
    expect(css).toContain('.flow-node.runtime-error');
    expect(css).toContain('.activity-file');
    expect(css).toContain('.activity-artifact');
    expect(css).toContain('nodeActivityPulse');
  });

  test('wires activity playback controls and active edge tracers', () => {
    const webviewSource = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(webviewSource).toContain('deriveActivityPlaybackState');
    expect(webviewSource).toContain('ActivityPlaybackControls');
    expect(webviewSource).toContain('Replay latest activity');
    expect(webviewSource).toContain('Pause activity playback');
    expect(webviewSource).toContain('Resume activity playback');
    expect(webviewSource).toContain('activity-edge-tracer');
    expect(webviewSource).toContain('replayEventId');
    expect(css).toContain('.activity-playback-controls');
    expect(css).toContain('.graph-edge.activity-edge-tracer');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  test('organizes inspector as task-oriented editing flow', () => {
    const source = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(source).toContain('inspector-section-identity');
    expect(source).toContain('Run behavior');
    expect(source).toContain('Routing');
    expect(source).toContain('Context');
    expect(source).toContain('Artifacts');
    expect(source).toContain('Content');
    expect(source).toContain('Health');
    expect(source).toContain('Open file');
    expect(source).toContain('selectedToolSummary');
    expect(source).toContain('runtime={selected ? state.nodeRuntime?.[selected.id] : undefined}');
    expect(css).toContain('.config-header.sticky');
    expect(css).toContain('.inspector-section-summary');
  });

  test('shows which markdown or frontmatter field each inspector task edits', () => {
    const source = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(source).toContain('fieldHint');
    expect(source).toContain('Writes:');
    expect(source).toContain('frontmatter name, file path, description');
    expect(source).toContain('frontmatter tools, model, target');
    expect(source).toContain('Artifact work');
    expect(source).toContain('Referenced instructions');
    expect(source).toContain('Markdown body');
    expect(css).toContain('.inspector-section-field');
  });

  test('lets users resize inspector and diagnostics without clipping long debug details', () => {
    const source = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(source).toContain('useResizablePanel');
    expect(source).toContain('inspectorResize');
    expect(source).toContain('diagnosticsResize');
    expect(source).toContain('Resize configuration panel');
    expect(source).toContain('Resize diagnostics panel');
    expect(source).toContain('--agentflow-inspector-width');
    expect(source).toContain('--agentflow-bottom-height');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) var(--agentflow-inspector-width)');
    expect(css).toContain('grid-template-rows: minmax(var(--agentflow-toolbar-min-height), auto) minmax(var(--agentflow-canvas-min-height), 1fr) var(--agentflow-bottom-height)');
    expect(css).toContain('.panel-resize-handle');
    expect(css).toContain('cursor: col-resize');
    expect(css).toContain('cursor: row-resize');
    expect(css).toContain('.diagnostic-chip {');
    expect(css).toContain('overflow-wrap: anywhere;');
  });

  test('turns validation diagnostics into actionable workflows', () => {
    const source = readFileSync('src/webview/main.tsx', 'utf8');
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(source).toContain('Ready to run');
    expect(source).toContain('validation-filter-bar');
    expect(source).toContain('diagnostic-workflow-card');
    expect(source).toContain('Focus node');
    expect(source).toContain('Apply quick fix');
    expect(source).toContain('applyDiagnosticQuickFix');
    expect(source).toContain('onApplyQuickFix(finding.quickFix)');
    expect(source).toContain('disabled={!finding.quickFix}');
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
    expect(source).toContain('aria-label={`Graph node ${node.data.fullLabel ?? node.data.label}');
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

  test('documents a release UX smoke checklist with a fixture workspace', () => {
    const docs = readFileSync('docs/development.md', 'utf8');
    const checklist = readFileSync('docs/ux-smoke-checklist.md', 'utf8');
    const defaultDemo = readFileSync('docs/default-pipeline-demo.md', 'utf8');
    const fixturePrompt = readFileSync('examples/ux-smoke-workspace/.github/prompts/start-implementation.prompt.md', 'utf8');
    const fixtureRouter = readFileSync('examples/ux-smoke-workspace/.github/agents/router.agent.md', 'utf8');
    const fixtureInstruction = readFileSync('examples/ux-smoke-workspace/.github/instructions/project-guidelines.instructions.md', 'utf8');

    expect(docs).toContain('ux-smoke-checklist.md');
    expect(docs).toContain('default-pipeline-demo.md');
    expect(checklist).toContain('default-pipeline-demo.md');
    expect(defaultDemo).toContain('node creation');
    expect(defaultDemo).toContain('reference editing');
    expect(defaultDemo).toContain('resulting edges');
    expect(checklist).toContain('Expected visual outcome');
    expect(checklist).toContain('Blocking release issues');
    expect(checklist).toContain('Cosmetic issues');
    expect(checklist).toContain('within 4 seconds');
    expect(checklist).toContain('examples/ux-smoke-workspace');
    expect(checklist).toContain('Marketplace Capture');
    expect(fixturePrompt).toContain('agent: "router"');
    expect(fixtureRouter).toContain('handoffs:');
    expect(fixtureRouter).toContain('<!--agent-flow:begin artifact-ref action="write" path=".github/artifacts/plan.md"-->');
    expect(fixtureInstruction).toContain('name: "project guidelines"');
  });

  test('reserves node header space so badges do not overlap labels', () => {
    const css = readFileSync('src/webview/styles.css', 'utf8');

    expect(css).toContain('grid-template-rows: 18px minmax(0, 1fr) 22px');
    expect(css).toContain('grid-template-rows: 18px minmax(0, 1fr) 18px');
    expect(css).toContain('.token-badge { position: static;');
    expect(css).toContain('-webkit-line-clamp: 2');
    expect(css).toContain('.node-status-slot');
  });

  test('documents graph visual grammar for nodes, edges, activity, and debug states', () => {
    const docs = readFileSync('docs/graph-visual-grammar.md', 'utf8');

    expect(docs).toContain('Type Color');
    expect(docs).toContain('Reserved Regions');
    expect(docs).toContain('Edge Label Visibility');
    expect(docs).toContain('Activity States');
    expect(docs).toContain('Debug And Recovery');
    expect(docs).toContain('handoff');
    expect(docs).toContain('contrast');
  });
});
