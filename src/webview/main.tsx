import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Background, Controls, MiniMap, ReactFlow, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { AgentPipeline, PipelineNode, ValidationFinding, RiskScore } from '../pipeline/types';

interface State {
  pipeline: AgentPipeline;
  findings: ValidationFinding[];
  risk: RiskScore;
  mermaid: string;
  generatedFiles: Array<{ path: string; kind: string }>;
}

type BottomTab = 'validation' | 'files' | 'mermaid' | 'tools' | 'risk';

declare global { interface Window { __AGENTFLOW_STATE__: State; acquireVsCodeApi?: () => { postMessage(message: unknown): void } } }

const vscode = window.acquireVsCodeApi?.();
const typeColors: Record<string, string> = { agent: 'var(--vscode-charts-blue)', prompt: 'var(--vscode-charts-purple)', instruction: 'var(--vscode-charts-orange)', skill: 'var(--vscode-charts-green)', artifact: 'var(--vscode-descriptionForeground)', gate: 'var(--vscode-charts-yellow)', hook: 'var(--vscode-charts-red)' };
const toolOptions = ['codebase', 'editFiles', 'runCommands', 'search', 'terminal', 'agent', 'vscode/memory'];

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

  const selected = draft.nodes.find((node) => node.id === selectedId) ?? draft.nodes[0];
  const risky = new Set(state.findings.filter((finding) => finding.nodeId).map((finding) => finding.nodeId));
  const nodes: Node[] = useMemo(() => draft.nodes.map((node) => ({
    id: node.id,
    position: node.position ?? { x: 0, y: 0 },
    data: { label: `${risky.has(node.id) ? '⚠ ' : ''}${node.label}\n${node.type}` },
    style: { border: `2px solid ${typeColors[node.type] ?? 'var(--vscode-focusBorder)'}`, borderRadius: 10, background: 'var(--vscode-editorWidget-background)', color: 'var(--vscode-editorWidget-foreground)', width: 170, whiteSpace: 'pre-line' }
  })), [draft.nodes, risky]);
  const edges: Edge[] = useMemo(() => draft.edges.map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.label ?? edge.artifact ?? edge.kind, animated: edge.kind === 'artifact' })), [draft.edges]);

  const updateNode = (nodeId: string, patch: Partial<PipelineNode>) => {
    setDraft((pipeline) => ({ ...pipeline, nodes: pipeline.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } as PipelineNode : node) }));
  };
  const savePipeline = () => vscode?.postMessage({ command: 'savePipeline', pipeline: draft, selectedId: selected?.id });
  const reloadPipeline = () => vscode?.postMessage({ command: 'reloadPipeline', selectedId: selected?.id });
  const writeNodeFile = () => vscode?.postMessage({ command: 'writeNodeFile', pipeline: draft, nodeId: selected?.id });

  return <div className={`app ${bottomOpen ? 'bottom-open' : 'bottom-collapsed'}`}>
    <header className="toolbar"><strong>AgentFlow</strong><span>{draft.name}</span><button onClick={savePipeline}>Save pipeline.json</button><button onClick={reloadPipeline}>Reload flow</button><button onClick={() => vscode?.postMessage({ command: 'generateFiles' })}>Preview & Generate</button><button onClick={() => vscode?.postMessage({ command: 'exportMermaid' })}>Copy Mermaid</button></header>
    <main className="canvas"><ReactFlow nodes={nodes} edges={edges} onNodeClick={(_: unknown, node: Node) => setSelectedId(node.id)} onNodeDragStop={(_: unknown, node: Node) => updateNode(node.id, { position: node.position } as Partial<PipelineNode>)} fitView><MiniMap /><Controls /><Background /></ReactFlow></main>
    <aside className="inspector"><Inspector node={selected} pipeline={draft} findings={state.findings.filter((finding) => finding.nodeId === selected?.id)} onChange={updateNode} onSave={savePipeline} onWriteFile={writeNodeFile} /></aside>
    <section className="bottom"><button className="collapse" onClick={() => setBottomOpen(!bottomOpen)}>{bottomOpen ? 'Hide diagnostics' : 'Show diagnostics'}</button>{bottomOpen && <Bottom state={state} activeTab={activeTab} setActiveTab={setActiveTab} />}</section>
  </div>;
}

