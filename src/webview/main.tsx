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
import type { ActivitySourceRuntimeState } from '../activity/sources';
import { findCycles, validatePipeline } from '../pipeline/validator';
import { calculateRiskScore } from '../pipeline/riskScore';
import { generateFiles } from '../pipeline/generators';
import { deriveVisibleFlowEdges, type VisibleFlowEdge } from './graph';
import { clamp, edgePathBetweenNodes, fitNativeGraphViewport, focusViewportOnNode, graphNodeHeight, graphNodeWidth, graphTransform, measuredGraphBounds, nativeGraphMaxZoom, nativeGraphMinZoom, normalizeGraphNodePositions, screenToGraphPosition, shouldAutoFitGraph, type GraphBounds, type GraphViewport } from './graphGeometry';
import { activeEdgeIds, recentActivityEvents, recentNodeActivitySummaries, resolveActivityEventsForPipeline } from './activity';
import { FlowLayout, layoutFlowNodes } from './flowLayout';
import { combineMarkdownFrontmatter, markdownToTiptapHtml, splitMarkdownFrontmatter, tiptapJsonToMarkdown } from './markdown';
import { flattenToolOptionValues, normalizeConfiguredToolsForOptions, partitionConfiguredTools, toolOptionSelectionState, type ToolOption, type ToolOptionGroup } from './toolOptions';
import { estimateNodeTokenCount, formatTokenBadge } from './tokenCounts';
import { TokenNode, flowHandlePositions } from './TokenNode';
import { connectPipelineNodes, deletePipelineEdges, deletePipelineNodes, renameNodeLabel } from './flowMutations';
import { optionalTextValue, referenceInstructionTextValue } from './formState';
import { Codicon, VSCodeButton, VSCodeIconButton, VSCodeInput, VSCodeTextarea } from './components';
import { applyNodePatch } from './nodeMarkdownSync';
import { mergeRemoteStateUpdate } from './stateUpdates';
import { deriveNodeRuntimeState, markNodeRuntimeDirty, mergeNodeRuntimeState, type NodeRuntimeStateMap } from './nodeRuntimeState';
import { edgeGradientId, edgeMarkerColor, graphNodeDisplayLabel, nodeTypeColor, nodeTypeColors } from './nodeDisplay';

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
  debugOverlay?: boolean;
}

type BottomTab = 'activity' | 'validation' | 'files' | 'tools' | 'risk';

declare global { interface Window { __AGENTFLOW_STATE__: State; __AGENTFLOW_APP_BOOTED__?: boolean; __AGENTFLOW_VSCODE_API__?: { postMessage(message: unknown): void }; acquireVsCodeApi?: () => { postMessage(message: unknown): void } } }

const vscode = window.__AGENTFLOW_VSCODE_API__ ?? window.acquireVsCodeApi?.();
if (vscode && !window.__AGENTFLOW_VSCODE_API__) window.__AGENTFLOW_VSCODE_API__ = vscode;
const webviewBootId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const typeColors: Record<string, string> = nodeTypeColors;
const nodeTypes: PipelineNodeType[] = ['agent', 'prompt', 'instruction', 'skill', 'role', 'artifact', 'gate', 'hook', 'handoff', 'mcp-server'];
const nodeTypeIcons: Record<PipelineNodeType, string> = { agent: 'hubot', prompt: 'comment-discussion', instruction: 'list-tree', skill: 'tools', role: 'person', artifact: 'file', gate: 'pass', hook: 'debug-disconnect', handoff: 'arrow-swap', 'mcp-server': 'server-process' };

interface RenderedNode {
  id: string;
  position: { x: number; y: number };
  data: React.ComponentProps<typeof TokenNode>['data'];
  style: React.CSSProperties;
}

