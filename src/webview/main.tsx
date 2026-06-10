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
import { FlowLayout, layoutFlowNodes } from './flowLayout';
import { combineMarkdownFrontmatter, markdownToTiptapHtml, splitMarkdownFrontmatter, tiptapJsonToMarkdown } from './markdown';
import { partitionConfiguredTools } from './toolOptions';
import { estimateNodeTokenCount, formatTokenBadge } from './tokenCounts';

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
const typeColors: Record<string, string> = { agent: 'var(--vscode-charts-blue)', prompt: 'var(--vscode-charts-purple)', instruction: 'var(--vscode-charts-orange)', skill: 'var(--vscode-charts-green)', artifact: 'var(--vscode-descriptionForeground)', gate: 'var(--vscode-charts-yellow)', hook: 'var(--vscode-charts-red)' };
const nodeTypes: PipelineNodeType[] = ['agent', 'prompt', 'instruction', 'skill', 'artifact', 'gate', 'hook'];
const nodeTypesConfig = {
  tokenNode: ({ data }: { data: { label: string; type: string; tokenBadge: string } }) => <div className="flow-node"><span className="token-badge" title="Estimated token count">{data.tokenBadge}</span><span>{data.label}</span><small>{data.type}</small></div>
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
  const [inspectorOpen, setInspectorOpen] = useState(true);
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
  const layoutPositions = useMemo(() => layoutFlowNodes(draft, state.flowLayout), [draft, state.flowLayout]);
  const nodes: Node[] = useMemo(() => draft.nodes.map((node) => ({
    id: node.id,
    position: layoutPositions.get(node.id) ?? node.position ?? { x: 0, y: 0 },
    draggable: state.flowLayout === 'manual',
    type: 'tokenNode',
    data: { label: `${risky.has(node.id) ? '⚠ ' : ''}${node.label}`, type: node.type, tokenBadge: formatTokenBadge(estimateNodeTokenCount(draft, node)) },
    style: { border: `2px solid ${typeColors[node.type] ?? 'var(--vscode-focusBorder)'}`, borderRadius: 10, background: 'var(--vscode-editorWidget-background)', color: 'var(--vscode-editorWidget-foreground)', width: 190 }
  })), [draft, layoutPositions, risky, state.flowLayout]);
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

  return <ReactFlowProvider><FlowApp state={state} draft={draft} selected={selected} selectedId={selectedId} nodes={nodes} edges={edges} activeTab={activeTab} bottomOpen={bottomOpen} inspectorOpen={inspectorOpen} setActiveTab={setActiveTab} setBottomOpen={setBottomOpen} setInspectorOpen={setInspectorOpen} setSelectedId={setSelectedId} updateNode={updateNode} updateEdges={updateEdges} addNode={addNode} savePipeline={savePipeline} /></ReactFlowProvider>;
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

function FlowApp({ state, draft, selected, selectedId, nodes, edges, activeTab, bottomOpen, inspectorOpen, setActiveTab, setBottomOpen, setInspectorOpen, setSelectedId, updateNode, updateEdges, addNode, savePipeline }: { state: State; draft: AgentPipeline; selected?: PipelineNode; selectedId: string; nodes: Node[]; edges: Edge[]; activeTab: BottomTab; bottomOpen: boolean; inspectorOpen: boolean; setActiveTab: (tab: BottomTab) => void; setBottomOpen: (open: boolean) => void; setInspectorOpen: (open: boolean) => void; setSelectedId: (id: string) => void; updateNode: (nodeId: string, patch: Partial<PipelineNode>) => void; updateEdges: (edges: Edge[]) => void; addNode: (type: PipelineNodeType, position?: { x: number; y: number }, connectFrom?: string) => void; savePipeline: () => void }) {
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

  return <div className={`app ${bottomOpen ? 'bottom-open' : 'bottom-collapsed'} ${inspectorOpen ? 'inspector-open' : 'inspector-closed'}`}>
    <header className="toolbar"><strong>AgentFlow</strong><span>{draft.name}</span><button onClick={savePipeline}>Save Pipeline</button><button className="secondary" onClick={() => setInspectorOpen(!inspectorOpen)}>{inspectorOpen ? 'Hide config' : 'Show config'}</button><div className="node-buttons">{nodeTypes.map((type) => <button key={type} onClick={() => addNode(type)} title={`Create ${type} node`}>+ {type}</button>)}</div></header>
    <main className="canvas"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypesConfig} onNodeClick={(_: unknown, node: Node) => setSelectedId(node.id)} onNodeDragStop={(_: unknown, node: Node) => updateNode(node.id, { position: node.position } as Partial<PipelineNode>)} onConnect={onConnect} onConnectStart={(_: unknown, params: { nodeId?: string | null }) => { connectingNodeId.current = params.nodeId ?? null; }} onConnectEnd={onConnectEnd} fitView><Controls /><Background /></ReactFlow></main>
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
  const setOptionalString = (field: string, value: string) => onChange(node.id, { [field]: value.trim() || undefined } as Partial<PipelineNode>);
  const setArray = (field: string, value: string) => onChange(node.id, { [field]: value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean) } as Partial<PipelineNode>);
  const setHandoffs = (value: string) => onChange(node.id, {
    handoffs: value.split(/\r?\n/).map((line) => {
      const [label, agent, prompt, send] = line.split('|').map((part) => part.trim());
      if (!label || !agent) return undefined;
      return { label, agent, prompt: prompt || undefined, send: send ? send === 'true' : undefined };
    }).filter(Boolean)
  } as Partial<PipelineNode>);
  const toggleListItem = (field: string, item: string, checked: boolean) => {
    const current = Array.isArray((node as any)[field]) ? (node as any)[field] as string[] : [];
    onChange(node.id, { [field]: checked ? [...new Set([...current, item])] : current.filter((value) => value !== item) } as Partial<PipelineNode>);
  };
  const toolGroups = (node.type === 'agent' || node.type === 'prompt') ? partitionConfiguredTools({ availableTools: toolOptions, configuredTools: node.tools ?? [] }) : { available: [], unavailable: [] };
  return <div className="config"><h2>{node.label}</h2><span className="pill">{node.type}</span>
    <label>Label<input value={node.label} onChange={(event: any) => onChange(node.id, { label: event.target.value } as Partial<PipelineNode>)} /></label>
    <label>Description<textarea value={node.description ?? ''} onChange={(event: any) => onChange(node.id, { description: event.target.value } as Partial<PipelineNode>)} /></label>
    {node.type === 'agent' && <details><summary>Agent metadata</summary><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label><label>Target<select value={node.target ?? ''} onChange={(event: any) => setOptionalString('target', event.target.value)}><option value="">Both environments</option><option value="vscode">VS Code</option><option value="github-copilot">GitHub Copilot</option></select></label><label className="inline-check"><input type="checkbox" checked={node.userInvocable ?? true} onChange={(event: any) => onChange(node.id, { userInvocable: event.target.checked ? undefined : false } as Partial<PipelineNode>)} /> User invocable</label><label className="inline-check"><input type="checkbox" checked={node.disableModelInvocation ?? false} onChange={(event: any) => onChange(node.id, { disableModelInvocation: event.target.checked || undefined } as Partial<PipelineNode>)} /> Disable model invocation</label><label>Handoffs<textarea value={(node.handoffs ?? []).map((handoff) => [handoff.label, handoff.agent, handoff.prompt ?? '', typeof handoff.send === 'boolean' ? String(handoff.send) : ''].join(' | ')).join('\n')} placeholder="Label | agent-id | optional prompt | false" onChange={(event: any) => setHandoffs(event.target.value)} /></label></details>}
    {(node.type === 'agent' || node.type === 'prompt') && <details><summary>Tools</summary>{toolGroups.available.length ? <div className="checks">{toolGroups.available.map((tool) => <label key={tool}><input type="checkbox" checked={(node.tools ?? []).includes(tool)} onChange={(event: any) => toggleListItem('tools', tool, event.target.checked)} />{tool}</label>)}</div> : <p className="hint">No VS Code language model tools are registered.</p>}{toolGroups.unavailable.length > 0 && <><h4>Selected tools</h4><p className="hint">Selected on this node, but not registered by VS Code right now.</p><div className="checks selected-tools">{toolGroups.unavailable.map((tool) => <label key={tool} title="Selected on this node, but not registered by VS Code right now."><input type="checkbox" checked={true} onChange={(event: any) => toggleListItem('tools', tool, event.target.checked)} />{tool}</label>)}</div></>}</details>}
    {node.type === 'agent' && <details><summary>Routing and artifacts</summary><h4>Subagents</h4><div className="checks">{agents.map((agent) => <label key={agent.id}><input type="checkbox" checked={(node.calls ?? []).includes(agent.id)} onChange={(event: any) => toggleListItem('calls', agent.id, event.target.checked)} />{agent.label}</label>)}</div><label>Input artifacts<textarea value={(node.inputs ?? []).join('\n')} onChange={(event: any) => setArray('inputs', event.target.value)} /></label><label>Output artifacts<textarea value={(node.outputs ?? []).join('\n')} onChange={(event: any) => setArray('outputs', event.target.value)} /></label></details>}
    {node.type === 'prompt' && <details open><summary>Prompt metadata</summary><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label>Model<input value={node.model ?? ''} onChange={(event: any) => setOptionalString('model', event.target.value)} /></label><label>Agent<select value={node.startAgent ?? ''} onChange={(event: any) => onChange(node.id, { startAgent: event.target.value || undefined } as Partial<PipelineNode>)}><option value="">Current agent</option><option value="ask">ask</option><option value="agent">agent</option><option value="plan">plan</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label></details>}
    {node.type === 'instruction' && <details open><summary>Instruction scope</summary><label>applyTo<input value={node.applyTo} onChange={(event: any) => onChange(node.id, { applyTo: event.target.value } as Partial<PipelineNode>)} /></label><label>Exclude agent<select value={node.excludeAgent ?? ''} onChange={(event: any) => setOptionalString('excludeAgent', event.target.value)}><option value="">None</option><option value="code-review">code-review</option><option value="cloud-agent">cloud-agent</option></select></label></details>}
    {node.type === 'skill' && <details open><summary>Skill metadata</summary><label>Argument hint<input value={node.argumentHint ?? ''} onChange={(event: any) => setOptionalString('argumentHint', event.target.value)} /></label><label className="inline-check"><input type="checkbox" checked={node.userInvocable ?? true} onChange={(event: any) => onChange(node.id, { userInvocable: event.target.checked ? undefined : false } as Partial<PipelineNode>)} /> User invocable</label><label className="inline-check"><input type="checkbox" checked={node.disableModelInvocation ?? false} onChange={(event: any) => onChange(node.id, { disableModelInvocation: event.target.checked || undefined } as Partial<PipelineNode>)} /> Disable model invocation</label><label>Context<select value={node.context ?? ''} onChange={(event: any) => setOptionalString('context', event.target.value)}><option value="">inline</option><option value="fork">fork</option></select></label></details>}
    {node.type === 'artifact' && <details open><summary>Artifact file</summary><label>Path<input value={node.path} onChange={(event: any) => onChange(node.id, { path: event.target.value } as Partial<PipelineNode>)} /></label></details>}
    {node.type === 'gate' && <details open><summary>Gate condition</summary><label>Condition<input value={node.condition} onChange={(event: any) => onChange(node.id, { condition: event.target.value } as Partial<PipelineNode>)} /></label></details>}
    <details><summary>Markdown editor</summary><TiptapMarkdownEditor value={node.markdown ?? ''} references={references} onChange={(value) => onChange(node.id, { markdown: value } as Partial<PipelineNode>)} /></details>
    <details open={findings.length > 0}><summary>Findings</summary>{findings.length ? findings.map((finding) => <p key={`${finding.ruleId}-${finding.message}`} className={finding.severity}>{finding.message}</p>) : <p>No node findings.</p>}</details>
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
