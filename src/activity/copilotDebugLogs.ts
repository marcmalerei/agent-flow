import { AgentFlowActivityEvent } from './types';
import { normalizeActivityInput } from './store';

export interface CopilotDebugLogParseOptions {
  sourceFile: string;
  maxBytes?: number;
}

export interface CopilotDebugLogParseResult {
  events: AgentFlowActivityEvent[];
  diagnostics: string[];
}

export function parseCopilotDebugLogContent(content: string, options: CopilotDebugLogParseOptions): CopilotDebugLogParseResult {
  const maxBytes = options.maxBytes ?? 2_000_000;
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    return { events: [], diagnostics: [`${options.sourceFile} is larger than ${maxBytes} bytes and was skipped.`] };
  }
  const events: AgentFlowActivityEvent[] = [];
  const diagnostics: string[] = [];
  let sequence = 0;
  for (const item of parseDebugRows(content)) {
    if (item.error) {
      diagnostics.push(`${options.sourceFile} line ${item.line} is not valid JSON: ${item.error}`);
      continue;
    }
    const event = parseCopilotDebugRow(item.row, options.sourceFile, () => {
      sequence += 1;
      return `copilot-debug-${sequence}`;
    });
    if (event) events.push(event);
  }
  return { events, diagnostics };
}

export function parseCopilotDebugRow(row: any, sourceFile: string, nextId?: () => string): AgentFlowActivityEvent | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const attrs = attributeObject(row);
  const type = String(row.type ?? row.name ?? row.event ?? attrs.type ?? '');
  const name = stringValue(row.toolName ?? attrs.toolName ?? row.name ?? attrs.name);
  if (type === 'llm_request') {
    const nanoAiu = numberValue(attrs.copilotUsageNanoAiu ?? attrs.nanoAiu ?? row.copilotUsageNanoAiu);
    if (!nanoAiu || nanoAiu <= 0) return undefined;
    const promptTokens = numberValue(attrs.prompt_tokens ?? attrs.promptTokens ?? attrs.inputTokens) ?? 0;
    const completionTokens = numberValue(attrs.completion_tokens ?? attrs.completionTokens ?? attrs.outputTokens) ?? 0;
    return normalizeActivityInput({
      timestamp: stringValue(row.timestamp ?? attrs.timestamp),
      sessionId: stringValue(row.sessionId ?? attrs.sessionId ?? row.conversationId) ?? 'copilot-debug',
      phase: 'thinking',
      summary: 'Copilot language model request recorded.',
      aiCredits: nanoAiu / 1_000_000_000,
      tokenEstimate: promptTokens + completionTokens || undefined,
      inputTokens: promptTokens || undefined,
      outputTokens: completionTokens || undefined,
      model: stringValue(attrs.model ?? row.model),
      sourceFile
    }, nextId);
  }
  if (type === 'session_start') {
    return normalizeActivityInput({
      timestamp: timestampValue(row.timestamp ?? row.ts ?? attrs.timestamp ?? attrs.ts),
      sessionId: stringValue(row.sessionId ?? attrs.sessionId ?? row.conversationId ?? row.sid) ?? 'copilot-debug',
      phase: 'started',
      summary: 'Copilot debug session started.',
      sourceFile
    }, nextId);
  }
  if (type === 'tool_call' || type === 'toolCall' || type === 'tool_call_started' || /tool/i.test(type) || /tool/i.test(name ?? '')) {
    const file = pipelineFilePath(row.nodeFile ?? attrs.nodeFile ?? row.filePath ?? attrs.filePath ?? row.file ?? attrs.file ?? row.path ?? attrs.path) ?? findPipelineFilePath(row) ?? findPipelineFilePath(attrs);
    const isArtifact = file?.replace(/\\/g, '/').startsWith('.github/artifacts/');
    return normalizeActivityInput({
      timestamp: timestampValue(row.timestamp ?? row.ts ?? attrs.timestamp ?? attrs.ts),
      sessionId: stringValue(row.sessionId ?? attrs.sessionId ?? row.sid ?? attrs.sid) ?? 'copilot-debug',
      nodeId: stringValue(row.nodeId ?? attrs.nodeId),
      phase: 'tool',
      summary: `Tool ${name ?? 'call'} recorded.`,
      toolName: name,
      nodeFile: isArtifact ? undefined : file,
      artifactPath: isArtifact ? file : undefined,
      sourceFile
    }, nextId);
  }
  if (/request|response|agent|chat|turn|invoke/i.test(type) || /request|response|agent|chat|turn|invoke/i.test(name ?? '')) {
    return normalizeActivityInput({
      timestamp: timestampValue(row.timestamp ?? row.ts ?? attrs.timestamp ?? attrs.ts),
      sessionId: stringValue(row.sessionId ?? attrs.sessionId ?? row.sid ?? attrs.sid ?? row.conversationId) ?? 'copilot-debug',
      phase: /response|done|complete/i.test(type) ? 'completed' : 'thinking',
      summary: `${name ?? type} recorded from Copilot debug logs.`,
      model: stringValue(attrs.model ?? row.model),
      sourceFile
    }, nextId);
  }
  return undefined;
}

