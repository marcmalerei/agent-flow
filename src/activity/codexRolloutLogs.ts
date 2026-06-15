import * as path from 'node:path';
import { AgentPipeline } from '../pipeline/types';
import { activityInputsForChangedFiles } from './fileActivity';
import { normalizeActivityInput } from './store';
import { AgentFlowActivityEvent, AgentFlowActivityInput } from './types';

export interface CodexRolloutParseOptions {
  sourceFile: string;
  workspace?: string;
  pipeline?: AgentPipeline;
}

export interface CodexRolloutParseResult {
  events: AgentFlowActivityEvent[];
  diagnostics: string[];
}

interface PendingToolCall {
  name: string;
  args: Record<string, unknown>;
  timestamp?: string;
}

export interface CodexRolloutParserState {
  sessionId?: string;
  cwd?: string;
  active?: boolean;
  startedEmitted: boolean;
  pendingLine: string;
  pendingToolCalls: Map<string, PendingToolCall>;
  sequence: number;
}

export function createCodexRolloutParserState(): CodexRolloutParserState {
  return {
    startedEmitted: false,
    pendingLine: '',
    pendingToolCalls: new Map(),
    sequence: 0
  };
}

export function parseCodexRolloutChunk(chunk: string, state: CodexRolloutParserState, options: CodexRolloutParseOptions): CodexRolloutParseResult {
  const diagnostics: string[] = [];
  const events: AgentFlowActivityEvent[] = [];
  const content = state.pendingLine + chunk;
  const endsWithNewline = /\r?\n$/.test(content);
  const lines = content.split(/\r?\n/);
  state.pendingLine = endsWithNewline ? '' : lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch (error) {
      diagnostics.push(`${options.sourceFile} contains invalid Codex rollout JSONL: ${(error as Error).message}`);
      continue;
    }
    events.push(...parseCodexRolloutRow(row, state, options));
  }

  return { events, diagnostics };
}

export function recentCodexSessionDirs(codexHome: string, now = new Date(), days = 3): string[] {
  const root = path.join(codexHome, 'sessions');
  const dirs = new Set<string>();
  for (let index = 0; index < days; index += 1) {
    const date = new Date(now.getTime() - index * 24 * 60 * 60 * 1000);
    dirs.add(sessionDir(root, date.getFullYear(), date.getMonth() + 1, date.getDate()));
    dirs.add(sessionDir(root, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()));
  }
  return [...dirs];
}

function parseCodexRolloutRow(row: any, state: CodexRolloutParserState, options: CodexRolloutParseOptions): AgentFlowActivityEvent[] {
  if (!row || typeof row !== 'object') return [];
  if (row.type === 'session_meta') {
    const payload = objectValue(row.payload);
    state.sessionId = stringValue(payload.id) ?? state.sessionId ?? sessionIdFromFile(options.sourceFile);
    state.cwd = stringValue(payload.cwd) ?? state.cwd;
    state.active = isWorkspaceSession(state.cwd, options.workspace);
    return emitStarted(row, state, options);
  }
  if (row.type === 'turn_context') {
    const payload = objectValue(row.payload);
    state.cwd = stringValue(payload.cwd) ?? state.cwd;
    state.active = isWorkspaceSession(state.cwd, options.workspace);
    return [];
  }
  if (options.workspace && state.active !== true) return [];

  if (row.type === 'event_msg') return parseEventMessage(objectValue(row.payload), row, state, options);
  if (row.type === 'response_item') return parseResponseItem(objectValue(row.payload), row, state, options);
  return [];
}

function parseEventMessage(payload: Record<string, unknown>, row: any, state: CodexRolloutParserState, options: CodexRolloutParseOptions): AgentFlowActivityEvent[] {
  const type = stringValue(payload.type);
  if (type === 'task_started') return emitStarted(row, state, options);
  if (type === 'task_complete' || type === 'task_completed') return [event({ phase: 'completed', summary: 'Codex session completed.' }, row, state, options)];
  if (type === 'turn_aborted' || type === 'task_failed') return [event({ phase: 'failed', summary: 'Codex session failed.', severity: 'error' }, row, state, options)];
  if (type === 'agent_reasoning') {
    const text = stringValue(payload.text);
    return text ? [event({ phase: 'thinking', summary: text }, row, state, options)] : [];
  }
  if (type === 'token_count') {
    const info = objectValue(payload.info);
    const last = objectValue(info.last_token_usage);
    const tokenEstimate = numberValue(last.input_tokens) ?? numberValue(info.input_tokens);
    return tokenEstimate ? [event({ phase: 'thinking', tokenEstimate, summary: `Codex context contains ${tokenEstimate} tokens.` }, row, state, options)] : [];
  }
  return [];
}

function parseResponseItem(payload: Record<string, unknown>, row: any, state: CodexRolloutParserState, options: CodexRolloutParseOptions): AgentFlowActivityEvent[] {
  const type = stringValue(payload.type);
  if (type === 'function_call' || type === 'custom_tool_call') {
    const name = stringValue(payload.name) ?? 'unknown';
    const callId = stringValue(payload.call_id);
    const args = parseArguments(payload.arguments ?? payload.input);
    if (callId) state.pendingToolCalls.set(callId, { name, args, timestamp: timestampValue(row.timestamp) });
    return toolStartEvents(name, args, row, state, options);
  }
  if (type === 'function_call_output' || type === 'custom_tool_call_output') {
    const callId = stringValue(payload.call_id);
    const pending = callId ? state.pendingToolCalls.get(callId) : undefined;
    if (callId) state.pendingToolCalls.delete(callId);
    return pending ? [event({ phase: detectFailure(payload.output) ? 'failed' : 'tool', toolName: pending.name, summary: `Tool ${pending.name} completed.`, severity: detectFailure(payload.output) ? 'error' : 'info' }, row, state, options)] : [];
  }
  if (type === 'message') {
    const role = stringValue(payload.role);
    if (role === 'assistant') return [event({ phase: 'completed', summary: 'Codex produced an assistant message.' }, row, state, options)];
  }
  return [];
}

