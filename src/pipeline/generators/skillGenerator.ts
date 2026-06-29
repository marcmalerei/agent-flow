import { SkillNode } from '../types';
import { normalizeNodeLabel } from '../labels';
import { AGENT_FLOW_ACTIVITY_REPORTING_HEADING, activityReportingGuidance, appendGeneratedMarker, artifactUsageList, list, markdownBody, mergeMarkdownWithFrontmatter, nodeFileStem, replaceMarkdownSection, yamlBooleanLine, yamlString, yamlStringLine } from './shared';

export function skillFilePath(node: SkillNode): string {
  if (node.skillFile) return node.skillFile;
  return `.github/skills/${nodeFileStem(node.id, node.label, 'skill')}/SKILL.md`;
}

export function generateSkillMarkdown(node: SkillNode): string {
  const frontmatter = skillFrontmatter(node);
  const label = normalizeNodeLabel(node.label, node.id);
  if (node.markdown?.trim()) {
    const body = replaceMarkdownSection(
      replaceMarkdownSection(markdownBody(node.markdown), 'Required artifacts', artifactUsageList(node.artifactUsages, node.requiredArtifacts)),
      AGENT_FLOW_ACTIVITY_REPORTING_HEADING,
      activityReportingGuidance()
    );
    return mergeMarkdownWithFrontmatter(body, frontmatter);
  }

  return appendGeneratedMarker(`${frontmatter}

# ${label}

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

# Required artifacts

${artifactUsageList(node.artifactUsages, node.requiredArtifacts)}

# Agent Flow activity reporting

${activityReportingGuidance()}
`);
}

function skillFrontmatter(node: SkillNode): string {
  const skillName = normalizeNodeLabel(skillFilePath(node).split('/').at(-2) ?? nodeFileStem(node.id, node.label, 'skill'), node.id);
  return `---
name: ${yamlString(skillName)}
${yamlStringLine('description', node.description)}
${yamlStringLine('argument-hint', node.argumentHint)}${yamlBooleanLine('user-invocable', node.userInvocable)}${yamlBooleanLine('disable-model-invocation', node.disableModelInvocation)}${yamlStringLine('context', node.context)}---`;
}