type RenderedEdge = VisibleFlowEdge & { className?: string };

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
    const previous = undoStack.current.pop();
    if (!previous) return;
    dirtyRef.current = true;
    setDraft(previous);
    setState((state) => deriveState(previous, state));
    setSelectedId((current) => previous.nodes.some((node) => node.id === current) ? current : previous.nodes[0]?.id ?? '');
  }, []);

  const selected = draft.nodes.find((node) => node.id === selectedId) ?? draft.nodes[0];
  const risky = new Set(state.findings.filter((finding) => finding.nodeId).map((finding) => finding.nodeId));
  const layoutPositions = useMemo(() => layoutFlowNodes(draft, state.flowLayout), [draft, state.flowLayout]);
  const handlePositions = useMemo(() => flowHandlePositions(state.flowLayout), [state.flowLayout]);
  const visualActivity = useMemo(() => recentActivityEvents(state.activityEvents ?? [], activityClock), [activityClock, state.activityEvents]);
  const activityByNode = useMemo(() => recentNodeActivitySummaries(state.activityEvents ?? [], activityClock), [activityClock, state.activityEvents]);
  const activeEdges = useMemo(() => new Set(activeEdgeIds(draft, visualActivity)), [draft, visualActivity]);
  const nodes: RenderedNode[] = useMemo(() => normalizeGraphNodePositions(draft.nodes.map((node) => ({
    id: node.id,
    position: layoutPositions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
    data: { label: `${risky.has(node.id) ? '! ' : ''}${graphNodeDisplayLabel(node)}`, type: node.type, tokenBadge: formatTokenBadge(estimateNodeTokenCount(draft, node)), tokenColor: nodeTypeColor(node.type), activity: activityByNode.get(node.id), runtimeStatus: state.nodeRuntime?.[node.id]?.status, dirty: state.nodeRuntime?.[node.id]?.dirty, ...handlePositions },
    style: { border: `1px solid ${typeColors[node.type] ?? 'var(--vscode-focusBorder)'}`, borderLeft: `5px solid ${typeColors[node.type] ?? 'var(--vscode-focusBorder)'}`, borderRadius: 4, background: 'var(--vscode-editor-background)', color: 'var(--vscode-editor-foreground)', width: 190 }
  }))).nodes, [activityByNode, draft, handlePositions, layoutPositions, risky, state.flowLayout, state.nodeRuntime]);
  const activeNodeIds = useMemo(() => [...activityByNode.keys()], [activityByNode]);
  const edges: RenderedEdge[] = useMemo(() => deriveVisibleFlowEdges(draft).map((edge) => activeEdges.has(edge.id) ? { ...edge, animated: true, className: 'activity-edge', style: { ...(edge.style ?? {}), strokeWidth: 3, opacity: 1 } } : edge), [activeEdges, draft]);

  const updateNode = (nodeId: string, patch: Partial<PipelineNode>) => {
    commitDraft((pipeline) => ({ ...pipeline, nodes: pipeline.nodes.map((node) => node.id === nodeId ? applyNodePatch(node, patch) : node) }), undefined, [nodeId]);
  };
  const connectNodes = (sourceId: string, targetId: string) => commitDraft((pipeline) => connectPipelineNodes(pipeline, sourceId, targetId));
  const deleteNodes = (nodeIds: string[]) => {
    if (nodeIds.length) commitDraft((pipeline) => deletePipelineNodes(pipeline, nodeIds));
  };
  const deleteEdges = (edgeIds: string[]) => commitDraft((pipeline) => deletePipelineEdges(pipeline, edgeIds));
  const addNode = (type: PipelineNodeType, position = { x: 120, y: 120 }, connectFrom?: string) => {
    const node = createNode(type, draft, position);
    commitDraft((pipeline) => {
      const next = { ...pipeline, nodes: [...pipeline.nodes, node] };
      return connectFrom ? connectPipelineNodes(next, connectFrom, node.id) : next;
    }, node.id, [node.id]);
    setInspectorOpen(true);
  };
  return <FlowApp state={state} draft={draft} selected={selected} selectedId={selectedId} nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} activeTab={activeTab} bottomOpen={bottomOpen} inspectorOpen={inspectorOpen} viewportSignal={viewportSignal} canUndo={undoStack.current.length > 0} undoLast={undoLast} setActiveTab={setActiveTab} setBottomOpen={setBottomOpen} setInspectorOpen={setInspectorOpen} setSelectedId={setSelectedId} updateNode={updateNode} connectNodes={connectNodes} deleteNodes={deleteNodes} deleteEdges={deleteEdges} addNode={addNode} />;
}

