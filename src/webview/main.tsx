import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent, useEditor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Heading from '@tiptap/extension-heading';
import BulletList from '@tiptap/extension-bullet-list';
import ListItem from '@tiptap/extension-list-item';
import CodeBlock from '@tiptap/extension-code-block';
import Code from '@tiptap/extension-code';
import Link from '@tiptap/extension-link';
import '@vscode/codicons/dist/codicon.css';
import './styles.css';
import { AgentHandoff, AgentPipeline, ArtifactAction, ArtifactUsage, PipelineNode, PipelineNodeType, ReferenceInstruction, ValidationFinding, RiskScore } from '../pipeline/types';
import { AgentFlowActivityEvent } from '../activity/types';
import { aggregateActivityMetrics } from '../activity/metrics';
import { aggregateFileAttention } from '../activity/fileAttention';
import { buildActivityTimeline } from '../activity/timeline';
import type { ActivitySourceRuntimeState } from '../activity/sources';
import { findCycles, validatePipeline } from '../pipeline/validator';
import { calculateRiskScore } from '../pipeline/riskScore';
import { generateFiles } from '../pipeline/generators';
import { deriveVisibleFlowEdges, type VisibleFlowEdge } from './graph';
import { clamp, edgePathBetweenNodes, fitNativeGraphViewport, focusViewportOnNode, graphNodeSizeForType, graphTransform, measuredGraphBounds, nativeGraphMaxZoom, nativeGraphMinZoom, normalizeGraphNodePositions, screenToGraphPosition, shouldAutoFitGraph, type GraphBounds, type GraphViewport } from './graphGeometry';
import { activeEdgeIds, deriveActivityHudState, freshActivityEvents, recentActivityTrail, recentNodeActivitySummaries, resolveActivityEventsForPipeline, type ActivityHudState, type ActivityTrailItem } from './activity';
import { FlowLayout, layoutFlowNodes } from './flowLayout';
import { combineMarkdownFrontmatter, markdownToTiptapHtml, splitMarkdownFrontmatter, tiptapJsonToMarkdown } from './markdown';
import { flattenToolOptionValues, normalizeConfiguredToolsForOptions, partitionConfiguredTools, toolOptionSelectionState, type ToolOption, type ToolOptionGroup } from './toolOptions';
import { estimateNodeTokenCount, formatTokenBadge } from './tokenCounts';
import { TokenNode, flowHandlePositions } from './TokenNode';
import { applyConnectionIntent, buildConnectionIntentOptions, connectPipelineNodes, deletePipelineEdges, deletePipelineNodes, renamePipelineNodeLabel, type ConnectionIntentKind } from './flowMutations';
import { duplicatePipelineSelection } from './builderMutations';
import { optionalTextValue, referenceInstructionTextValue } from './formState';
import { Codicon, VSCodeButton, VSCodeIconButton, VSCodeInput, VSCodeTextarea } from './components';
import { applyNodePatch } from './nodeMarkdownSync';
import { mergeRemoteStateUpdate } from './stateUpdates';
import { deriveNodeRuntimeState, markNodeRuntimeDirty, mergeNodeRuntimeState, type NodeRuntimeState, type NodeRuntimeStateMap } from './nodeRuntimeState';
import { edgeGradientId, edgeMarkerColor, graphNodeDisplayLabel, graphNodeFullLabel, nodeTypeColor, nodeTypeColors } from './nodeDisplay';
import { deriveFlowEmptyState, type EmptyStateAction, type FlowEmptyState, type WorkspaceFileSummary } from './emptyState';
import { spatialNeighborNodeId, type SpatialArrowKey } from './keyboardNavigation';
import { deriveGraphRecoveryState, type GraphRecoveryState } from './graphRecoveryState';
import { activeEdgeClass, edgeTooltip } from './edgeClasses';
import { shouldFocusLiveActivity } from './activityFocus';
import { deriveInspectorSyncStatus, type InspectorSyncStatus } from './inspectorStatus';

interface State {
  stateVersion: number;
  pipeline: AgentPipeline;
  findings: ValidationFinding[];
  risk: RiskScore;
  generatedFiles: Array<{ path: string; kind: string }>;
  flowLayout: FlowLayout;
  toolOptions: ToolOptionGroup[];
  activityEvents: AgentFlowActivityEvent[];
  nodeRuntime: NodeRuntimeStateMap;
  activitySources?: ActivitySourceRuntimeState[];
  workspaceFiles?: WorkspaceFileSummary;
  debugOverlay?: boolean;
}

type BottomTab = 'activity' | 'metrics' | 'attention' | 'validation' | 'files' | 'tools' | 'risk';

declare global { interface Window { __AGENTFLOW_STATE__: State; __AGENTFLOW_APP_BOOTED__?: boolean; __AGENTFLOW_VSCODE_API__?: { postMessage(message: unknown): void }; acquireVsCodeApi?: () => { postMessage(message: unknown): void } } }

const vscode = window.__AGENTFLOW_VSCODE_API__ ?? window.acquireVsCodeApi?.();
if (vscode && !window.__AGENTFLOW_VSCODE_API__) window.__AGENTFLOW_VSCODE_API__ = vscode;
const webviewBootId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const typeColors: Record<string, string> = nodeTypeColors;
const nodeTypeIcons: Record<PipelineNodeType, string> = { agent: 'hubot', prompt: 'comment-discussion', instruction: 'list-tree', skill: 'tools', role: 'person', artifact: 'file', gate: 'pass', hook: 'debug-disconnect', handoff: 'arrow-swap', 'mcp-server': 'server-process' };
const nodePaletteGroups: Array<{ label: string; types: PipelineNodeType[] }> = [
  { label: 'Entry', types: ['prompt'] },
  { label: 'Execution', types: ['agent', 'handoff', 'gate'] },
  { label: 'Context', types: ['instruction', 'skill', 'role'] },
  { label: 'Data and integrations', types: ['artifact', 'hook', 'mcp-server'] }
];

interface RenderedNode {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  data: React.ComponentProps<typeof TokenNode>['data'];
  style: React.CSSProperties;
}

type RenderedEdge = VisibleFlowEdge & { className?: string };
type ResizeAxis = 'x' | 'y';

interface ResizablePanelOptions {
  axis: ResizeAxis;
  initialSize: number;
  invert?: boolean;
  max: number;
  min: number;
  step?: number;
}

interface PendingNodeConnection {
  type: PipelineNodeType;
  position: { x: number; y: number };
  sourceId: string;
  targetNode: PipelineNode;
  options: ReturnType<typeof buildConnectionIntentOptions>;
}

function useResizablePanel({ axis, initialSize, invert = false, max, min, step = 24 }: ResizablePanelOptions) {
  const [size, setSize] = useState(initialSize);
  const drag = useRef<{ pointerId: number; size: number; start: number } | undefined>(undefined);
  const applyDelta = useCallback((delta: number) => {
    setSize((current) => clamp(current + (invert ? -delta : delta), min, max));
  }, [invert, max, min]);
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, size, start: axis === 'x' ? event.clientX : event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [axis, size]);
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const pointer = axis === 'x' ? event.clientX : event.clientY;
    const delta = pointer - current.start;
    setSize(clamp(current.size + (invert ? -delta : delta), min, max));
    event.preventDefault();
  }, [axis, invert, max, min]);
  const endDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
  }, []);
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const negativeKey = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const positiveKey = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== negativeKey && event.key !== positiveKey) return;
    event.preventDefault();
    applyDelta(event.key === negativeKey ? -step : step);
  }, [applyDelta, axis, step]);
  return {
    max,
    min,
    resizeHandleProps: { onKeyDown, onPointerCancel: endDrag, onPointerDown, onPointerMove, onPointerUp: endDrag },
    size
  };
}

function deriveState(pipeline: AgentPipeline, previous: State): State {
  const activityEvents = resolveActivityEventsForPipeline(pipeline, previous.activityEvents ?? []);
  const incomingRuntime = deriveNodeRuntimeState(pipeline, activityEvents);
  return {
    ...previous,
    pipeline,
    findings: validatePipeline(pipeline),
    risk: calculateRiskScore(pipeline),
    generatedFiles: generateFiles(pipeline).map((file) => ({ path: file.path, kind: file.kind })),
    flowLayout: previous.flowLayout,
    toolOptions: previous.toolOptions,
    activityEvents,
    nodeRuntime: mergeNodeRuntimeState(previous.nodeRuntime, incomingRuntime, pipeline)
  };
}

