import { generateAgentMarkdown, generateInstructionMarkdown, generatePromptMarkdown, generateRoleMarkdown, generateSkillMarkdown } from '../pipeline/generators';
import { ArtifactAction, ArtifactUsage, PipelineNode, ReferenceInstruction } from '../pipeline/types';

export function applyNodePatch(node: PipelineNode, patch: Partial<PipelineNode>): PipelineNode {
  const next = { ...node, ...patch } as PipelineNode;
  if (typeof patch.markdown === 'string') return applyMarkdownReferences(next, patch.markdown);
  return syncMarkdownFromConfig(next);
}

function syncMarkdownFromConfig(node: PipelineNode): PipelineNode {
  const markdown = generateMarkdown(node);
  return markdown ? { ...node, markdown } as PipelineNode : node;
}

function applyMarkdownReferences(node: PipelineNode, markdown: string): PipelineNode {
  if (node.type === 'agent') {
    const artifactUsages = parseArtifactUsages(markdown, 'Artifact work');
    return {
      ...node,
      inputs: artifactUsages.filter((usage) => usage.action === 'read' || usage.action === 'validate').map((usage) => usage.path),
      outputs: artifactUsages.filter((usage) => usage.action === 'write' || usage.action === 'append').map((usage) => usage.path),
      artifactUsages,
      instructionRefs: parseInstructionRefs(markdown),
      markdown
    };
  }
  if (node.type === 'prompt') {
    const artifactUsages = parseArtifactUsages(markdown, 'Required artifacts');
    return {
      ...node,
      requiredArtifacts: artifactUsages.map((usage) => usage.path),
      artifactUsages,
      instructionRefs: parseInstructionRefs(markdown),
      markdown
    };
  }
  if (node.type === 'instruction') {
    const artifactUsages = parseArtifactUsages(markdown, 'Required artifacts');
    return {
      ...node,
      requiredArtifacts: artifactUsages.map((usage) => usage.path),
      artifactUsages,
      instructionRefs: parseInstructionRefs(markdown),
      markdown
    };
  }
  if (node.type === 'skill') {
    const artifactUsages = parseArtifactUsages(markdown, 'Required artifacts');
    return {
      ...node,
      requiredArtifacts: artifactUsages.map((usage) => usage.path),
      artifactUsages,
      markdown
    };
  }
  return { ...node, markdown };
}

function generateMarkdown(node: PipelineNode): string | undefined {
  if (node.type === 'agent') return generateAgentMarkdown(node);
  if (node.type === 'prompt') return generatePromptMarkdown(node);
  if (node.type === 'instruction') return generateInstructionMarkdown(node);
  if (node.type === 'skill') return generateSkillMarkdown(node);
  if (node.type === 'role') return generateRoleMarkdown(node);
  return undefined;
}

function parseArtifactUsages(source: string, heading: 'Artifact work' | 'Required artifacts'): ArtifactUsage[] {
  const section = markdownSection(source, heading);
  return mergeArtifactUsages(parseMagicArtifactRefs(source), section ? parseArtifactUsageLines(section) : undefined, parseMarkdownFileUsages(source)) ?? [];
}

function parseMagicArtifactRefs(source: string): ArtifactUsage[] | undefined {
  const usages: ArtifactUsage[] = [];
  const pattern = /<!--agent-flow:begin\s+artifact-ref\s+([^>]*)-->([\s\S]*?)<!--agent-flow:end\s+artifact-ref-->/gi;
  for (const match of source.matchAll(pattern)) {
    const attrs = parseReferenceAttributes(match[1]);
    const path = attrs.path;
    const action = attrs.action;
    if (!path || !action || !isArtifactPath(path)) continue;
    usages.push({ path, action: artifactAction(action), instruction: referenceInstructionFromBlock(match[2], path, '$artifact') });
  }
  return usages.length ? usages : undefined;
}

