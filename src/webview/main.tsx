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
import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { AgentHandoff, AgentPipeline, ArtifactAction, ArtifactUsage, PipelineNode, PipelineNodeType, ReferenceInstruction, ValidationFinding, RiskScore } from '../pipeline/types';
import { validatePipeline } from '../pipeline/validator';
import { calculateRiskScore } from '../pipeline/riskScore';
import { generateFiles } from '../pipeline/generators';
import { deriveVisibleFlowEdges } from './graph';
import { FlowLayout, layoutFlowNodes } from './flowLayout';
import { combineMarkdownFrontmatter, markdownToTiptapHtml, splitMarkdownFrontmatter, tiptapJsonToMarkdown } from './markdown';
import { normalizeConfiguredTools, partitionConfiguredTools } from './toolOptions';
import { estimateNodeTokenCount, formatTokenBadge } from './tokenCounts';
import { TokenNode, flowHandlePositions } from './TokenNode';
import { connectPipelineNodes, deletePipelineEdges, deletePipelineNodes, renameNodeLabel } from './flowMutations';
import { optionalTextValue, referenceInstructionTextValue } from './formState';

interface State {
  pipeline: AgentPipeline;
  findings: ValidationFinding[];
  risk: RiskScore;
  generatedFiles: Array<{ path: string; kind: string }>;
  flowLayout: FlowLayout;
  toolOptions: string[];
}

type BottomTab = 'validation' | 'files' | 'tools' | 'risk';

declare global { interface Window { __AGENTFLOW_STATE__: State; acquireVsCodeApi?: () => { postMessage(message: unknown): void } } }

const vscode = window.acquireVsCodeApi?.();
const typeColors: Record<string, string> = { agent: 'var(--vscode-charts-blue)', prompt: 'var(--vscode-charts-purple)', instruction: 'var(--vscode-charts-orange)', skill: 'var(--vscode-testing-iconPassed, #2ea043)', artifact: 'var(--vscode-charts-green)', gate: 'var(--vscode-charts-yellow)', hook: 'var(--vscode-charts-red)', handoff: 'var(--vscode-editorWarning-foreground, #cca700)', 'mcp-server': 'var(--vscode-charts-cyan, #00b7c3)' };
const nodeTypes: PipelineNodeType[] = ['agent', 'prompt', 'instruction', 'skill', 'artifact', 'gate', 'hook', 'handoff', 'mcp-server'];
const nodeTypesConfig = {
  tokenNode: TokenNode
};

function deriveState(pipeline: AgentPipeline, previous: State): State {
  return {
    ...previous,
    pipeline,
    findings: validatePipeline(pipeline),
    risk: calculateRiskScore(pipeline),
    generatedFiles: generateFiles(pipeline).map((file) => ({ path: file.path, kind: file.kind })),
    flowLayout: previous.flowLayout,
    toolOptions: previous.toolOptions
  };
}

