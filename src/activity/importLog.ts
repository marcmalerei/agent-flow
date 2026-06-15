import { AgentPipeline } from '../pipeline/types';
import { AgentFlowActivityEvent } from './types';
import { normalizeActivityInput } from './store';

export interface ActivityLogImportOptions {
  sourceFile?: string;
  pipeline?: AgentPipeline;
}

export interface ActivityLogImportResult {
  events: AgentFlowActivityEvent[];
  diagnostics: string[];
}

export interface ActivityReplayStep {
  event: AgentFlowActivityEvent;
  delayMs: number;
}

export function parseActivityLogJsonl(content: string, options: ActivityLogImportOptions = {}): ActivityLogImportResult {
  const events: AgentFlowActivityEvent[] = [];
  const diagnostics: string[] = [];
  const seenIds = new Set<string>();
  let generated = 0;

  const nextId = () => {
    generated += 1;
    return `imported-activity-${generated}`;
  };

  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch (error) {
      diagnostics.push(`${sourceName(options.sourceFile)} line ${index + 1} is not valid JSONL: ${(error as Error).message}`);
      return;
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      diagnostics.push(`${sourceName(options.sourceFile)} line ${index + 1} is not an activity object.`);
      return;
    }
    const event = normalizeActivityInput({ ...(row as Record<string, unknown>), sourceFile: options.sourceFile }, nextId, options.pipeline);
    if (seenIds.has(event.id)) {
      diagnostics.push(`${sourceName(options.sourceFile)} line ${index + 1} duplicates activity id ${event.id} and was skipped.`);
      return;
    }
    seenIds.add(event.id);
    events.push(event);
  });

  events.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.id.localeCompare(right.id));
  return { events, diagnostics };
}

export function createActivityReplayPlan(events: readonly AgentFlowActivityEvent[], speed = 1): ActivityReplayStep[] {
  const sorted = [...events].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.id.localeCompare(right.id));
  const first = sorted[0] ? Date.parse(sorted[0].timestamp) : 0;
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return sorted.map((event) => ({
    event,
    delayMs: Math.max(0, Math.round((Date.parse(event.timestamp) - first) / safeSpeed))
  }));
}

function sourceName(sourceFile: string | undefined): string {
  return sourceFile || 'activity log';
}
