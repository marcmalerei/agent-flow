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
import { Background, Controls, ReactFlow, ReactFlowProvider, addEdge, useReactFlow, type Connection, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { AgentPipeline, PipelineEdgeKind, PipelineNode, PipelineNodeType, ValidationFinding, RiskScore } from '../pipeline/types';
import { validatePipeline } from '../pipeline/validator';
import { calculateRiskScore } from '../pipeline/riskScore';
import { generateFiles } from '../pipeline/generators';
import { deriveVisibleFlowEdges } from './graph';
import { markdownToTiptapHtml, tiptapJsonToMarkdown } from './markdown';
import { partitionConfiguredTools } from './toolOptions';

interface State {
  pipeline: AgentPipeline;
  findings: ValidationFinding[];
  risk: RiskScore;
  generatedFiles: Array<{ path: string; kind: string }>;
  toolOptions: string[];
}

type BottomTab = 'validation' | 'files' | 'tools' | 'risk';

declare global { interface Window { __AGENTFLOW_STATE__: State; acquireVsCodeApi?: () => { postMessage(message: unknown): void } } }

const vscode = window.acquireVsCodeApi?.();
const typeColors: Record<string, string> = { agent: 'var(--vscode-charts-blue)', prompt: 'var(--vscode-charts-purple)', instruction: 'var(--vscode-charts-orange)', skill: 'var(--vscode-charts-green)', artifact: 'var(--vscode-descriptionForeground)', gate: 'var(--vscode-charts-yellow)', hook: 'var(--vscode-charts-red)' };
const nodeTypes: PipelineNodeType[] = ['agent', 'prompt', 'instruction', 'skill', 'artifact', 'gate', 'hook'];

function deriveState(pipeline: AgentPipeline, previous: State): State {
  return {
    ...previous,
    pipeline,
    findings: validatePipeline(pipeline),
    risk: calculateRiskScore(pipeline),
    generatedFiles: generateFiles(pipeline).map((file) => ({ path: file.path, kind: file.kind })),
    toolOptions: previous.toolOptions
  };
}

function App() {
  const [state, setState] = useState(window.__AGENTFLOW_STATE__);
  const [draft, setDraft] = useState(state.pipeline);
  const [selectedId, setSelectedId] = useState(state.pipeline.nodes[0]?.id ?? '');
  const [bottomOpen, setBottomOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<BottomTab>('validation');

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.command === 'stateUpdated') {
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
      setState((previous) => deriveState(next, previous));
      if (nextSelectedId) setSelectedId(nextSelectedId);
      return next;
    });
  }, []);

  const selected = draft.nodes.find((node) => node.id === selectedId) ?? draft.nodes[0];
  const risky = new Set(state.findings.filter((finding) => finding.nodeId).map((finding) => finding.nodeId));
  const nodes: Node[] = useMemo(() => draft.nodes.map((node) => ({
    id: node.id,
    position: node.position ?? { x: 0, y: 0 },
    data: { label: `${risky.has(node.id) ? '⚠ ' : ''}${node.label}\n${node.type}` },
    style: { border: `2px solid ${typeColors[node.type] ?? 'var(--vscode-focusBorder)'}`, borderRadius: 10, background: 'var(--vscode-editorWidget-background)', color: 'var(--vscode-editorWidget-foreground)', width: 170, whiteSpace: 'pre-line' }
  })), [draft.nodes, risky]);
  const edges: Edge[] = useMemo(() => deriveVisibleFlowEdges(draft), [draft]);

  const updateNode = (nodeId: string, patch: Partial<PipelineNode>) => {
    commitDraft((pipeline) => ({ ...pipeline, nodes: pipeline.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } as PipelineNode : node) }));
  };
  const updateEdges = (nextEdges: Edge[]) => {
    commitDraft((pipeline) => ({
      ...pipeline,
      edges: nextEdges
        .filter((edge) => !isPreviewEdge(edge))
        .map((edge) => {
          const metadata = edgeMetadata(edge);
          return {
            id: edge.id,
            from: String(edge.source),
            to: String(edge.target),
            kind: metadata.kind,
            artifact: metadata.artifact,
            label: typeof edge.label === 'string' ? edge.label : undefined
          };
        })
    }));
  };
  const addNode = (type: PipelineNodeType, position = { x: 120, y: 120 }, connectFrom?: string) => {
    const node = createNode(type, draft, position);
    commitDraft((pipeline) => ({
      ...pipeline,
      nodes: [...pipeline.nodes, node],
      edges: connectFrom ? [...pipeline.edges, { id: `${connectFrom}-to-${node.id}`, from: connectFrom, to: node.id, kind: 'flow' }] : pipeline.edges
    }), node.id);
  };
  const savePipeline = () => vscode?.postMessage({ command: 'savePipeline', pipeline: draft, selectedId: selected?.id });

  return <ReactFlowProvider><FlowApp state={state} draft={draft} selected={selected} selectedId={selectedId} nodes={nodes} edges={edges} activeTab={activeTab} bottomOpen={bottomOpen} setActiveTab={setActiveTab} setBottomOpen={setBottomOpen} setSelectedId={setSelectedId} updateNode={updateNode} updateEdges={updateEdges} addNode={addNode} savePipeline={savePipeline} /></ReactFlowProvider>;
}