function App() {
  const [state, setState] = useState(window.__AGENTFLOW_STATE__);
  const [draft, setDraft] = useState(state.pipeline);
  const [selectedId, setSelectedId] = useState(state.pipeline.nodes[0]?.id ?? '');
  const [bottomOpen, setBottomOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<BottomTab>('validation');
  const dirtyRef = useRef(false);
  const undoStack = useRef<AgentPipeline[]>([]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.command === 'stateUpdated') {
        dirtyRef.current = false;
        setState(event.data.state);
        setDraft(event.data.state.pipeline);
        setSelectedId((current) => event.data.state.pipeline.nodes.some((node: PipelineNode) => node.id === event.data.selectedId) ? event.data.selectedId : event.data.state.pipeline.nodes.some((node: PipelineNode) => node.id === current) ? current : event.data.state.pipeline.nodes[0]?.id ?? '');
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  const commitDraft = useCallback((updater: (pipeline: AgentPipeline) => AgentPipeline, nextSelectedId?: string) => {
    setDraft((pipeline) => {
      const next = updater(pipeline);
      undoStack.current = [...undoStack.current.slice(-49), pipeline];
      dirtyRef.current = true;
      setState((previous) => deriveState(next, previous));
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
  const nodes: Node[] = useMemo(() => draft.nodes.map((node) => ({
    id: node.id,
    position: layoutPositions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
    draggable: false,
    type: 'tokenNode',
    data: { label: `${risky.has(node.id) ? '⚠ ' : ''}${node.label}`, type: node.type, tokenBadge: formatTokenBadge(estimateNodeTokenCount(draft, node)), ...handlePositions },
    style: { border: `1px solid ${typeColors[node.type] ?? 'var(--vscode-focusBorder)'}`, borderLeft: `5px solid ${typeColors[node.type] ?? 'var(--vscode-focusBorder)'}`, borderRadius: 4, background: 'var(--vscode-editor-background)', color: 'var(--vscode-editor-foreground)', width: 190 }
  })), [draft, handlePositions, layoutPositions, risky, state.flowLayout]);
  const edges: Edge[] = useMemo(() => deriveVisibleFlowEdges(draft), [draft]);

  const updateNode = (nodeId: string, patch: Partial<PipelineNode>) => {
    commitDraft((pipeline) => ({ ...pipeline, nodes: pipeline.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } as PipelineNode : node) }));
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
    }, node.id);
    setInspectorOpen(true);
  };
  return <ReactFlowProvider><FlowApp state={state} draft={draft} selected={selected} selectedId={selectedId} nodes={nodes} edges={edges} activeTab={activeTab} bottomOpen={bottomOpen} inspectorOpen={inspectorOpen} canUndo={undoStack.current.length > 0} undoLast={undoLast} setActiveTab={setActiveTab} setBottomOpen={setBottomOpen} setInspectorOpen={setInspectorOpen} setSelectedId={setSelectedId} updateNode={updateNode} connectNodes={connectNodes} deleteNodes={deleteNodes} deleteEdges={deleteEdges} addNode={addNode} /></ReactFlowProvider>;
}

function FlowApp({ state, draft, selected, selectedId, nodes, edges, activeTab, bottomOpen, inspectorOpen, canUndo, undoLast, setActiveTab, setBottomOpen, setInspectorOpen, setSelectedId, updateNode, connectNodes, deleteNodes, deleteEdges, addNode }: { state: State; draft: AgentPipeline; selected?: PipelineNode; selectedId: string; nodes: Node[]; edges: Edge[]; activeTab: BottomTab; bottomOpen: boolean; inspectorOpen: boolean; canUndo: boolean; undoLast: () => void; setActiveTab: (tab: BottomTab) => void; setBottomOpen: (open: boolean) => void; setInspectorOpen: (open: boolean) => void; setSelectedId: (id: string) => void; updateNode: (nodeId: string, patch: Partial<PipelineNode>) => void; connectNodes: (sourceId: string, targetId: string) => void; deleteNodes: (nodeIds: string[]) => void; deleteEdges: (edgeIds: string[]) => void; addNode: (type: PipelineNodeType, position?: { x: number; y: number }, connectFrom?: string) => void }) {
  const { screenToFlowPosition } = useReactFlow();
  const connectingNodeId = useRef<string | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoLast();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoLast]);
  const onConnect = useCallback((params: Connection) => {
    if (params.source && params.target) connectNodes(params.source, params.target);
  }, [connectNodes]);
  const onNodesDelete = useCallback((deletedNodes: Node[]) => deleteNodes(deletedNodes.map((node) => node.id)), [deleteNodes]);
  const onEdgesDelete = useCallback((deletedEdges: Edge[]) => deleteEdges(deletedEdges.map((edge) => edge.id)), [deleteEdges]);
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    if (!connectingNodeId.current) return;
    const target = event.target as Element | null;
    if (target?.closest('.react-flow__pane')) {
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      addNode('agent', screenToFlowPosition({ x: point.clientX, y: point.clientY }), connectingNodeId.current);
    }
    connectingNodeId.current = null;
  }, [addNode, screenToFlowPosition]);

  return <div className={`app ${bottomOpen ? 'bottom-open' : 'bottom-collapsed'} ${inspectorOpen ? 'inspector-open' : 'inspector-closed'}`}>
    <header className="toolbar"><strong>Agent Flow</strong><span>{draft.name}</span><button className="button-secondary compact" onClick={undoLast} disabled={!canUndo} title="Undo last graph change">Undo</button><span className="autosave-status">Auto-save</span><div className="node-buttons">{nodeTypes.map((type) => <button className="button-secondary compact" key={type} onClick={() => addNode(type)} title={`Create ${type} node`}>+ {type}</button>)}</div></header>
    <main className="canvas"><ReactFlow key={state.flowLayout} nodes={nodes} edges={edges} nodeTypes={nodeTypesConfig} onNodeClick={(_: unknown, node: Node) => { setSelectedId(node.id); setInspectorOpen(true); }} onPaneClick={() => setInspectorOpen(false)} onConnect={onConnect} onNodesDelete={onNodesDelete} onEdgesDelete={onEdgesDelete} deleteKeyCode={['Backspace', 'Delete']} onConnectStart={(_: unknown, params: { nodeId?: string | null }) => { connectingNodeId.current = params.nodeId ?? null; }} onConnectEnd={onConnectEnd} fitView><Controls /><Background /></ReactFlow></main>
    {inspectorOpen && <aside className="inspector"><Inspector node={selected} pipeline={draft} toolOptions={state.toolOptions} findings={state.findings.filter((finding) => finding.nodeId === selectedId)} onChange={updateNode} /></aside>}
    <section className="bottom"><button className="collapse" onClick={() => setBottomOpen(!bottomOpen)}>{bottomOpen ? 'Hide diagnostics' : 'Show diagnostics'}</button>{bottomOpen && <Bottom state={state} activeTab={activeTab} setActiveTab={setActiveTab} />}</section>
  </div>;
}

