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
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch (error) {
      diagnostics.push(`${options.sourceFile} line ${index + 1} is not valid JSON: ${(error as Error).message}`);
      continue;
    }
    const event = parseCopilotDebugRow(row, options.sourceFile, () => {
      sequence += 1;
      return `copilot-debug-${sequence}`;
    });
    if (event) events.push(event);
  }
  return { events, diagnostics };
}

export function parseCopilotDebugRow(row: any, sourceFile: string, nextId?: () => string): AgentFlowActivityEvent | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const attrs = row.attrs && typeof row.attrs === 'object' ? row.attrs : row;
  const type = String(row.type ?? row.name ?? row.event ?? attrs.type ?? '');
  const name = stringValue(row.name ?? attrs.name ?? row.toolName ?? attrs.toolName);
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
    return normalizeActivityInput({
      timestamp: timestampValue(row.timestamp ?? row.ts ?? attrs.timestamp ?? attrs.ts),
      sessionId: stringValue(row.sessionId ?? attrs.sessionId ?? row.sid ?? attrs.sid) ?? 'copilot-debug',
      nodeId: stringValue(row.nodeId ?? attrs.nodeId),
      phase: 'tool',
      summary: `Tool ${name ?? 'call'} recorded.`,
      toolName: name,
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}