function isPreviewEdge(edge: Edge): boolean {
  const derivedFrom = (edge as Edge & { data?: { derivedFrom?: string } }).data?.derivedFrom;
  return typeof derivedFrom === 'string' && derivedFrom !== 'pipeline.edges';
}

function edgeMetadata(edge: Edge): { kind: PipelineEdgeKind; artifact?: string } {
  const data = (edge as Edge & { data?: { kind?: string; artifact?: string } }).data;
  if (data?.kind === 'artifact' || data?.kind === 'prompt' || data?.kind === 'skill' || data?.kind === 'gate') return { kind: data.kind, artifact: data.artifact };
  return { kind: 'flow' };
}

function FlowApp({ state, draft, selected, selectedId, nodes, edges, activeTab, bottomOpen, setActiveTab, setBottomOpen, setSelectedId, updateNode, updateEdges, addNode, savePipeline }: { state: State; draft: AgentPipeline; selected?: PipelineNode; selectedId: string; nodes: Node[]; edges: Edge[]; activeTab: BottomTab; bottomOpen: boolean; setActiveTab: (tab: BottomTab) => void; setBottomOpen: (open: boolean) => void; setSelectedId: (id: string) => void; updateNode: (nodeId: string, patch: Partial<PipelineNode>) => void; updateEdges: (edges: Edge[]) => void; addNode: (type: PipelineNodeType, position?: { x: number; y: number }, connectFrom?: string) => void; savePipeline: () => void }) {
  const { screenToFlowPosition } = useReactFlow();
  const connectingNodeId = useRef<string | null>(null);
  const onConnect = useCallback((params: Connection) => updateEdges(addEdge(params, edges)), [edges, updateEdges]);
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    if (!connectingNodeId.current) return;
    const target = event.target as Element | null;
    if (target?.closest('.react-flow__pane')) {
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      addNode('agent', screenToFlowPosition({ x: point.clientX, y: point.clientY }), connectingNodeId.current);
    }
    connectingNodeId.current = null;
  }, [addNode, screenToFlowPosition]);

  return <div className={`app ${bottomOpen ? 'bottom-open' : 'bottom-collapsed'}`}>
    <header className="toolbar"><strong>AgentFlow</strong><span>{draft.name}</span><button onClick={savePipeline}>Save Pipeline</button><div className="node-buttons">{nodeTypes.map((type) => <button key={type} onClick={() => addNode(type)} title={`Create ${type} node`}>+ {type}</button>)}</div></header>
    <main className="canvas"><ReactFlow nodes={nodes} edges={edges} onNodeClick={(_: unknown, node: Node) => setSelectedId(node.id)} onNodeDragStop={(_: unknown, node: Node) => updateNode(node.id, { position: node.position } as Partial<PipelineNode>)} onConnect={onConnect} onConnectStart={(_: unknown, params: { nodeId?: string | null }) => { connectingNodeId.current = params.nodeId ?? null; }} onConnectEnd={onConnectEnd} fitView><Controls /><Background /></ReactFlow></main>
    <aside className="inspector"><Inspector node={selected} pipeline={draft} toolOptions={state.toolOptions} findings={state.findings.filter((finding) => finding.nodeId === selectedId)} onChange={updateNode} /></aside>
    <section className="bottom"><button className="collapse" onClick={() => setBottomOpen(!bottomOpen)}>{bottomOpen ? 'Hide diagnostics' : 'Show diagnostics'}</button>{bottomOpen && <Bottom state={state} activeTab={activeTab} setActiveTab={setActiveTab} />}</section>
  </div>;
}