function FlowApp({ state, draft, selected, selectedId, nodes, edges, activeNodeIds, activeTab, bottomOpen, inspectorOpen, viewportSignal, canUndo, undoLast, setActiveTab, setBottomOpen, setInspectorOpen, setSelectedId, updateNode, deleteNodes, addNode }: { state: State; draft: AgentPipeline; selected?: PipelineNode; selectedId: string; nodes: RenderedNode[]; edges: RenderedEdge[]; activeNodeIds: string[]; activeTab: BottomTab; bottomOpen: boolean; inspectorOpen: boolean; viewportSignal: number; canUndo: boolean; undoLast: () => void; setActiveTab: (tab: BottomTab) => void; setBottomOpen: (open: boolean) => void; setInspectorOpen: (open: boolean) => void; setSelectedId: (id: string) => void; updateNode: (nodeId: string, patch: Partial<PipelineNode>) => void; connectNodes: (sourceId: string, targetId: string) => void; deleteNodes: (nodeIds: string[]) => void; deleteEdges: (edgeIds: string[]) => void; addNode: (type: PipelineNodeType, position?: { x: number; y: number }, connectFrom?: string) => void }) {
  const addNodeMenuRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const [addNodeMenuOpen, setAddNodeMenuOpen] = useState(false);
  const [viewport, setViewport] = useState<GraphViewport>({ x: 0, y: 0, zoom: 1 });
  const viewportRef = useRef(viewport);
  const userViewportInteracted = useRef(false);
  const lastFitSignature = useRef<string | undefined>(undefined);
  const lastFocusedActivityNode = useRef<string | undefined>(undefined);
  const [renderStatus, setRenderStatus] = useState<FlowRenderStatus | undefined>(undefined);
  const flowNodeSignature = useMemo(() => nodes.map((node) => `${node.id}@${Math.round(node.position.x)},${Math.round(node.position.y)}`).join('|'), [nodes]);
  const graphBounds = useMemo(() => measuredGraphBounds(nodes), [nodes]);
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
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoLast();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoLast]);
  useEffect(() => {
    if (!addNodeMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof globalThis.Node)) return;
      if (target && addNodeMenuRef.current?.contains(target)) return;
      setAddNodeMenuOpen(false);
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
    if (!activeNodeId || lastFocusedActivityNode.current === activeNodeId) return;
    const node = nodes.find((item) => item.id === activeNodeId);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!node || !rect || rect.width < 20 || rect.height < 20) return;
    lastFocusedActivityNode.current = activeNodeId;
    setGraphViewport(focusViewportOnNode(node, viewportRef.current, rect));
  }, [activeNodeIds, nodes, setGraphViewport]);

  const addNodeAtCenter = (type: PipelineNodeType) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const position = rect
      ? screenToGraphPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, rect, viewport)
      : { x: 120, y: 120 };
    addNode(type, position);
  };

  return <div className={`app ${bottomOpen ? 'bottom-open' : 'bottom-collapsed'} ${inspectorOpen ? 'inspector-open' : 'inspector-closed'}`}>
    <header className="toolbar"><strong>Agent Flow</strong><span>{draft.name}</span><VSCodeButton className="compact" icon="discard" onClick={undoLast} disabled={!canUndo} title="Undo last graph change">Undo</VSCodeButton><span className="autosave-status"><Codicon name="sync" /> Auto-save</span><div className="add-node-menu" ref={addNodeMenuRef}><VSCodeButton className="compact" icon="add" aria-haspopup="menu" aria-expanded={addNodeMenuOpen} onClick={() => setAddNodeMenuOpen((open) => !open)}>Add Node</VSCodeButton>{addNodeMenuOpen && <div className="add-node-popover" role="menu" aria-label="Add node">{nodeTypes.map((type) => <button type="button" role="menuitem" key={type} onClick={() => { addNodeAtCenter(type); setAddNodeMenuOpen(false); }}><Codicon name={nodeTypeIcons[type]} /><span>{nodeTypeLabel(type)}</span><small>{nodeTypeDescription(type)}</small></button>)}</div>}</div></header>
    <NativeGraph canvasRef={canvasRef} nodes={nodes} edges={edges} selectedId={selectedId} activeNodeIds={activeNodeIds} viewport={viewport} graphBounds={graphBounds} onViewportChange={setGraphViewport} onFit={fitViewport} onNodeClick={(nodeId) => { setSelectedId(nodeId); setInspectorOpen(true); }} onCanvasClick={() => setInspectorOpen(false)} onDeleteSelected={() => selectedId && deleteNodes([selectedId])} />
    {state.debugOverlay && <DebugOverlay status={renderStatus} stateVersion={state.stateVersion} draft={draft} />}
    {inspectorOpen && <aside className="inspector"><Inspector node={selected} pipeline={draft} toolOptions={state.toolOptions} findings={state.findings.filter((finding) => finding.nodeId === selectedId)} onChange={updateNode} /></aside>}
    <section className="bottom"><VSCodeButton className="collapse" icon={bottomOpen ? 'chevron-down' : 'chevron-right'} onClick={() => setBottomOpen(!bottomOpen)}>{bottomOpen ? 'Hide diagnostics' : 'Show diagnostics'}</VSCodeButton>{bottomOpen && <Bottom state={state} activeTab={activeTab} setActiveTab={setActiveTab} onSelectNode={(nodeId) => { setSelectedId(nodeId); setInspectorOpen(true); }} />}</section>
  </div>;
}

