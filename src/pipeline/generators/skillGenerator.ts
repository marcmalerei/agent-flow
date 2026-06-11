import { SkillNode } from '../types';
import { appendGeneratedMarker, isDefaultNewNodePath, list, mergeMarkdownWithFrontmatter, nodeFileStem, yamlBooleanLine, yamlString, yamlStringLine } from './shared';

export function skillFilePath(node: SkillNode): string {
  const defaultPath = `.github/skills/${node.id}/SKILL.md`;
  if (node.skillFile && !isDefaultNewNodePath(node.id, 'skill', node.skillFile, defaultPath)) return node.skillFile;
  return `.github/skills/${nodeFileStem(node.id, node.label, 'skill')}/SKILL.md`;
}

export function generateSkillMarkdown(node: SkillNode): string {
  const frontmatter = skillFrontmatter(node);
  if (node.markdown?.trim()) return mergeMarkdownWithFrontmatter(node.markdown, frontmatter);

  return appendGeneratedMarker(`${frontmatter}

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

function skillFrontmatter(node: SkillNode): string {
  const skillName = skillFilePath(node).split('/').at(-2) ?? nodeFileStem(node.id, node.label, 'skill');
  return `---
name: ${yamlString(skillName)}
${yamlStringLine('description', node.description)}
${yamlStringLine('argument-hint', node.argumentHint)}${yamlBooleanLine('user-invocable', node.userInvocable)}${yamlBooleanLine('disable-model-invocation', node.disableModelInvocation)}${yamlStringLine('context', node.context)}---`;
}