function createNode(type: PipelineNodeType, pipeline: AgentPipeline, position: { x: number; y: number }): PipelineNode {
  const baseId = `new-${type}`;
  const existing = new Set(pipeline.nodes.map((node) => node.id));
  let suffix = 1;
  while (existing.has(`${baseId}-${suffix}`)) suffix += 1;
  const id = `${baseId}-${suffix}`;
  const base = { id, type, label: `New ${type}`, description: '', markdown: `# New ${type}\n\nDescribe this ${type} node.`, position };
  if (type === 'agent') return { ...base, type, agentFile: `.github/agents/${id}.agent.md`, tools: ['codebase'], calls: [], inputs: [], outputs: [] };
  if (type === 'prompt') return { ...base, type, promptFile: `.github/prompts/${id}.prompt.md`, tools: [], workflow: [], constraints: [] };
  if (type === 'instruction') return { ...base, type, instructionFile: `.github/instructions/${id}.instructions.md`, applyTo: '**/*', rules: [] };
  if (type === 'skill') return { ...base, type, skillFile: `.github/skills/${id}/SKILL.md`, activationCriteria: [], procedure: [] };
  if (type === 'artifact') return { ...base, type, path: `.agent-output/${id}.md` };
  if (type === 'gate') return { ...base, type, condition: 'Define condition' };
  return { ...base, type };
}

