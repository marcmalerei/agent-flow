import { AgentPipeline, GeneratedFile } from '../types';
import { stringifyPipeline } from '../parser';
import { generateAgentMarkdown, agentFilePath } from './agentGenerator';
import { generatePromptMarkdown, promptFilePath } from './promptGenerator';
import { generateInstructionMarkdown, instructionFilePath } from './instructionGenerator';
import { generateSkillMarkdown, skillFilePath } from './skillGenerator';
import { generateMermaid } from './mermaidGenerator';
import { GENERATED_MARKER } from './shared';

export function generateFiles(pipeline: AgentPipeline): GeneratedFile[] {
  const files: GeneratedFile[] = [
    { path: '.agent-pipeline/pipeline.json', content: stringifyPipeline(pipeline), kind: 'pipeline' }
  ];
  for (const node of pipeline.nodes) {
    if (node.type === 'agent') files.push({ path: agentFilePath(node), content: generateAgentMarkdown(node), kind: 'agent' });
    if (node.type === 'prompt') files.push({ path: promptFilePath(node), content: generatePromptMarkdown(node), kind: 'prompt' });
    if (node.type === 'instruction') files.push({ path: instructionFilePath(node), content: generateInstructionMarkdown(node), kind: 'instruction' });
    if (node.type === 'skill') files.push({ path: skillFilePath(node), content: generateSkillMarkdown(node), kind: 'skill' });
    if (node.type === 'artifact') files.push({ path: node.path, content: `${GENERATED_MARKER}\n# ${node.label}\n\n${node.template ?? 'Artifact content will be written by agents.'}\n`, kind: 'artifact' });
  }
  files.push({ path: 'AGENT_PIPELINE.md', content: `${GENERATED_MARKER}\n# ${pipeline.name}\n\n\`\`\`mermaid\n${generateMermaid(pipeline)}\`\`\`\n`, kind: 'documentation' });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export { generateAgentMarkdown, generatePromptMarkdown, generateInstructionMarkdown, generateSkillMarkdown, generateMermaid };