function Inspector({ node, pipeline, findings, onChange, onSave, onWriteFile }: { node?: PipelineNode; pipeline: AgentPipeline; findings: ValidationFinding[]; onChange: (nodeId: string, patch: Partial<PipelineNode>) => void; onSave: () => void; onWriteFile: () => void }) {
  if (!node) return <p>Select a node.</p>;
  const agents = pipeline.nodes.filter((item) => item.type === 'agent' && item.id !== node.id);
  const references = buildReferenceItems(pipeline);
  const setArray = (field: string, value: string) => onChange(node.id, { [field]: value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean) } as Partial<PipelineNode>);
  const toggleListItem = (field: string, item: string, checked: boolean) => {
    const current = Array.isArray((node as any)[field]) ? (node as any)[field] as string[] : [];
    onChange(node.id, { [field]: checked ? [...new Set([...current, item])] : current.filter((value) => value !== item) } as Partial<PipelineNode>);
  };
  return <div className="config"><h2>{node.label}</h2><span className="pill">{node.type}</span>
    <label>Label<input value={node.label} onChange={(event: any) => onChange(node.id, { label: event.target.value } as Partial<PipelineNode>)} /></label>
    <label>Description<textarea value={node.description ?? ''} onChange={(event: any) => onChange(node.id, { description: event.target.value } as Partial<PipelineNode>)} /></label>
    {node.type === 'agent' && <><h3>Tools</h3><div className="checks">{toolOptions.map((tool) => <label key={tool}><input type="checkbox" checked={(node.tools ?? []).includes(tool)} onChange={(event: any) => toggleListItem('tools', tool, event.target.checked)} />{tool}</label>)}</div><h3>Subagents</h3><div className="checks">{agents.map((agent) => <label key={agent.id}><input type="checkbox" checked={(node.calls ?? []).includes(agent.id)} onChange={(event: any) => toggleListItem('calls', agent.id, event.target.checked)} />{agent.label}</label>)}</div><label>Input artifacts<textarea value={(node.inputs ?? []).join('\n')} onChange={(event: any) => setArray('inputs', event.target.value)} /></label><label>Output artifacts<textarea value={(node.outputs ?? []).join('\n')} onChange={(event: any) => setArray('outputs', event.target.value)} /></label></>}
    {node.type === 'prompt' && <label>Start agent<select value={node.startAgent ?? ''} onChange={(event: any) => onChange(node.id, { startAgent: event.target.value || undefined } as Partial<PipelineNode>)}><option value="">None</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label>}
    {node.type === 'instruction' && <label>applyTo<input value={node.applyTo} onChange={(event: any) => onChange(node.id, { applyTo: event.target.value } as Partial<PipelineNode>)} /></label>}
    {node.type === 'artifact' && <label>Path<input value={node.path} onChange={(event: any) => onChange(node.id, { path: event.target.value } as Partial<PipelineNode>)} /></label>}
    {node.type === 'gate' && <label>Condition<input value={node.condition} onChange={(event: any) => onChange(node.id, { condition: event.target.value } as Partial<PipelineNode>)} /></label>}
    <h3>Markdown editor</h3><p className="hint">WYSIWYG editor with Markdown output. Type @ to reference agents, skills, artifacts, prompts or files; type / for snippets such as dates and checklists.</p><MarkdownEditor value={node.markdown ?? ''} references={references} onChange={(value) => onChange(node.id, { markdown: value } as Partial<PipelineNode>)} />
    <div className="actions"><button onClick={onSave}>Save & reload flow</button><button onClick={onWriteFile}>Write this node file</button></div>
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

