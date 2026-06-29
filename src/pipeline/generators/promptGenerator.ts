import { PromptNode } from '../types';
import { normalizeNodeLabel } from '../labels';
import { AGENT_FLOW_ACTIVITY_REPORTING_HEADING, activityReportingGuidance, appendGeneratedMarker, artifactUsageList, list, markdownBody, mergeMarkdownWithFrontmatter, nodeFileStem, referenceInstructionList, referenceRoleList, replaceMarkdownSection, toolsWithActivityReporting, yamlOptionalList, yamlString, yamlStringLine } from './shared';

export function promptFilePath(node: PromptNode): string {
  if (node.promptFile) return node.promptFile;
  return `.github/prompts/${nodeFileStem(node.id, node.label, 'prompt')}.prompt.md`;
}

export function generatePromptMarkdown(node: PromptNode): string {
  const frontmatter = promptFrontmatter(node);
  const label = normalizeNodeLabel(node.label, node.id);
  if (node.markdown?.trim()) {
    const body = replaceMarkdownSection(
      replaceMarkdownSection(
        replaceMarkdownSection(
          replaceMarkdownSection(markdownBody(node.markdown), 'Required artifacts', artifactUsageList(node.artifactUsages, node.requiredArtifacts)),
          'Referenced instructions',
          referenceInstructionList(node.instructionRefs)
        ),
        'Referenced roles',
        referenceRoleList(node.roleRefs)
      ),
      AGENT_FLOW_ACTIVITY_REPORTING_HEADING,
      activityReportingGuidance()
    );
    return mergeMarkdownWithFrontmatter(body, frontmatter);
  }

  return appendGeneratedMarker(`${frontmatter}

# ${label}

${node.description ?? ''}

# Start agent

${node.startAgent ? `Start with \`${node.startAgent}\`.` : 'No start agent configured.'}

# Workflow

${list(node.workflow)}

# Constraints and non-goals

${list(node.constraints)}

# Required artifacts

${artifactUsageList(node.artifactUsages, node.requiredArtifacts)}

# Referenced instructions

${referenceInstructionList(node.instructionRefs)}

# Referenced roles

${referenceRoleList(node.roleRefs)}

# Agent Flow activity reporting

${activityReportingGuidance()}

# Definition of done

${list(node.definitionOfDone)}
`);
}

function promptFrontmatter(node: PromptNode): string {
  const label = normalizeNodeLabel(node.label, node.id);
  return `---
name: ${yamlString(label)}
${yamlStringLine('description', node.description)}
${yamlStringLine('argument-hint', node.argumentHint)}${yamlStringLine('agent', node.startAgent)}${yamlStringLine('model', node.model)}
${yamlOptionalList('tools', toolsWithActivityReporting(node.tools))}
---`;
}
