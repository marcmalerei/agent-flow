import { AgentPipeline, PipelineEdge, PipelineNode, PIPELINE_VERSION } from './types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`);
  return value;
}

function assertStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${field} must be an array of strings`);
  return value;
}

const nodeTypes = new Set(['agent', 'prompt', 'instruction', 'skill', 'artifact', 'gate', 'hook', 'handoff', 'mcp-server']);
const edgeKinds = new Set(['flow', 'artifact', 'prompt', 'skill', 'gate', 'handoff', 'hook', 'mcp-server', 'instruction']);

export function parsePipelineJson(source: string): AgentPipeline {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (error) { throw new Error(`Invalid pipeline JSON: ${(error as Error).message}`); }
  return parsePipeline(parsed);
}

export function parsePipeline(value: unknown): AgentPipeline {
  if (!isObject(value)) throw new Error('pipeline must be an object');
  if (value.version !== PIPELINE_VERSION) throw new Error(`pipeline version must be ${PIPELINE_VERSION}`);
  const name = assertString(value.name, 'name');
  if (!Array.isArray(value.nodes)) throw new Error('nodes must be an array');
  if (!Array.isArray(value.edges)) throw new Error('edges must be an array');
  const seen = new Set<string>();
  const nodes = value.nodes.map((node, index) => parseNode(node, `nodes[${index}]`, seen));
  const edges = value.edges.map((edge, index) => parseEdge(edge, `edges[${index}]`));
  return { version: PIPELINE_VERSION, name, nodes, edges };
}

function parseNode(value: unknown, field: string, seen: Set<string>): PipelineNode {
  if (!isObject(value)) throw new Error(`${field} must be an object`);
  const id = assertString(value.id, `${field}.id`);
  if (seen.has(id)) throw new Error(`duplicate node id ${id}`);
  seen.add(id);
  const type = assertString(value.type, `${field}.type`);
  if (!nodeTypes.has(type)) throw new Error(`${field}.type is unsupported: ${type}`);
  const base = { ...value, id, type, label: assertString(value.label, `${field}.label`) } as Record<string, unknown>;
  if (isObject(value.position)) base.position = { x: Number(value.position.x ?? 0), y: Number(value.position.y ?? 0) };
  switch (type) {
    case 'agent':
      return { ...base, type, tools: assertStringArray(value.tools, `${field}.tools`), calls: assertStringArray(value.calls, `${field}.calls`), inputs: assertStringArray(value.inputs, `${field}.inputs`), outputs: assertStringArray(value.outputs, `${field}.outputs`), allowedSkills: assertStringArray(value.allowedSkills, `${field}.allowedSkills`) } as PipelineNode;
    case 'prompt':
      return { ...base, type, tools: assertStringArray(value.tools, `${field}.tools`), workflow: assertStringArray(value.workflow, `${field}.workflow`), constraints: assertStringArray(value.constraints, `${field}.constraints`) } as PipelineNode;
    case 'instruction':
      return { ...base, type, applyTo: assertString(value.applyTo, `${field}.applyTo`), rules: assertStringArray(value.rules, `${field}.rules`) } as PipelineNode;
    case 'skill':
      return { ...base, type, activationCriteria: assertStringArray(value.activationCriteria, `${field}.activationCriteria`), procedure: assertStringArray(value.procedure, `${field}.procedure`) } as PipelineNode;
    case 'artifact':
      return { ...base, type, path: assertString(value.path, `${field}.path`) } as PipelineNode;
    case 'gate':
      return { ...base, type, condition: assertString(value.condition, `${field}.condition`) } as PipelineNode;
    default:
      return { ...base, type } as PipelineNode;
  }
}

function parseEdge(value: unknown, field: string): PipelineEdge {
  if (!isObject(value)) throw new Error(`${field} must be an object`);
  const kind = assertString(value.kind, `${field}.kind`);
  if (!edgeKinds.has(kind)) throw new Error(`${field}.kind is unsupported: ${kind}`);
  return {
    id: assertString(value.id, `${field}.id`),
    from: assertString(value.from, `${field}.from`),
    to: assertString(value.to, `${field}.to`),
    kind: kind as PipelineEdge['kind'],
    artifact: typeof value.artifact === 'string' ? value.artifact : undefined,
    label: typeof value.label === 'string' ? value.label : undefined
  };
}

export function stringifyPipeline(pipeline: AgentPipeline): string {
  return `${JSON.stringify(pipeline, null, 2)}\n`;
}