function createNode(type: PipelineNodeType, pipeline: AgentPipeline, position: { x: number; y: number }): PipelineNode {
  const baseId = `new-${type}`;
  const existing = new Set(pipeline.nodes.map((node) => node.id));
  let suffix = 1;
  while (existing.has(`${baseId}-${suffix}`)) suffix += 1;
  const id = `${baseId}-${suffix}`;
  const base = { id, type, label: `New ${type}`, position };
  if (type === 'agent') return { ...base, type, agentFile: `.github/agents/${id}.agent.md`, tools: ['read', 'search'], calls: [], inputs: [], outputs: [] };
  if (type === 'prompt') return { ...base, type, promptFile: `.github/prompts/${id}.prompt.md`, tools: [], workflow: [], constraints: [] };
  if (type === 'instruction') return { ...base, type, instructionFile: `.github/instructions/${id}.instructions.md`, rules: [] };
  if (type === 'skill') return { ...base, type, skillFile: `.github/skills/${id}/SKILL.md`, activationCriteria: [], procedure: [] };
  if (type === 'artifact') return { ...base, type, path: `.agent-output/${id}.md` };
  if (type === 'gate') return { ...base, type, condition: 'Define condition' };
  if (type === 'handoff') return { ...base, type, label: 'New handoff' };
  if (type === 'mcp-server') return { ...base, type, label: 'New MCP server' };
  return { ...base, type };
}

