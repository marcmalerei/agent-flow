import * as path from 'node:path';
import { AgentPipeline } from '../pipeline/types';
import { activityInputsForChangedFiles } from './fileActivity';
import { normalizeActivityInput } from './store';
import { AgentFlowActivityEvent, AgentFlowActivityInput } from './types';

export interface ClaudeCodeHookParseOptions {
  sourceFile: string;
  workspace?: string;
  pipeline?: AgentPipeline;
}

export interface ClaudeCodeHookParseResult {
  events: AgentFlowActivityEvent[];
  diagnostics: string[];
}

export function parseClaudeCodeHookLogContent(content: string, options: ClaudeCodeHookParseOptions): ClaudeCodeHookParseResult {
  const events: AgentFlowActivityEvent[] = [];
  const diagnostics: string[] = [];
  let sequence = 0;
  for (const item of parseRows(content)) {
    if (item.error) {
      diagnostics.push(`${options.sourceFile} line ${item.line} is not valid Claude Code hook JSON: ${item.error}`);
      continue;
    }
    events.push(...parseClaudeCodeHookRow(item.row, options, () => {
      sequence += 1;
      return `claude-code-hook-${sequence}`;
    }));
  }
  return { events, diagnostics };
}

export function parseClaudeCodeHookRow(row: any, options: ClaudeCodeHookParseOptions, nextId?: () => string): AgentFlowActivityEvent[] {
  if (!row || typeof row !== 'object') return [];
  const hook = stringValue(row.hook_event_name ?? row.hookEventName ?? row.hook ?? row.event ?? row.type) ?? 'unknown';
  const toolName = stringValue(row.tool_name ?? row.toolName ?? row.name ?? row.tool?.name);
  const sessionId = stringValue(row.session_id ?? row.sessionId ?? row.conversationId ?? row.transcript_path) ?? 'claude-code-hook';
  const timestamp = timestampValue(row.timestamp ?? row.ts);
  const summary = summaryForHook(hook, toolName);
  const toolInput = objectValue(row.tool_input ?? row.toolInput ?? row.input ?? row.arguments ?? row.tool?.input);
  const file = findPipelinePath(toolInput) ?? findPipelinePath(row);
  const action = actionForHook(hook, toolName);
  const base: AgentFlowActivityInput = {
    timestamp,
    sessionId,
    sourceFile: options.sourceFile,
    toolName,
    summary
  };
  if (file && options.pipeline) {
    return activityInputsForChangedFiles(options.pipeline, [absoluteOrRelativePipelinePath(file, options.workspace)], options.workspace, action === 'write' ? 'write' : 'read')
      .map((input) => event({ ...input, ...base, toolName: toolName ?? input.toolName, summary }, options, nextId));
  }
  return [event({
    ...base,
    phase: phaseForHook(hook, action),
    nodeFile: file && !isArtifactPath(file) ? normalizePipelinePath(file, options.workspace) : undefined,
    artifactPath: file && isArtifactPath(file) ? normalizePipelinePath(file, options.workspace) : undefined,
    severity: /error|fail/i.test(hook) ? 'error' : undefined
  }, options, nextId)];
}

function event(input: AgentFlowActivityInput, options: ClaudeCodeHookParseOptions, nextId?: () => string): AgentFlowActivityEvent {
  return normalizeActivityInput(input, nextId, options.pipeline);
}

function parseRows(content: string): Array<{ row?: any; line?: number; error?: string }> {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({ row }));
    } catch {
      // Fall through to JSONL parsing.
    }
  }
  const rows: Array<{ row?: any; line?: number; error?: string }> = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push({ row: JSON.parse(line) });
    } catch (error) {
      rows.push({ line: index + 1, error: (error as Error).message });
    }
  }
  return rows;
}

function summaryForHook(hook: string, toolName?: string): string {
  if (/prompt/i.test(hook)) return 'Claude Code prompt submitted.';
  if (/stop|complete/i.test(hook)) return 'Claude Code turn completed.';
  if (toolName) return `Claude Code ${hook} ${toolName}.`;
  return `Claude Code ${hook} event.`;
}

function phaseForHook(hook: string, action?: 'read' | 'write'): AgentFlowActivityInput['phase'] {
  if (/stop|complete/i.test(hook)) return 'completed';
  if (/error|fail/i.test(hook)) return 'failed';
  if (action === 'write') return 'artifact';
  if (action === 'read') return 'file';
  if (/tool/i.test(hook)) return 'tool';
  return 'thinking';
}

function actionForHook(hook: string, toolName?: string): 'read' | 'write' | undefined {
  const text = `${hook} ${toolName ?? ''}`.toLowerCase();
  if (/\b(write|edit|multiedit|notebookedit|create|delete|patch)\b/.test(text)) return 'write';
  if (/\b(read|grep|glob|ls|search|open)\b/.test(text)) return 'read';
  return undefined;
}

function findPipelinePath(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value == null) return undefined;
  if (typeof value === 'string') return pipelineFilePath(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPipelinePath(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = findPipelinePath(item, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function pipelineFilePath(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, '/');
  const relative = normalized.match(/(?:^|[/"'`\s])(\.github\/(?:agents\/[^"'`\s]+\.agent\.md|prompts\/[^"'`\s]+\.prompt\.md|instructions\/[^"'`\s]+\.instructions\.md|skills\/[^"'`\s]+\/SKILL\.md|roles\/[^"'`\s]+\.md|artifacts\/[^"'`\s]+\.(?:md|json|txt)))/);
  if (relative) return relative[1];
  const absolute = normalized.match(/\/\.github\/(?:agents\/[^"'`\s]+\.agent\.md|prompts\/[^"'`\s]+\.prompt\.md|instructions\/[^"'`\s]+\.instructions\.md|skills\/[^"'`\s]+\/SKILL\.md|roles\/[^"'`\s]+\.md|artifacts\/[^"'`\s]+\.(?:md|json|txt))/);
  return absolute?.[0];
}

function absoluteOrRelativePipelinePath(file: string, workspace?: string): string {
  if (!path.isAbsolute(file) || !workspace) return file;
  const relative = path.relative(workspace, file).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

function normalizePipelinePath(file: string, workspace?: string): string {
  return absoluteOrRelativePipelinePath(file, workspace).replace(/^\/+/, '');
}

function isArtifactPath(file: string): boolean {
  return normalizePipelinePath(file).startsWith('.github/artifacts/');
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
