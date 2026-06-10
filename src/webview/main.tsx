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

declare global { interface Window { __AGENTFLOW_STATE__: State; acquireVsCodeApi?: () => { postMessage(message: unknown): void } } }

const vscode = window.acquireVsCodeApi?.();
const typeColors: Record<string, string> = { agent: '#2563eb', prompt: '#7c3aed', instruction: '#c2410c', skill: '#059669', artifact: '#64748b', gate: '#ca8a04', hook: '#be123c' };
const toolOptions = ['codebase', 'editFiles', 'runCommands', 'search', 'terminal', 'agent', 'vscode/memory'];

function App() {
  const [state, setState] = useState(window.__AGENTFLOW_STATE__);
  const [draft, setDraft] = useState(state.pipeline);
  const [selectedId, setSelectedId] = useState(state.pipeline.nodes[0]?.id ?? '');
  const [bottomOpen, setBottomOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'validation' | 'files' | 'mermaid' | 'tools' | 'risk'>('validation');

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.command === 'stateUpdated') {
        setState(event.data.state);
        setDraft(event.data.state.pipeline);
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
    style: { border: `2px solid ${typeColors[node.type] ?? '#888'}`, borderRadius: 10, background: '#111827', color: '#f9fafb', width: 170, whiteSpace: 'pre-line' }
  })), [draft.nodes, risky]);
  const edges: Edge[] = useMemo(() => draft.edges.map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.label ?? edge.artifact ?? edge.kind, animated: edge.kind === 'artifact' })), [draft.edges]);

  const updateNode = (nodeId: string, patch: Partial<PipelineNode>) => {
    setDraft((pipeline) => ({ ...pipeline, nodes: pipeline.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } as PipelineNode : node) }));
  };
  const savePipeline = () => vscode?.postMessage({ command: 'savePipeline', pipeline: draft });
  const writeNodeFile = () => vscode?.postMessage({ command: 'writeNodeFile', pipeline: draft, nodeId: selected?.id });

  return <div className={`app ${bottomOpen ? 'bottom-open' : 'bottom-collapsed'}`}>
    <aside className="sidebar"><h2>AgentFlow</h2><Palette /><button onClick={() => vscode?.postMessage({ command: 'generateFiles' })}>Preview & Generate</button><button onClick={() => vscode?.postMessage({ command: 'exportMermaid' })}>Copy Mermaid</button></aside>
    <main className="canvas"><ReactFlow nodes={nodes} edges={edges} onNodeClick={(_: unknown, node: Node) => setSelectedId(node.id)} onNodeDragStop={(_: unknown, node: Node) => updateNode(node.id, { position: node.position } as Partial<PipelineNode>)} fitView><MiniMap /><Controls /><Background /></ReactFlow></main>
    <aside className="inspector"><Inspector node={selected} pipeline={draft} findings={state.findings.filter((finding) => finding.nodeId === selected?.id)} onChange={updateNode} onSave={savePipeline} onWriteFile={writeNodeFile} /></aside>
    <section className="bottom"><button className="collapse" onClick={() => setBottomOpen(!bottomOpen)}>{bottomOpen ? 'Hide diagnostics' : 'Show diagnostics'}</button>{bottomOpen && <Bottom state={state} activeTab={activeTab} setActiveTab={setActiveTab} />}</section>
  </div>;
}

function Palette() {
  return <div className="palette"><h3>Pipeline</h3><p>Router • Context • Planner • Task Splitter</p><h3>Implementation</h3><p>Frontend • Backend • Test • Docs</p><h3>Quality Gates</h3><p>Review • Integration • Final Review • Approval</p><h3>Resources</h3><p>Prompt • Instruction • Skill • Artifact • Hook</p></div>;
}

function Inspector({ node, pipeline, findings, onChange, onSave, onWriteFile }: { node?: PipelineNode; pipeline: AgentPipeline; findings: ValidationFinding[]; onChange: (nodeId: string, patch: Partial<PipelineNode>) => void; onSave: () => void; onWriteFile: () => void }) {
  if (!node) return <p>Select a node.</p>;
  const agents = pipeline.nodes.filter((item) => item.type === 'agent' && item.id !== node.id);
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
    <h3>Markdown editor</h3><p className="hint">Edit generated Markdown here. The live preview keeps the inspector focused instead of showing raw debug JSON.</p><textarea className="markdown-editor" value={node.markdown ?? ''} placeholder="Leave empty to use deterministic generated Markdown." onChange={(event: any) => onChange(node.id, { markdown: event.target.value } as Partial<PipelineNode>)} />
    <div className="markdown-preview"><MarkdownPreview markdown={node.markdown ?? node.description ?? node.label} /></div>
    <div className="actions"><button onClick={onSave}>Save pipeline.json</button><button onClick={onWriteFile}>Write this node file</button></div>
    <h3>Findings</h3>{findings.length ? findings.map((finding) => <p key={`${finding.ruleId}-${finding.message}`} className={finding.severity}>{finding.message}</p>) : <p>No node findings.</p>}
  </div>;
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  return <>{markdown.split(/\r?\n/).map((line, index) => {
    if (line.startsWith('### ')) return <h4 key={index}>{line.slice(4)}</h4>;
    if (line.startsWith('## ')) return <h3 key={index}>{line.slice(3)}</h3>;
    if (line.startsWith('# ')) return <h2 key={index}>{line.slice(2)}</h2>;
    if (line.startsWith('- ')) return <p key={index}>• {line.slice(2)}</p>;
    return <p key={index}>{line || '\u00a0'}</p>;
  })}</>;
}

function Bottom({ state, activeTab, setActiveTab }: { state: State; activeTab: string; setActiveTab: (tab: any) => void }) {
  const matrix = state.pipeline.nodes.filter((node) => node.type === 'agent').map((node) => `${node.id}: ${(node.tools ?? []).join(', ') || 'none'}`);
  return <div className="diagnostics"><nav>{['validation', 'files', 'mermaid', 'tools', 'risk'].map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav><article>{activeTab === 'validation' && (state.findings.length ? state.findings.map((finding, index) => <p key={index} className={finding.severity}>{finding.severity.toUpperCase()}: {finding.message}</p>) : <p>No findings.</p>)}{activeTab === 'files' && <ul>{state.generatedFiles.map((file) => <li key={file.path}>{file.kind}: {file.path}</li>)}</ul>}{activeTab === 'mermaid' && <pre>{state.mermaid}</pre>}{activeTab === 'tools' && <pre>{matrix.join('\n')}</pre>}{activeTab === 'risk' && <><strong>{state.risk.score}/100</strong><ul>{state.risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}</article></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