function NativeGraph({ canvasRef, nodes, edges, selectedId, activeNodeIds, viewport, graphBounds, onViewportChange, onFit, onNodeClick, onCanvasClick, onDeleteSelected }: { canvasRef: React.RefObject<HTMLElement>; nodes: RenderedNode[]; edges: RenderedEdge[]; selectedId: string; activeNodeIds: string[]; viewport: GraphViewport; graphBounds: GraphBounds; onViewportChange: (viewport: GraphViewport, userInteracted?: boolean) => void; onFit: () => void; onNodeClick: (nodeId: string) => void; onCanvasClick: () => void; onDeleteSelected: () => void }) {
  const panStart = useRef<{ pointerId: number; x: number; y: number; viewport: GraphViewport } | undefined>(undefined);
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const activeNodeSet = useMemo(() => new Set(activeNodeIds), [activeNodeIds]);

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
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      onDeleteSelected();
    }
  };

  return <main className="canvas native-graph" ref={canvasRef} tabIndex={0} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPan} onPointerCancel={endPan} onWheel={onWheel} onKeyDown={onKeyDown}>
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
        {edges.map((edge) => <GraphEdge key={edge.id} edge={edge} nodesById={nodesById} />)}
      </svg>
      <div className="graph-node-layer">
        {nodes.map((node) => <button type="button" key={node.id} className={`agentflow-node${node.id === selectedId ? ' selected' : ''}${activeNodeSet.has(node.id) ? ' active' : ''}`} data-node-id={node.id} style={{ ...node.style, transform: `translate(${node.position.x}px, ${node.position.y}px)`, height: graphNodeHeight }} onClick={(event) => { event.stopPropagation(); onNodeClick(node.id); }}>
          <TokenNode data={node.data} />
        </button>)}
      </div>
    </div>
    <div className="native-controls" aria-label="Graph controls">
      <button type="button" title="Zoom in" onClick={() => onViewportChange({ ...viewport, zoom: clamp(viewport.zoom * 1.18, nativeGraphMinZoom, nativeGraphMaxZoom) }, true)}><Codicon name="add" /></button>
      <button type="button" title="Zoom out" onClick={() => onViewportChange({ ...viewport, zoom: clamp(viewport.zoom / 1.18, nativeGraphMinZoom, nativeGraphMaxZoom) }, true)}><Codicon name="dash" /></button>
      <button type="button" title="Fit graph" onClick={onFit}><Codicon name="screen-full" /></button>
    </div>
  </main>;
}