function Inspector({ node, pipeline, toolOptions, findings, onChange }: { node?: PipelineNode; pipeline: AgentPipeline; toolOptions: string[]; findings: ValidationFinding[]; onChange: (nodeId: string, patch: Partial<PipelineNode>) => void }) {
  if (!node) return <p>Select a node.</p>;
  const agents = pipeline.nodes.filter((item) => item.type === 'agent' && item.id !== node.id);
  const references = buildReferenceItems(pipeline);
  const setArray = (field: string, value: string) => onChange(node.id, { [field]: value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean) } as Partial<PipelineNode>);
  const toggleListItem = (field: string, item: string, checked: boolean) => {
    const current = Array.isArray((node as any)[field]) ? (node as any)[field] as string[] : [];
    onChange(node.id, { [field]: checked ? [...new Set([...current, item])] : current.filter((value) => value !== item) } as Partial<PipelineNode>);
  };
  const toolGroups = (node.type === 'agent' || node.type === 'prompt') ? partitionConfiguredTools({ availableTools: toolOptions, configuredTools: node.tools ?? [] }) : { available: [], unavailable: [] };
  return <div className="config"><h2>{node.label}</h2><span className="pill">{node.type}</span>
    <label>Label<input value={node.label} onChange={(event: any) => onChange(node.id, { label: event.target.value } as Partial<PipelineNode>)} /></label>
    <label>Description<textarea value={node.description ?? ''} onChange={(event: any) => onChange(node.id, { description: event.target.value } as Partial<PipelineNode>)} /></label>
    {(node.type === 'agent' || node.type === 'prompt') && <><h3>Tools</h3>{toolGroups.available.length ? <div className="checks">{toolGroups.available.map((tool) => <label key={tool}><input type="checkbox" checked={(node.tools ?? []).includes(tool)} onChange={(event: any) => toggleListItem('tools', tool, event.target.checked)} />{tool}</label>)}</div> : <p className="hint">No VS Code language model tools are registered.</p>}{toolGroups.unavailable.length > 0 && <><h4>Unavailable tools</h4><div className="checks unavailable-tools">{toolGroups.unavailable.map((tool) => <label key={tool} title="Configured on this node, but not registered by VS Code right now."><input type="checkbox" checked={true} onChange={(event: any) => toggleListItem('tools', tool, event.target.checked)} />{tool}</label>)}</div></>}</>}
    {node.type === 'agent' && <><h3>Subagents</h3><div className="checks">{agents.map((agent) => <label key={agent.id}><input type="checkbox" checked={(node.calls ?? []).includes(agent.id)} onChange={(event: any) => toggleListItem('calls', agent.id, event.target.checked)} />{agent.label}</label>)}</div><label>Input artifacts<textarea value={(node.inputs ?? []).join('\n')} onChange={(event: any) => setArray('inputs', event.target.value)} /></label><label>Output artifacts<textarea value={(node.outputs ?? []).join('\n')} onChange={(event: any) => setArray('outputs', event.target.value)} /></label></>}
    {node.type === 'prompt' && <label>Start agent<select value={node.startAgent ?? ''} onChange={(event: any) => onChange(node.id, { startAgent: event.target.value || undefined } as Partial<PipelineNode>)}><option value="">None</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label>}
    {node.type === 'instruction' && <label>applyTo<input value={node.applyTo} onChange={(event: any) => onChange(node.id, { applyTo: event.target.value } as Partial<PipelineNode>)} /></label>}
    {node.type === 'artifact' && <label>Path<input value={node.path} onChange={(event: any) => onChange(node.id, { path: event.target.value } as Partial<PipelineNode>)} /></label>}
    {node.type === 'gate' && <label>Condition<input value={node.condition} onChange={(event: any) => onChange(node.id, { condition: event.target.value } as Partial<PipelineNode>)} /></label>}
    <h3>Markdown editor</h3><TiptapMarkdownEditor value={node.markdown ?? ''} references={references} onChange={(value) => onChange(node.id, { markdown: value } as Partial<PipelineNode>)} />
    <h3>Findings</h3>{findings.length ? findings.map((finding) => <p key={`${finding.ruleId}-${finding.message}`} className={finding.severity}>{finding.message}</p>) : <p>No node findings.</p>}
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
    if (node.type === 'skill') items.push({ label: node.skillFile ?? `.github/skills/${node.id}/SKILL.md`, value: `@skill:${node.id}`, type: 'skill' });
    if (node.type === 'prompt') items.push({ label: node.promptFile ?? `.github/prompts/${node.id}.prompt.md`, value: `@prompt:${node.id}`, type: 'prompt' });
    if (node.type === 'artifact') items.push({ label: node.path, value: `@file:${node.path}`, type: 'artifact' });
    return items;
  });
  return [...new Map(generated.map((item) => [item.value, item])).values()].sort((a, b) => a.label.localeCompare(b.label));
}