function parseDebugRows(content: string): Array<{ row?: any; line?: number; error?: string }> {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return extractDebugRows(JSON.parse(trimmed)).map((row) => ({ row }));
    } catch {
      // Fall through to JSONL parsing for line-level diagnostics.
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

function extractDebugRows(value: unknown, depth = 0): any[] {
  if (depth > 8 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => extractDebugRows(item, depth + 1));
  if (typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  const rows: any[] = [];
  if (isDebugEventRow(row)) rows.push(normalizeDebugEventRow(row));
  for (const item of Object.values(row)) rows.push(...extractDebugRows(item, depth + 1));
  return rows;
}

function isDebugEventRow(row: Record<string, unknown>): boolean {
  if (typeof row.type === 'string' || typeof row.event === 'string') return true;
  if (typeof row.name === 'string' && (/tool|request|response|agent|chat|turn|invoke|session/i.test(row.name) || Array.isArray(row.attributes))) return true;
  const attrs = attributeObject(row);
  return typeof attrs.type === 'string' || typeof attrs.name === 'string' || typeof attrs.toolName === 'string';
}

function normalizeDebugEventRow(row: Record<string, unknown>): Record<string, unknown> {
  const attrs = attributeObject(row);
  return {
    ...row,
    attrs,
    type: row.type ?? attrs.type ?? row.name,
    name: attrs.toolName ?? row.name ?? attrs.name,
    sessionId: row.sessionId ?? attrs.sessionId ?? attrs.sid,
    timestamp: row.timestamp ?? row.ts ?? attrs.timestamp ?? attrs.ts ?? row.startTimeUnixNano
  };
}

function attributeObject(row: Record<string, unknown>): Record<string, unknown> {
  if (row.attrs && typeof row.attrs === 'object' && !Array.isArray(row.attrs)) return row.attrs as Record<string, unknown>;
  if (!Array.isArray(row.attributes)) return row;
  const attrs: Record<string, unknown> = {};
  for (const attribute of row.attributes) {
    if (!attribute || typeof attribute !== 'object') continue;
    const key = (attribute as { key?: unknown }).key;
    if (typeof key !== 'string' || !key) continue;
    attrs[key] = otelAttributeValue((attribute as { value?: unknown }).value);
  }
  return attrs;
}

function otelAttributeValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if ('stringValue' in record) return record.stringValue;
  if ('intValue' in record) return typeof record.intValue === 'string' ? Number(record.intValue) : record.intValue;
  if ('doubleValue' in record) return record.doubleValue;
  if ('boolValue' in record) return record.boolValue;
  if ('arrayValue' in record) return record.arrayValue;
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'string' && /^\d{16,}$/.test(value.trim())) {
    const millis = Number(BigInt(value.trim()) / 1_000_000n);
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function findPipelineFilePath(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value == null) return undefined;
  const direct = pipelineFilePath(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPipelineFilePath(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = findPipelineFilePath(item, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function pipelineFilePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().replace(/\\/g, '/');
  const match = normalized.match(/(?:^|[/"'`])(\.github\/(?:agents\/[^"'`\s]+\.agent\.md|prompts\/[^"'`\s]+\.prompt\.md|instructions\/[^"'`\s]+\.instructions\.md|skills\/[^"'`\s]+\/SKILL\.md|roles\/[^"'`\s]+\.md|artifacts\/[^"'`\s]+\.(?:md|json|txt)))/);
  return match?.[1];
}