function toolStartEvents(name: string, args: Record<string, unknown>, row: any, state: CodexRolloutParserState, options: CodexRolloutParseOptions): AgentFlowActivityEvent[] {
  const events: AgentFlowActivityEvent[] = [];
  const filePath = referencedPipelinePath(name, args, options.workspace);
  if (filePath && options.pipeline) {
    const action = isWriteTool(name, args) ? 'write' : 'read';
    for (const input of activityInputsForChangedFiles(options.pipeline, [filePath], options.workspace, action)) {
      events.push(event({ ...input, toolName: name }, row, state, options));
    }
  }
  if (!filePath || isShellTool(name)) {
    events.push(event({ phase: 'tool', toolName: name, summary: toolSummary(name, args) }, row, state, options));
  }
  return events;
}

function event(input: AgentFlowActivityInput, row: any, state: CodexRolloutParserState, options: CodexRolloutParseOptions): AgentFlowActivityEvent {
  return normalizeActivityInput({
    ...input,
    timestamp: timestampValue(row.timestamp),
    sessionId: state.sessionId ?? sessionIdFromFile(options.sourceFile) ?? 'codex-rollout',
    sourceFile: options.sourceFile
  }, () => {
    state.sequence += 1;
    return `codex-rollout-${state.sequence}`;
  }, options.pipeline);
}

function emitStarted(row: any, state: CodexRolloutParserState, options: CodexRolloutParseOptions): AgentFlowActivityEvent[] {
  if (state.startedEmitted || state.active !== true) return [];
  state.startedEmitted = true;
  return [event({ phase: 'started', summary: 'Codex session started.' }, row, state, options)];
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return objectValue(parsed);
    } catch {
      return { input: value };
    }
  }
  return objectValue(value);
}

function referencedPipelinePath(name: string, args: Record<string, unknown>, workspace?: string): string | undefined {
  const direct = findPipelinePath(args);
  if (direct) return direct;
  if (name === 'apply_patch' && typeof args.patch === 'string') return findPatchPath(args.patch);
  if (isShellTool(name) && typeof args.cmd === 'string') return findPipelinePath(args.cmd);
  if (!workspace) return undefined;
  return undefined;
}

function findPipelinePath(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.replace(/\\/g, '/');
    const match = normalized.match(/(?:^|[/"'`\s])(\.github\/(?:agents\/[^"'`\s]+\.agent\.md|prompts\/[^"'`\s]+\.prompt\.md|instructions\/[^"'`\s]+\.instructions\.md|skills\/[^"'`\s]+\/SKILL\.md|roles\/[^"'`\s]+\.md|artifacts\/[^"'`\s]+\.(?:md|json|txt)))/);
    if (match) return match[1];
    const absoluteMatch = normalized.match(/\/\.github\/(?:agents\/[^"'`\s]+\.agent\.md|prompts\/[^"'`\s]+\.prompt\.md|instructions\/[^"'`\s]+\.instructions\.md|skills\/[^"'`\s]+\/SKILL\.md|roles\/[^"'`\s]+\.md|artifacts\/[^"'`\s]+\.(?:md|json|txt))/);
    if (absoluteMatch) return absoluteMatch[0].slice(1);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPipelinePath(item);
      if (found) return found;
    }
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = findPipelinePath(item);
      if (found) return found;
    }
  }
  return undefined;
}

function findPatchPath(patch: string): string | undefined {
  const match = patch.match(/^\*\*\* (?:Update File|Add File|Delete File):\s*(.+)$/m);
  return match ? findPipelinePath(match[1]) ?? match[1].trim().replace(/\\/g, '/') : undefined;
}

function isWriteTool(name: string, args: Record<string, unknown>): boolean {
  return /write|edit|patch|apply|create|delete|replace/i.test(name) || typeof args.patch === 'string';
}

function isShellTool(name: string): boolean {
  return /exec|command|terminal|shell/i.test(name);
}

function toolSummary(name: string, args: Record<string, unknown>): string {
  if (isShellTool(name) && typeof args.cmd === 'string') return `Ran shell command \`${args.cmd}\`.`;
  return `Tool ${name} started.`;
}

function detectFailure(output: unknown): boolean {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
  return /\b(error|failed|exception|traceback)\b/i.test(text);
}

function isWorkspaceSession(cwd: string | undefined, workspace: string | undefined): boolean {
  if (!workspace) return true;
  if (!cwd) return false;
  const rel = path.relative(path.resolve(workspace), path.resolve(cwd));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function sessionDir(root: string, year: number, month: number, day: number): string {
  return path.join(root, String(year), String(month).padStart(2, '0'), String(day).padStart(2, '0'));
}

function sessionIdFromFile(file: string): string | undefined {
  return file.match(/rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f-]{36})\.jsonl$/)?.[1];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return undefined;
}