function App() {
  const [state, setState] = useState(window.__AGENTFLOW_STATE__);
  const [draft, setDraft] = useState(state.pipeline);
  const [selectedId, setSelectedId] = useState(state.pipeline.nodes[0]?.id ?? '');
  const [bottomOpen, setBottomOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<BottomTab>('validation');
  const [activityClock, setActivityClock] = useState(Date.now());
  const [viewportSignal, setViewportSignal] = useState(0);
  const dirtyRef = useRef(false);
  const draftRef = useRef(draft);
  const undoStack = useRef<AgentPipeline[]>([]);
  const redoStack = useRef<AgentPipeline[]>([]);
  const [copiedIds, setCopiedIds] = useState<string[]>([]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const timers = [0, 100, 500, 1_500].map((delay) => window.setTimeout(() => {
      vscode?.postMessage({ command: 'webviewReady', bootId: webviewBootId, stateVersion: state.stateVersion });
    }, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.command === 'stateUpdated') {
        const incoming = event.data.state as State;
        setViewportSignal((signal) => signal + 1);
        setState((current) => {
          const merged = mergeRemoteStateUpdate({
            currentState: current,
            currentDraft: draftRef.current,
            incomingState: incoming,
            dirty: dirtyRef.current
          });
          if (merged.applyDraft) {
            dirtyRef.current = false;
            setDraft(merged.draft);
            setSelectedId((selected) => incoming.pipeline.nodes.some((node: PipelineNode) => node.id === event.data.selectedId) ? event.data.selectedId : incoming.pipeline.nodes.some((node: PipelineNode) => node.id === selected) ? selected : incoming.pipeline.nodes[0]?.id ?? '');
          }
          return merged.state;
        });
      }
      if (event.data?.command === 'activityUpdated') {
        setViewportSignal((signal) => signal + 1);
        setActivityClock(Date.now());
        setState((current) => {
          const activityEvents = resolveActivityEventsForPipeline(current.pipeline, event.data.activityEvents ?? []);
          return {
            ...current,
            activityEvents,
            nodeRuntime: mergeNodeRuntimeState(current.nodeRuntime, deriveNodeRuntimeState(current.pipeline, activityEvents), current.pipeline)
          };
        });
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  useEffect(() => {
    if (!state.activityEvents?.length) return;
    const timer = window.setInterval(() => setActivityClock(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, [state.activityEvents?.length]);

  const commitDraft = useCallback((updater: (pipeline: AgentPipeline) => AgentPipeline, nextSelectedId?: string, dirtyNodeIds: string[] = []) => {
    setDraft((pipeline) => {
      const next = updater(pipeline);
      undoStack.current = [...undoStack.current.slice(-49), pipeline];
      redoStack.current = [];
      dirtyRef.current = true;
      setState((previous) => {
        const derived = deriveState(next, previous);
        return dirtyNodeIds.length ? { ...derived, nodeRuntime: markNodeRuntimeDirty(derived.nodeRuntime, dirtyNodeIds) } : derived;
      });
      if (nextSelectedId) setSelectedId(nextSelectedId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      vscode?.postMessage({ command: 'persistPipeline', pipeline: draft, selectedId });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, selectedId]);

  const undoLast = useCallback(() => {
    setDraft((pipeline) => {
      const previous = undoStack.current.pop();
      if (!previous) return pipeline;
      redoStack.current = [...redoStack.current.slice(-49), pipeline];
      dirtyRef.current = true;
      setState((state) => deriveState(previous, state));
      setSelectedId((current) => previous.nodes.some((node) => node.id === current) ? current : previous.nodes[0]?.id ?? '');
      return previous;
    });
  }, []);
  const redoLast = useCallback(() => {
    setDraft((pipeline) => {
      const next = redoStack.current.pop();
      if (!next) return pipeline;
      undoStack.current = [...undoStack.current.slice(-49), pipeline];
      dirtyRef.current = true;
      setState((state) => deriveState(next, state));
      setSelectedId((current) => next.nodes.some((node) => node.id === current) ? current : next.nodes[0]?.id ?? '');
      return next;
    });
  }, []);
  const copySelection = useCallback(() => {
    if (selectedId) setCopiedIds([selectedId]);
  }, [selectedId]);
  const pasteSelection = useCallback(() => {
    const ids = copiedIds.length ? copiedIds : selectedId ? [selectedId] : [];
    if (!ids.length) return;
    setDraft((pipeline) => {
      const result = duplicatePipelineSelection(pipeline, ids);
      if (!result.selectedIds.length) return pipeline;
      undoStack.current = [...undoStack.current.slice(-49), pipeline];
      redoStack.current = [];
      dirtyRef.current = true;
      setState((previous) => {
        const derived = deriveState(result.pipeline, previous);
        return { ...derived, nodeRuntime: markNodeRuntimeDirty(derived.nodeRuntime, result.selectedIds) };
      });
      setSelectedId(result.selectedIds[0] ?? selectedId);
      setCopiedIds(result.selectedIds);
      return result.pipeline;
    });
  }, [copiedIds, selectedId]);

  const selected = draft.nodes.find((node) => node.id === selectedId) ?? draft.nodes[0];
  const risky = new Set(state.findings.filter((finding) => finding.nodeId).map((finding) => finding.nodeId));
  const layoutPositions = useMemo(() => layoutFlowNodes(draft, state.flowLayout), [draft, state.flowLayout]);
  const handlePositions = useMemo(() => flowHandlePositions(state.flowLayout), [state.flowLayout]);
  const freshActivity = useMemo(() => freshActivityEvents(state.activityEvents ?? [], activityClock), [activityClock, state.activityEvents]);
  const activityByNode = useMemo(() => recentNodeActivitySummaries(state.activityEvents ?? [], activityClock), [activityClock, state.activityEvents]);
  const activityHud = useMemo(() => deriveActivityHudState(state.activityEvents ?? [], state.activitySources ?? [], activityClock), [activityClock, state.activityEvents, state.activitySources]);
  const activityTrail = useMemo(() => recentActivityTrail(state.activityEvents ?? [], activityClock, 6), [activityClock, state.activityEvents]);
  const activeEdges = useMemo(() => new Set(activeEdgeIds(draft, freshActivity)), [draft, freshActivity]);
  const nodes: RenderedNode[] = useMemo(() => normalizeGraphNodePositions(draft.nodes.map((node) => {
    const size = graphNodeSizeForType(node.type);
    return {
      id: node.id,
      position: layoutPositions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      data: { label: graphNodeDisplayLabel(node), fullLabel: graphNodeFullLabel(node), type: node.type, tokenBadge: formatTokenBadge(estimateNodeTokenCount(draft, node)), tokenColor: nodeTypeColor(node.type), activity: activityByNode.get(node.id), runtimeStatus: state.nodeRuntime?.[node.id]?.status, dirty: state.nodeRuntime?.[node.id]?.dirty, attention: risky.has(node.id), ...handlePositions },
      style: { border: `1px solid ${typeColors[node.type] ?? 'var(--vscode-focusBorder)'}`, borderLeft: `5px solid ${typeColors[node.type] ?? 'var(--vscode-focusBorder)'}`, borderRadius: 4, background: 'var(--vscode-editor-background)', color: 'var(--vscode-editor-foreground)', width: size.width }
    };
  })).nodes, [activityByNode, draft, handlePositions, layoutPositions, risky, state.flowLayout, state.nodeRuntime]);
  const activeNodeIds = useMemo(() => [...activityByNode.values()].filter((activity) => activity.freshness === 'fresh').map((activity) => activity.nodeId), [activityByNode]);
  const visibleEdges = useMemo(() => deriveVisibleFlowEdges(draft), [draft]);
  const loopEdgeIds = useMemo(() => {
    const loopIds = new Set<string>();
    const cycles = findCycles(draft.nodes, visibleEdges.map((edge) => ({ from: edge.source, to: edge.target })));
    for (const cycle of cycles) {
      for (let index = 0; index < cycle.length - 1; index += 1) {
        const source = cycle[index];
        const target = cycle[index + 1];
        for (const edge of visibleEdges) if (edge.source === source && edge.target === target) loopIds.add(edge.id);
      }
    }
    return loopIds;
  }, [draft.nodes, visibleEdges]);
  const edges: RenderedEdge[] = useMemo(() => visibleEdges.map((edge) => {
    const classNames = [
      activeEdges.has(edge.id) ? 'activity-edge' : undefined,
      activeEdges.has(edge.id) ? activeEdgeClass(edge) : undefined,
      loopEdgeIds.has(edge.id) ? 'loop-edge' : undefined,
      edge.data.kind === 'error' ? 'error-edge' : undefined
    ].filter(Boolean).join(' ');
    return activeEdges.has(edge.id)
      ? { ...edge, animated: true, className: classNames, style: { ...(edge.style ?? {}), strokeWidth: 3, opacity: 1 } }
      : { ...edge, className: classNames || undefined };
  }), [activeEdges, loopEdgeIds, visibleEdges]);

  const updateNode = (nodeId: string, patch: Partial<PipelineNode>) => {
    if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
      commitDraft((pipeline) => renamePipelineNodeLabel(pipeline, nodeId, String(patch.label ?? '')), undefined, draft.nodes.map((node) => node.id));
      return;
    }
    commitDraft((pipeline) => ({ ...pipeline, nodes: pipeline.nodes.map((node) => node.id === nodeId ? applyNodePatch(node, patch) : node) }), undefined, [nodeId]);
  };
  const connectNodes = (sourceId: string, targetId: string) => commitDraft((pipeline) => connectPipelineNodes(pipeline, sourceId, targetId));
  const applyConnection = (sourceId: string, targetId: string, kind: ConnectionIntentKind) => {
    commitDraft((pipeline) => applyConnectionIntent(pipeline, sourceId, targetId, kind), undefined, [sourceId, targetId]);
  };
  const deleteNodes = (nodeIds: string[]) => {
    if (nodeIds.length) commitDraft((pipeline) => deletePipelineNodes(pipeline, nodeIds));
  };
  const deleteEdges = (edgeIds: string[]) => commitDraft((pipeline) => deletePipelineEdges(pipeline, edgeIds));
  const addNode = (type: PipelineNodeType, position = { x: 120, y: 120 }, connectFrom?: string, intent?: ConnectionIntentKind) => {
    const node = createNode(type, draft, position);
    commitDraft((pipeline) => {
      const next = { ...pipeline, nodes: [...pipeline.nodes, node] };
      if (connectFrom && intent) return applyConnectionIntent(next, connectFrom, node.id, intent);
      return connectFrom ? connectPipelineNodes(next, connectFrom, node.id) : next;
    }, node.id, [node.id]);
    setInspectorOpen(true);
  };
  return <FlowApp state={state} draft={draft} selected={selected} selectedId={selectedId} nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} activityHud={activityHud} activityTrail={activityTrail} activeTab={activeTab} bottomOpen={bottomOpen} inspectorOpen={inspectorOpen} viewportSignal={viewportSignal} canUndo={undoStack.current.length > 0} canRedo={redoStack.current.length > 0} canPaste={copiedIds.length > 0 || Boolean(selectedId)} undoLast={undoLast} redoLast={redoLast} copySelection={copySelection} pasteSelection={pasteSelection} setActiveTab={setActiveTab} setBottomOpen={setBottomOpen} setInspectorOpen={setInspectorOpen} setSelectedId={setSelectedId} updateNode={updateNode} connectNodes={connectNodes} applyConnection={applyConnection} deleteNodes={deleteNodes} deleteEdges={deleteEdges} addNode={addNode} />;
}

function FlowApp({ state, draft, selected, selectedId, nodes, edges, activeNodeIds, activityHud, activityTrail, activeTab, bottomOpen, inspectorOpen, viewportSignal, canUndo, canRedo, canPaste, undoLast, redoLast, copySelection, pasteSelection, setActiveTab, setBottomOpen, setInspectorOpen, setSelectedId, updateNode, applyConnection, deleteNodes, addNode }: { state: State; draft: AgentPipeline; selected?: PipelineNode; selectedId: string; nodes: RenderedNode[]; edges: RenderedEdge[]; activeNodeIds: string[]; activityHud: ActivityHudState; activityTrail: ActivityTrailItem[]; activeTab: BottomTab; bottomOpen: boolean; inspectorOpen: boolean; viewportSignal: number; canUndo: boolean; canRedo: boolean; canPaste: boolean; undoLast: () => void; redoLast: () => void; copySelection: () => void; pasteSelection: () => void; setActiveTab: (tab: BottomTab) => void; setBottomOpen: (open: boolean) => void; setInspectorOpen: (open: boolean) => void; setSelectedId: (id: string) => void; updateNode: (nodeId: string, patch: Partial<PipelineNode>) => void; connectNodes: (sourceId: string, targetId: string) => void; applyConnection: (sourceId: string, targetId: string, kind: ConnectionIntentKind) => void; deleteNodes: (nodeIds: string[]) => void; deleteEdges: (edgeIds: string[]) => void; addNode: (type: PipelineNodeType, position?: { x: number; y: number }, connectFrom?: string, intent?: ConnectionIntentKind) => void }) {
  const addNodeMenuRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const [addNodeMenuOpen, setAddNodeMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [followLiveActivity, setFollowLiveActivity] = useState(false);
  const [pendingNodeConnection, setPendingNodeConnection] = useState<PendingNodeConnection | undefined>(undefined);
  const [viewport, setViewport] = useState<GraphViewport>({ x: 0, y: 0, zoom: 1 });
  const inspectorResize = useResizablePanel({ axis: 'x', initialSize: 390, invert: true, min: 300, max: 720 });
  const diagnosticsResize = useResizablePanel({ axis: 'y', initialSize: 250, invert: true, min: 180, max: 560 });
  const viewportRef = useRef(viewport);
  const userViewportInteracted = useRef(false);
  const lastFitSignature = useRef<string | undefined>(undefined);
  const lastFocusedActivityNode = useRef<string | undefined>(undefined);
  const [renderStatus, setRenderStatus] = useState<FlowRenderStatus | undefined>(undefined);
  const appStyle = {
    '--agentflow-inspector-width': `${inspectorResize.size}px`,
    '--agentflow-bottom-height': `${diagnosticsResize.size}px`
  } as React.CSSProperties;
  const flowNodeSignature = useMemo(() => nodes.map((node) => `${node.id}@${Math.round(node.position.x)},${Math.round(node.position.y)}`).join('|'), [nodes]);
  const graphBounds = useMemo(() => measuredGraphBounds(nodes), [nodes]);
  const emptyState = useMemo(() => deriveFlowEmptyState(nodes.length, state.workspaceFiles), [nodes.length, state.workspaceFiles]);
  const recoveryState = useMemo(() => deriveGraphRecoveryState({
    nodeCount: nodes.length,
    edgeCount: edges.length,
    renderedNodeCount: renderStatus?.renderedNodeCount,
    visibleNodeCount: renderStatus?.visibleNodeCount,
    emptyStateKind: emptyState.kind,
    reason: renderStatus?.reason
  }), [edges.length, emptyState.kind, nodes.length, renderStatus?.reason, renderStatus?.renderedNodeCount, renderStatus?.visibleNodeCount]);
  const setGraphViewport = useCallback((next: GraphViewport, userInteracted = false) => {
    if (userInteracted) userViewportInteracted.current = true;
    viewportRef.current = next;
    setViewport(next);
  }, []);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        setAddNodeMenuOpen(false);
        setPendingNodeConnection(undefined);
        setShortcutsOpen(false);
        return;
      }
      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoLast();
      }
      if (((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z') || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y')) {
        event.preventDefault();
        redoLast();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelection();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [copySelection, pasteSelection, redoLast, undoLast]);
  useEffect(() => {
    if (!addNodeMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof globalThis.Node)) return;
      if (target && addNodeMenuRef.current?.contains(target)) return;
      setAddNodeMenuOpen(false);
      setPendingNodeConnection(undefined);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [addNodeMenuOpen]);

  const fitViewport = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 20 || rect.height < 20 || !nodes.length) return;
    const next = fitNativeGraphViewport(graphBounds, rect);
    lastFitSignature.current = flowNodeSignature;
    userViewportInteracted.current = false;
    setGraphViewport(next);
  }, [flowNodeSignature, graphBounds, nodes.length, setGraphViewport]);

  useEffect(() => {
    const report = (reason: string) => {
      const status = postFlowRenderStatus(canvasRef.current, state.stateVersion, nodes.map((node) => node.id), edges.length, reason, viewportRef.current, graphBounds);
      setRenderStatus(status);
      return status;
    };
    if (!nodes.length) {
      report('empty-pipeline');
      return;
    }
    if (shouldAutoFitGraph({ previousSignature: lastFitSignature.current, nextSignature: flowNodeSignature, userInteracted: userViewportInteracted.current, reason: 'structure' })) {
      fitViewport();
    }
    const renderStatusTimers = [0, 120, 500, 1200, 2400].map((delay) => window.setTimeout(() => report(`render-check-${delay}`), delay));
    const observer = typeof ResizeObserver !== 'undefined' && canvasRef.current ? new ResizeObserver(() => {
      if (shouldAutoFitGraph({ previousSignature: lastFitSignature.current, nextSignature: flowNodeSignature, userInteracted: userViewportInteracted.current, reason: 'resize' })) fitViewport();
    }) : undefined;
    if (observer && canvasRef.current) observer.observe(canvasRef.current);
    const onVisibility = () => {
      if (!document.hidden) {
        if (!userViewportInteracted.current) fitViewport();
        window.setTimeout(() => report('visibilitychange'), 120);
      }
    };
    const onResize = () => {
      if (shouldAutoFitGraph({ previousSignature: lastFitSignature.current, nextSignature: flowNodeSignature, userInteracted: userViewportInteracted.current, reason: 'resize' })) fitViewport();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('focus', onResize);
    window.addEventListener('pageshow', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      renderStatusTimers.forEach((timer) => window.clearTimeout(timer));
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('focus', onResize);
      window.removeEventListener('pageshow', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [bottomOpen, edges.length, fitViewport, flowNodeSignature, graphBounds, inspectorOpen, nodes, state.flowLayout, state.stateVersion, viewportSignal]);

  useEffect(() => {
    const activeNodeId = activeNodeIds[0];
    if (!shouldFocusLiveActivity({
      activeNodeId,
      followLiveActivity,
      inspectorOpen,
      lastFocusedActivityNode: lastFocusedActivityNode.current,
      userViewportInteracted: userViewportInteracted.current
    })) return;
    const node = nodes.find((item) => item.id === activeNodeId);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!node || !rect || rect.width < 20 || rect.height < 20) return;
    lastFocusedActivityNode.current = activeNodeId;
    setGraphViewport(focusViewportOnNode(node, viewportRef.current, rect));
  }, [activeNodeIds, followLiveActivity, inspectorOpen, nodes, setGraphViewport]);

  const addNodeAtCenter = (type: PipelineNodeType, connectFrom?: string) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const position = rect
      ? screenToGraphPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, rect, viewport)
      : { x: 120, y: 120 };
    if (connectFrom) {
      const targetNode = createNode(type, draft, position);
      const previewPipeline = { ...draft, nodes: [...draft.nodes, targetNode] };
      setPendingNodeConnection({
        type,
        position,
        sourceId: connectFrom,
        targetNode,
        options: buildConnectionIntentOptions(previewPipeline, connectFrom, targetNode.id)
      });
      return;
    }
    setPendingNodeConnection(undefined);
    addNode(type, position);
  };
  const openActivityForNode = (nodeId?: string) => {
    if (nodeId) {
      setSelectedId(nodeId);
      setInspectorOpen(true);
    }
    setActiveTab('activity');
    setBottomOpen(true);
  };

  return <div className={`app ${bottomOpen ? 'bottom-open' : 'bottom-collapsed'} ${inspectorOpen ? 'inspector-open' : 'inspector-closed'}`} style={appStyle}>
    <header className="toolbar"><strong>Agent Flow</strong><span>{draft.name}</span><ActivityHud state={activityHud} onOpen={() => openActivityForNode()} /><VSCodeButton className={`compact follow-live-toggle${followLiveActivity ? ' active' : ''}`} icon="target" aria-pressed={followLiveActivity} onClick={() => setFollowLiveActivity((enabled) => { if (!enabled) userViewportInteracted.current = false; return !enabled; })} title="Follow live activity without changing zoom">Follow live</VSCodeButton><VSCodeButton className="compact" icon="question" aria-keyshortcuts="?" onClick={() => setShortcutsOpen((open) => !open)} title="Keyboard shortcuts">Shortcuts</VSCodeButton><VSCodeButton className="compact" icon="discard" aria-keyshortcuts="Control+Z Meta+Z" onClick={undoLast} disabled={!canUndo} title="Undo last graph change">Undo</VSCodeButton><VSCodeButton className="compact" icon="redo" aria-keyshortcuts="Control+Y Meta+Y" onClick={redoLast} disabled={!canRedo} title="Redo last graph change">Redo</VSCodeButton><VSCodeButton className="compact" icon="copy" aria-keyshortcuts="Control+C Meta+C" onClick={copySelection} disabled={!selectedId} title="Copy selected node">Copy</VSCodeButton><VSCodeButton className="compact" icon="files" aria-keyshortcuts="Control+V Meta+V" onClick={pasteSelection} disabled={!canPaste} title="Paste copied node">Paste</VSCodeButton><span className="autosave-status"><Codicon name="sync" /> Auto-save</span><div className="add-node-menu" ref={addNodeMenuRef}><VSCodeButton className="compact" icon="add" aria-haspopup="menu" aria-expanded={addNodeMenuOpen} onClick={() => setAddNodeMenuOpen((open) => !open)}>Add Node</VSCodeButton>{addNodeMenuOpen && <div className="add-node-popover" role="menu" aria-label="Add node">{nodePaletteGroups.map((group) => <section className="node-palette-group" key={group.label}><h3>{group.label}</h3>{group.types.map((type) => <div className="node-palette-item" key={type}><button type="button" role="menuitem" onClick={() => { addNodeAtCenter(type); setAddNodeMenuOpen(false); }}><Codicon name={nodeTypeIcons[type]} /><span>{nodeTypeLabel(type)}</span><small>{nodeTypeDescription(type)}</small></button>{selected && <button type="button" className="node-palette-connect" onClick={() => addNodeAtCenter(type, selected.id)} title={`Connect from selected ${selected.label}`}><Codicon name="link" /><span>Connect from selected</span></button>}</div>)}</section>)}{pendingNodeConnection && <ConnectionIntentChooser pending={pendingNodeConnection} source={draft.nodes.find((node) => node.id === pendingNodeConnection.sourceId)} onCancel={() => setPendingNodeConnection(undefined)} onCreateOnly={() => { addNode(pendingNodeConnection.type, pendingNodeConnection.position); setPendingNodeConnection(undefined); setAddNodeMenuOpen(false); }} onCreateAndConnect={(kind) => { addNode(pendingNodeConnection.type, pendingNodeConnection.position, pendingNodeConnection.sourceId, kind); setPendingNodeConnection(undefined); setAddNodeMenuOpen(false); }} />}</div>}</div></header>
    {shortcutsOpen && <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />}
    <NativeGraph canvasRef={canvasRef} nodes={nodes} edges={edges} selectedId={selectedId} activeNodeIds={activeNodeIds} activityTrail={activityTrail} viewport={viewport} graphBounds={graphBounds} emptyState={emptyState} recoveryState={recoveryState} onActivitySelect={(item) => openActivityForNode(item.nodeId ?? item.targetNodeId)} onViewportChange={setGraphViewport} onFit={fitViewport} onOpenDiagnostics={() => { setBottomOpen(true); setActiveTab('validation'); }} onNodeClick={(nodeId) => { setSelectedId(nodeId); setInspectorOpen(true); }} onSelectNode={setSelectedId} onOpenSelected={() => selectedId && setInspectorOpen(true)} onCanvasClick={() => setInspectorOpen(false)} onDeleteSelected={() => selectedId && deleteNodes([selectedId])} />
    {state.debugOverlay && <DebugOverlay status={renderStatus} stateVersion={state.stateVersion} draft={draft} />}
    {inspectorOpen && <div className="panel-resize-handle inspector-resize-handle" role="separator" aria-label="Resize configuration panel" aria-orientation="vertical" aria-valuemin={inspectorResize.min} aria-valuemax={inspectorResize.max} aria-valuenow={inspectorResize.size} tabIndex={0} {...inspectorResize.resizeHandleProps} />}
    {inspectorOpen && <aside className="inspector"><Inspector node={selected} pipeline={draft} toolOptions={state.toolOptions} runtime={selected ? state.nodeRuntime?.[selected.id] : undefined} findings={state.findings.filter((finding) => finding.nodeId === selectedId)} onChange={updateNode} onConnect={applyConnection} /></aside>}
    <section className="bottom">{bottomOpen && <div className="panel-resize-handle diagnostics-resize-handle" role="separator" aria-label="Resize diagnostics panel" aria-orientation="horizontal" aria-valuemin={diagnosticsResize.min} aria-valuemax={diagnosticsResize.max} aria-valuenow={diagnosticsResize.size} tabIndex={0} {...diagnosticsResize.resizeHandleProps} />}<VSCodeButton className="collapse" icon={bottomOpen ? 'chevron-down' : 'chevron-right'} onClick={() => setBottomOpen(!bottomOpen)}>{bottomOpen ? 'Hide diagnostics' : 'Show diagnostics'}</VSCodeButton>{bottomOpen && <Bottom state={state} activeTab={activeTab} setActiveTab={setActiveTab} onSelectNode={(nodeId) => { setSelectedId(nodeId); setInspectorOpen(true); }} />}</section>
  </div>;
}

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return <KeyboardShortcutsPopover onClose={onClose} />;
}

function KeyboardShortcutsPopover({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    ['Arrow keys', 'Select the nearest node in that direction'],
    ['Enter', 'Open the selected node inspector'],
    ['F', 'Fit the graph to the viewport'],
    ['Backspace/Delete', 'Remove the selected node'],
    ['Cmd/Ctrl+C', 'Copy the selected node'],
    ['Cmd/Ctrl+V', 'Paste a duplicate node'],
    ['Cmd/Ctrl+Z/Y', 'Undo or redo graph edits'],
    ['?', 'Show or hide this help']
  ];
  return <aside className="shortcut-help keyboard-shortcuts-popover" role="dialog" aria-label="Keyboard shortcuts" id="agentflow-keyboard-shortcuts">
    <header><strong>Keyboard shortcuts</strong><button type="button" aria-label="Close keyboard shortcuts" onClick={onClose}><Codicon name="close" /></button></header>
    <dl>{shortcuts.map(([key, description]) => <React.Fragment key={key}><dt>{key}</dt><dd>{description}</dd></React.Fragment>)}</dl>
  </aside>;
}

function ActivityHud({ onOpen, state }: { onOpen: () => void; state: ActivityHudState }) {
  const icon = state.mode === 'live' ? 'pulse' : state.mode === 'recent' ? 'history' : state.mode === 'degraded' ? 'warning' : 'circle-outline';
  const label = state.mode === 'live' ? 'Live activity' : state.mode === 'recent' ? 'Recent activity' : state.mode === 'degraded' ? 'Activity setup needed' : 'No activity';
  const capability = state.canReportReads && state.canReportWrites ? 'reads + writes' : state.canReportWrites ? 'writes only' : state.canReportReads ? 'reads only' : 'no live read/write source';
  const detail = state.lastSummary ? `${state.lastSummary}${state.activeSessionId ? ` · ${state.activeSessionId}` : ''}` : state.sourceSummary;
  return <button type="button" className={`activity-hud activity-hud-${state.mode}`} onClick={onOpen} title={`${label}. ${detail}`}>
    <Codicon name={icon} />
    <span>{label}</span>
    <small>{state.recentCount ? `${state.recentCount} recent · ${capability}` : `${state.sourceSummary} · ${capability}`}</small>
  </button>;
}

function NativeGraph({ canvasRef, nodes, edges, selectedId, activeNodeIds, activityTrail, viewport, graphBounds, emptyState, recoveryState, onActivitySelect, onViewportChange, onFit, onOpenDiagnostics, onNodeClick, onSelectNode, onOpenSelected, onCanvasClick, onDeleteSelected }: { canvasRef: React.RefObject<HTMLElement>; nodes: RenderedNode[]; edges: RenderedEdge[]; selectedId: string; activeNodeIds: string[]; activityTrail: ActivityTrailItem[]; viewport: GraphViewport; graphBounds: GraphBounds; emptyState: FlowEmptyState; recoveryState: GraphRecoveryState; onActivitySelect: (item: ActivityTrailItem) => void; onViewportChange: (viewport: GraphViewport, userInteracted?: boolean) => void; onFit: () => void; onOpenDiagnostics: () => void; onNodeClick: (nodeId: string) => void; onSelectNode: (nodeId: string) => void; onOpenSelected: () => void; onCanvasClick: () => void; onDeleteSelected: () => void }) {
  const panStart = useRef<{ pointerId: number; x: number; y: number; viewport: GraphViewport } | undefined>(undefined);
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const activeNodeSet = useMemo(() => new Set(activeNodeIds), [activeNodeIds]);
  const focusNodeSet = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const related = new Set([selectedId]);
    for (const edge of edges) {
      if (edge.source === selectedId) related.add(edge.target);
      if (edge.target === selectedId) related.add(edge.source);
    }
    return related;
  }, [edges, selectedId]);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.agentflow-node, .native-controls')) return;
    onCanvasClick();
    panStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewport };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const start = panStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    onViewportChange({ ...start.viewport, x: start.viewport.x + event.clientX - start.x, y: start.viewport.y + event.clientY - start.y }, true);
  };
  const endPan = (event: React.PointerEvent<HTMLElement>) => {
    if (panStart.current?.pointerId === event.pointerId) panStart.current = undefined;
  };
  const onWheel = (event: React.WheelEvent<HTMLElement>) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextZoom = clamp(viewport.zoom * Math.exp(-event.deltaY * 0.0012), nativeGraphMinZoom, nativeGraphMaxZoom);
    const graphPoint = screenToGraphPosition({ x: event.clientX, y: event.clientY }, rect, viewport);
    onViewportChange({
      x: event.clientX - rect.left - graphPoint.x * nextZoom,
      y: event.clientY - rect.top - graphPoint.y * nextZoom,
      zoom: nextZoom
    }, true);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const navigationKeys: SpatialArrowKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (navigationKeys.includes(event.key as SpatialArrowKey)) {
      event.preventDefault();
      const nextId = spatialNeighborNodeId(nodes, selectedId, event.key as SpatialArrowKey);
      if (nextId) onSelectNode(nextId);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpenSelected();
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      onFit();
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      onDeleteSelected();
    }
  };

  return <main className="canvas native-graph" ref={canvasRef} tabIndex={0} aria-label="Agent Flow graph canvas" aria-describedby="agentflow-keyboard-shortcuts" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter F Backspace Delete" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPan} onPointerCancel={endPan} onWheel={onWheel} onKeyDown={onKeyDown}>
    <div className="graph-viewport" style={{ transform: graphTransform(viewport), width: graphBounds.width, height: graphBounds.height }}>
      <svg className="graph-edge-layer" width={graphBounds.width} height={graphBounds.height} viewBox={`0 0 ${graphBounds.width} ${graphBounds.height}`} aria-hidden="true">
        <defs>{edges.map((edge) => {
          const source = nodesById.get(edge.source);
          const target = nodesById.get(edge.target);
          const sourceColor = nodeTypeColor(source?.data.type ?? 'agent');
          const targetColor = nodeTypeColor(target?.data.type ?? 'agent');
          return <React.Fragment key={edge.id}>
            <linearGradient id={edgeGradientId(edge.id)} gradientUnits="userSpaceOnUse" x1={source?.position.x ?? 0} y1={source?.position.y ?? 0} x2={target?.position.x ?? 1} y2={target?.position.y ?? 1}>
              <stop offset="0%" stopColor={sourceColor} />
              <stop offset="100%" stopColor={targetColor} />
            </linearGradient>
            <marker id={edgeMarkerId(edge.id)} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 9 4.5 L 0 9 z" fill={edgeMarkerColor(target ? { id: target.id, type: target.data.type, label: target.data.label } as PipelineNode : undefined)} /></marker>
          </React.Fragment>;
        })}</defs>
        {edges.map((edge) => <GraphEdge key={edge.id} edge={edge} nodesById={nodesById} selectedId={selectedId} />)}
      </svg>
      <div className="graph-node-layer">
        {nodes.map((node) => <button
          type="button"
          key={node.id}
          className={`agentflow-node${node.id === selectedId ? ' selected' : ''}${activeNodeSet.has(node.id) ? ' active' : ''}${selectedId && !focusNodeSet.has(node.id) ? ' focus-muted' : ''}${selectedId && focusNodeSet.has(node.id) && node.id !== selectedId ? ' focus-related' : ''}`}
          data-node-id={node.id}
          style={{ ...node.style, transform: `translate(${node.position.x}px, ${node.position.y}px)`, height: node.height }}
          aria-label={`Graph node ${node.data.fullLabel ?? node.data.label}, ${node.data.type} node`}
          aria-current={node.id === selectedId ? 'true' : undefined}
          onClick={(event) => { event.stopPropagation(); onNodeClick(node.id); }}
        >
          <TokenNode data={node.data} />
        </button>)}
      </div>
    </div>
    {emptyState.kind !== 'none' && <FlowEmptyStateView state={emptyState} />}
    {emptyState.kind === 'none' && recoveryState.kind !== 'none' && <FlowRecoveryStateView state={recoveryState} onRetry={onFit} onOpenDiagnostics={onOpenDiagnostics} />}
    {activityTrail.length > 0 && <div className="activity-trail" aria-label="Recent activity trail">
      {activityTrail.map((item) => <button type="button" key={item.id} title={item.summary} onClick={() => onActivitySelect(item)}>
        <Codicon name={item.label === 'handoff' ? 'arrow-swap' : item.artifactPath ? 'file' : 'pulse'} />
        <span>{item.label}</span>
      </button>)}
    </div>}
    <div className="native-controls" aria-label="Graph controls">
      <button type="button" title="Zoom in" aria-label="Zoom in graph" onClick={() => onViewportChange({ ...viewport, zoom: clamp(viewport.zoom * 1.18, nativeGraphMinZoom, nativeGraphMaxZoom) }, true)}><Codicon name="add" /></button>
      <button type="button" title="Zoom out" aria-label="Zoom out graph" onClick={() => onViewportChange({ ...viewport, zoom: clamp(viewport.zoom / 1.18, nativeGraphMinZoom, nativeGraphMaxZoom) }, true)}><Codicon name="dash" /></button>
      <button type="button" title="Fit graph" aria-label="Fit graph" aria-keyshortcuts="F" onClick={onFit}><Codicon name="screen-full" /></button>
    </div>
  </main>;
}