function MarkdownEditor({ value, references, onChange }: { value: string; references: ReferenceItem[]; onChange: (value: string) => void }) {
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual');
  const [query, setQuery] = useState<{ trigger: '@' | '/'; text: string } | undefined>(undefined);
  const slashItems: ReferenceItem[] = [
    { label: 'Today', value: new Date().toISOString().slice(0, 10), type: 'date' },
    { label: 'Checklist', value: '- [ ] ', type: 'snippet' },
    { label: 'Definition of done', value: '## Definition of done\n\n- [ ] ', type: 'snippet' }
  ];
  const suggestions = query ? (query.trigger === '@' ? references : slashItems).filter((item) => item.label.toLowerCase().includes(query.text.toLowerCase()) || item.value.toLowerCase().includes(query.text.toLowerCase())).slice(0, 8) : [];
  const update = (next: string) => {
    onChange(next);
    const match = next.match(/(^|\s)([@/])([^\s@/]*)$/);
    setQuery(match ? { trigger: match[2] as '@' | '/', text: match[3] } : undefined);
  };
  const insertSuggestion = (item: ReferenceItem) => {
    const next = value.replace(/(^|\s)([@/])([^\s@/]*)$/, (_match, prefix) => `${prefix}${item.value} `);
    update(next === value ? `${value}${item.value} ` : next);
  };
  return <div className="markdown-shell"><div className="editor-toolbar"><button onClick={() => update(`${value}\n# Heading\n`)}>H1</button><button onClick={() => update(`${value}\n## Heading\n`)}>H2</button><button onClick={() => update(`${value}\n- `)}>List</button><button onClick={() => update(`${value}**bold**`)}>Bold</button><button onClick={() => setMode(mode === 'visual' ? 'markdown' : 'visual')}>{mode === 'visual' ? 'Markdown source' : 'Visual editor'}</button></div>{mode === 'visual' ? <div className="wysiwyg-editor" contentEditable suppressContentEditableWarning onInput={(event: any) => update(event.currentTarget.innerText)} onBlur={(event: any) => update(event.currentTarget.innerText)}>{value}</div> : <textarea className="markdown-editor" value={value} onChange={(event: any) => update(event.target.value)} />}{suggestions.length > 0 && <div className="reference-menu">{suggestions.map((item) => <button key={`${item.type}-${item.value}`} onClick={() => insertSuggestion(item)}><span>{item.label}</span><small>{item.type} · {item.value}</small></button>)}</div>}<div className="markdown-preview"><MarkdownPreview markdown={value || 'Start writing Markdown. Use @ for references and / for snippets.'} /></div></div>;
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  return <>{markdown.split(/\r?\n/).map((line, index) => {
    if (line.startsWith('### ')) return <h4 key={index}>{line.slice(4)}</h4>;
    if (line.startsWith('## ')) return <h3 key={index}>{line.slice(3)}</h3>;
    if (line.startsWith('# ')) return <h2 key={index}>{line.slice(2)}</h2>;
    if (line.startsWith('- ')) return <p key={index}>• {line.slice(2)}</p>;
    const parts = line.split(/(@(?:file|skill|prompt)?:[^\s]+|@[A-Za-z0-9_-]+)/g);
    return <p key={index}>{parts.map((part, partIndex) => part.startsWith('@') ? <span key={partIndex} className="mention">{part}</span> : part || '\u00a0')}</p>;
  })}</>;
}

function Bottom({ state, activeTab, setActiveTab }: { state: State; activeTab: BottomTab; setActiveTab: (tab: BottomTab) => void }) {
  const matrix = state.pipeline.nodes.filter((node) => node.type === 'agent').map((node) => `${node.id}: ${(node.tools ?? []).join(', ') || 'none'}`);
  return <div className="diagnostics"><nav>{(['validation', 'files', 'mermaid', 'tools', 'risk'] as BottomTab[]).map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav><article>{activeTab === 'validation' && (state.findings.length ? state.findings.map((finding, index) => <p key={index} className={finding.severity}>{finding.severity.toUpperCase()}: {finding.message}</p>) : <p>No findings.</p>)}{activeTab === 'files' && <ul>{state.generatedFiles.map((file) => <li key={file.path}>{file.kind}: {file.path}</li>)}</ul>}{activeTab === 'mermaid' && <pre>{state.mermaid}</pre>}{activeTab === 'tools' && <pre>{matrix.join('\n')}</pre>}{activeTab === 'risk' && <><strong>{state.risk.score}/100</strong><ul>{state.risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}</article></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
