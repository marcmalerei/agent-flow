import { AgentPipeline, GeneratedFile } from '../types';
import { generateAgentMarkdown, agentFilePath } from './agentGenerator';
import { generatePromptMarkdown, promptFilePath } from './promptGenerator';
import { generateInstructionMarkdown, instructionFilePath } from './instructionGenerator';
import { generateSkillMarkdown, skillFilePath } from './skillGenerator';
import { appendGeneratedMarker } from './shared';

export function generateFiles(pipeline: AgentPipeline): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  for (const node of pipeline.nodes) {
    if (node.type === 'agent') files.push({ path: agentFilePath(node), content: generateAgentMarkdown(node), kind: 'agent' });
    if (node.type === 'prompt') files.push({ path: promptFilePath(node), content: generatePromptMarkdown(node), kind: 'prompt' });
    if (node.type === 'instruction') files.push({ path: instructionFilePath(node), content: generateInstructionMarkdown(node), kind: 'instruction' });
    if (node.type === 'skill') files.push({ path: skillFilePath(node), content: generateSkillMarkdown(node), kind: 'skill' });
    if (node.type === 'artifact') files.push({ path: node.path, content: appendGeneratedMarker(`# ${node.label}\n\n${node.template ?? 'Artifact content will be written by agents.'}`), kind: 'artifact' });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function generateFileForNode(pipeline: AgentPipeline, nodeId: string): GeneratedFile | undefined {
  return generateFiles(pipeline).find((file) => {
    const node = pipeline.nodes.find((item) => item.id === nodeId);
    if (!node) return false;
    if (node.type === 'agent') return file.path === agentFilePath(node);
    if (node.type === 'prompt') return file.path === promptFilePath(node);
    if (node.type === 'instruction') return file.path === instructionFilePath(node);
    if (node.type === 'skill') return file.path === skillFilePath(node);
    if (node.type === 'artifact') return file.path === node.path;
    return false;
  });
}

export { generateAgentMarkdown, generatePromptMarkdown, generateInstructionMarkdown, generateSkillMarkdown };