function parseArtifactUsageLines(source: string): ArtifactUsage[] | undefined {
  const usages = source.split(/\r?\n/).map((line): ArtifactUsage | undefined => {
    const match = line.match(/^\s*-\s+(Read|Write|Append to|Validate)\s+`([^`]+)`(?::\s*(.+)|\.)?\s*$/i);
    if (!match || !isArtifactPath(match[2])) return undefined;
    return { path: match[2], action: artifactAction(match[1]), instruction: match[3]?.trim() || undefined };
  }).filter((usage): usage is ArtifactUsage => Boolean(usage));
  return usages.length ? usages : undefined;
}

function parseMarkdownFileUsages(source: string): ArtifactUsage[] | undefined {
  const usages: ArtifactUsage[] = [];
  const pattern = /\b(Read|Write|Append to|Validate)\s+`([^`]+)`(?::\s*([^\n]+))?/gi;
  for (const match of source.matchAll(pattern)) {
    if (!isArtifactPath(match[2])) continue;
    usages.push({ path: match[2], action: artifactAction(match[1]), instruction: match[3]?.trim().replace(/\.$/, '') || undefined });
  }
  return usages.length ? usages : undefined;
}

function parseInstructionRefs(source: string): ReferenceInstruction[] {
  const section = markdownSection(source, 'Referenced instructions');
  const sectionRefs = section?.split(/\r?\n/).map((line): ReferenceInstruction | undefined => {
    const match = line.match(/^\s*-\s+Follow\s+`([^`]+)`(?::\s*(.+)|\.)?\s*$/i);
    if (!match) return undefined;
    return { target: match[1], instruction: match[2]?.trim() || undefined };
  }).filter((ref): ref is ReferenceInstruction => Boolean(ref));
  return mergeInstructionRefs(parseMagicInstructionRefs(source), sectionRefs, parseMarkdownInstructionRefs(source)) ?? [];
}

function parseMagicInstructionRefs(source: string): ReferenceInstruction[] | undefined {
  const refs: ReferenceInstruction[] = [];
  const pattern = /<!--agent-flow:begin\s+instruction-ref\s+([^>]*)-->([\s\S]*?)<!--agent-flow:end\s+instruction-ref-->/gi;
  for (const match of source.matchAll(pattern)) {
    const target = parseReferenceAttributes(match[1]).target;
    if (!target) continue;
    refs.push({ target, instruction: referenceInstructionFromBlock(match[2], target, '$instruction') });
  }
  return refs.length ? refs : undefined;
}

function parseMarkdownInstructionRefs(source: string): ReferenceInstruction[] | undefined {
  const refs: ReferenceInstruction[] = [];
  const pattern = /`([^`]*\.github\/instructions\/[^`]+\.instructions\.md)`/gi;
  for (const match of source.matchAll(pattern)) refs.push({ target: match[1] });
  return refs.length ? refs : undefined;
}

function mergeArtifactUsages(...groups: Array<ArtifactUsage[] | undefined>): ArtifactUsage[] | undefined {
  const byKey = new Map<string, ArtifactUsage>();
  for (const usage of groups.flatMap((group) => group ?? [])) {
    const key = `${usage.action}:${usage.path}`;
    byKey.set(key, { ...usage, instruction: byKey.get(key)?.instruction ?? usage.instruction });
  }
  return byKey.size ? [...byKey.values()] : undefined;
}

function mergeInstructionRefs(...groups: Array<ReferenceInstruction[] | undefined>): ReferenceInstruction[] | undefined {
  const byTarget = new Map<string, ReferenceInstruction>();
  for (const ref of groups.flatMap((group) => group ?? [])) {
    byTarget.set(ref.target, { ...ref, instruction: byTarget.get(ref.target)?.instruction ?? ref.instruction });
  }
  return byTarget.size ? [...byTarget.values()] : undefined;
}

function markdownSection(source: string, heading: string): string | undefined {
  const pattern = new RegExp(`^# ${escapeRegExp(heading)}\\s*$`, 'm');
  const match = pattern.exec(source);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const rest = source.slice(start).replace(/^(?:\r?\n)+/, '');
  return rest.split(/\r?\n# /)[0]?.trim();
}

function parseReferenceAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z0-9_-]+)="([^"]*)"/g)) attrs[match[1]] = htmlAttributeValue(match[2]);
  return attrs;
}

function referenceInstructionFromBlock(source: string, path: string, placeholder: '$artifact' | '$instruction'): string | undefined {
  const body = source.trim();
  if (!body) return undefined;
  const escaped = escapeRegExp(path);
  return body
    .replace(new RegExp(`\`${escaped}\``, 'g'), placeholder)
    .replace(new RegExp(escaped, 'g'), placeholder)
    .trim();
}

function customizationKind(filePath: string): 'agent' | 'prompt' | 'instruction' | 'skill' | 'role' | undefined {
  if (filePath.endsWith('.agent.md')) return 'agent';
  if (filePath.endsWith('.prompt.md')) return 'prompt';
  if (filePath.endsWith('.instructions.md')) return 'instruction';
  if (/^\.github\/skills\/[^/]+\/SKILL\.md$/i.test(filePath)) return 'skill';
  if (/^\.github\/roles\/.+\.md$/i.test(filePath)) return 'role';
  return undefined;
}

function isArtifactPath(filePath: string): boolean {
  return customizationKind(filePath) === undefined;
}

function artifactAction(value: string): ArtifactAction {
  const normalized = value.toLowerCase();
  if (normalized === 'append to') return 'append';
  if (normalized === 'read' || normalized === 'write' || normalized === 'validate') return normalized;
  return normalized;
}

function htmlAttributeValue(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
