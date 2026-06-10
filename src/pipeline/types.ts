export const PIPELINE_VERSION = 1;

export type PipelineNodeType = 'agent' | 'prompt' | 'instruction' | 'skill' | 'artifact' | 'gate' | 'hook';
export type PipelineEdgeKind = 'flow' | 'artifact' | 'prompt' | 'skill' | 'gate';
export type ToolPermission = 'codebase' | 'editFiles' | 'runCommands' | 'search' | 'terminal' | string;

export interface Position { x: number; y: number }

export interface BaseNode {
  id: string;
  type: PipelineNodeType;
  label: string;
  description?: string;
  /** Optional Markdown override edited from the AgentFlow webview. */
  markdown?: string;
  position?: Position;
}

export interface AgentNode extends BaseNode {
  type: 'agent';
  agentFile?: string;
  tools?: ToolPermission[];
  calls?: string[];
  inputs?: string[];
  outputs?: string[];
  allowedSkills?: string[];
  rules?: string[];
  contextBudget?: string[];
  editRules?: string[];
  verificationRules?: string[];
  forbiddenChanges?: string[];
  commandSafety?: string[];
}

export interface PromptNode extends BaseNode {
  type: 'prompt';
  promptFile?: string;
  startAgent?: string;
  tools?: ToolPermission[];
  workflow?: string[];
  constraints?: string[];
  requiredArtifacts?: string[];
  definitionOfDone?: string[];
}

export interface InstructionNode extends BaseNode {
  type: 'instruction';
  instructionFile?: string;
  applyTo: string;
  rules?: string[];
}

export interface SkillNode extends BaseNode {
  type: 'skill';
  skillFile?: string;
  argumentHint?: string;
  activationCriteria?: string[];
  doNotUseWhen?: string[];
  procedure?: string[];
  resourceReferences?: string[];
}

export interface ArtifactNode extends BaseNode {
  type: 'artifact';
  path: string;
  template?: string;
  schema?: string;
  producers?: string[];
  consumers?: string[];
}

export interface GateNode extends BaseNode {
  type: 'gate';
  condition: string;
  trueBranch?: string;
  falseBranch?: string;
  maxIterations?: number;
}

export interface HookNode extends BaseNode {
  type: 'hook';
  trigger?: string;
  policy?: string[];
  action?: string;
}

export type PipelineNode = AgentNode | PromptNode | InstructionNode | SkillNode | ArtifactNode | GateNode | HookNode;

export interface PipelineEdge {
  id: string;
  from: string;
  to: string;
  kind: PipelineEdgeKind;
  artifact?: string;
  label?: string;
}

export interface AgentPipeline {
  version: 1;
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export interface GeneratedFile {
  path: string;
  content: string;
  kind: 'agent' | 'prompt' | 'instruction' | 'skill' | 'artifact' | 'documentation' | 'pipeline';
}

export type FindingSeverity = 'error' | 'warning' | 'risk' | 'info';
export interface ValidationFinding {
  severity: FindingSeverity;
  message: string;
  nodeId?: string;
  ruleId: string;
}

export interface RiskScore {
  score: number;
  reasons: string[];
}
