export const PIPELINE_VERSION = 1;

export type PipelineNodeType = 'agent' | 'prompt' | 'instruction' | 'skill' | 'artifact' | 'gate' | 'hook' | 'handoff' | 'mcp-server';
export type PipelineEdgeKind = 'flow' | 'artifact' | 'prompt' | 'skill' | 'gate' | 'handoff' | 'hook' | 'mcp-server' | 'instruction';
export type ToolPermission = 'agent' | 'browser' | 'edit' | 'execute' | 'read' | 'search' | 'todo' | 'vscode' | 'web' | string;
export type CustomizationTarget = 'vscode' | 'github-copilot' | string;
export type SkillContext = 'inline' | 'fork' | string;

export interface Position { x: number; y: number }

export interface AgentHandoff {
  label: string;
  agent: string;
  prompt?: string;
  send?: boolean;
  model?: string;
}

export interface AgentHookCommand {
  type: string;
  command?: string;
  [key: string]: string | boolean | number | undefined;
}

export type AgentHooks = Record<string, AgentHookCommand[]>;

export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string | string[];
  [key: string]: string | string[] | boolean | number | undefined;
}

export type ArtifactAction = 'read' | 'write' | 'append' | 'validate' | string;

export interface ArtifactUsage {
  path: string;
  action: ArtifactAction;
  instruction?: string;
}

export interface ReferenceInstruction {
  target: string;
  instruction?: string;
}

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
  argumentHint?: string;
  model?: string | string[];
  target?: CustomizationTarget;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  handoffs?: AgentHandoff[];
  hooks?: AgentHooks;
  mcpServers?: McpServerConfig[];
  tools?: ToolPermission[];
  calls?: string[];
  inputs?: string[];
  outputs?: string[];
  artifactUsages?: ArtifactUsage[];
  instructionRefs?: ReferenceInstruction[];
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
  argumentHint?: string;
  model?: string | string[];
  startAgent?: string;
  tools?: ToolPermission[];
  workflow?: string[];
  constraints?: string[];
  requiredArtifacts?: string[];
  artifactUsages?: ArtifactUsage[];
  instructionRefs?: ReferenceInstruction[];
  definitionOfDone?: string[];
}

export interface InstructionNode extends BaseNode {
  type: 'instruction';
  instructionFile?: string;
  applyTo: string;
  excludeAgent?: 'code-review' | 'cloud-agent' | string;
  instructionRefs?: ReferenceInstruction[];
  rules?: string[];
}

export interface SkillNode extends BaseNode {
  type: 'skill';
  skillFile?: string;
  argumentHint?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  context?: SkillContext;
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

export interface HandoffNode extends BaseNode {
  type: 'handoff';
  sourceAgent?: string;
  targetAgent?: string;
  prompt?: string;
  send?: boolean;
  model?: string;
}

export interface McpServerNode extends BaseNode {
  type: 'mcp-server';
  ownerAgent?: string;
  command?: string;
  args?: string | string[];
}

export type PipelineNode = AgentNode | PromptNode | InstructionNode | SkillNode | ArtifactNode | GateNode | HookNode | HandoffNode | McpServerNode;

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
