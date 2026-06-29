import { RoleNode } from '../types';
import { normalizeNodeLabel } from '../labels';
import { AGENT_FLOW_ACTIVITY_REPORTING_HEADING, activityReportingGuidance, appendGeneratedMarker, markdownBody, mergeMarkdownWithFrontmatter, nodeFileStem, replaceMarkdownSection, yamlString, yamlStringLine } from './shared';

export function roleFilePath(node: RoleNode): string {
  if (node.roleFile) return node.roleFile;
  return `.github/roles/${nodeFileStem(node.id, node.label, 'role')}.md`;
}

export function generateRoleMarkdown(node: RoleNode): string {
  const frontmatter = roleFrontmatter(node);
  const label = normalizeNodeLabel(node.label, node.id);
  if (node.markdown?.trim()) {
    const body = replaceMarkdownSection(
      markdownBody(node.markdown),
      AGENT_FLOW_ACTIVITY_REPORTING_HEADING,
      activityReportingGuidance()
    );
    return mergeMarkdownWithFrontmatter(body, frontmatter);
  }

  return appendGeneratedMarker(`${frontmatter}

# ${label}

${node.description ?? 'Describe this reusable role.'}

# Agent Flow activity reporting

${activityReportingGuidance()}
`);
}

function roleFrontmatter(node: RoleNode): string {
  const label = normalizeNodeLabel(node.label, node.id);
  return `---
name: ${yamlString(label)}
${yamlStringLine('description', node.description)}---`;
}