function FlowRecoveryStateView({ onOpenDiagnostics, onRetry, state }: { onOpenDiagnostics: () => void; onRetry: () => void; state: GraphRecoveryState }) {
  const copyDebugSnapshot = () => vscode?.postMessage({ command: 'copyDebugSnapshot' });
  const runAction = (label: string) => {
    if (label === 'Retry render' || label === 'Fit graph') onRetry();
    if (label === 'Copy debug snapshot') copyDebugSnapshot();
    if (label === 'Open diagnostics') onOpenDiagnostics();
    if (label === 'Scan Workspace') vscode?.postMessage({ command: 'runCommand', name: 'agentflow.scanWorkspace' });
  };
  const icon = state.kind === 'render-failed' ? 'warning' : state.kind === 'no-visible-nodes' ? 'screen-full' : 'sync';
  return <section className={`flow-recovery-state flow-recovery-${state.kind}`} aria-live="polite">
    <div className="flow-recovery-card">
      <Codicon name={icon} />
      <div>
        <strong>{state.title}</strong>
        <p>{state.detail}</p>
      </div>
      {state.actionLabels.length > 0 && <div className="flow-recovery-actions">
        {state.actionLabels.map((label) => <VSCodeButton key={label} className="compact" icon={label === 'Copy debug snapshot' ? 'copy' : label === 'Open diagnostics' ? 'list-selection' : 'refresh'} onClick={() => runAction(label)}>{label}</VSCodeButton>)}
      </div>}
    </div>
  </section>;
}

function FlowEmptyStateView({ state }: { state: FlowEmptyState }) {
  const runAction = (action: EmptyStateAction) => {
    vscode?.postMessage({ command: 'runCommand', name: action.command });
  };
  return <section className="flow-empty-state" aria-live="polite">
    <div className="flow-empty-card">
      <Codicon name="graph" />
      <div>
        <h2>{state.title}</h2>
        <p>{state.detail}</p>
        <div className="flow-empty-actions">
          <VSCodeButton variant="primary" icon={state.primaryAction.icon} onClick={() => runAction(state.primaryAction)}>{state.primaryAction.label}</VSCodeButton>
          {state.secondaryActions.map((action) => <VSCodeButton key={action.command} className="compact" icon={action.icon} onClick={() => runAction(action)}>{action.label}</VSCodeButton>)}
        </div>
      </div>
    </div>
  </section>;
}

function GraphEdge({ edge, nodesById, selectedId }: { edge: RenderedEdge; nodesById: Map<string, RenderedNode>; selectedId: string }) {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  if (!source || !target) return null;
  const label = edge.label ? compactEdgeLabel(edge.label) : undefined;
  const labelWidth = label ? edgeLabelWidth(label) : 56;
  const labelHeight = 22;
  const points = edgePathBetweenNodes(source, target, { labelWidth, labelHeight });
  const color = `url(#${edgeGradientId(edge.id)})`;
  const opacity = typeof edge.style?.opacity === 'number' ? edge.style.opacity : 0.82;
  const strokeWidth = typeof edge.style?.strokeWidth === 'number' ? edge.style.strokeWidth : 1.8;
  const selectedEdge = Boolean(selectedId && (edge.source === selectedId || edge.target === selectedId));
  const title = edgeTooltip(edge, source.data.fullLabel ?? source.data.label, target.data.fullLabel ?? target.data.label);
  return <g className={`graph-edge${edge.className ? ` ${edge.className}` : ''}${edge.animated ? ' animated' : ''}${isSupportEdge(edge) ? ' support-edge' : ''}${selectedId && !selectedEdge ? ' focus-muted' : ''}${selectedEdge ? ' focus-edge' : ''}`} data-edge-id={edge.id} style={{ color }}>
    <title>{title}</title>
    <path className="graph-edge-path" d={points.path} stroke={color} strokeWidth={strokeWidth} strokeDasharray={typeof edge.style?.strokeDasharray === 'string' ? edge.style.strokeDasharray : undefined} opacity={opacity} markerEnd={`url(#${edgeMarkerId(edge.id)})`} />
    {edge.animated && <circle className="graph-edge-tracer" r="4" fill={color}>
      <animateMotion dur="1.15s" repeatCount="indefinite" path={points.path} />
    </circle>}
    {label && <g className="graph-edge-label" transform={`translate(${points.labelX} ${points.labelY})`}>
      <title>{edge.label}</title>
      <rect x={-labelWidth / 2} y={-labelHeight / 2} width={labelWidth} height={labelHeight} rx="2" />
      <text textAnchor="middle" dominantBaseline="central">{label}</text>
    </g>}
  </g>;
}

function isSupportEdge(edge: RenderedEdge): boolean {
  return edge.data.derivedFrom.includes('artifact')
    || edge.data.derivedFrom.includes('instruction')
    || edge.data.derivedFrom.includes('role')
    || edge.data.derivedFrom.includes('skill')
    || edge.data.kind === 'reference';
}

function compactEdgeLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/g, ' ');
  return normalized.length > 24 ? `${normalized.slice(0, 21).trimEnd()}...` : normalized;
}

function edgeLabelWidth(label: string): number {
  return Math.min(160, Math.max(56, label.length * 6.8 + 18));
}