function Inspector({ node, pipeline, toolOptions, findings, onChange }: { node?: PipelineNode; pipeline: AgentPipeline; toolOptions: string[]; findings: ValidationFinding[]; onChange: (nodeId: string, patch: Partial<PipelineNode>) => void }) {
  if (!node) return <p>Select a node.</p>;
  const agents = pipeline.nodes.filter((item): item is Extract<PipelineNode, { type: 'agent' }> => item.type === 'agent' && item.id !== node.id);
  const artifacts = pipeline.nodes.filter((item): item is Extract<PipelineNode, { type: 'artifact' }> => item.type === 'artifact');
  const instructions = pipeline.nodes.filter((item): item is Extract<PipelineNode, { type: 'instruction' }> => item.type === 'instruction');
  const references = buildReferenceItems(pipeline);
  const setOptionalString = (field: string, value: string) => onChange(node.id, { [field]: optionalTextValue(value) } as Partial<PipelineNode>);
  const setHandoffs = (handoffs: AgentHandoff[]) => onChange(node.id, { handoffs } as Partial<PipelineNode>);
  const toggleListItem = (field: string, item: string, checked: boolean) => {
    const rawCurrent = Array.isArray((node as any)[field]) ? (node as any)[field] as string[] : [];
    const current = field === 'tools' ? normalizeConfiguredTools(rawCurrent) : rawCurrent;
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
  const toolGroups = (node.type === 'agent' || node.type === 'prompt') ? partitionConfiguredTools({ availableTools: toolOptions, configuredTools: node.tools ?? [] }) : { available: [], unavailable: [] };
  return <div className="config"><h2>{node.label}</h2><span className="pill">{node.type}</span>
    <label>Label<input value={node.label} onChange={(event: any) => onChange(node.id, renameNodeLabel(node, event.target.value) as Partial<PipelineNode>)} /></label>
    <label>Description<textarea value={node.description ?? ''} onChange={(event: any) => setOptionalString('description', event.target.value)} /></label>
    {node.type === 'agent' && <details><summary>Agent metadata</summary><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label><label>Target<select value={node.target ?? ''} onChange={(event: any) => setOptionalString('target', event.target.value)}><option value="">Both environments</option><option value="vscode">VS Code</option><option value="github-copilot">GitHub Copilot</option></select></label><label className="inline-check"><input type="checkbox" checked={node.userInvocable ?? true} onChange={(event: any) => onChange(node.id, { userInvocable: event.target.checked ? undefined : false } as Partial<PipelineNode>)} /> User invocable</label><label className="inline-check"><input type="checkbox" checked={node.disableModelInvocation ?? false} onChange={(event: any) => onChange(node.id, { disableModelInvocation: event.target.checked || undefined } as Partial<PipelineNode>)} /> Disable model invocation</label><HandoffEditor handoffs={node.handoffs ?? []} agents={agents} onChange={setHandoffs} /></details>}
    {(node.type === 'agent' || node.type === 'prompt') && <details><summary>Tools</summary>{toolGroups.available.length ? <div className="checks">{toolGroups.available.map((tool) => <label key={tool}><input type="checkbox" checked={(node.tools ?? []).includes(tool)} onChange={(event: any) => toggleListItem('tools', tool, event.target.checked)} />{tool}</label>)}</div> : <p className="hint">No VS Code language model tools are registered.</p>}{toolGroups.unavailable.length > 0 && <><h4>Selected tools</h4><p className="hint">Selected on this node, but not registered by VS Code right now.</p><div className="checks selected-tools">{toolGroups.unavailable.map((tool) => <label key={tool} title="Selected on this node, but not registered by VS Code right now."><input type="checkbox" checked={true} onChange={(event: any) => toggleListItem('tools', tool, event.target.checked)} />{tool}</label>)}</div></>}</details>}
    {node.type === 'agent' && <details><summary>Routing and references</summary><h4>Subagents</h4><div className="checks">{agents.map((agent) => <label key={agent.id}><input type="checkbox" checked={(node.calls ?? []).includes(agent.id)} onChange={(event: any) => toggleListItem('calls', agent.id, event.target.checked)} />{agent.label}</label>)}</div><AgentArtifactSelector artifacts={artifacts} inputs={node.inputs ?? []} outputs={node.outputs ?? []} usages={node.artifactUsages ?? []} onInputToggle={(path, checked) => toggleArtifact('inputs', path, checked, 'read')} onOutputToggle={(path, checked) => toggleArtifact('outputs', path, checked, 'write')} onUsageChange={(path, patch, action) => updateArtifactUsage(path, patch, action)} /><InstructionReferenceSelector instructions={instructions} refs={node.instructionRefs ?? []} onToggle={toggleInstructionRef} onInstructionChange={updateInstructionRef} /></details>}
    {node.type === 'prompt' && <details open><summary>Prompt metadata</summary><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label><label>Agent<select value={node.startAgent ?? ''} onChange={(event: any) => onChange(node.id, { startAgent: event.target.value || undefined } as Partial<PipelineNode>)}><option value="">Current agent</option><option value="ask">ask</option><option value="agent">agent</option><option value="plan">plan</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label><ArtifactSelector title="Required artifacts" artifacts={artifacts} selected={node.requiredArtifacts ?? []} usages={node.artifactUsages ?? []} defaultAction="read" actionOptions={['read', 'validate']} onToggle={(path, checked) => toggleArtifact('requiredArtifacts', path, checked, 'read')} onUsageChange={(path, patch) => updateArtifactUsage(path, patch, 'read')} /><InstructionReferenceSelector instructions={instructions} refs={node.instructionRefs ?? []} onToggle={toggleInstructionRef} onInstructionChange={updateInstructionRef} /></details>}
    {node.type === 'instruction' && <details open><summary>Instruction scope</summary><label>applyTo<input value={node.applyTo ?? ''} onChange={(event: any) => setOptionalString('applyTo', event.target.value)} /></label><label>Exclude agent<select value={node.excludeAgent ?? ''} onChange={(event: any) => setOptionalString('excludeAgent', event.target.value)}><option value="">None</option><option value="code-review">code-review</option><option value="cloud-agent">cloud-agent</option></select></label></details>}
    {node.type === 'skill' && <details open><summary>Skill metadata</summary><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label className="inline-check"><input type="checkbox" checked={node.userInvocable ?? true} onChange={(event: any) => onChange(node.id, { userInvocable: event.target.checked ? undefined : false } as Partial<PipelineNode>)} /> User invocable</label><label className="inline-check"><input type="checkbox" checked={node.disableModelInvocation ?? false} onChange={(event: any) => onChange(node.id, { disableModelInvocation: event.target.checked || undefined } as Partial<PipelineNode>)} /> Disable model invocation</label><label>Context<select value={node.context ?? ''} onChange={(event: any) => setOptionalString('context', event.target.value)}><option value="">inline</option><option value="fork">fork</option></select></label></details>}
    {node.type === 'artifact' && <details open><summary>Artifact file</summary><label>Path<input value={node.path} onChange={(event: any) => onChange(node.id, { path: event.target.value } as Partial<PipelineNode>)} /></label></details>}
    {node.type === 'gate' && <details open><summary>Gate condition</summary><label>Condition<input value={node.condition} onChange={(event: any) => onChange(node.id, { condition: event.target.value } as Partial<PipelineNode>)} /></label></details>}
    {node.type === 'hook' && <details open><summary>Hook metadata</summary><label>Trigger<input value={node.trigger ?? ''} onChange={(event: any) => setOptionalString('trigger', event.target.value)} /></label><label>Action<textarea value={node.action ?? ''} onChange={(event: any) => setOptionalString('action', event.target.value)} /></label></details>}
    {node.type === 'handoff' && <details open><summary>Handoff metadata</summary><label>Target agent<input value={node.targetAgent ?? ''} onChange={(event: any) => setOptionalString('targetAgent', event.target.value)} /></label><label>Prompt<textarea value={node.prompt ?? ''} onChange={(event: any) => setOptionalString('prompt', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label></details>}
    {node.type === 'mcp-server' && <details open><summary>MCP server</summary><label>Command<input value={node.command ?? ''} onChange={(event: any) => setOptionalString('command', event.target.value)} /></label><label>Args<input value={Array.isArray(node.args) ? node.args.join(' ') : node.args ?? ''} onChange={(event: any) => setOptionalString('args', event.target.value)} /></label></details>}
    <details><summary>Markdown editor</summary><TiptapMarkdownEditor value={node.markdown ?? ''} references={references} onChange={(value) => onChange(node.id, { markdown: value } as Partial<PipelineNode>)} /></details>
    <details open={findings.length > 0}><summary>Findings</summary>{findings.length ? findings.map((finding) => <p key={`${finding.ruleId}-${finding.message}`} className={finding.severity}>{finding.message}</p>) : <p>No node findings.</p>}</details>
  </div>;
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
      <button type="button" className="icon-button" title="Add handoff" aria-label="Add handoff" onClick={addHandoff}>+</button>
    </div>
    {handoffs.length ? <div className="handoff-list">{handoffs.map((handoff, index) => (
      <div className="handoff-row" key={index}>
        <label>Label<input value={handoff.label} onChange={(event: any) => updateHandoff(index, { label: event.target.value })} /></label>
        <label>Agent<select value={handoff.agent} onChange={(event: any) => updateHandoff(index, { agent: event.target.value })}><option value="">Select agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label>
        <label>Prompt<textarea value={handoff.prompt ?? ''} placeholder="Optional prompt for this handoff." onChange={(event: any) => updateHandoff(index, { prompt: event.target.value })} /></label>
        <label>Model<input value={handoff.model ?? ''} placeholder="Optional model" onChange={(event: any) => updateHandoff(index, { model: event.target.value })} /></label>
        <label>Send<select value={typeof handoff.send === 'boolean' ? String(handoff.send) : ''} onChange={(event: any) => updateHandoff(index, { send: event.target.value === '' ? undefined : event.target.value === 'true' })}><option value="">Default</option><option value="true">true</option><option value="false">false</option></select></label>
        <button type="button" className="icon-button danger" title="Delete handoff" aria-label={`Delete handoff ${handoff.label || index + 1}`} onClick={() => removeHandoff(index)}>&#128465;</button>
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

function ArtifactSelector({ actionOptions, artifacts, defaultAction, onToggle, onUsageChange, selected, title, usages }: { actionOptions: ArtifactAction[]; artifacts: Array<Extract<PipelineNode, { type: 'artifact' }>>; defaultAction: ArtifactAction; onToggle: (path: string, checked: boolean) => void; onUsageChange: (path: string, patch: Partial<ArtifactUsage>) => void; selected: string[]; title: string; usages: ArtifactUsage[] }) {
  const artifactPaths = new Set(artifacts.map((artifact) => artifact.path));
  const selectedWithoutNode = selected.filter((path) => !artifactPaths.has(path));
  const rows = artifacts.map((artifact) => ({ id: artifact.id, label: artifact.label, path: artifact.path }));
  return <section className="artifact-picker">
    <h4>{title}</h4>
    {rows.length ? <div className="reference-list">{rows.map((artifact) => <ArtifactUsageRow key={artifact.id} actionOptions={actionOptions} checked={selected.includes(artifact.path)} defaultAction={defaultAction} label={artifact.label} path={artifact.path} usage={usages.find((usage) => usage.path === artifact.path)} onToggle={onToggle} onUsageChange={onUsageChange} />)}</div> : <p className="hint">Create an artifact node to select it here.</p>}
    {selectedWithoutNode.length > 0 && <><p className="hint">Selected paths without an artifact node.</p><div className="reference-list selected-tools">{selectedWithoutNode.map((path) => <ArtifactUsageRow key={path} actionOptions={actionOptions} checked={true} defaultAction={defaultAction} label={path} path={path} usage={usages.find((usage) => usage.path === path)} onToggle={onToggle} onUsageChange={onUsageChange} />)}</div></>}
  </section>;
}

function AgentArtifactSelector({ artifacts, inputs, onInputToggle, onOutputToggle, onUsageChange, outputs, usages }: { artifacts: Array<Extract<PipelineNode, { type: 'artifact' }>>; inputs: string[]; onInputToggle: (path: string, checked: boolean) => void; onOutputToggle: (path: string, checked: boolean) => void; onUsageChange: (path: string, patch: Partial<ArtifactUsage>, action: ArtifactAction) => void; outputs: string[]; usages: ArtifactUsage[] }) {
  const artifactPaths = new Set(artifacts.map((artifact) => artifact.path));
  const missing = [...new Set([...inputs, ...outputs].filter((path) => !artifactPaths.has(path)))].map((path) => ({ id: path, label: path, path }));
  const rows = [...artifacts.map((artifact) => ({ id: artifact.id, label: artifact.label, path: artifact.path })), ...missing];
  return <section className="artifact-picker">
    <h4>Artifacts</h4>
    {rows.length ? <div className="reference-list compact-reference-list">{rows.map((artifact) => <AgentArtifactRow key={artifact.id} checkedInput={inputs.includes(artifact.path)} checkedOutput={outputs.includes(artifact.path)} label={artifact.label} path={artifact.path} usage={usages.find((usage) => usage.path === artifact.path)} onInputToggle={onInputToggle} onOutputToggle={onOutputToggle} onUsageChange={onUsageChange} />)}</div> : <p className="hint">Create an artifact node to select it here.</p>}
  </section>;
}

function AgentArtifactRow({ checkedInput, checkedOutput, label, onInputToggle, onOutputToggle, onUsageChange, path, usage }: { checkedInput: boolean; checkedOutput: boolean; label: string; onInputToggle: (path: string, checked: boolean) => void; onOutputToggle: (path: string, checked: boolean) => void; onUsageChange: (path: string, patch: Partial<ArtifactUsage>, action: ArtifactAction) => void; path: string; usage?: ArtifactUsage }) {
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
    {checked && <div className="compact-reference-fields"><select aria-label={`Action for ${label}`} value={currentAction} onChange={(event: any) => onUsageChange(path, { action: event.target.value }, event.target.value)}>{['read', 'write', 'append', 'validate'].map((action) => <option key={action} value={action}>{artifactActionLabel(action)}</option>)}</select><textarea aria-label={`Instruction for ${label}`} value={usage?.instruction ?? ''} placeholder="Add the instruction for this artifact." onChange={(event: any) => onUsageChange(path, { instruction: referenceInstructionTextValue(event.target.value) }, currentAction)} /></div>}
  </div>;
}

function ArtifactUsageRow({ actionOptions, checked, defaultAction, label, onToggle, onUsageChange, path, usage }: { actionOptions: ArtifactAction[]; checked: boolean; defaultAction: ArtifactAction; label: string; onToggle: (path: string, checked: boolean) => void; onUsageChange: (path: string, patch: Partial<ArtifactUsage>) => void; path: string; usage?: ArtifactUsage }) {
  const currentAction = usage?.action ?? defaultAction;
  return <div className={`reference-row compact-reference-row${checked ? ' selected' : ''}`}>
    <div className="reference-row-header">
      <label className="reference-check" title={path}><input type="checkbox" checked={checked} onChange={(event: any) => onToggle(path, event.target.checked)} /><span className="artifact-option"><span>{label}</span><small>{path}</small></span></label>
    </div>
    {checked && <div className="compact-reference-fields"><select aria-label={`Action for ${label}`} value={currentAction} onChange={(event: any) => onUsageChange(path, { action: event.target.value })}>{actionOptions.map((action) => <option key={action} value={action}>{artifactActionLabel(action)}</option>)}</select><textarea aria-label={`Instruction for ${label}`} value={usage?.instruction ?? ''} placeholder="Add the instruction for this artifact." onChange={(event: any) => onUsageChange(path, { instruction: referenceInstructionTextValue(event.target.value) })} /></div>}
  </div>;
}

function InstructionReferenceSelector({ instructions, onInstructionChange, onToggle, refs }: { instructions: Array<Extract<PipelineNode, { type: 'instruction' }>>; onInstructionChange: (target: string, instruction: string) => void; onToggle: (target: string, checked: boolean) => void; refs: ReferenceInstruction[] }) {
  const targets = new Set(instructions.map(instructionReferenceTarget));
  const missing = refs.filter((ref) => !targets.has(ref.target));
  return <section className="reference-picker">
    <h4>Instruction references</h4>
    {instructions.length ? <div className="reference-list">{instructions.map((instruction) => {
      const target = instructionReferenceTarget(instruction);
      const ref = refs.find((item) => item.target === target);
      return <InstructionReferenceRow key={target} checked={Boolean(ref)} instruction={instruction} reference={ref} target={target} onToggle={onToggle} onInstructionChange={onInstructionChange} />;
    })}</div> : <p className="hint">Create an instruction node to reference it here.</p>}
    {missing.length > 0 && <><p className="hint">Selected instruction references without an instruction node.</p><div className="reference-list selected-tools">{missing.map((ref) => <InstructionReferenceRow key={ref.target} checked={true} reference={ref} target={ref.target} onToggle={onToggle} onInstructionChange={onInstructionChange} />)}</div></>}
  </section>;
}

function InstructionReferenceRow({ checked, instruction, onInstructionChange, onToggle, reference, target }: { checked: boolean; instruction?: Extract<PipelineNode, { type: 'instruction' }>; onInstructionChange: (target: string, instruction: string) => void; onToggle: (target: string, checked: boolean) => void; reference?: ReferenceInstruction; target: string }) {
  return <div className={`reference-row${checked ? ' selected' : ''}`}>
    <label className="reference-check" title={target}><input type="checkbox" checked={checked} onChange={(event: any) => onToggle(target, event.target.checked)} /><span className="artifact-option"><span>{instruction?.label ?? target}</span><small>{target}</small></span></label>
    {checked && <div className="reference-fields"><label>Purpose<textarea value={reference?.instruction ?? ''} placeholder={`How should this node apply ${target}?`} onChange={(event: any) => onInstructionChange(target, event.target.value)} /></label></div>}
  </div>;
}

interface ReferenceItem { label: string; value: string; type: string }

function buildReferenceItems(pipeline: AgentPipeline): ReferenceItem[] {
  const generated = pipeline.nodes.flatMap((node) => {
    const items: ReferenceItem[] = [{ label: node.label, value: `@${node.id}`, type: node.type }];
    if (node.type === 'agent') {
      items.push(...(node.inputs ?? []).map((path) => ({ label: path, value: `@file:${path}`, type: 'input' })));
      items.push(...(node.outputs ?? []).map((path) => ({ label: path, value: `@file:${path}`, type: 'output' })));
    }
    if (node.type === 'instruction') items.push({ label: node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`, value: `@instruction:${node.id}`, type: 'instruction' });
    if (node.type === 'skill') items.push({ label: node.skillFile ?? `.github/skills/${node.id}/SKILL.md`, value: `@skill:${node.id}`, type: 'skill' });
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
    || (node.type === 'prompt' && (node.requiredArtifacts ?? []).filter((value) => value === path).length > 1);
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

function TiptapMarkdownEditor({ value, references, onChange }: { value: string; references: ReferenceItem[]; onChange: (value: string) => void }) {
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
        class: 'tiptap-editor',
        'aria-label': 'TipTap Markdown editor',
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
  return <div className="markdown-shell tiptap-shell">
    <div className="editor-toolbar" role="toolbar" aria-label="Markdown formatting">
      <EditorTool title="Heading 1" active={editor?.isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>H1</EditorTool>
      <EditorTool title="Heading 2" active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</EditorTool>
      <EditorTool title="Heading 3" active={editor?.isActive('heading', { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H3</EditorTool>
      <span className="editor-separator" />
      <EditorTool title="Bullet list" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}>-</EditorTool>
      <EditorTool title="Checklist" onClick={() => appendMarkdown('\n- [ ] ')}>[ ]</EditorTool>
      <span className="editor-separator" />
      <EditorTool title="Bold" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}>B</EditorTool>
      <EditorTool title="Inline code" active={editor?.isActive('code')} onClick={() => editor?.chain().focus().toggleCode().run()}>`</EditorTool>
      <EditorTool title="Code block" active={editor?.isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>{`</>`}</EditorTool>
      <EditorTool title="Link" active={editor?.isActive('link')} onClick={addLink}>@</EditorTool>
    </div>
    {frontmatter.current && <details className="frontmatter-drawer"><summary>Frontmatter</summary><textarea value={frontmatter.current} onChange={(event: any) => updateFrontmatter(event.target.value)} spellCheck={false} /></details>}
    <EditorContent editor={editor} />
    {suggestions.length > 0 && <div className="reference-menu">{suggestions.map((item) => <button key={`${item.type}-${item.value}`} onClick={() => insertSuggestion(item)}><span>{item.label}</span><small>{item.type} · {item.value}</small></button>)}</div>}
  </div>;
}

function EditorTool({ active, children, title, onClick }: { active?: boolean; children: React.ReactNode; title: string; onClick: () => void }) {
  return <button type="button" className={`editor-tool${active ? ' active' : ''}`} title={title} aria-label={title} onMouseDown={(event: any) => event.preventDefault()} onClick={onClick}>{children}</button>;
}

function Bottom({ state, activeTab, setActiveTab }: { state: State; activeTab: BottomTab; setActiveTab: (tab: BottomTab) => void }) {
  const matrix = state.pipeline.nodes.filter((node) => node.type === 'agent').map((node) => `${node.id}: ${(node.tools ?? []).join(', ') || 'none'}`);
  return <div className="diagnostics"><nav>{(['validation', 'files', 'tools', 'risk'] as BottomTab[]).map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav><article>{activeTab === 'validation' && (state.findings.length ? state.findings.map((finding, index) => <p key={index} className={finding.severity}>{finding.severity.toUpperCase()}: {finding.message}</p>) : <p>No findings.</p>)}{activeTab === 'files' && <ul>{state.generatedFiles.map((file) => <li key={file.path}>{file.kind}: {file.path}</li>)}</ul>}{activeTab === 'tools' && <pre>{matrix.join('\n')}</pre>}{activeTab === 'risk' && <><strong>{state.risk.score}/100</strong><ul>{state.risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}</article></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
