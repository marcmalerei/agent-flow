import { AgentFlowActivityEvent } from './types';

export interface FileAttentionEntry {
  path: string;
  reads: number;
  writes: number;
  events: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  latestTimestamp?: string;
  nodeIds: string[];
  heat: number;
}

export interface FileAttentionDecoration {
  badge: string;
  tooltip: string;
}

export function aggregateFileAttention(events: readonly AgentFlowActivityEvent[]): FileAttentionEntry[] {
  const entries = new Map<string, MutableFileAttentionEntry>();
  for (const event of events) {
    const file = event.artifactPath ?? event.nodeFile;
    if (!file) continue;
    const entry = entries.get(file) ?? { path: file, reads: 0, writes: 0, events: 0, tokens: 0, inputTokens: 0, outputTokens: 0, latestTimestamp: undefined, nodeIds: new Set<string>() };
    const action = fileAction(event);
    entry.events += 1;
    entry.tokens += event.tokenEstimate ?? ((event.inputTokens ?? 0) + (event.outputTokens ?? 0));
    entry.inputTokens += event.inputTokens ?? 0;
    entry.outputTokens += event.outputTokens ?? 0;
    entry.latestTimestamp = later(entry.latestTimestamp, event.timestamp);
    if (event.nodeId) entry.nodeIds.add(event.nodeId);
    if (action === 'read') entry.reads += 1;
    if (action === 'write') entry.writes += 1;
    entries.set(file, entry);
  }
  const maxEvents = Math.max(1, ...[...entries.values()].map((entry) => entry.events));
  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      nodeIds: [...entry.nodeIds].sort((a, b) => a.localeCompare(b)),
      heat: Number((entry.events / maxEvents).toFixed(2))
    }))
    .sort((left, right) => right.events - left.events || right.tokens - left.tokens || left.path.localeCompare(right.path));
}

export function fileAttentionDecoration(entries: readonly FileAttentionEntry[], relativePath: string): FileAttentionDecoration | undefined {
  const entry = entries.find((item) => item.path === normalizePath(relativePath));
  if (!entry) return undefined;
  const reads = `${entry.reads} read${entry.reads === 1 ? '' : 's'}`;
  const writes = `${entry.writes} write${entry.writes === 1 ? '' : 's'}`;
  const events = `${entry.events} event${entry.events === 1 ? '' : 's'}`;
  const tokenBreakdown = entry.inputTokens || entry.outputTokens ? ` (${entry.inputTokens} in / ${entry.outputTokens} out)` : '';
  const tokens = `${entry.tokens} estimated token${entry.tokens === 1 ? '' : 's'}${tokenBreakdown}`;
  return {
    badge: 'AI',
    tooltip: `Agent Flow: ${reads}, ${writes}, ${events}, ${tokens}`
  };
}

interface MutableFileAttentionEntry {
  path: string;
  reads: number;
  writes: number;
  events: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  latestTimestamp?: string;
  nodeIds: Set<string>;
}

function fileAction(event: AgentFlowActivityEvent): 'read' | 'write' | undefined {
  const text = `${event.phase} ${event.toolName ?? ''} ${event.summary}`.toLowerCase();
  if (/\b(write|append|edit|update|create|save|wrote)\b/.test(text)) return 'write';
  if (/\b(read|open|load|reviewed)\b/.test(text)) return 'read';
  return undefined;
}

function later(left: string | undefined, right: string): string {
  if (!left) return right;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}
