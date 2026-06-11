import { RoleNode } from '../types';
import { appendGeneratedMarker, mergeMarkdownWithFrontmatter, nodeFileStem, yamlString, yamlStringLine } from './shared';

export function roleFilePath(node: RoleNode): string {
  if (node.roleFile) return node.roleFile;
  return `.github/roles/${nodeFileStem(node.id, node.label, 'role')}.md`;
}

export function generateRoleMarkdown(node: RoleNode): string {
  const frontmatter = roleFrontmatter(node);
  if (node.markdown?.trim()) return mergeMarkdownWithFrontmatter(node.markdown, frontmatter);

  return appendGeneratedMarker(`${frontmatter}

# ${node.label}

${node.description ?? 'Describe this reusable role.'}
`);
}

function roleFrontmatter(node: RoleNode): string {
  return `---
name: ${yamlString(node.label)}
${yamlStringLine('description', node.description)}---`;
}
