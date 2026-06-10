import React, { useMemo, useState } from 'react';
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

function App() {
  const state = window.__AGENTFLOW_STATE__;
  const [selectedId, setSelectedId] = useState(state.pipeline.nodes[0]?.id ?? '');
  const selected = state.pipeline.nodes.find((node) => node.id === selectedId);
  const risky = new Set(state.findings.filter((finding) => finding.nodeId).map((finding) => finding.nodeId));
  const nodes: Node[] = useMemo(() => state.pipeline.nodes.map((node) => ({
    id: node.id,
    position: node.position ?? { x: 0, y: 0 },
    data: { label: `${risky.has(node.id) ? '⚠ ' : ''}${node.label}\n${node.type}` },
    style: { border: `2px solid ${typeColors[node.type] ?? '#888'}`, borderRadius: 10, background: '#111827', color: '#f9fafb', width: 170, whiteSpace: 'pre-line' }
  })), [state.pipeline.nodes, risky]);
  const edges: Edge[] = useMemo(() => state.pipeline.edges.map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.label ?? edge.artifact ?? edge.kind, animated: edge.kind === 'artifact' })), [state.pipeline.edges]);
  return <div className="app">
    <aside className="sidebar"><h2>AgentFlow</h2><Palette /><button onClick={() => vscode?.postMessage({ command: 'generateFiles' })}>Preview & Generate</button><button onClick={() => vscode?.postMessage({ command: 'exportMermaid' })}>Copy Mermaid</button></aside>
    <main className="canvas"><ReactFlow nodes={nodes} edges={edges} onNodeClick={(_: unknown, node: Node) => setSelectedId(node.id)} fitView><MiniMap /><Controls /><Background /></ReactFlow></main>
    <aside className="inspector"><Inspector node={selected} findings={state.findings.filter((finding) => finding.nodeId === selected?.id)} /></aside>
    <section className="bottom"><Bottom state={state} /></section>
  </div>;
}

function Palette() {
  return <div className="palette"><h3>Pipeline</h3><p>Router • Context • Planner • Task Splitter</p><h3>Implementation</h3><p>Frontend • Backend • Test • Docs</p><h3>Quality Gates</h3><p>Review • Integration • Final Review • Approval</p><h3>Resources</h3><p>Prompt • Instruction • Skill • Artifact • Hook</p></div>;
}

function Inspector({ node, findings }: { node?: PipelineNode; findings: ValidationFinding[] }) {
  if (!node) return <p>Select a node.</p>;
  return <><h2>{node.label}</h2><span className="pill">{node.type}</span><pre>{JSON.stringify(node, null, 2)}</pre><h3>Findings</h3>{findings.length ? findings.map((finding) => <p key={finding.ruleId} className={finding.severity}>{finding.message}</p>) : <p>No node findings.</p>}</>;
}

function Bottom({ state }: { state: State }) {
  const matrix = state.pipeline.nodes.filter((node) => node.type === 'agent').map((node) => `${node.id}: ${(node.tools ?? []).join(', ') || 'none'}`);
  return <div className="tabs"><article><h3>Validation</h3>{state.findings.map((finding, index) => <p key={index} className={finding.severity}>{finding.severity.toUpperCase()}: {finding.message}</p>) || 'No findings.'}</article><article><h3>Generated files</h3><ul>{state.generatedFiles.map((file) => <li key={file.path}>{file.kind}: {file.path}</li>)}</ul></article><article><h3>Mermaid</h3><pre>{state.mermaid}</pre></article><article><h3>Tool matrix</h3><pre>{matrix.join('\n')}</pre></article><article><h3>Context risk</h3><strong>{state.risk.score}/100</strong><ul>{state.risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></article></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