function edgeMarkerId(edgeId: string): string {
  return `agentflow-arrow-${edgeId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

interface FlowRenderStatus {
  stateVersion: number;
  nodeIds: string[];
  renderedNodeIds: string[];
  nodeCount: number;
  edgeCount: number;
  renderedNodeCount: number;
  visibleNodeCount: number;
  canvasWidth: number;
  canvasHeight: number;
  windowInnerHeight: number;
  visualViewportHeight: number;
  rootHeight: number;
  appHeight: number;
  graphTransform: string;
  graphBounds: string;
  reason: string;
}

function postFlowRenderStatus(container: HTMLElement | null, stateVersion: number, nodeIds: string[], edgeCount: number, reason: string, viewport: GraphViewport, bounds: GraphBounds): FlowRenderStatus {
  const status = collectFlowRenderStatus(container, stateVersion, nodeIds, edgeCount, reason, viewport, bounds);
  vscode?.postMessage({ command: 'webviewRenderStatus', ...status });
  return status;
}

function collectFlowRenderStatus(container: HTMLElement | null, stateVersion: number, nodeIds: string[], edgeCount: number, reason: string, viewport: GraphViewport, bounds: GraphBounds): FlowRenderStatus {
  const containerRect = container?.getBoundingClientRect();
  const rootRect = document.getElementById('root')?.getBoundingClientRect();
  const appRect = container?.closest<HTMLElement>('.app')?.getBoundingClientRect();
  const renderedNodeIds = renderedNativeNodeIds(container);
  return {
    stateVersion,
    nodeIds,
    renderedNodeIds,
    nodeCount: nodeIds.length,
    edgeCount,
    renderedNodeCount: renderedNodeIds.length,
    visibleNodeCount: visibleNativeNodeCount(container),
    canvasWidth: Math.round(containerRect?.width ?? 0),
    canvasHeight: Math.round(containerRect?.height ?? 0),
    windowInnerHeight: Math.round(window.innerHeight || 0),
    visualViewportHeight: Math.round(window.visualViewport?.height ?? 0),
    rootHeight: Math.round(rootRect?.height ?? 0),
    appHeight: Math.round(appRect?.height ?? 0),
    graphTransform: graphTransform(viewport),
    graphBounds: `${Math.round(bounds.width)}x${Math.round(bounds.height)}@${Math.round(bounds.x)},${Math.round(bounds.y)}`,
    reason
  };
}

function renderedNativeNodeIds(container: HTMLElement | null): string[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>('.agentflow-node'))
    .map((node) => node.dataset.nodeId)
    .filter((nodeId): nodeId is string => Boolean(nodeId));
}

function minimumUsefulVisibleNodeCount(nodeCount: number): number {
  if (nodeCount <= 1) return nodeCount;
  return Math.min(nodeCount, Math.max(4, Math.ceil(nodeCount * 0.15)));
}

function preferredVisibleNodeCount(nodeCount: number): number {
  if (nodeCount <= 1) return nodeCount;
  return Math.min(nodeCount, Math.max(8, Math.ceil(nodeCount * 0.85)));
}

function DebugOverlay({ status, stateVersion, draft }: { status?: FlowRenderStatus; stateVersion: number; draft: AgentPipeline }) {
  const expectedVisible = minimumUsefulVisibleNodeCount(draft.nodes.length);
  const rows = [
    ['state', String(stateVersion)],
    ['draft nodes', String(draft.nodes.length)],
    ['draft edges', String(draft.edges.length)],
    ['webview nodes', String(status?.nodeCount ?? 'n/a')],
    ['dom nodes', String(status?.renderedNodeCount ?? 'n/a')],
    ['visible nodes', `${status?.visibleNodeCount ?? 'n/a'} / ${expectedVisible}`],
    ['canvas', `${status?.canvasWidth ?? 'n/a'} x ${status?.canvasHeight ?? 'n/a'}`],
    ['window', String(status?.windowInnerHeight ?? 'n/a')],
    ['visual viewport', String(status?.visualViewportHeight ?? 'n/a')],
    ['root/app', `${status?.rootHeight ?? 'n/a'} / ${status?.appHeight ?? 'n/a'}`],
    ['graph bounds', status?.graphBounds ?? 'n/a'],
    ['transform', status?.graphTransform ?? 'n/a'],
    ['reason', status?.reason ?? 'n/a']
  ];
  return <aside className="debug-overlay" aria-label="Agent Flow debug overlay">
    <strong>Agent Flow Debug</strong>
    <dl>{rows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
  </aside>;
}

function visibleNativeNodeCount(container: HTMLElement | null): number {
  if (!container) return 0;
  const containerRect = container.getBoundingClientRect();
  if (!containerRect || containerRect.width < 20 || containerRect.height < 20) return 0;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.agentflow-node'));
  return nodes.filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.right > containerRect.left
      && rect.left < containerRect.right
      && rect.bottom > containerRect.top
      && rect.top < containerRect.bottom;
  }).length;
}

function createNode(type: PipelineNodeType, pipeline: AgentPipeline, position: { x: number; y: number }): PipelineNode {
  const baseId = `new-${type}`;
  const existing = new Set(pipeline.nodes.map((node) => node.id));
  let suffix = 1;
  while (existing.has(`${baseId}-${suffix}`)) suffix += 1;
  const id = `${baseId}-${suffix}`;
  const base = { id, type, label: `new ${type}`, position };
  if (type === 'agent') return { ...base, type, agentFile: `.github/agents/${id}.agent.md`, tools: ['read', 'search'], calls: [], inputs: [], outputs: [] };
  if (type === 'prompt') return { ...base, type, promptFile: `.github/prompts/${id}.prompt.md`, tools: [], workflow: [], constraints: [] };
  if (type === 'instruction') return { ...base, type, instructionFile: `.github/instructions/${id}.instructions.md`, rules: [] };
  if (type === 'skill') return { ...base, type, skillFile: `.github/skills/${id}/SKILL.md`, activationCriteria: [], procedure: [] };
  if (type === 'role') return { ...base, type, roleFile: `.github/roles/${id}.md` };
  if (type === 'artifact') return { ...base, type, path: `.github/artifacts/${id}.md` };
  if (type === 'gate') return { ...base, type, condition: 'Define condition' };
  if (type === 'handoff') return { ...base, type, label: 'new handoff' };
  if (type === 'mcp-server') return { ...base, type, label: 'new mcp server' };
  return { ...base, type };
}

function nodeTypeLabel(type: PipelineNodeType): string {
  return ({
    agent: 'Agent',
    prompt: 'Prompt',
    instruction: 'Instruction',
    skill: 'Skill',
    role: 'Role',
    artifact: 'Artifact',
    gate: 'Gate',
    hook: 'Hook',
    handoff: 'Handoff',
    'mcp-server': 'MCP Server'
  } as Record<PipelineNodeType, string>)[type];
}

function nodeTypeDescription(type: PipelineNodeType): string {
  return ({
    agent: 'Copilot agent file',
    prompt: 'Reusable prompt file',
    instruction: 'Workspace instruction file',
    skill: 'Skill package',
    role: 'Markdown role reference',
    artifact: 'Generated or consumed output',
    gate: 'Conditional flow decision',
    hook: 'Automation hook',
    handoff: 'Agent-to-agent routing',
    'mcp-server': 'MCP server reference'
  } as Record<PipelineNodeType, string>)[type];
}

function nodeFileSummary(node: PipelineNode): string {
  if (node.type === 'agent') return node.agentFile ?? `.github/agents/${node.id}.agent.md`;
  if (node.type === 'prompt') return node.promptFile ?? `.github/prompts/${node.id}.prompt.md`;
  if (node.type === 'instruction') return node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`;
  if (node.type === 'skill') return node.skillFile ?? `.github/skills/${node.id}/SKILL.md`;
  if (node.type === 'role') return node.roleFile ?? `.github/roles/${node.id}.md`;
  if (node.type === 'artifact') return node.path;
  return node.id;
}

