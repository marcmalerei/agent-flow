import { RoleNode } from '../types';
import { normalizeNodeLabel } from '../labels';
import { appendGeneratedMarker, mergeMarkdownWithFrontmatter, nodeFileStem, yamlString, yamlStringLine } from './shared';

export function roleFilePath(node: RoleNode): string {
  if (node.roleFile) return node.roleFile;
  return `.github/roles/${nodeFileStem(node.id, node.label, 'role')}.md`;
}

export function generateRoleMarkdown(node: RoleNode): string {
  const frontmatter = roleFrontmatter(node);
  const label = normalizeNodeLabel(node.label, node.id);
  if (node.markdown?.trim()) return mergeMarkdownWithFrontmatter(node.markdown, frontmatter);

  return appendGeneratedMarker(`${frontmatter}

# ${label}

${node.description ?? 'Describe this reusable role.'}
`);
}

function roleFrontmatter(node: RoleNode): string {
  const label = normalizeNodeLabel(node.label, node.id);
  return `---
name: ${yamlString(label)}
${yamlStringLine('description', node.description)}---`;
}