function GraphEdge({ edge, nodesById }: { edge: RenderedEdge; nodesById: Map<string, RenderedNode> }) {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  if (!source || !target) return null;
  const points = edgePathBetweenNodes(source, target);
  const color = `url(#${edgeGradientId(edge.id)})`;
  const opacity = typeof edge.style?.opacity === 'number' ? edge.style.opacity : 0.82;
  const strokeWidth = typeof edge.style?.strokeWidth === 'number' ? edge.style.strokeWidth : 1.8;
  return <g className={`graph-edge${edge.className ? ` ${edge.className}` : ''}${edge.animated ? ' animated' : ''}`} data-edge-id={edge.id} style={{ color }}>
    <path className="graph-edge-path" d={points.path} stroke={color} strokeWidth={strokeWidth} strokeDasharray={typeof edge.style?.strokeDasharray === 'string' ? edge.style.strokeDasharray : undefined} opacity={opacity} markerEnd={`url(#${edgeMarkerId(edge.id)})`} />
    {edge.animated && <circle className="graph-edge-tracer" r="4" fill={color}>
      <animateMotion dur="1.15s" repeatCount="indefinite" path={points.path} />
    </circle>}
    {edge.label && <g className="graph-edge-label" transform={`translate(${points.labelX} ${points.labelY})`}>
      <rect x="-28" y="-10" width="56" height="20" rx="2" />
      <text textAnchor="middle" dominantBaseline="central">{edge.label}</text>
    </g>}
  </g>;
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

function Inspector({ node, pipeline, toolOptions, findings, onChange }: { node?: PipelineNode; pipeline: AgentPipeline; toolOptions: ToolOptionGroup[]; findings: ValidationFinding[]; onChange: (nodeId: string, patch: Partial<PipelineNode>) => void }) {
  if (!node) return <p>Select a node.</p>;
  const agents = pipeline.nodes.filter((item): item is Extract<PipelineNode, { type: 'agent' }> => item.type === 'agent' && item.id !== node.id);
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
  return <div className="config"><div className="config-header"><div><h2>{node.label}</h2><span className="config-subtitle">{nodeFileSummary(node)}</span></div><span className="pill node-type-pill" style={{ background: typeColors[node.type] }}>{node.type}</span></div>
    <VSCodeInput label="Label" value={node.label} onChange={(event: any) => onChange(node.id, renameNodeLabel(node, event.target.value) as Partial<PipelineNode>)} />
    <VSCodeTextarea label="Description" value={node.description ?? ''} onChange={(event: any) => setOptionalString('description', event.target.value)} />
    {node.type === 'agent' && <details><summary>Agent metadata</summary><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label><label>Target<select value={node.target ?? ''} onChange={(event: any) => setOptionalString('target', event.target.value)}><option value="">Both environments</option><option value="vscode">VS Code</option><option value="github-copilot">GitHub Copilot</option></select></label><label className="inline-check"><input type="checkbox" checked={node.userInvocable ?? true} onChange={(event: any) => onChange(node.id, { userInvocable: event.target.checked ? undefined : false } as Partial<PipelineNode>)} /> User invocable</label><label className="inline-check"><input type="checkbox" checked={node.disableModelInvocation ?? false} onChange={(event: any) => onChange(node.id, { disableModelInvocation: event.target.checked || undefined } as Partial<PipelineNode>)} /> Disable model invocation</label><HandoffEditor handoffs={node.handoffs ?? []} agents={agents} onChange={setHandoffs} /></details>}
    {(node.type === 'agent' || node.type === 'prompt') && <details key={`tools-${node.id}`}><summary>Tools</summary><ToolTree groups={toolOptions} selected={node.tools ?? []} unavailable={toolGroups.unavailable} onToggle={(tool, checked) => toggleListItem('tools', tool, checked)} /></details>}
    {node.type === 'agent' && <details><summary>Routing and references</summary><h4>Subagents</h4><div className="checks">{agents.map((agent) => <label key={agent.id}><input type="checkbox" checked={(node.calls ?? []).includes(agent.id)} onChange={(event: any) => toggleListItem('calls', agent.id, event.target.checked)} />{agent.label}</label>)}</div><AgentArtifactSelector artifacts={artifacts} inputs={node.inputs ?? []} outputs={node.outputs ?? []} usages={node.artifactUsages ?? []} references={references} onInputToggle={(path, checked) => toggleArtifact('inputs', path, checked, 'read')} onOutputToggle={(path, checked) => toggleArtifact('outputs', path, checked, 'write')} onUsageChange={(path, patch, action) => updateArtifactUsage(path, patch, action)} /><InstructionReferenceSelector instructions={instructions} refs={node.instructionRefs ?? []} references={references} onToggle={toggleInstructionRef} onInstructionChange={updateInstructionRef} /></details>}
    {node.type === 'prompt' && <details open><summary>Prompt metadata</summary><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label><label>Agent<select value={node.startAgent ?? ''} onChange={(event: any) => onChange(node.id, { startAgent: event.target.value || undefined } as Partial<PipelineNode>)}><option value="">Current agent</option><option value="ask">ask</option><option value="agent">agent</option><option value="plan">plan</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label><ArtifactSelector title="Required artifacts" artifacts={artifacts} selected={node.requiredArtifacts ?? []} usages={node.artifactUsages ?? []} references={references} defaultAction="read" actionOptions={['read', 'validate']} onToggle={(path, checked) => toggleArtifact('requiredArtifacts', path, checked, 'read')} onUsageChange={(path, patch) => updateArtifactUsage(path, patch, 'read')} /><InstructionReferenceSelector instructions={instructions} refs={node.instructionRefs ?? []} references={references} onToggle={toggleInstructionRef} onInstructionChange={updateInstructionRef} /></details>}
    {node.type === 'instruction' && <details open><summary>Instruction scope</summary><label>applyTo<input value={node.applyTo ?? ''} onChange={(event: any) => setOptionalString('applyTo', event.target.value)} /></label><label>Exclude agent<select value={node.excludeAgent ?? ''} onChange={(event: any) => setOptionalString('excludeAgent', event.target.value)}><option value="">None</option><option value="code-review">code-review</option><option value="cloud-agent">cloud-agent</option></select></label><ArtifactSelector title="Artifacts" artifacts={artifacts} selected={node.requiredArtifacts ?? []} usages={node.artifactUsages ?? []} references={references} defaultAction="read" actionOptions={['read', 'write', 'append', 'validate']} onToggle={(path, checked) => toggleArtifact('requiredArtifacts', path, checked, 'read')} onUsageChange={(path, patch) => updateArtifactUsage(path, patch, 'read')} /></details>}
    {node.type === 'skill' && <details open><summary>Skill metadata</summary><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label className="inline-check"><input type="checkbox" checked={node.userInvocable ?? true} onChange={(event: any) => onChange(node.id, { userInvocable: event.target.checked ? undefined : false } as Partial<PipelineNode>)} /> User invocable</label><label className="inline-check"><input type="checkbox" checked={node.disableModelInvocation ?? false} onChange={(event: any) => onChange(node.id, { disableModelInvocation: event.target.checked || undefined } as Partial<PipelineNode>)} /> Disable model invocation</label><label>Context<select value={node.context ?? ''} onChange={(event: any) => setOptionalString('context', event.target.value)}><option value="">inline</option><option value="fork">fork</option></select></label><ArtifactSelector title="Artifacts" artifacts={artifacts} selected={node.requiredArtifacts ?? []} usages={node.artifactUsages ?? []} references={references} defaultAction="read" actionOptions={['read', 'write', 'append', 'validate']} onToggle={(path, checked) => toggleArtifact('requiredArtifacts', path, checked, 'read')} onUsageChange={(path, patch) => updateArtifactUsage(path, patch, 'read')} /></details>}
    {node.type === 'role' && <details open><summary>Role file</summary><label>Path<input value={node.roleFile ?? `.github/roles/${node.id}.md`} onChange={(event: any) => setOptionalString('roleFile', event.target.value)} /></label></details>}
    {node.type === 'artifact' && <details open><summary>Artifact file</summary><label>Path<input value={node.path} onChange={(event: any) => onChange(node.id, { path: event.target.value } as Partial<PipelineNode>)} /></label></details>}
    {node.type === 'gate' && <details open><summary>Gate condition</summary><label>Condition<input value={node.condition} onChange={(event: any) => onChange(node.id, { condition: event.target.value } as Partial<PipelineNode>)} /></label></details>}
    {node.type === 'hook' && <details open><summary>Hook metadata</summary><label>Trigger<input value={node.trigger ?? ''} onChange={(event: any) => setOptionalString('trigger', event.target.value)} /></label><label>Action<textarea value={node.action ?? ''} onChange={(event: any) => setOptionalString('action', event.target.value)} /></label></details>}
    {node.type === 'handoff' && <details open><summary>Handoff metadata</summary><label>Target agent<input value={node.targetAgent ?? ''} onChange={(event: any) => setOptionalString('targetAgent', event.target.value)} /></label><label>Prompt<textarea value={node.prompt ?? ''} onChange={(event: any) => setOptionalString('prompt', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label></details>}
    {node.type === 'mcp-server' && <details open><summary>MCP server</summary><label>Command<input value={node.command ?? ''} onChange={(event: any) => setOptionalString('command', event.target.value)} /></label><label>Args<input value={Array.isArray(node.args) ? node.args.join(' ') : node.args ?? ''} onChange={(event: any) => setOptionalString('args', event.target.value)} /></label></details>}
    <details><summary>Markdown editor</summary><TiptapMarkdownEditor value={node.markdown ?? ''} references={references} onChange={(value) => onChange(node.id, { markdown: value } as Partial<PipelineNode>)} /></details>
    <details open={findings.length > 0}><summary>Findings</summary>{findings.length ? findings.map((finding) => <p key={`${finding.ruleId}-${finding.message}`} className={finding.severity}>{finding.message}</p>) : <p>No node findings.</p>}</details>
  </div>;
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
  const tabs: BottomTab[] = ['activity', 'validation', 'files', 'tools', 'risk'];
  const tabCounts: Record<BottomTab, number | undefined> = {
    activity: state.activityEvents?.length ?? 0,
    validation: state.findings.length,
    files: state.generatedFiles.length,
    tools: state.pipeline.nodes.filter((node) => (node.type === 'agent' || node.type === 'prompt') && (node.tools?.length ?? 0) > 0).length,
    risk: state.risk.score
  };
  const title = ({ activity: 'Activity timeline', validation: 'Validation findings', files: 'Generated files', tools: 'Tool matrix', risk: 'Context risk' } as Record<BottomTab, string>)[activeTab];
  return <div className="diagnostics">
    <nav>{tabs.map((tab) => <VSCodeButton key={tab} variant="ghost" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}><span>{tab}</span>{tabCounts[tab] !== undefined && <span className="diagnostic-tab-count">{tabCounts[tab]}</span>}</VSCodeButton>)}</nav>
    <article><div className="diagnostic-heading"><h3>{title}</h3><span>{diagnosticSummary(state, activeTab)}</span></div>{activeTab === 'activity' && <ActivityDiagnostics events={state.activityEvents ?? []} pipeline={state.pipeline} sources={state.activitySources ?? []} onSelectNode={onSelectNode} />}{activeTab === 'validation' && <ValidationDiagnostics findings={state.findings} pipeline={state.pipeline} />}{activeTab === 'files' && <FileDiagnostics files={state.generatedFiles} />}{activeTab === 'tools' && <ToolDiagnostics pipeline={state.pipeline} />}{activeTab === 'risk' && <RiskDiagnostics pipeline={state.pipeline} risk={state.risk} />}</article>
  </div>;
}

function diagnosticSummary(state: State, tab: BottomTab): string {
  if (tab === 'activity') return state.activityEvents?.length ? `${state.activityEvents.length} live event${state.activityEvents.length === 1 ? '' : 's'}` : 'No activity reported yet';
  if (tab === 'validation') return state.findings.length ? `${state.findings.length} issue${state.findings.length === 1 ? '' : 's'} need attention` : 'No validation findings';
  if (tab === 'files') return `${state.generatedFiles.length} inferred output file${state.generatedFiles.length === 1 ? '' : 's'}`;
  if (tab === 'tools') return 'Configured tools by runnable node';
  return `${state.risk.score}/100`;
}

function ActivityDiagnostics({ events, onSelectNode, pipeline, sources }: { events: AgentFlowActivityEvent[]; onSelectNode: (nodeId: string) => void; pipeline: AgentPipeline; sources: ActivitySourceRuntimeState[] }) {
  const [filters, setFilters] = useState({ sessionId: '', nodeId: '', phase: '', toolName: '', artifactPath: '', severity: '' });
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
    <div className="activity-actions"><ActivityFilter label="Session" value={filters.sessionId} options={unique(events.map((event) => event.sessionId))} onChange={(sessionId) => setFilters((current) => ({ ...current, sessionId }))} /><ActivityFilter label="Node" value={filters.nodeId} options={pipeline.nodes.filter((node) => events.some((event) => event.nodeId === node.id)).map((node) => ({ value: node.id, label: node.label }))} onChange={(nodeId) => setFilters((current) => ({ ...current, nodeId }))} /><ActivityFilter label="Phase" value={filters.phase} options={unique(events.map((event) => event.phase))} onChange={(phase) => setFilters((current) => ({ ...current, phase }))} /><ActivityFilter label="Tool" value={filters.toolName} options={unique(events.map((event) => event.toolName).filter(Boolean) as string[])} onChange={(toolName) => setFilters((current) => ({ ...current, toolName }))} /><ActivityFilter label="Artifact" value={filters.artifactPath} options={unique(events.map((event) => event.artifactPath).filter(Boolean) as string[])} onChange={(artifactPath) => setFilters((current) => ({ ...current, artifactPath }))} /><ActivityFilter label="Severity" value={filters.severity} options={['info', 'warning', 'error']} onChange={(severity) => setFilters((current) => ({ ...current, severity }))} /><VSCodeButton className="compact" icon="clear-all" onClick={() => vscode?.postMessage({ command: 'clearActivity' })}>Clear activity</VSCodeButton></div>
    <div className="diagnostic-list activity-list">{[...filtered].reverse().map((event) => <button type="button" key={event.id} className={`diagnostic-card activity-card ${event.severity === 'error' || event.phase === 'failed' ? 'error' : event.severity === 'warning' ? 'warning' : 'neutral'}`} onClick={() => event.nodeId && onSelectNode(event.nodeId)} disabled={!event.nodeId}>
    <Codicon name={event.phase === 'completed' ? 'pass' : event.phase === 'failed' ? 'error' : event.phase === 'tool' ? 'tools' : event.phase === 'artifact' ? 'file' : 'pulse'} />
    <div>
      <div className="diagnostic-card-title"><span>{event.phase}</span>{event.nodeId && <code>{labels.get(event.nodeId) ?? event.nodeId}</code>}{event.toolName && <code>{event.toolName}</code>}</div>
      <p>{event.summary}</p>
      <small>{new Date(event.timestamp).toLocaleTimeString()} · {event.sessionId}{event.artifactPath ? ` · ${event.artifactPath}` : ''}{event.aiCredits !== undefined ? ` · ${event.aiCredits.toFixed(3)} AI credits` : ''}</small>
    </div>
  </button>)}</div>
  </div>;
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

function ValidationDiagnostics({ findings, pipeline }: { findings: ValidationFinding[]; pipeline: AgentPipeline }) {
  if (!findings.length) return <EmptyDiagnostics icon="pass" title="No findings" detail="The inferred flow has no validation warnings right now." />;
  const nodeLabels = new Map(pipeline.nodes.map((node) => [node.id, node.label]));
  return <div className="diagnostic-list">{findings.map((finding, index) => <div key={`${finding.ruleId}-${index}`} className={`diagnostic-card ${finding.severity}`}>
    <Codicon name={finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : finding.severity === 'risk' ? 'flame' : 'info'} />
    <div><div className="diagnostic-card-title"><span>{finding.severity}</span>{finding.nodeId && <code>{nodeLabels.get(finding.nodeId) ?? finding.nodeId}</code>}</div><p>{finding.message}</p><small>{finding.ruleId}</small></div>
  </div>)}</div>;
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