function Inspector({ node, pipeline, toolOptions, runtime, findings, onChange, onConnect }: { node?: PipelineNode; pipeline: AgentPipeline; toolOptions: ToolOptionGroup[]; runtime?: NodeRuntimeState; findings: ValidationFinding[]; onChange: (nodeId: string, patch: Partial<PipelineNode>) => void; onConnect: (sourceId: string, targetId: string, kind: ConnectionIntentKind) => void }) {
  if (!node) return <p>Select a node.</p>;
  const agents = pipeline.nodes.filter((item): item is Extract<PipelineNode, { type: 'agent' }> => item.type === 'agent' && item.id !== node.id);
  const branchTargets = pipeline.nodes.filter((item) => item.id !== node.id && (item.type === 'agent' || item.type === 'prompt' || item.type === 'gate' || item.type === 'handoff'));
  const artifacts = pipeline.nodes.filter((item): item is Extract<PipelineNode, { type: 'artifact' }> => item.type === 'artifact');
  const instructions = pipeline.nodes.filter((item): item is Extract<PipelineNode, { type: 'instruction' }> => item.type === 'instruction');
  const references = buildReferenceItems(pipeline);
  const setOptionalString = (field: string, value: string) => onChange(node.id, { [field]: optionalTextValue(value) } as Partial<PipelineNode>);
  const setHandoffs = (handoffs: AgentHandoff[]) => onChange(node.id, { handoffs } as Partial<PipelineNode>);
  const toggleListItem = (field: string, item: string, checked: boolean) => {
    const rawCurrent = Array.isArray((node as any)[field]) ? (node as any)[field] as string[] : [];
    const current = field === 'tools' ? normalizeConfiguredToolsForOptions(rawCurrent, toolOptions) : rawCurrent;
    onChange(node.id, { [field]: checked ? [...new Set([...current, item])] : current.filter((value) => value !== item) } as Partial<PipelineNode>);
  };
  const toggleArtifact = (field: 'inputs' | 'outputs' | 'requiredArtifacts', path: string, checked: boolean, action: ArtifactAction) => {
    const current = Array.isArray((node as any)[field]) ? (node as any)[field] as string[] : [];
    const artifactUsages = checked
      ? upsertArtifactUsage((node as any).artifactUsages, path, action)
      : removeArtifactUsageIfUnselected((node as any).artifactUsages, path, current.filter((value) => value !== path), node);
    onChange(node.id, { [field]: checked ? [...new Set([...current, path])] : current.filter((value) => value !== path), artifactUsages } as Partial<PipelineNode>);
  };
  const updateArtifactUsage = (path: string, patch: Partial<ArtifactUsage>, action: ArtifactAction) => {
    onChange(node.id, { artifactUsages: upsertArtifactUsage((node as any).artifactUsages, path, action, patch) } as Partial<PipelineNode>);
  };
  const toggleInstructionRef = (target: string, checked: boolean) => {
    const instructionRefs = checked ? upsertInstructionRef((node as any).instructionRefs, target) : ((node as any).instructionRefs as ReferenceInstruction[] | undefined)?.filter((ref) => ref.target !== target);
    onChange(node.id, { instructionRefs } as Partial<PipelineNode>);
  };
  const updateInstructionRef = (target: string, instruction: string) => {
    onChange(node.id, { instructionRefs: upsertInstructionRef((node as any).instructionRefs, target, instruction) } as Partial<PipelineNode>);
  };
  const toolGroups = (node.type === 'agent' || node.type === 'prompt') ? partitionConfiguredTools({ availableTools: flattenToolOptionValues(toolOptions), configuredTools: node.tools ?? [] }) : { available: [], unavailable: [] };
  const selectedToolSummaryText = selectedToolSummary(node.type === 'agent' || node.type === 'prompt' ? node.tools ?? [] : [], toolOptions, toolGroups.unavailable);
  const filePath = nodeFileSummary(node);
  const syncStatus = deriveInspectorSyncStatus({ runtime, findingSeverities: findings.map((finding) => finding.severity) });
  const firstArtifact = artifacts[0];
  const firstInstruction = instructions[0];
  return <div className="config"><InspectorHeader node={node} filePath={filePath} syncStatus={syncStatus} />
    <InspectorQuickActions node={node} hasArtifact={Boolean(firstArtifact)} hasInstruction={Boolean(firstInstruction)} hasAgent={agents.length > 0} onAddInput={() => firstArtifact && toggleArtifact(node.type === 'agent' ? 'inputs' : 'requiredArtifacts', firstArtifact.path, true, 'read')} onAddOutput={() => firstArtifact && node.type === 'agent' && toggleArtifact('outputs', firstArtifact.path, true, 'write')} onAddInstruction={() => firstInstruction && toggleInstructionRef(instructionReferenceTarget(firstInstruction), true)} onAddHandoff={() => setHandoffs([...(node.type === 'agent' ? node.handoffs ?? [] : []), { label: 'New handoff', agent: agents[0]?.id ?? '', send: false }])} />
    <InspectorSection id="identity" title="Identity" summary={filePath} defaultOpen>
      <VSCodeInput label="Label" value={node.label} onChange={(event: any) => onChange(node.id, { label: event.target.value } as Partial<PipelineNode>)} />
      <VSCodeTextarea label="Description" value={node.description ?? ''} onChange={(event: any) => setOptionalString('description', event.target.value)} />
    </InspectorSection>
    <InspectorSection id="connections" title="Connections" summary="guided edge creation"><GuidedConnectionPanel node={node} pipeline={pipeline} onConnect={onConnect} /></InspectorSection>
    {node.type === 'agent' && <InspectorSection id="run" title="Run behavior" summary={`${node.model || 'auto model'} · ${node.target || 'both environments'}`} defaultOpen><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label><label>Target<select value={node.target ?? ''} onChange={(event: any) => setOptionalString('target', event.target.value)}><option value="">Both environments</option><option value="vscode">VS Code</option><option value="github-copilot">GitHub Copilot</option></select></label><label className="inline-check"><input type="checkbox" checked={node.userInvocable ?? true} onChange={(event: any) => onChange(node.id, { userInvocable: event.target.checked ? undefined : false } as Partial<PipelineNode>)} /> User invocable</label><label className="inline-check"><input type="checkbox" checked={node.disableModelInvocation ?? false} onChange={(event: any) => onChange(node.id, { disableModelInvocation: event.target.checked || undefined } as Partial<PipelineNode>)} /> Disable model invocation</label></InspectorSection>}
    {(node.type === 'agent' || node.type === 'prompt') && <InspectorSection id="tools" title="Tools" summary={selectedToolSummaryText}><ToolSelectionSummary selected={node.tools ?? []} groups={toolOptions} unavailable={toolGroups.unavailable} /><ToolTree groups={toolOptions} selected={node.tools ?? []} unavailable={toolGroups.unavailable} onToggle={(tool, checked) => toggleListItem('tools', tool, checked)} /></InspectorSection>}
    {node.type === 'agent' && <InspectorSection id="routing" title="Routing" summary={`${node.handoffs?.length ?? 0} handoffs · ${node.calls?.length ?? 0} subagents`}><h4>Subagents</h4><div className="checks">{agents.map((agent) => <label key={agent.id}><input type="checkbox" checked={(node.calls ?? []).includes(agent.id)} onChange={(event: any) => toggleListItem('calls', agent.id, event.target.checked)} />{agent.label}</label>)}</div><HandoffEditor handoffs={node.handoffs ?? []} agents={agents} onChange={setHandoffs} /></InspectorSection>}
    {(node.type === 'agent' || node.type === 'prompt') && <InspectorSection id="context" title="Context" summary={`${((node as any).instructionRefs ?? []).length} instruction refs`}><InstructionReferenceSelector instructions={instructions} refs={(node as any).instructionRefs ?? []} references={references} onToggle={toggleInstructionRef} onInstructionChange={updateInstructionRef} /></InspectorSection>}
    {node.type === 'agent' && <InspectorSection id="artifacts" title="Artifacts" summary={`${(node.inputs ?? []).length} input · ${(node.outputs ?? []).length} output`}><AgentArtifactSelector artifacts={artifacts} inputs={node.inputs ?? []} outputs={node.outputs ?? []} usages={node.artifactUsages ?? []} references={references} onInputToggle={(path, checked) => toggleArtifact('inputs', path, checked, 'read')} onOutputToggle={(path, checked) => toggleArtifact('outputs', path, checked, 'write')} onUsageChange={(path, patch, action) => updateArtifactUsage(path, patch, action)} /></InspectorSection>}
    {node.type === 'prompt' && <InspectorSection id="run" title="Run behavior" summary={node.startAgent || 'current agent'} defaultOpen><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label><label>Agent<select value={node.startAgent ?? ''} onChange={(event: any) => onChange(node.id, { startAgent: event.target.value || undefined } as Partial<PipelineNode>)}><option value="">Current agent</option><option value="ask">ask</option><option value="agent">agent</option><option value="plan">plan</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label></InspectorSection>}
    {node.type === 'prompt' && <InspectorSection id="artifacts" title="Artifacts" summary={`${node.requiredArtifacts?.length ?? 0} required`}><ArtifactSelector title="Required artifacts" artifacts={artifacts} selected={node.requiredArtifacts ?? []} usages={node.artifactUsages ?? []} references={references} defaultAction="read" actionOptions={['read', 'validate']} onToggle={(path, checked) => toggleArtifact('requiredArtifacts', path, checked, 'read')} onUsageChange={(path, patch) => updateArtifactUsage(path, patch, 'read')} /></InspectorSection>}
    {node.type === 'instruction' && <InspectorSection id="context" title="Context" summary={node.applyTo || 'manual scope'} defaultOpen><label>applyTo<input value={node.applyTo ?? ''} onChange={(event: any) => setOptionalString('applyTo', event.target.value)} /></label><label>Exclude agent<select value={node.excludeAgent ?? ''} onChange={(event: any) => setOptionalString('excludeAgent', event.target.value)}><option value="">None</option><option value="code-review">code-review</option><option value="cloud-agent">cloud-agent</option></select></label></InspectorSection>}
    {(node.type === 'instruction' || node.type === 'skill') && <InspectorSection id="artifacts" title="Artifacts" summary={`${node.requiredArtifacts?.length ?? 0} referenced`}><ArtifactSelector title="Artifacts" artifacts={artifacts} selected={node.requiredArtifacts ?? []} usages={node.artifactUsages ?? []} references={references} defaultAction="read" actionOptions={['read', 'write', 'append', 'validate']} onToggle={(path, checked) => toggleArtifact('requiredArtifacts', path, checked, 'read')} onUsageChange={(path, patch) => updateArtifactUsage(path, patch, 'read')} /></InspectorSection>}
    {node.type === 'skill' && <InspectorSection id="run" title="Run behavior" summary={node.context || 'inline'} defaultOpen><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label className="inline-check"><input type="checkbox" checked={node.userInvocable ?? true} onChange={(event: any) => onChange(node.id, { userInvocable: event.target.checked ? undefined : false } as Partial<PipelineNode>)} /> User invocable</label><label className="inline-check"><input type="checkbox" checked={node.disableModelInvocation ?? false} onChange={(event: any) => onChange(node.id, { disableModelInvocation: event.target.checked || undefined } as Partial<PipelineNode>)} /> Disable model invocation</label><label>Context<select value={node.context ?? ''} onChange={(event: any) => setOptionalString('context', event.target.value)}><option value="">inline</option><option value="fork">fork</option></select></label></InspectorSection>}
    {node.type === 'role' && <InspectorSection id="context" title="Context" summary={node.roleFile ?? `.github/roles/${node.id}.md`} defaultOpen><label>Path<input value={node.roleFile ?? `.github/roles/${node.id}.md`} onChange={(event: any) => setOptionalString('roleFile', event.target.value)} /></label></InspectorSection>}
    {node.type === 'artifact' && <InspectorSection id="artifacts" title="Artifacts" summary={node.path} defaultOpen><label>Path<input value={node.path} onChange={(event: any) => onChange(node.id, { path: event.target.value } as Partial<PipelineNode>)} /></label></InspectorSection>}
    {node.type === 'gate' && <InspectorSection id="routing" title="Routing" summary={node.condition} defaultOpen><label>Condition<input value={node.condition} onChange={(event: any) => onChange(node.id, { condition: event.target.value } as Partial<PipelineNode>)} /></label><label>True branch<select value={node.trueBranch ?? ''} onChange={(event: any) => setOptionalString('trueBranch', event.target.value)}><option value="">None</option>{branchTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label><label>False branch<select value={node.falseBranch ?? ''} onChange={(event: any) => setOptionalString('falseBranch', event.target.value)}><option value="">None</option>{branchTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label><label>Error branch<select value={node.errorBranch ?? ''} onChange={(event: any) => setOptionalString('errorBranch', event.target.value)}><option value="">None</option>{branchTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label><label>Max iterations<input type="number" min="0" value={node.maxIterations ?? ''} onChange={(event: any) => onChange(node.id, { maxIterations: event.target.value === '' ? undefined : Number(event.target.value) } as Partial<PipelineNode>)} /></label></InspectorSection>}
    {node.type === 'hook' && <InspectorSection id="run" title="Run behavior" summary={node.trigger || 'manual trigger'} defaultOpen><label>Trigger<input value={node.trigger ?? ''} onChange={(event: any) => setOptionalString('trigger', event.target.value)} /></label><label>Action<textarea value={node.action ?? ''} onChange={(event: any) => setOptionalString('action', event.target.value)} /></label></InspectorSection>}
    {node.type === 'handoff' && <InspectorSection id="routing" title="Routing" summary={node.targetAgent || 'no target'} defaultOpen><label>Target agent<input value={node.targetAgent ?? ''} onChange={(event: any) => setOptionalString('targetAgent', event.target.value)} /></label><label>Prompt<textarea value={node.prompt ?? ''} onChange={(event: any) => setOptionalString('prompt', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label></InspectorSection>}
    {node.type === 'mcp-server' && <InspectorSection id="run" title="Run behavior" summary={node.command || 'no command'} defaultOpen><label>Command<input value={node.command ?? ''} onChange={(event: any) => setOptionalString('command', event.target.value)} /></label><label>Args<input value={Array.isArray(node.args) ? node.args.join(' ') : node.args ?? ''} onChange={(event: any) => setOptionalString('args', event.target.value)} /></label></InspectorSection>}
    <InspectorSection id="markdown" title="Content" summary={node.markdown ? 'custom body' : 'empty'}><TiptapMarkdownEditor value={node.markdown ?? ''} references={references} onChange={(value) => onChange(node.id, { markdown: value } as Partial<PipelineNode>)} /></InspectorSection>
    <InspectorSection id="findings" title="Health" summary={findings.length ? `${findings.length} finding${findings.length === 1 ? '' : 's'}` : 'no findings'} defaultOpen={findings.length > 0}>{findings.length ? findings.map((finding) => <p key={`${finding.ruleId}-${finding.message}`} className={`inspector-finding ${finding.severity}`}><strong>{finding.severity}</strong>{finding.message}<small>{finding.ruleId}</small></p>) : <p>No node findings.</p>}</InspectorSection>
  </div>;
}

function InspectorHeader({ filePath, node, syncStatus }: { filePath: string; node: PipelineNode; syncStatus: InspectorSyncStatus }) {
  return <div className={`config-header sticky inspector-sticky-header inspector-sync-${syncStatus.kind}`}>
    <div className="inspector-node-context">
      <div className="inspector-title-row"><h2>{node.label}</h2><span className="pill node-type-pill" style={{ background: typeColors[node.type] }}>{node.type}</span></div>
      <span className="config-subtitle" title={filePath}>{filePath}</span>
      <span className="inspector-sync-status" title={syncStatus.detail}><Codicon name={syncStatus.icon} />{syncStatus.label}<small>{syncStatus.detail}</small></span>
    </div>
    <div className="config-header-actions"><VSCodeButton className="compact" icon="go-to-file" onClick={() => vscode?.postMessage({ command: 'openWorkspaceFile', path: filePath })}>Open file</VSCodeButton></div>
  </div>;
}

const inspectorSectionClassNames: Record<string, string> = {
  artifacts: 'inspector-section-artifacts',
  connections: 'inspector-section-connections',
  context: 'inspector-section-context',
  findings: 'inspector-section-findings',
  identity: 'inspector-section-identity',
  markdown: 'inspector-section-markdown',
  routing: 'inspector-section-routing',
  run: 'inspector-section-run',
  tools: 'inspector-section-tools'
};

function InspectorSection({ children, defaultOpen = false, id, summary, title }: { children: React.ReactNode; defaultOpen?: boolean; id: string; summary?: React.ReactNode; title: string }) {
  return <details className={`vscode-section inspector-section ${inspectorSectionClassNames[id] ?? `inspector-section-${id}`}`} data-section-id={id} open={defaultOpen}>
    <summary><Codicon name="chevron-right" /><span>{title}</span>{summary && <small className="inspector-section-summary">{summary}</small>}</summary>
    <div className="vscode-section-body">{children}</div>
  </details>;
}

function InspectorQuickActions({ hasAgent, hasArtifact, hasInstruction, node, onAddHandoff, onAddInput, onAddInstruction, onAddOutput }: { hasAgent: boolean; hasArtifact: boolean; hasInstruction: boolean; node: PipelineNode; onAddHandoff: () => void; onAddInput: () => void; onAddInstruction: () => void; onAddOutput: () => void }) {
  const canReferenceArtifacts = node.type === 'agent' || node.type === 'prompt' || node.type === 'instruction' || node.type === 'skill';
  const canReferenceInstructions = node.type === 'agent' || node.type === 'prompt';
  return <div className="inspector-quick-actions" aria-label="Common node actions">
    {canReferenceArtifacts && <VSCodeButton className="compact" icon="arrow-down" disabled={!hasArtifact} onClick={onAddInput}>Add input artifact</VSCodeButton>}
    {node.type === 'agent' && <VSCodeButton className="compact" icon="arrow-up" disabled={!hasArtifact} onClick={onAddOutput}>Add output artifact</VSCodeButton>}
    {canReferenceInstructions && <VSCodeButton className="compact" icon="references" disabled={!hasInstruction} onClick={onAddInstruction}>Add instruction</VSCodeButton>}
    {node.type === 'agent' && <VSCodeButton className="compact" icon="arrow-swap" disabled={!hasAgent} onClick={onAddHandoff}>Add handoff</VSCodeButton>}
  </div>;
}

function ConnectionIntentChooser({ onCancel, onCreateAndConnect, onCreateOnly, pending, source }: { onCancel: () => void; onCreateAndConnect: (kind: ConnectionIntentKind) => void; onCreateOnly: () => void; pending: PendingNodeConnection; source?: PipelineNode }) {
  const firstEnabled = pending.options.find((option) => option.enabled);
  const [intent, setIntent] = useState<ConnectionIntentKind | ''>(firstEnabled?.kind ?? '');
  const selectedOption = pending.options.find((option) => option.kind === intent) ?? firstEnabled ?? pending.options[0];

  useEffect(() => {
    const stillValid = pending.options.some((option) => option.kind === intent && option.enabled);
    if (!stillValid) setIntent(pending.options.find((option) => option.enabled)?.kind ?? '');
  }, [intent, pending]);

  return <section className="connection-intent-chooser" aria-label="Connection intent chooser">
    <div className="connection-intent-heading">
      <strong>Connect new node?</strong>
      <small>{source?.label ?? pending.sourceId} -&gt; {pending.targetNode.label}</small>
    </div>
    <label>Intent<select value={intent} onChange={(event: any) => setIntent(event.target.value)}>{pending.options.map((option) => <option className={option.enabled ? undefined : 'invalid-connection-option'} disabled={!option.enabled} key={option.kind} value={option.kind}>{option.label}</option>)}</select></label>
    {selectedOption && <ConnectionIntentPreview option={selectedOption} />}
    <div className="connection-intent-actions">
      <VSCodeButton className="compact" onClick={onCreateOnly}>Create without connection</VSCodeButton>
      <VSCodeButton className="compact" icon="add" disabled={!selectedOption?.enabled} onClick={() => selectedOption && onCreateAndConnect(selectedOption.kind)}>Create and connect</VSCodeButton>
      <VSCodeIconButton icon="close" title="Cancel connection" onClick={onCancel} />
    </div>
  </section>;
}

function GuidedConnectionPanel({ node, onConnect, pipeline }: { node: PipelineNode; onConnect: (sourceId: string, targetId: string, kind: ConnectionIntentKind) => void; pipeline: AgentPipeline }) {
  const targets = pipeline.nodes.filter((target) => target.id !== node.id);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const options = useMemo(() => buildConnectionIntentOptions(pipeline, node.id, targetId), [node.id, pipeline, targetId]);
  const firstEnabled = options.find((option) => option.enabled);
  const [intent, setIntent] = useState<ConnectionIntentKind | ''>(firstEnabled?.kind ?? '');
  const selectedOption = options.find((option) => option.kind === intent) ?? firstEnabled ?? options[0];

  useEffect(() => {
    const nextOptions = buildConnectionIntentOptions(pipeline, node.id, targetId);
    const stillValid = nextOptions.some((option) => option.kind === intent && option.enabled);
    if (!stillValid) setIntent(nextOptions.find((option) => option.enabled)?.kind ?? '');
  }, [intent, node.id, pipeline, targetId]);

  if (!targets.length) return <p className="hint">Create another node before adding a connection.</p>;

  return <div className="guided-connection-panel">
    <label>Target<select value={targetId} onChange={(event: any) => setTargetId(event.target.value)}>{targets.map((target) => <option key={target.id} value={target.id}>{target.label} · {target.type}</option>)}</select></label>
    <label>Intent<select value={intent} onChange={(event: any) => setIntent(event.target.value)}>{options.map((option) => <option className={option.enabled ? undefined : 'invalid-connection-option'} disabled={!option.enabled} key={option.kind} value={option.kind}>{option.label}</option>)}</select></label>
    {selectedOption && <ConnectionIntentPreview option={selectedOption} />}
    <VSCodeButton className="compact" icon="add" disabled={!selectedOption?.enabled} onClick={() => selectedOption && onConnect(node.id, targetId, selectedOption.kind)}>Add connection</VSCodeButton>
  </div>;
}

function ConnectionIntentPreview({ option }: { option: ReturnType<typeof buildConnectionIntentOptions>[number] }) {
  return <div className={`connection-intent-preview${option.enabled ? '' : ' invalid-connection-option'}`}>
    <strong>Connection preview</strong>
    <dl>
      <dt>File</dt><dd>{option.preview.targetFile ?? 'Not persisted'}</dd>
      <dt>Field</dt><dd>{option.preview.field}</dd>
      <dt>Write</dt><dd>{option.preview.value}</dd>
      {option.preview.placeholder && <><dt>placeholder token</dt><dd><code>{option.preview.placeholder}</code></dd></>}
    </dl>
    <p>{option.enabled ? option.description : option.reason}</p>
  </div>;
}

function ToolSelectionSummary({ groups, selected, unavailable }: { groups: readonly ToolOptionGroup[]; selected: readonly string[]; unavailable: readonly string[] }) {
  const normalized = normalizeConfiguredToolsForOptions(selected, groups);
  if (!normalized.length && !unavailable.length) return <p className="tool-selection-summary empty">No tools selected.</p>;
  return <div className="tool-selection-summary" aria-label="Selected tools">{[...normalized, ...unavailable].slice(0, 8).map((tool) => <span key={tool}>{tool}</span>)}{normalized.length + unavailable.length > 8 && <small>+{normalized.length + unavailable.length - 8}</small>}</div>;
}

function selectedToolSummary(selected: readonly string[], groups: readonly ToolOptionGroup[], unavailable: readonly string[]): string {
  const count = normalizeConfiguredToolsForOptions(selected, groups).length + unavailable.length;
  return count ? `${count} selected` : 'No tools selected';
}

function ToolTree({ groups, onToggle, selected, unavailable }: { groups: readonly ToolOptionGroup[]; selected: readonly string[]; unavailable: readonly string[]; onToggle: (tool: string, checked: boolean) => void }) {
  const selectedSet = new Set(normalizeConfiguredToolsForOptions(selected, groups));
  return <div className="tool-tree">
    {groups.length ? groups.map((group) => <details className="tool-group" key={group.id}>
      <summary>{group.icon && <Codicon name={group.icon} />}<span>{group.label}</span></summary>
      <div className="tool-group-options">{group.options.map((option) => <ToolOptionRow key={option.value} option={option} selectedSet={selectedSet} onToggle={onToggle} />)}</div>
    </details>) : <p className="hint">No VS Code language model tools are registered.</p>}
    {unavailable.length > 0 && <details className="tool-group unavailable-tools">
      <summary><Codicon name="warning" /><span>Selected tools</span></summary>
      <div className="tool-group-options">{unavailable.map((tool) => <label className="tool-option-row unavailable" key={tool} title="Selected on this node, but not registered by VS Code right now."><input type="checkbox" checked={true} onChange={(event: any) => onToggle(tool, event.target.checked)} /><span className="tool-option-icon"><Codicon name="question" /></span><span className="tool-option-text"><span className="tool-option-label">{tool}</span></span></label>)}</div>
    </details>}
  </div>;
}

function ToolOptionRow({ onToggle, option, parent, selectedSet }: { option: ToolOption; parent?: ToolOption; selectedSet: Set<string>; onToggle: (tool: string, checked: boolean) => void }) {
  const { checked, disabled } = toolOptionSelectionState(option, selectedSet, parent);
  const inputId = `tool-${option.value.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const checkbox = <div className={`tool-option-row${disabled ? ' inherited' : ''}`}>
    <input id={inputId} type="checkbox" checked={checked} disabled={disabled} onChange={(event: any) => onToggle(option.value, event.target.checked)} />
    <span className="tool-option-icon"><Codicon name={option.icon ?? 'symbol-method'} /></span>
    <label className="tool-option-text" htmlFor={inputId}><span className="tool-option-label">{option.label}</span></label>
    {option.description && <span className="tool-option-help" data-tooltip={option.description} tabIndex={0} aria-label={option.description} role="img"><Codicon name="info" /></span>}
  </div>;

  if (!option.children?.length) return checkbox;

  return <details className="tool-option-branch">
    <summary onClick={(event) => {
      if ((event.target as HTMLElement | null)?.closest('input')) event.preventDefault();
    }}>{checkbox}</summary>
    <div className="tool-children">{option.children.map((child) => <ToolOptionRow key={child.value} option={child} parent={option} selectedSet={selectedSet} onToggle={onToggle} />)}</div>
  </details>;
}

function HandoffEditor({ agents, handoffs, onChange }: { agents: Array<Extract<PipelineNode, { type: 'agent' }>>; handoffs: AgentHandoff[]; onChange: (handoffs: AgentHandoff[]) => void }) {
  const updateHandoff = (index: number, patch: Partial<AgentHandoff>) => {
    onChange(handoffs.map((handoff, itemIndex) => itemIndex === index ? normalizeHandoff({ ...handoff, ...patch }) : handoff));
  };
  const addHandoff = () => {
    onChange([...handoffs, { label: 'New handoff', agent: agents[0]?.id ?? '', send: false }]);
  };
  const removeHandoff = (index: number) => {
    onChange(handoffs.filter((_handoff, itemIndex) => itemIndex !== index));
  };

  return <section className="handoff-editor">
    <div className="section-heading-row">
      <h4>Handoffs</h4>
      <VSCodeIconButton type="button" icon="add" title="Add handoff" onClick={addHandoff} />
    </div>
    {handoffs.length ? <div className="handoff-list">{handoffs.map((handoff, index) => (
      <div className="handoff-row" key={index}>
        <label>Label<input value={handoff.label} onChange={(event: any) => updateHandoff(index, { label: event.target.value })} /></label>
        <label>Agent<select value={handoff.agent} onChange={(event: any) => updateHandoff(index, { agent: event.target.value })}><option value="">Select agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label>
        <label>Prompt<textarea value={handoff.prompt ?? ''} placeholder="Optional prompt for this handoff." onChange={(event: any) => updateHandoff(index, { prompt: event.target.value })} /></label>
        <label>Model<input value={handoff.model ?? ''} placeholder="Optional model" onChange={(event: any) => updateHandoff(index, { model: event.target.value })} /></label>
        <label>Send<select value={typeof handoff.send === 'boolean' ? String(handoff.send) : ''} onChange={(event: any) => updateHandoff(index, { send: event.target.value === '' ? undefined : event.target.value === 'true' })}><option value="">Default</option><option value="true">true</option><option value="false">false</option></select></label>
        <VSCodeIconButton type="button" className="danger" icon="trash" title="Delete handoff" aria-label={`Delete handoff ${handoff.label || index + 1}`} onClick={() => removeHandoff(index)} />
      </div>
    ))}</div> : <p className="hint">No handoffs configured.</p>}
  </section>;
}

function normalizeHandoff(handoff: AgentHandoff): AgentHandoff {
  return {
    label: handoff.label,
    agent: handoff.agent,
    prompt: handoff.prompt || undefined,
    send: handoff.send,
    model: handoff.model || undefined
  };
}

function ArtifactSelector({ actionOptions, artifacts, defaultAction, onToggle, onUsageChange, references, selected, title, usages }: { actionOptions: ArtifactAction[]; artifacts: Array<Extract<PipelineNode, { type: 'artifact' }>>; defaultAction: ArtifactAction; onToggle: (path: string, checked: boolean) => void; onUsageChange: (path: string, patch: Partial<ArtifactUsage>) => void; references: ReferenceItem[]; selected: string[]; title: string; usages: ArtifactUsage[] }) {
  const artifactPaths = new Set(artifacts.map((artifact) => artifact.path));
  const selectedWithoutNode = selected.filter((path) => !artifactPaths.has(path));
  const rows = artifacts.map((artifact) => ({ id: artifact.id, label: artifact.label, path: artifact.path }));
  return <section className="artifact-picker">
    <h4>{title}</h4>
    {rows.length ? <div className="reference-list">{rows.map((artifact) => <ArtifactUsageRow key={artifact.id} actionOptions={actionOptions} checked={selected.includes(artifact.path)} defaultAction={defaultAction} label={artifact.label} path={artifact.path} usage={usages.find((usage) => usage.path === artifact.path)} references={references} onToggle={onToggle} onUsageChange={onUsageChange} />)}</div> : <p className="hint">Create an artifact node to select it here.</p>}
    {selectedWithoutNode.length > 0 && <><p className="hint">Selected paths without an artifact node.</p><div className="reference-list selected-tools">{selectedWithoutNode.map((path) => <ArtifactUsageRow key={path} actionOptions={actionOptions} checked={true} defaultAction={defaultAction} label={path} path={path} usage={usages.find((usage) => usage.path === path)} references={references} onToggle={onToggle} onUsageChange={onUsageChange} />)}</div></>}
  </section>;
}

function AgentArtifactSelector({ artifacts, inputs, onInputToggle, onOutputToggle, onUsageChange, outputs, references, usages }: { artifacts: Array<Extract<PipelineNode, { type: 'artifact' }>>; inputs: string[]; onInputToggle: (path: string, checked: boolean) => void; onOutputToggle: (path: string, checked: boolean) => void; onUsageChange: (path: string, patch: Partial<ArtifactUsage>, action: ArtifactAction) => void; outputs: string[]; references: ReferenceItem[]; usages: ArtifactUsage[] }) {
  const artifactPaths = new Set(artifacts.map((artifact) => artifact.path));
  const missing = [...new Set([...inputs, ...outputs].filter((path) => !artifactPaths.has(path)))].map((path) => ({ id: path, label: path, path }));
  const rows = [...artifacts.map((artifact) => ({ id: artifact.id, label: artifact.label, path: artifact.path })), ...missing];
  return <section className="artifact-picker">
    <h4>Artifacts</h4>
    {rows.length ? <div className="reference-list compact-reference-list">{rows.map((artifact) => <AgentArtifactRow key={artifact.id} checkedInput={inputs.includes(artifact.path)} checkedOutput={outputs.includes(artifact.path)} label={artifact.label} path={artifact.path} usage={usages.find((usage) => usage.path === artifact.path)} references={references} onInputToggle={onInputToggle} onOutputToggle={onOutputToggle} onUsageChange={onUsageChange} />)}</div> : <p className="hint">Create an artifact node to select it here.</p>}
  </section>;
}

function AgentArtifactRow({ checkedInput, checkedOutput, label, onInputToggle, onOutputToggle, onUsageChange, path, references, usage }: { checkedInput: boolean; checkedOutput: boolean; label: string; onInputToggle: (path: string, checked: boolean) => void; onOutputToggle: (path: string, checked: boolean) => void; onUsageChange: (path: string, patch: Partial<ArtifactUsage>, action: ArtifactAction) => void; path: string; references: ReferenceItem[]; usage?: ArtifactUsage }) {
  const checked = checkedInput || checkedOutput;
  const currentAction = usage?.action ?? (checkedOutput ? 'write' : 'read');
  return <div className={`reference-row compact-reference-row${checked ? ' selected' : ''}`}>
    <div className="reference-row-header">
      <span className="artifact-option"><span>{label}</span><small>{path}</small></span>
      <div className="direction-chips" aria-label={`Artifact direction for ${label}`}>
        <label><input type="checkbox" checked={checkedInput} onChange={(event: any) => onInputToggle(path, event.target.checked)} />Input</label>
        <label><input type="checkbox" checked={checkedOutput} onChange={(event: any) => onOutputToggle(path, event.target.checked)} />Output</label>
      </div>
    </div>
    {checked && <div className="compact-reference-fields"><label className="reference-action-field">Action<select aria-label={`Action for ${label}`} value={currentAction} onChange={(event: any) => onUsageChange(path, { action: event.target.value }, event.target.value)}>{['read', 'write', 'append', 'validate'].map((action) => <option key={action} value={action}>{artifactActionLabel(action)}</option>)}</select></label><div className="reference-markdown-field"><span className="reference-markdown-label">Instruction</span><ReferenceMarkdownEditor ariaLabel={`Instruction for ${label}`} value={usage?.instruction ?? ''} references={references} referenceToken={{ icon: 'file-symlink-file', label: 'Artifact', value: '$artifact', title: `Insert ${path}` }} onChange={(value) => onUsageChange(path, { instruction: referenceInstructionTextValue(value) }, currentAction)} /></div></div>}
  </div>;
}

function ArtifactUsageRow({ actionOptions, checked, defaultAction, label, onToggle, onUsageChange, path, references, usage }: { actionOptions: ArtifactAction[]; checked: boolean; defaultAction: ArtifactAction; label: string; onToggle: (path: string, checked: boolean) => void; onUsageChange: (path: string, patch: Partial<ArtifactUsage>) => void; path: string; references: ReferenceItem[]; usage?: ArtifactUsage }) {
  const currentAction = usage?.action ?? defaultAction;
  return <div className={`reference-row compact-reference-row${checked ? ' selected' : ''}`}>
    <div className="reference-row-header">
      <label className="reference-check" title={path}><input type="checkbox" checked={checked} onChange={(event: any) => onToggle(path, event.target.checked)} /><span className="artifact-option"><span>{label}</span><small>{path}</small></span></label>
    </div>
    {checked && <div className="compact-reference-fields"><label className="reference-action-field">Action<select aria-label={`Action for ${label}`} value={currentAction} onChange={(event: any) => onUsageChange(path, { action: event.target.value })}>{actionOptions.map((action) => <option key={action} value={action}>{artifactActionLabel(action)}</option>)}</select></label><div className="reference-markdown-field"><span className="reference-markdown-label">Instruction</span><ReferenceMarkdownEditor ariaLabel={`Instruction for ${label}`} value={usage?.instruction ?? ''} references={references} referenceToken={{ icon: 'file-symlink-file', label: 'Artifact', value: '$artifact', title: `Insert ${path}` }} onChange={(value) => onUsageChange(path, { instruction: referenceInstructionTextValue(value) })} /></div></div>}
  </div>;
}

function InstructionReferenceSelector({ instructions, onInstructionChange, onToggle, references, refs }: { instructions: Array<Extract<PipelineNode, { type: 'instruction' }>>; onInstructionChange: (target: string, instruction: string) => void; onToggle: (target: string, checked: boolean) => void; references: ReferenceItem[]; refs: ReferenceInstruction[] }) {
  const targets = new Set(instructions.map(instructionReferenceTarget));
  const missing = refs.filter((ref) => !targets.has(ref.target));
  return <section className="reference-picker">
    <h4>Instruction references</h4>
    {instructions.length ? <div className="reference-list">{instructions.map((instruction) => {
      const target = instructionReferenceTarget(instruction);
      const ref = refs.find((item) => item.target === target);
      return <InstructionReferenceRow key={target} checked={Boolean(ref)} instruction={instruction} reference={ref} references={references} target={target} onToggle={onToggle} onInstructionChange={onInstructionChange} />;
    })}</div> : <p className="hint">Create an instruction node to reference it here.</p>}
    {missing.length > 0 && <><p className="hint">Selected instruction references without an instruction node.</p><div className="reference-list selected-tools">{missing.map((ref) => <InstructionReferenceRow key={ref.target} checked={true} reference={ref} references={references} target={ref.target} onToggle={onToggle} onInstructionChange={onInstructionChange} />)}</div></>}
  </section>;
}

function InstructionReferenceRow({ checked, instruction, onInstructionChange, onToggle, reference, references, target }: { checked: boolean; instruction?: Extract<PipelineNode, { type: 'instruction' }>; onInstructionChange: (target: string, instruction: string) => void; onToggle: (target: string, checked: boolean) => void; reference?: ReferenceInstruction; references: ReferenceItem[]; target: string }) {
  return <div className={`reference-row${checked ? ' selected' : ''}`}>
    <label className="reference-check" title={target}><input type="checkbox" checked={checked} onChange={(event: any) => onToggle(target, event.target.checked)} /><span className="artifact-option"><span>{instruction?.label ?? target}</span><small>{target}</small></span></label>
    {checked && <div className="reference-fields"><div className="reference-markdown-field"><span className="reference-markdown-label">Purpose</span><ReferenceMarkdownEditor ariaLabel={`Purpose for ${target}`} value={reference?.instruction ?? ''} references={references} referenceToken={{ icon: 'references', label: 'Instruction', value: '$instruction', title: `Insert ${target}` }} onChange={(value) => onInstructionChange(target, value)} /></div></div>}
  </div>;
}

interface ReferenceItem { label: string; value: string; type: string }

interface ReferenceToken { icon?: string; label: string; title: string; value: string }

function ReferenceMarkdownEditor({ ariaLabel, onChange, referenceToken, references, value }: { ariaLabel: string; onChange: (value: string) => void; referenceToken?: ReferenceToken; references: ReferenceItem[]; value: string }) {
  return <TiptapMarkdownEditor value={value} references={references} variant="compact" ariaLabel={ariaLabel} referenceToken={referenceToken} onChange={onChange} />;
}

function buildReferenceItems(pipeline: AgentPipeline): ReferenceItem[] {
  const generated = pipeline.nodes.flatMap((node) => {
    const items: ReferenceItem[] = [{ label: node.label, value: `@${node.id}`, type: node.type }];
    if (node.type === 'agent') {
      items.push(...(node.inputs ?? []).map((path) => ({ label: path, value: `@file:${path}`, type: 'input' })));
      items.push(...(node.outputs ?? []).map((path) => ({ label: path, value: `@file:${path}`, type: 'output' })));
    }
    if (node.type === 'instruction') items.push({ label: node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`, value: `@instruction:${node.id}`, type: 'instruction' });
    if (node.type === 'skill') items.push({ label: node.skillFile ?? `.github/skills/${node.id}/SKILL.md`, value: `@skill:${node.id}`, type: 'skill' });
    if (node.type === 'role') items.push({ label: node.roleFile ?? `.github/roles/${node.id}.md`, value: `@role:${node.id}`, type: 'role' });
    if (node.type === 'prompt') items.push({ label: node.promptFile ?? `.github/prompts/${node.id}.prompt.md`, value: `@prompt:${node.id}`, type: 'prompt' });
    if (node.type === 'artifact') items.push({ label: node.path, value: `@file:${node.path}`, type: 'artifact' });
    return items;
  });
  return [...new Map(generated.map((item) => [item.value, item])).values()].sort((a, b) => a.label.localeCompare(b.label));
}

function upsertArtifactUsage(usages: ArtifactUsage[] | undefined, path: string, action: ArtifactAction, patch: Partial<ArtifactUsage> = {}): ArtifactUsage[] {
  const existing = usages ?? [];
  const patchKeys = Object.keys(patch);
  return existing.some((usage) => usage.path === path)
    ? patchKeys.length === 0
      ? existing
      : existing.map((usage) => usage.path === path ? { ...usage, ...patch, path } : usage)
    : [...existing, { path, action, ...patch }];
}

function removeArtifactUsageIfUnselected(usages: ArtifactUsage[] | undefined, path: string, nextSelected: string[], node: PipelineNode): ArtifactUsage[] | undefined {
  const stillSelected = nextSelected.includes(path)
    || (node.type === 'agent' && [...(node.inputs ?? []), ...(node.outputs ?? [])].filter((value) => value === path).length > 1)
    || ((node.type === 'prompt' || node.type === 'instruction' || node.type === 'skill') && (node.requiredArtifacts ?? []).filter((value) => value === path).length > 1);
  const next = stillSelected ? usages : usages?.filter((usage) => usage.path !== path);
  return next?.length ? next : undefined;
}

function upsertInstructionRef(refs: ReferenceInstruction[] | undefined, target: string, instruction?: string): ReferenceInstruction[] {
  const existing = refs ?? [];
  if (existing.some((ref) => ref.target === target)) return existing.map((ref) => ref.target === target ? { target, instruction: instruction === undefined ? ref.instruction : referenceInstructionTextValue(instruction) } : ref);
  return [...existing, { target, instruction: instruction === undefined ? undefined : referenceInstructionTextValue(instruction) }];
}

function instructionReferenceTarget(instruction: Extract<PipelineNode, { type: 'instruction' }>): string {
  return instruction.instructionFile ?? `.github/instructions/${instruction.id}.instructions.md`;
}

function artifactActionLabel(action: string): string {
  return ({ read: 'Read', write: 'Write', append: 'Append', validate: 'Validate' } as Record<string, string>)[action] ?? action;
}

function TiptapMarkdownEditor({ ariaLabel = 'TipTap Markdown editor', onChange, references, referenceToken, value, variant = 'default' }: { ariaLabel?: string; onChange: (value: string) => void; references: ReferenceItem[]; referenceToken?: ReferenceToken; value: string; variant?: 'default' | 'compact' }) {
  const [query, setQuery] = useState<{ trigger: '@' | '/'; text: string } | undefined>(undefined);
  const slashItems: ReferenceItem[] = [
    { label: 'Today', value: new Date().toISOString().slice(0, 10), type: 'date' },
    { label: 'Checklist', value: '- [ ] ', type: 'snippet' },
    { label: 'Definition of done', value: '## Definition of done\n\n- [ ] ', type: 'snippet' }
  ];
  const initialMarkdown = splitMarkdownFrontmatter(value);
  const frontmatter = useRef(initialMarkdown.frontmatter ?? '');
  const lastBodyMarkdown = useRef(initialMarkdown.body);
  const lastFullMarkdown = useRef(value);
  const editor = useEditor({
    extensions: [Document, Paragraph, Text, Bold, Code, Link, Heading.configure({ levels: [1, 2, 3] }), BulletList, ListItem, CodeBlock],
    content: markdownToTiptapHtml(initialMarkdown.body),
    editorProps: {
      attributes: {
        class: `tiptap-editor${variant === 'compact' ? ' tiptap-editor-compact' : ''}`,
        'aria-label': ariaLabel,
        spellcheck: 'false'
      }
    },
    onUpdate: ({ editor }: any) => {
      const markdown = tiptapJsonToMarkdown(editor.getJSON());
      const fullMarkdown = combineMarkdownFrontmatter(frontmatter.current, markdown);
      lastBodyMarkdown.current = markdown;
      lastFullMarkdown.current = fullMarkdown;
      onChange(fullMarkdown);
      updateQuery(markdown);
    }
  });

  useEffect(() => {
    if (!editor || value === lastFullMarkdown.current) return;
    const markdown = splitMarkdownFrontmatter(value);
    frontmatter.current = markdown.frontmatter ?? '';
    lastBodyMarkdown.current = markdown.body;
    lastFullMarkdown.current = value;
    editor.commands.setContent(markdownToTiptapHtml(markdown.body), { emitUpdate: false });
    updateQuery(markdown.body);
  }, [editor, value]);

  const suggestions = query ? (query.trigger === '@' ? references : slashItems).filter((item) => item.label.toLowerCase().includes(query.text.toLowerCase()) || item.value.toLowerCase().includes(query.text.toLowerCase())).slice(0, 8) : [];
  const updateQuery = (markdown: string) => {
    const match = markdown.match(/(^|\s)([@/])([^\s@/]*)$/);
    setQuery(match ? { trigger: match[2] as '@' | '/', text: match[3] } : undefined);
  };
  const replaceBodyMarkdown = (next: string) => {
    const fullMarkdown = combineMarkdownFrontmatter(frontmatter.current, next);
    lastBodyMarkdown.current = next;
    lastFullMarkdown.current = fullMarkdown;
    onChange(fullMarkdown);
    updateQuery(next);
    editor?.commands.setContent(markdownToTiptapHtml(next), { emitUpdate: false });
  };
  const appendMarkdown = (snippet: string) => replaceBodyMarkdown(`${lastBodyMarkdown.current}${snippet}`);
  const insertMarkdown = (snippet: string) => {
    editor?.chain().focus().insertContent(snippet).run();
  };
  const insertSuggestion = (item: ReferenceItem) => {
    const current = lastBodyMarkdown.current;
    const next = current.replace(/(^|\s)([@/])([^\s@/]*)$/, (_match, prefix) => `${prefix}${item.value} `);
    replaceBodyMarkdown(next === current ? `${current}${item.value} ` : next);
  };
  const updateFrontmatter = (next: string) => {
    const fullMarkdown = combineMarkdownFrontmatter(next, lastBodyMarkdown.current);
    frontmatter.current = next;
    lastFullMarkdown.current = fullMarkdown;
    onChange(fullMarkdown);
  };
  const addLink = () => {
    const href = window.prompt('URL');
    if (!href) return;
    editor?.chain().focus().setLink({ href }).run();
  };
  return <div className={`markdown-shell tiptap-shell${variant === 'compact' ? ' compact-markdown-shell' : ''}`}>
    <div className="editor-toolbar" role="toolbar" aria-label="Markdown formatting">
      <EditorTool title="Heading 1" active={editor?.isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>H1</EditorTool>
      <EditorTool title="Heading 2" active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</EditorTool>
      <EditorTool title="Heading 3" active={editor?.isActive('heading', { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H3</EditorTool>
      <span className="editor-separator" />
      <EditorTool title="Bullet list" icon="list-unordered" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
      <EditorTool title="Checklist" icon="checklist" onClick={() => appendMarkdown('\n- [ ] ')} />
      <span className="editor-separator" />
      <EditorTool title="Bold" icon="bold" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} />
      <EditorTool title="Inline code" icon="symbol-keyword" active={editor?.isActive('code')} onClick={() => editor?.chain().focus().toggleCode().run()} />
      <EditorTool title="Code block" icon="code" active={editor?.isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
      <EditorTool title="Link" icon="link" active={editor?.isActive('link')} onClick={addLink} />
      {referenceToken && <><span className="editor-separator" /><EditorTool title={referenceToken.title} icon={referenceToken.icon ?? 'references'} onClick={() => insertMarkdown(referenceToken.value)} /></>}
    </div>
    {variant !== 'compact' && frontmatter.current && <details className="frontmatter-drawer"><summary>Frontmatter</summary><textarea value={frontmatter.current} onChange={(event: any) => updateFrontmatter(event.target.value)} spellCheck={false} /></details>}
    <EditorContent editor={editor} />
    {suggestions.length > 0 && <div className="reference-menu">{suggestions.map((item) => <button key={`${item.type}-${item.value}`} onClick={() => insertSuggestion(item)}><span>{item.label}</span><small>{item.type} · {item.value}</small></button>)}</div>}
  </div>;
}

function EditorTool({ active, children, icon, title, onClick }: { active?: boolean; children?: React.ReactNode; icon?: string; title: string; onClick: () => void }) {
  return <VSCodeButton type="button" className={`editor-tool${active ? ' active' : ''}`} icon={icon} title={title} aria-label={title} onMouseDown={(event: any) => event.preventDefault()} onClick={onClick}>{children}</VSCodeButton>;
}

function Bottom({ onSelectNode, state, activeTab, setActiveTab }: { onSelectNode: (nodeId: string) => void; state: State; activeTab: BottomTab; setActiveTab: (tab: BottomTab) => void }) {
  const metrics = aggregateActivityMetrics(state.pipeline, state.activityEvents ?? []);
  const fileAttention = aggregateFileAttention(state.activityEvents ?? []);
  const tabs: BottomTab[] = ['activity', 'metrics', 'attention', 'validation', 'files', 'tools', 'risk'];
  const tabCounts: Record<BottomTab, number | undefined> = {
    activity: state.activityEvents?.length ?? 0,
    metrics: metrics.summary.activeNodes,
    attention: fileAttention.length,
    validation: state.findings.length,
    files: state.generatedFiles.length,
    tools: state.pipeline.nodes.filter((node) => (node.type === 'agent' || node.type === 'prompt') && (node.tools?.length ?? 0) > 0).length,
    risk: state.risk.score
  };
  const title = ({ activity: 'Activity timeline', metrics: 'Run metrics', attention: 'File attention', validation: 'Validation findings', files: 'Generated files', tools: 'Tool matrix', risk: 'Context risk' } as Record<BottomTab, string>)[activeTab];
  return <div className="diagnostics">
    <nav>{tabs.map((tab) => <VSCodeButton key={tab} variant="ghost" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}><span>{tab}</span>{tabCounts[tab] !== undefined && <span className="diagnostic-tab-count">{tabCounts[tab]}</span>}</VSCodeButton>)}</nav>
    <article><div className="diagnostic-heading"><h3>{title}</h3><span>{diagnosticSummary(state, activeTab)}</span></div>{activeTab === 'activity' && <ActivityDiagnostics events={state.activityEvents ?? []} pipeline={state.pipeline} sources={state.activitySources ?? []} onSelectNode={onSelectNode} />}{activeTab === 'metrics' && <MetricsDiagnostics metrics={metrics} onSelectNode={onSelectNode} />}{activeTab === 'attention' && <FileAttentionDiagnostics entries={fileAttention} />}{activeTab === 'validation' && <ValidationDiagnostics findings={state.findings} pipeline={state.pipeline} toolOptions={state.toolOptions} onSelectNode={onSelectNode} />}{activeTab === 'files' && <FileDiagnostics files={state.generatedFiles} />}{activeTab === 'tools' && <ToolDiagnostics pipeline={state.pipeline} />}{activeTab === 'risk' && <RiskDiagnostics pipeline={state.pipeline} risk={state.risk} />}</article>
  </div>;
}

function diagnosticSummary(state: State, tab: BottomTab): string {
  if (tab === 'activity') return state.activityEvents?.length ? `${state.activityEvents.length} live event${state.activityEvents.length === 1 ? '' : 's'}` : 'No activity reported yet';
  if (tab === 'metrics') return state.activityEvents?.length ? 'Operational metrics from current activity events' : 'No run metrics yet';
  if (tab === 'attention') return state.activityEvents?.length ? 'Files touched by current activity events' : 'No file attention yet';
  if (tab === 'validation') return state.findings.length ? `${state.findings.length} issue${state.findings.length === 1 ? '' : 's'} need attention` : 'No validation findings';
  if (tab === 'files') return `${state.generatedFiles.length} inferred output file${state.generatedFiles.length === 1 ? '' : 's'}`;
  if (tab === 'tools') return 'Configured tools by runnable node';
  return `${state.risk.score}/100`;
}

function FileAttentionDiagnostics({ entries }: { entries: ReturnType<typeof aggregateFileAttention> }) {
  if (!entries.length) return <EmptyDiagnostics icon="eye" title="No file attention yet" detail="File reads and writes from activity events will appear here and in Explorer badges." />;
  return <div className="file-attention-list">{entries.map((entry) => <button type="button" key={entry.path} className="file-attention-row" onClick={() => vscode?.postMessage({ command: 'openWorkspaceFile', path: entry.path })}>
    <div className="file-attention-title"><Codicon name={entry.writes ? 'edit' : 'eye'} /><code>{entry.path}</code><span>{Math.round(entry.heat * 100)}%</span></div>
    <div className="metrics-bar"><span style={{ width: `${Math.max(5, Math.round(entry.heat * 100))}%` }} /></div>
    <small>{entry.reads} reads · {entry.writes} writes · {entry.events} events · {entry.tokens} tok ({entry.inputTokens} in / {entry.outputTokens} out) · {entry.nodeIds.join(', ') || 'No mapped node'}</small>
  </button>)}</div>;
}

function MetricsDiagnostics({ metrics, onSelectNode }: { metrics: ReturnType<typeof aggregateActivityMetrics>; onSelectNode: (nodeId: string) => void }) {
  if (!metrics.summary.sessions) return <EmptyDiagnostics icon="graph" title="No metrics yet" detail="Import or replay an activity log, run demo activity, or let an agent report activity to populate run metrics." />;
  const cards = [
    ['Sessions', metrics.summary.sessions],
    ['Active nodes', metrics.summary.activeNodes],
    ['Completed', metrics.summary.completed],
    ['Failed', metrics.summary.failed],
    ['Reads', metrics.summary.fileReads],
    ['Writes', metrics.summary.fileWrites],
    ['Artifacts', metrics.summary.artifactsTouched],
    ['Total tokens', metrics.summary.tokenEstimate],
    ['Input tokens', metrics.summary.inputTokens],
    ['Output tokens', metrics.summary.outputTokens]
  ];
  const maxFileEvents = Math.max(1, ...metrics.files.map((file) => file.events));
  return <div className="metrics-panel">
    <div className="metrics-cards">{cards.map(([label, value]) => <div className="metrics-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <section className="metrics-section"><h4>Node activity</h4><div className="diagnostic-list">{metrics.nodes.slice(0, 12).map((node) => <button key={node.nodeId} type="button" className={`diagnostic-card activity-card ${node.failedCount ? 'error' : 'neutral'}`} onClick={() => onSelectNode(node.nodeId)}>
      <Codicon name={node.failedCount ? 'error' : 'pulse'} />
      <div><div className="diagnostic-card-title"><span>{node.label}</span><code>{node.eventCount} events</code>{node.tokenEstimate > 0 && <code>{node.tokenEstimate} tok</code>}</div><p>{node.completedCount} completed · {node.failedCount} failed</p><small>{node.inputTokens} input · {node.outputTokens} output · {node.lastActivity ? new Date(node.lastActivity).toLocaleString() : 'No activity timestamp'}</small></div>
    </button>)}</div></section>
    <section className="metrics-section"><h4>Top files and artifacts</h4><div className="metrics-files">{metrics.files.slice(0, 12).map((file) => <div key={file.path} className="metrics-file-row">
      <div className="metrics-file-main"><code>{file.path}</code><span>{file.reads} reads · {file.writes} writes · {file.events} events · {file.tokens} tok ({file.inputTokens} in / {file.outputTokens} out)</span></div>
      <div className="metrics-bar"><span style={{ width: `${Math.max(5, Math.round((file.events / maxFileEvents) * 100))}%` }} /></div>
      <small>{file.nodeIds.join(', ') || 'No node mapped'}</small>
    </div>)}</div></section>
  </div>;
}

function ActivityDiagnostics({ events, onSelectNode, pipeline, sources }: { events: AgentFlowActivityEvent[]; onSelectNode: (nodeId: string) => void; pipeline: AgentPipeline; sources: ActivitySourceRuntimeState[] }) {
  const [filters, setFilters] = useState({ sessionId: '', nodeId: '', phase: '', toolName: '', artifactPath: '', severity: '' });
  const [view, setView] = useState<'events' | 'timeline' | 'transcript'>('events');
  const sourceStatus = <ActivitySourceStatuses sources={sources} />;
  if (!events.length) return <div className="activity-panel"><EmptyDiagnostics icon="pulse" title="No activity yet" detail="Agent Flow can show events from Agent Flow language model tools, VS Code document events, filesystem writes, and GitHub Copilot debug logs. File watchers alone cannot observe reads." />{sourceStatus}</div>;
  const labels = new Map(pipeline.nodes.map((node) => [node.id, node.label]));
  const filtered = events.filter((event) =>
    (!filters.sessionId || event.sessionId === filters.sessionId)
    && (!filters.nodeId || event.nodeId === filters.nodeId)
    && (!filters.phase || event.phase === filters.phase)
    && (!filters.toolName || event.toolName === filters.toolName)
    && (!filters.artifactPath || event.artifactPath === filters.artifactPath)
    && (!filters.severity || (event.severity ?? (event.phase === 'failed' ? 'error' : 'info')) === filters.severity)
  );
  return <div className="activity-panel">
    {sourceStatus}
    <div className="activity-actions"><div className="activity-view-switch">{(['events', 'timeline', 'transcript'] as const).map((item) => <VSCodeButton key={item} variant="ghost" className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item}</VSCodeButton>)}</div><ActivityFilter label="Session" value={filters.sessionId} options={unique(events.map((event) => event.sessionId))} onChange={(sessionId) => setFilters((current) => ({ ...current, sessionId }))} /><ActivityFilter label="Node" value={filters.nodeId} options={pipeline.nodes.filter((node) => events.some((event) => event.nodeId === node.id)).map((node) => ({ value: node.id, label: node.label }))} onChange={(nodeId) => setFilters((current) => ({ ...current, nodeId }))} /><ActivityFilter label="Phase" value={filters.phase} options={unique(events.map((event) => event.phase))} onChange={(phase) => setFilters((current) => ({ ...current, phase }))} /><ActivityFilter label="Tool" value={filters.toolName} options={unique(events.map((event) => event.toolName).filter(Boolean) as string[])} onChange={(toolName) => setFilters((current) => ({ ...current, toolName }))} /><ActivityFilter label="Artifact" value={filters.artifactPath} options={unique(events.map((event) => event.artifactPath).filter(Boolean) as string[])} onChange={(artifactPath) => setFilters((current) => ({ ...current, artifactPath }))} /><ActivityFilter label="Severity" value={filters.severity} options={['info', 'warning', 'error']} onChange={(severity) => setFilters((current) => ({ ...current, severity }))} /><VSCodeButton className="compact" icon="clear-all" onClick={() => vscode?.postMessage({ command: 'clearActivity' })}>Clear activity</VSCodeButton></div>
    {view === 'timeline' && <ActivityTimelineDiagnostics events={filtered} labels={labels} onSelectNode={onSelectNode} />}
    {view === 'transcript' && <ActivityTranscriptDiagnostics events={filtered} labels={labels} onSelectNode={onSelectNode} />}
    {view === 'events' && <div className="diagnostic-list activity-list">{[...filtered].reverse().map((event) => <button type="button" key={event.id} className={`diagnostic-card activity-card ${event.severity === 'error' || event.phase === 'failed' ? 'error' : event.severity === 'warning' ? 'warning' : 'neutral'}`} onClick={() => event.nodeId && onSelectNode(event.nodeId)} disabled={!event.nodeId}>
    <Codicon name={event.phase === 'completed' ? 'pass' : event.phase === 'failed' ? 'error' : event.phase === 'tool' ? 'tools' : event.phase === 'artifact' ? 'file' : 'pulse'} />
    <div>
      <div className="diagnostic-card-title"><span>{event.phase}</span>{event.nodeId && <code>{labels.get(event.nodeId) ?? event.nodeId}</code>}{event.toolName && <code>{event.toolName}</code>}</div>
      <p>{event.summary}</p>
      <small>{new Date(event.timestamp).toLocaleTimeString()} · {event.sessionId}{event.artifactPath ? ` · ${event.artifactPath}` : ''}{event.aiCredits !== undefined ? ` · ${event.aiCredits.toFixed(3)} AI credits` : ''}</small>
    </div>
  </button>)}</div>}
  </div>;
}

function ActivityTimelineDiagnostics({ events, labels, onSelectNode }: { events: AgentFlowActivityEvent[]; labels: Map<string, string>; onSelectNode: (nodeId: string) => void }) {
  const timeline = buildActivityTimeline(events);
  if (!timeline.sessions.length) return <EmptyDiagnostics icon="history" title="No timeline events" detail="Current filters hide all events." />;
  return <div className="activity-timeline">{timeline.sessions.map((session) => <section key={session.sessionId} className={`timeline-session${session.failed ? ' failed' : ''}`}>
    <h4><span>{session.sessionId}</span><small>{session.events.length} events · {timeRange(session.startedAt, session.updatedAt)}</small></h4>
    <div className="timeline-node-list">{session.nodes.map((node) => <div key={node.nodeId} className={`timeline-node-group${node.failed ? ' failed' : ''}`}>
      <button type="button" className="timeline-node-title" onClick={() => onSelectNode(node.nodeId)}><Codicon name={node.failed ? 'error' : 'circle-large-filled'} /><span>{labels.get(node.nodeId) ?? node.nodeId}</span><small>{node.events.length}</small></button>
      <ol>{node.events.map((event) => <li key={event.id}><button type="button" onClick={() => event.nodeId && onSelectNode(event.nodeId)} disabled={!event.nodeId}><span className={`timeline-dot phase-${event.phase}`} /><code>{event.phase}</code><span>{event.summary}</span><small>{new Date(event.timestamp).toLocaleTimeString()}</small></button></li>)}</ol>
    </div>)}</div>
  </section>)}</div>;
}

function ActivityTranscriptDiagnostics({ events, labels, onSelectNode }: { events: AgentFlowActivityEvent[]; labels: Map<string, string>; onSelectNode: (nodeId: string) => void }) {
  if (!events.length) return <EmptyDiagnostics icon="comment-discussion" title="No transcript events" detail="Current filters hide all events." />;
  return <div className="activity-transcript">{events.map((event) => {
    const speaker = event.toolName ? 'tool' : event.phase === 'handoff' ? 'handoff' : event.nodeId ? labels.get(event.nodeId) ?? event.nodeId : 'runtime';
    return <button type="button" key={event.id} className={`transcript-row phase-${event.phase}`} onClick={() => event.nodeId && onSelectNode(event.nodeId)} disabled={!event.nodeId}>
      <span>{speaker}</span><p>{event.summary}</p><small>{event.phase} · {new Date(event.timestamp).toLocaleTimeString()}{event.artifactPath ? ` · ${event.artifactPath}` : ''}</small>
    </button>;
  })}</div>;
}

function timeRange(startedAt: string, updatedAt: string): string {
  if (!startedAt || !updatedAt) return 'no timestamp';
  return `${new Date(startedAt).toLocaleTimeString()} - ${new Date(updatedAt).toLocaleTimeString()}`;
}

function ActivitySourceStatuses({ sources }: { sources: ActivitySourceRuntimeState[] }) {
  if (!sources.length) return null;
  return <div className="activity-source-grid">{sources.map((source) => <ActivitySourceStatus source={source} key={source.id} />)}</div>;
}

function ActivitySourceStatus({ source }: { source: ActivitySourceRuntimeState }) {
  const icon = source.state === 'watching' ? 'eye' : source.state === 'disabled' ? 'circle-slash' : source.state === 'error' ? 'error' : source.state === 'initializing' ? 'sync' : 'warning';
  const roots = Array.isArray(source.metadata?.discoveredRoots) ? source.metadata.discoveredRoots as string[] : [];
  return <div className={`activity-source-status ${source.state}`}>
    <div className="diagnostic-card-title"><Codicon name={icon} /><span>{source.label}</span><code>{source.state}</code></div>
    <p>{source.detail}</p>
    {source.id === 'copilotDebugLogs' && source.metadata?.copilotFileLoggingEnabled === false && <p className="diagnostic-muted">Enable <code>github.copilot.chat.agentDebugLog.fileLogging.enabled</code> in VS Code settings to import sanitized Copilot activity.</p>}
    {roots.length > 0 && <div className="diagnostic-chip-row">{roots.slice(0, 3).map((root) => <span className="diagnostic-chip" key={root}>{root}</span>)}</div>}
  </div>;
}

function ActivityFilter({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: Array<string | { value: string; label: string }>; value: string }) {
  return <label className="activity-filter"><span>{label}</span><select value={value} onChange={(event: any) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => {
    const item = typeof option === 'string' ? { value: option, label: option } : option;
    return <option key={item.value} value={item.value}>{item.label}</option>;
  })}</select></label>;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

type ActionableDiagnostic = {
  entity: string;
  entityPath?: string;
  entityType: PipelineNodeType | 'pipeline' | 'file' | 'tool' | 'node' | 'source';
  finding: ValidationFinding;
  fix: string;
  normalizedTools?: string[];
  registeredTools?: string[];
  savedTools?: string[];
  sectionId?: string;
  title: string;
  why: string;
};

function ValidationDiagnostics({ findings, onSelectNode, pipeline, toolOptions }: { findings: ValidationFinding[]; onSelectNode: (nodeId: string) => void; pipeline: AgentPipeline; toolOptions: ToolOptionGroup[] }) {
  const [severityFilter, setSeverityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const actionable = findings.map((finding) => buildActionableDiagnostic(finding, pipeline, toolOptions));
  const filtered = actionable.filter((item) => (!severityFilter || item.finding.severity === severityFilter) && (!typeFilter || item.entityType === typeFilter));
  if (!findings.length) return <><ReadyToRunSummary findings={[]} /><EmptyDiagnostics icon="pass" title="No findings" detail="The inferred flow has no validation warnings right now." /></>;
  return <div className="validation-workflow">
    <ReadyToRunSummary findings={findings} />
    <DiagnosticFilters severityFilter={severityFilter} typeFilter={typeFilter} entityTypes={unique(actionable.map((item) => item.entityType))} onSeverityChange={setSeverityFilter} onTypeChange={setTypeFilter} />
    <div className="diagnostic-list">{filtered.map((finding, index) => <ActionableDiagnosticCard key={`${finding.finding.ruleId}-${index}`} finding={finding} onFocusNode={() => finding.finding.nodeId && openInspectorSection(finding.finding.nodeId, finding.sectionId, onSelectNode)} />)}</div>
  </div>;
}

function ReadyToRunSummary({ findings }: { findings: ValidationFinding[] }) {
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  const risks = findings.filter((finding) => finding.severity === 'risk').length;
  const state = errors ? 'fail' : warnings || risks ? 'warn' : 'pass';
  const title = state === 'pass' ? 'Ready to run' : state === 'warn' ? 'Ready with warnings' : 'Not ready to run';
  return <section className={`validation-ready-summary ${state}`}><Codicon name={state === 'pass' ? 'pass' : state === 'warn' ? 'warning' : 'error'} /><div><strong>{title}</strong><span>{errors} errors · {warnings} warnings · {risks} risks</span></div></section>;
}

function DiagnosticFilters({ entityTypes, onSeverityChange, onTypeChange, severityFilter, typeFilter }: { entityTypes: string[]; onSeverityChange: (value: string) => void; onTypeChange: (value: string) => void; severityFilter: string; typeFilter: string }) {
  return <div className="validation-filter-bar"><ActivityFilter label="Severity" value={severityFilter} options={['error', 'warning', 'risk', 'info']} onChange={onSeverityChange} /><ActivityFilter label="Entity" value={typeFilter} options={entityTypes} onChange={onTypeChange} /></div>;
}

function ActionableDiagnosticCard({ finding, onFocusNode }: { finding: ActionableDiagnostic; onFocusNode: () => void }) {
  const validation = finding.finding;
  return <div className={`diagnostic-card diagnostic-workflow-card ${validation.severity}`}>
    <Codicon name={validation.severity === 'error' ? 'error' : validation.severity === 'warning' ? 'warning' : validation.severity === 'risk' ? 'flame' : 'info'} />
    <div>
      <div className="diagnostic-card-title"><span>{finding.title}</span><code>{finding.entity}</code><code>{validation.ruleId}</code></div>
      <p>{validation.message}</p>
      <dl className="diagnostic-explainer"><dt>Why it matters</dt><dd>{finding.why}</dd><dt>Suggested fix</dt><dd>{finding.fix}</dd></dl>
      {finding.savedTools && <div className="diagnostic-tool-details"><span>Saved tool ids <code>{finding.savedTools.join(', ') || 'none'}</code></span><span>Normalized tool ids <code>{finding.normalizedTools?.join(', ') || 'none'}</code></span><span>VS Code registered <code>{finding.registeredTools?.join(', ') || 'none'}</code></span></div>}
      <div className="diagnostic-actions">
        <VSCodeButton className="compact" icon="target" disabled={!validation.nodeId} onClick={onFocusNode}>Focus node</VSCodeButton>
        <VSCodeButton className="compact" icon="go-to-file" disabled={!finding.entityPath} onClick={() => finding.entityPath && vscode?.postMessage({ command: 'openWorkspaceFile', path: finding.entityPath })}>Open file</VSCodeButton>
        <VSCodeButton className="compact" icon="sparkle" disabled title="Quick fixes are shown when Agent Flow can make a safe deterministic edit.">Apply quick fix</VSCodeButton>
      </div>
    </div>
  </div>;
}

function openInspectorSection(nodeId: string, sectionId: string | undefined, onSelectNode: (nodeId: string) => void): void {
  onSelectNode(nodeId);
  if (sectionId) window.setTimeout(() => document.querySelector<HTMLElement>(`.inspector-section-${sectionId}`)?.scrollIntoView({ block: 'nearest' }), 0);
}

function buildActionableDiagnostic(finding: ValidationFinding, pipeline: AgentPipeline, toolOptions: ToolOptionGroup[]): ActionableDiagnostic {
  const node = finding.nodeId ? pipeline.nodes.find((item) => item.id === finding.nodeId) : undefined;
  const savedTools = node && (node.type === 'agent' || node.type === 'prompt') ? node.tools ?? [] : undefined;
  const normalizedTools = savedTools ? normalizeConfiguredToolsForOptions(savedTools, toolOptions) : undefined;
  const registeredToolSet = new Set(flattenToolOptionValues(toolOptions));
  const registeredTools = normalizedTools?.filter((tool) => registeredToolSet.has(tool));
  const entityPath = finding.entity?.filePath ?? (node ? nodeFileSummary(node) : extractFindingPath(finding.message));
  const entityType = node?.type ?? finding.entity?.kind ?? (entityPath ? 'file' : 'pipeline');
  const entity = finding.entity?.label ?? (node ? node.label : entityPath ?? 'Pipeline');
  const base = { entity, entityPath, entityType, finding, normalizedTools, registeredTools, savedTools } satisfies Partial<ActionableDiagnostic>;
  if (finding.ruleId === 'broad-apply-to' || finding.ruleId === 'markdown-apply-to') return { ...base, title: 'Broad instruction scope', why: 'This instruction can silently apply to many Copilot customization files and consume context where it is not intended.', fix: `Narrow applyTo on ${entityPath ?? 'the instruction'} to the target folder or file pattern.`, sectionId: 'context' } as ActionableDiagnostic;
  if (finding.ruleId === 'agent-no-output') return { ...base, title: 'Missing output artifact', why: 'The next agent or prompt has no explicit handoff file to read, so work can disappear into chat context.', fix: 'Create or select an output artifact and describe what this node should write to it.', sectionId: 'artifacts' } as ActionableDiagnostic;
  if (finding.ruleId.includes('tool') || finding.ruleId.includes('command') || finding.ruleId.includes('edit')) return { ...base, title: 'Tool access needs review', why: 'Tool permissions define what Copilot can read, write, execute, or delegate from this node.', fix: 'Review the selected tools and add a command/edit safety policy when broad tools are required.', sectionId: 'tools' } as ActionableDiagnostic;
  if (finding.ruleId.includes('artifact')) return { ...base, title: 'Artifact boundary issue', why: 'Artifact read/write edges are how the flow preserves context between nodes.', fix: 'Add the missing producer or consumer, or remove the unused artifact reference.', sectionId: 'artifacts' } as ActionableDiagnostic;
  if (finding.ruleId.includes('subagent') || finding.ruleId.includes('agent')) return { ...base, title: 'Routing reference issue', why: 'Broken agent references stop the flow from reaching the intended target node.', fix: 'Select an existing target agent or rename the reference to match the target file.', sectionId: 'routing' } as ActionableDiagnostic;
  return { ...base, title: 'Validation finding', why: 'This finding can affect pipeline correctness, maintainability, or runtime behavior.', fix: 'Review the referenced node or file and update the configuration before publishing.', sectionId: node ? 'identity' : undefined } as ActionableDiagnostic;
}

function extractFindingPath(message: string): string | undefined {
  return message.match(/`([^`]+)`/)?.[1];
}

function FileDiagnostics({ files }: { files: State['generatedFiles'] }) {
  if (!files.length) return <EmptyDiagnostics icon="files" title="No generated files" detail="Agent Flow did not infer any files for this workspace." />;
  const groups = [...files.reduce((map, file) => {
    const current = map.get(file.kind) ?? [];
    current.push(file.path);
    map.set(file.kind, current);
    return map;
  }, new Map<string, string[]>()).entries()].sort(([a], [b]) => a.localeCompare(b));
  return <div className="diagnostic-file-groups">{groups.map(([kind, paths]) => <section key={kind} className="diagnostic-file-group"><h4><span>{kind}</span><small>{paths.length}</small></h4><ul>{paths.sort((a, b) => a.localeCompare(b)).map((path) => <li key={path}><Codicon name="file-code" /><code>{path}</code></li>)}</ul></section>)}</div>;
}

function ToolDiagnostics({ pipeline }: { pipeline: AgentPipeline }) {
  const nodes = pipeline.nodes.filter((node): node is Extract<PipelineNode, { type: 'agent' | 'prompt' }> => (node.type === 'agent' || node.type === 'prompt'));
  if (!nodes.length) return <EmptyDiagnostics icon="tools" title="No runnable nodes" detail="Create an agent or prompt node to configure tools." />;
  return <div className="diagnostic-list">{nodes.map((node) => <div key={node.id} className="diagnostic-card neutral"><Codicon name={node.type === 'agent' ? 'hubot' : 'comment-discussion'} /><div><div className="diagnostic-card-title"><span>{node.label}</span><code>{node.type}</code></div>{node.tools?.length ? <div className="diagnostic-chip-row">{node.tools.map((tool) => <span key={tool} className="diagnostic-chip">{tool}</span>)}</div> : <p className="diagnostic-muted">No tools selected.</p>}</div></div>)}</div>;
}

function RiskDiagnostics({ pipeline, risk }: { pipeline: AgentPipeline; risk: RiskScore }) {
  return <div className="diagnostic-risk"><div className="diagnostic-score"><strong>{risk.score}</strong><span>/100</span></div>{risk.reasons.length ? <ul>{risk.reasons.map((reason) => <li key={reason}><Codicon name="circle-filled" /><div><span>{reason}</span><RiskReasonDetails pipeline={pipeline} reason={reason} /></div></li>)}</ul> : <p className="diagnostic-muted">No risk reasons reported.</p>}</div>;
}

function RiskReasonDetails({ pipeline, reason }: { pipeline: AgentPipeline; reason: string }) {
  const details = riskReasonDetails(pipeline, reason);
  if (!details.length) return null;
  return <div className="diagnostic-risk-details">{details.map((detail) => <code key={detail}>{detail}</code>)}</div>;
}

function riskReasonDetails(pipeline: AgentPipeline, reason: string): string[] {
  if (reason.includes('broad applyTo')) {
    return pipeline.nodes
      .filter((node): node is Extract<PipelineNode, { type: 'instruction' }> => node.type === 'instruction' && Boolean(node.applyTo && ['**/*', '**/*.md'].includes(node.applyTo)))
      .map((node) => `${node.label} (${node.instructionFile ?? `${node.id}.instructions.md`}, applyTo ${node.applyTo})`);
  }
  if (reason.includes('can run commands')) {
    return pipeline.nodes
      .filter((node): node is Extract<PipelineNode, { type: 'agent' }> => node.type === 'agent' && Boolean(node.tools?.includes('execute') || node.tools?.includes('runCommands')))
      .map((node) => `${node.label} (${node.agentFile ?? `${node.id}.agent.md`})`);
  }
  if (reason.includes('generic descriptions')) {
    return pipeline.nodes
      .filter((node): node is Extract<PipelineNode, { type: 'skill' }> => node.type === 'skill' && (!node.description || /general|helpful|useful/i.test(node.description)))
      .map((node) => `${node.label} (${node.skillFile ?? `${node.id}/SKILL.md`})`);
  }
  if (reason.includes('embedded examples or samples')) {
    return pipeline.nodes
      .filter((node): node is Extract<PipelineNode, { type: 'skill' }> => node.type === 'skill' && Boolean(node.procedure?.some((step) => /example|sample/i.test(step))))
      .map((node) => `${node.label} (${node.skillFile ?? `${node.id}/SKILL.md`})`);
  }
  if (reason.includes('context budget')) {
    return pipeline.nodes
      .filter((node): node is Extract<PipelineNode, { type: 'agent' }> => node.type === 'agent' && !node.contextBudget?.length)
      .map((node) => `${node.label} (${node.agentFile ?? `${node.id}.agent.md`})`);
  }
  if (reason.includes('input or output artifact boundaries')) {
    return pipeline.nodes
      .filter((node): node is Extract<PipelineNode, { type: 'agent' }> => node.type === 'agent' && (!node.inputs?.length || !node.outputs?.length))
      .map((node) => `${node.label} (${node.agentFile ?? `${node.id}.agent.md`})`);
  }
  if (reason.includes('cycles exist')) return findCycles(pipeline.nodes, pipeline.edges).map((cycle) => cycle.join(' -> '));
  return [];
}

function EmptyDiagnostics({ detail, icon, title }: { detail: string; icon: string; title: string }) {
  return <div className="diagnostic-empty"><Codicon name={icon} /><strong>{title}</strong><span>{detail}</span></div>;
}

window.__AGENTFLOW_APP_BOOTED__ = true;
createRoot(document.getElementById('root')!).render(<App />);