function TiptapMarkdownEditor({ value, references, onChange }: { value: string; references: ReferenceItem[]; onChange: (value: string) => void }) {
  const [query, setQuery] = useState<{ trigger: '@' | '/'; text: string } | undefined>(undefined);
  const slashItems: ReferenceItem[] = [
    { label: 'Today', value: new Date().toISOString().slice(0, 10), type: 'date' },
    { label: 'Checklist', value: '- [ ] ', type: 'snippet' },
    { label: 'Definition of done', value: '## Definition of done\n\n- [ ] ', type: 'snippet' }
  ];
  const lastMarkdown = useRef(value);
  const editor = useEditor({
    extensions: [Document, Paragraph, Text, Bold, Code, Link, Heading.configure({ levels: [1, 2, 3] }), BulletList, ListItem, CodeBlock],
    content: markdownToTiptapHtml(value),
    editorProps: {
      attributes: {
        class: 'markdown-editor tiptap-editor',
        'aria-label': 'TipTap Markdown editor',
        spellcheck: 'false'
      }
    },
    onUpdate: ({ editor }: any) => {
      const markdown = tiptapJsonToMarkdown(editor.getJSON());
      lastMarkdown.current = markdown;
      onChange(markdown);
      updateQuery(markdown);
    }
  });

  useEffect(() => {
    if (!editor || value === lastMarkdown.current) return;
    lastMarkdown.current = value;
    editor.commands.setContent(markdownToTiptapHtml(value), { emitUpdate: false });
    updateQuery(value);
  }, [editor, value]);

  const suggestions = query ? (query.trigger === '@' ? references : slashItems).filter((item) => item.label.toLowerCase().includes(query.text.toLowerCase()) || item.value.toLowerCase().includes(query.text.toLowerCase())).slice(0, 8) : [];
  const updateQuery = (markdown: string) => {
    const match = markdown.match(/(^|\s)([@/])([^\s@/]*)$/);
    setQuery(match ? { trigger: match[2] as '@' | '/', text: match[3] } : undefined);
  };
  const replaceMarkdown = (next: string) => {
    lastMarkdown.current = next;
    onChange(next);
    updateQuery(next);
    editor?.commands.setContent(markdownToTiptapHtml(next), { emitUpdate: false });
  };
  const appendMarkdown = (snippet: string) => replaceMarkdown(`${lastMarkdown.current}${snippet}`);
  const insertSuggestion = (item: ReferenceItem) => {
    const current = lastMarkdown.current;
    const next = current.replace(/(^|\s)([@/])([^\s@/]*)$/, (_match, prefix) => `${prefix}${item.value} `);
    replaceMarkdown(next === current ? `${current}${item.value} ` : next);
  };
  return <div className="markdown-shell tiptap-shell"><div className="editor-toolbar"><button onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button><button onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button><button onClick={() => editor?.chain().focus().toggleBulletList().run()}>List</button><button onClick={() => editor?.chain().focus().toggleBold().run()}>Bold</button><button onClick={() => appendMarkdown('\n- [ ] ')}>Check</button></div><EditorContent editor={editor} />{suggestions.length > 0 && <div className="reference-menu">{suggestions.map((item) => <button key={`${item.type}-${item.value}`} onClick={() => insertSuggestion(item)}><span>{item.label}</span><small>{item.type} · {item.value}</small></button>)}</div>}</div>;
}

function Bottom({ state, activeTab, setActiveTab }: { state: State; activeTab: BottomTab; setActiveTab: (tab: BottomTab) => void }) {
  const matrix = state.pipeline.nodes.filter((node) => node.type === 'agent').map((node) => `${node.id}: ${(node.tools ?? []).join(', ') || 'none'}`);
  return <div className="diagnostics"><nav>{(['validation', 'files', 'tools', 'risk'] as BottomTab[]).map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav><article>{activeTab === 'validation' && (state.findings.length ? state.findings.map((finding, index) => <p key={index} className={finding.severity}>{finding.severity.toUpperCase()}: {finding.message}</p>) : <p>No findings.</p>)}{activeTab === 'files' && <ul>{state.generatedFiles.map((file) => <li key={file.path}>{file.kind}: {file.path}</li>)}</ul>}{activeTab === 'tools' && <pre>{matrix.join('\n')}</pre>}{activeTab === 'risk' && <><strong>{state.risk.score}/100</strong><ul>{state.risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}</article></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
