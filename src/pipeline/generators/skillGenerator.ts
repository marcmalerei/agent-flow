import { SkillNode } from '../types';
import { GENERATED_MARKER, ensureTrailingNewline, list } from './shared';

export function skillFilePath(node: SkillNode): string {
  return node.skillFile ?? `.github/skills/${node.id}/SKILL.md`;
}

export function generateSkillMarkdown(node: SkillNode): string {
  return ensureTrailingNewline(`${GENERATED_MARKER}
# ${node.label}

## Description

${node.description ?? ''}

## Argument hint

${node.argumentHint ?? 'No argument required.'}

## Activation criteria

${list(node.activationCriteria)}

## Do not use when

${list(node.doNotUseWhen)}

## Procedure

${list(node.procedure)}

## Resource references

${list(node.resourceReferences)}
`);
}
