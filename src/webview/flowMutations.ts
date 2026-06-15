import { AgentPipeline, ArtifactAction, ArtifactUsage, PipelineEdge, PipelineNode, ReferenceInstruction, ReferenceRole } from '../pipeline/types';
import { deriveVisibleFlowEdges } from './graph';
import { normalizeNodeLabel } from '../pipeline/labels';
import { resolveAgentReference, stripYamlQuotes } from '../pipeline/referenceResolver';

export function connectPipelineNodes(pipeline: AgentPipeline, sourceId: string, targetId: string): AgentPipeline {
  const source = pipeline.nodes.find((node) => node.id === sourceId);
  const target = pipeline.nodes.find((node) => node.id === targetId);
  if (!source || !target) return pipeline;

  const edge = edgeForConnection(source, target);
  const nodes = pipeline.nodes.map((node) => updateNodeReferences(node, source, target));
  const edges = pipeline.edges.some((item) => item.from === sourceId && item.to === targetId && item.kind === edge.kind)
    ? pipeline.edges
    : [...pipeline.edges, edge];
  return { ...pipeline, nodes, edges };
}

export function renameNodeLabel(node: PipelineNode, label: string): PipelineNode {
  const normalizedLabel = normalizeNodeLabel(label, node.id);
  if (node.type === 'agent') {
    return { ...node, label: normalizedLabel, agentFile: managedPath(node.agentFile, '.github/agents/', '.agent.md') ? `.github/agents/${slugFileStem(normalizedLabel, node.id)}.agent.md` : node.agentFile };
  }
  if (node.type === 'prompt') {
    return { ...node, label: normalizedLabel, promptFile: managedPath(node.promptFile, '.github/prompts/', '.prompt.md') ? `.github/prompts/${slugFileStem(normalizedLabel, node.id)}.prompt.md` : node.promptFile };
  }
  if (node.type === 'instruction') {
    return { ...node, label: normalizedLabel, instructionFile: managedPath(node.instructionFile, '.github/instructions/', '.instructions.md') ? `.github/instructions/${slugFileStem(normalizedLabel, node.id)}.instructions.md` : node.instructionFile };
  }
  if (node.type === 'skill') {
    return { ...node, label: normalizedLabel, skillFile: managedSkillPath(node.skillFile) ? `.github/skills/${slugFileStem(normalizedLabel, node.id)}/SKILL.md` : node.skillFile };
  }
  if (node.type === 'role') {
    return { ...node, label: normalizedLabel, roleFile: managedPath(node.roleFile, '.github/roles/', '.md') ? `.github/roles/${slugFileStem(normalizedLabel, node.id)}.md` : node.roleFile };
  }
  if (node.type === 'artifact') {
    const extension = fileExtension(node.path) || '.md';
    return { ...node, label: normalizedLabel, path: managedPath(node.path, '.github/artifacts/', extension) ? `.github/artifacts/${slugFileStem(normalizedLabel, node.id)}${extension}` : node.path };
  }
  return { ...node, label: normalizedLabel } as PipelineNode;
}

export function renamePipelineNodeLabel(pipeline: AgentPipeline, nodeId: string, label: string): AgentPipeline {
  const previousNode = pipeline.nodes.find((node) => node.id === nodeId);
  if (!previousNode) return pipeline;
  const renamedNode = renameNodeLabel(previousNode, label);
  const nodesWithRenamedTarget = pipeline.nodes.map((node) => node.id === nodeId ? renamedNode : node);
  const nodes = nodesWithRenamedTarget.map((node) => node.id === nodeId ? node : updateReferencesForRenamedNode(node, previousNode, renamedNode, pipeline.nodes));
  const edges = pipeline.edges.map((edge) => updateEdgeForRenamedNode(edge, previousNode, renamedNode));
  return { ...pipeline, nodes, edges };
}

function edgeForConnection(source: PipelineNode, target: PipelineNode): PipelineEdge {
  const instructionEdge = instructionConnectionEdge(source, target);
  if (instructionEdge) return instructionEdge;
  const roleEdge = roleConnectionEdge(source, target);
  if (roleEdge) return roleEdge;
  const kind = source.type === 'prompt' && target.type === 'agent'
    ? 'prompt'
    : source.type === 'artifact' || target.type === 'artifact'
      ? 'artifact'
      : 'flow';
  const id = `${source.id}-${kind}-${target.id}`;
  const artifact = source.type === 'artifact' ? source.path : target.type === 'artifact' ? target.path : undefined;
  return { id, from: source.id, to: target.id, kind, artifact };
}

function updateNodeReferences(node: PipelineNode, source: PipelineNode, target: PipelineNode): PipelineNode {
  const instructionReference = instructionReferenceForConnection(source, target);
  if (instructionReference && node.id === instructionReference.referencingNode.id && supportsInstructionRefs(node)) {
    return { ...node, instructionRefs: upsertInstructionRef(node.instructionRefs, instructionReference.target) };
  }
  const roleReference = roleReferenceForConnection(source, target);
  if (roleReference && node.id === roleReference.referencingNode.id && supportsRoleRefs(node)) {
    return { ...node, roleRefs: upsertRoleRef(node.roleRefs, roleReference.target) };
  }
  if (node.id === source.id && source.type === 'agent' && target.type === 'agent') {
    return { ...source, calls: addUnique(source.calls, target.id) };
  }
  if (node.id === source.id && source.type === 'prompt' && target.type === 'agent') {
    return { ...source, startAgent: target.id };
  }
  if (node.id === source.id && source.type === 'agent' && target.type === 'artifact') {
    return { ...source, outputs: addUnique(source.outputs, target.path), artifactUsages: upsertArtifactUsage(source.artifactUsages, target.path, 'write') };
  }
  if (node.id === target.id && source.type === 'artifact' && target.type === 'agent') {
    return { ...target, inputs: addUnique(target.inputs, source.path), artifactUsages: upsertArtifactUsage(target.artifactUsages, source.path, 'read') };
  }
  if (node.id === source.id && source.type === 'prompt' && target.type === 'artifact') {
    return { ...source, requiredArtifacts: addUnique(source.requiredArtifacts, target.path), artifactUsages: upsertArtifactUsage(source.artifactUsages, target.path, 'read') };
  }
  if (node.id === target.id && source.type === 'artifact' && target.type === 'prompt') {
    return { ...target, requiredArtifacts: addUnique(target.requiredArtifacts, source.path), artifactUsages: upsertArtifactUsage(target.artifactUsages, source.path, 'read') };
  }
  if (node.id === source.id && supportsRequiredArtifactRefs(source) && target.type === 'artifact') {
    return { ...source, requiredArtifacts: addUnique(source.requiredArtifacts, target.path), artifactUsages: upsertArtifactUsage(source.artifactUsages, target.path, 'read') } as PipelineNode;
  }
  if (node.id === target.id && source.type === 'artifact' && supportsRequiredArtifactRefs(target)) {
    return { ...target, requiredArtifacts: addUnique(target.requiredArtifacts, source.path), artifactUsages: upsertArtifactUsage(target.artifactUsages, source.path, 'read') } as PipelineNode;
  }
  return node;
}

function updateReferencesForRenamedNode(node: PipelineNode, previousNode: PipelineNode, renamedNode: PipelineNode, previousNodes: PipelineNode[]): PipelineNode {
  if (previousNode.type === 'agent' && renamedNode.type === 'agent') return updateAgentReferencesForRename(node, previousNode, renamedNode, previousNodes);
  if (previousNode.type === 'instruction' && renamedNode.type === 'instruction') return updateInstructionReferencesForRename(node, previousNode, renamedNode);
  if (previousNode.type === 'role' && renamedNode.type === 'role') return updateRoleReferencesForRename(node, previousNode, renamedNode);
  if (previousNode.type === 'artifact' && renamedNode.type === 'artifact') return updateArtifactReferencesForRename(node, previousNode, renamedNode);
  return node;
}

function updateAgentReferencesForRename(node: PipelineNode, previousAgent: Extract<PipelineNode, { type: 'agent' }>, renamedAgent: Extract<PipelineNode, { type: 'agent' }>, previousNodes: PipelineNode[]): PipelineNode {
  if (node.type === 'agent') {
    return {
      ...node,
      calls: node.calls ? [...new Set(node.calls.map((call) => resolveAgentReference(call, previousNodes) === previousAgent.id ? renamedAgent.id : call))] : undefined,
      handoffs: node.handoffs?.map((handoff) => ({ ...handoff, agent: renamedAgentReference(handoff.agent, previousAgent, renamedAgent, previousNodes) }))
    };
  }
  if (node.type === 'prompt' && node.startAgent) {
    return { ...node, startAgent: renamedAgentReference(node.startAgent, previousAgent, renamedAgent, previousNodes) };
  }
  if (node.type === 'handoff' && node.targetAgent) {
    return { ...node, targetAgent: renamedAgentReference(node.targetAgent, previousAgent, renamedAgent, previousNodes) };
  }
  return node;
}

function renamedAgentReference(reference: string, previousAgent: Extract<PipelineNode, { type: 'agent' }>, renamedAgent: Extract<PipelineNode, { type: 'agent' }>, previousNodes: PipelineNode[]): string {
  if (resolveAgentReference(reference, previousNodes) !== previousAgent.id) return reference;
  const stripped = stripYamlQuotes(reference);
  if (previousAgent.agentFile && stripped === previousAgent.agentFile) return renamedAgent.agentFile ?? renamedAgent.id;
  if (stripped === previousAgent.label) return renamedAgent.label;
  return stripped === previousAgent.id ? renamedAgent.id : renamedAgent.agentFile ?? renamedAgent.id;
}

function updateInstructionReferencesForRename(node: PipelineNode, previousInstruction: Extract<PipelineNode, { type: 'instruction' }>, renamedInstruction: Extract<PipelineNode, { type: 'instruction' }>): PipelineNode {
  if (!supportsInstructionRefs(node)) return node;
  const previousTargets = referenceAliases(previousInstruction.id, previousInstruction.label, previousInstruction.instructionFile);
  const nextTarget = instructionReferenceTarget(renamedInstruction);
  return { ...node, instructionRefs: node.instructionRefs?.map((ref) => previousTargets.has(stripYamlQuotes(ref.target)) ? { ...ref, target: nextTarget } : ref) } as PipelineNode;
}

function updateRoleReferencesForRename(node: PipelineNode, previousRole: Extract<PipelineNode, { type: 'role' }>, renamedRole: Extract<PipelineNode, { type: 'role' }>): PipelineNode {
  if (!supportsRoleRefs(node)) return node;
  const previousTargets = referenceAliases(previousRole.id, previousRole.label, previousRole.roleFile);
  const nextTarget = roleReferenceTarget(renamedRole);
  return { ...node, roleRefs: node.roleRefs?.map((ref) => previousTargets.has(stripYamlQuotes(ref.target)) ? { ...ref, target: nextTarget } : ref) } as PipelineNode;
}

function updateArtifactReferencesForRename(node: PipelineNode, previousArtifact: Extract<PipelineNode, { type: 'artifact' }>, renamedArtifact: Extract<PipelineNode, { type: 'artifact' }>): PipelineNode {
  const previousPath = previousArtifact.path;
  const nextPath = renamedArtifact.path;
  if (node.type === 'agent') {
    return {
      ...node,
      inputs: renamePathList(node.inputs, previousPath, nextPath),
      outputs: renamePathList(node.outputs, previousPath, nextPath),
      artifactUsages: renameArtifactUsages(node.artifactUsages, previousPath, nextPath)
    };
  }
  if (node.type === 'prompt' || node.type === 'instruction' || node.type === 'skill') {
    return {
      ...node,
      requiredArtifacts: renamePathList(node.requiredArtifacts, previousPath, nextPath),
      artifactUsages: renameArtifactUsages(node.artifactUsages, previousPath, nextPath)
    } as PipelineNode;
  }
  return node;
}

function updateEdgeForRenamedNode(edge: PipelineEdge, previousNode: PipelineNode, renamedNode: PipelineNode): PipelineEdge {
  if (previousNode.type === 'artifact' && renamedNode.type === 'artifact' && edge.artifact === previousNode.path) return { ...edge, artifact: renamedNode.path };
  return edge;
}

function renamePathList(values: string[] | undefined, previousPath: string, nextPath: string): string[] | undefined {
  return values?.map((value) => value === previousPath ? nextPath : value);
}

function renameArtifactUsages(usages: ArtifactUsage[] | undefined, previousPath: string, nextPath: string): ArtifactUsage[] | undefined {
  return usages?.map((usage) => usage.path === previousPath ? { ...usage, path: nextPath } : usage);
}

function referenceAliases(id: string, label: string, file: string | undefined): Set<string> {
  return new Set([id, label, file].filter((value): value is string => Boolean(value)).map(stripYamlQuotes));
}

function addUnique(values: string[] | undefined, value: string): string[] {
  return [...new Set([...(values ?? []), value])];
}

function upsertArtifactUsage(usages: ArtifactUsage[] | undefined, path: string, action: ArtifactAction): ArtifactUsage[] {
  const current = usages ?? [];
  if (current.some((usage) => usage.path === path)) return current;
  return [...current, { path, action }];
}

function upsertInstructionRef(refs: ReferenceInstruction[] | undefined, target: string): ReferenceInstruction[] {
  const current = refs ?? [];
  if (current.some((ref) => ref.target === target)) return current;
  return [...current, { target }];
}

function upsertRoleRef(refs: ReferenceRole[] | undefined, target: string): ReferenceRole[] {
  const current = refs ?? [];
  if (current.some((ref) => ref.target === target)) return current;
  return [...current, { target }];
}

export function deletePipelineNodes(pipeline: AgentPipeline, nodeIds: string[]): AgentPipeline {
  const deleted = new Set(nodeIds);
  const deletedNodes = pipeline.nodes.filter((node) => deleted.has(node.id));
  const deletedArtifactPaths = new Set(deletedNodes.filter((node): node is Extract<PipelineNode, { type: 'artifact' }> => node.type === 'artifact').map((node) => node.path));
  const deletedInstructionTargets = new Set(deletedNodes.filter((node): node is Extract<PipelineNode, { type: 'instruction' }> => node.type === 'instruction').flatMap((node) => [node.id, node.label, node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`]));
  const deletedRoleTargets = new Set(deletedNodes.filter((node): node is Extract<PipelineNode, { type: 'role' }> => node.type === 'role').flatMap((node) => [node.id, node.label, node.roleFile ?? `.github/roles/${node.id}.md`]));

  return {
    ...pipeline,
    nodes: pipeline.nodes.filter((node) => !deleted.has(node.id)).map((node) => removeNodeReferences(node, deleted, deletedArtifactPaths, deletedInstructionTargets, deletedRoleTargets)),
    edges: pipeline.edges.filter((edge) => !deleted.has(edge.from) && !deleted.has(edge.to))
  };
}

export function deletePipelineEdges(pipeline: AgentPipeline, edgeIds: string[]): AgentPipeline {
  const deleted = new Set(edgeIds);
  const removed = pipeline.edges.filter((edge) => deleted.has(edge.id));
  const visibleRemoved = deriveVisibleFlowEdges(pipeline)
    .filter((edge) => deleted.has(edge.id) && !removed.some((stored) => stored.id === edge.id))
    .map((edge): PipelineEdge => ({ id: edge.id, from: edge.source, to: edge.target, kind: edge.data.kind === 'reference' ? inferReferenceEdgeKind(edge.source, edge.target, pipeline.nodes) : edge.data.kind, artifact: edge.data.artifact, label: edge.label }));
  const nodes = pipeline.nodes.map((node) => [...removed, ...visibleRemoved].reduce((current, edge) => removeEdgeReference(current, edge, pipeline.nodes), node));
  return { ...pipeline, nodes, edges: pipeline.edges.filter((edge) => !deleted.has(edge.id)) };
}

function removeNodeReferences(node: PipelineNode, deletedNodeIds: Set<string>, deletedArtifactPaths: Set<string>, deletedInstructionTargets: Set<string>, deletedRoleTargets: Set<string>): PipelineNode {
  if (node.type === 'agent') {
    return {
      ...node,
      calls: node.calls?.filter((id) => !deletedNodeIds.has(id)),
      handoffs: node.handoffs?.filter((handoff) => !deletedNodeIds.has(handoff.agent)),
      inputs: node.inputs?.filter((path) => !deletedArtifactPaths.has(path)),
      outputs: node.outputs?.filter((path) => !deletedArtifactPaths.has(path)),
      artifactUsages: node.artifactUsages?.filter((usage) => !deletedArtifactPaths.has(usage.path)),
      instructionRefs: node.instructionRefs?.filter((ref) => !deletedInstructionTargets.has(ref.target)),
      roleRefs: node.roleRefs?.filter((ref) => !deletedRoleTargets.has(ref.target))
    };
  }
  if (node.type === 'prompt') {
    return {
      ...node,
      startAgent: node.startAgent && deletedNodeIds.has(node.startAgent) ? undefined : node.startAgent,
      requiredArtifacts: node.requiredArtifacts?.filter((path) => !deletedArtifactPaths.has(path)),
      artifactUsages: node.artifactUsages?.filter((usage) => !deletedArtifactPaths.has(usage.path)),
      instructionRefs: node.instructionRefs?.filter((ref) => !deletedInstructionTargets.has(ref.target)),
      roleRefs: node.roleRefs?.filter((ref) => !deletedRoleTargets.has(ref.target))
    };
  }
  if (node.type === 'instruction') {
    return {
      ...node,
      requiredArtifacts: node.requiredArtifacts?.filter((path) => !deletedArtifactPaths.has(path)),
      artifactUsages: node.artifactUsages?.filter((usage) => !deletedArtifactPaths.has(usage.path)),
      instructionRefs: node.instructionRefs?.filter((ref) => !deletedInstructionTargets.has(ref.target))
    };
  }
  if (node.type === 'skill') {
    return {
      ...node,
      requiredArtifacts: node.requiredArtifacts?.filter((path) => !deletedArtifactPaths.has(path)),
      artifactUsages: node.artifactUsages?.filter((usage) => !deletedArtifactPaths.has(usage.path))
    };
  }
  return node;
}

function removeEdgeReference(node: PipelineNode, edge: PipelineEdge, nodes: PipelineNode[]): PipelineNode {
  const source = nodes.find((item) => item.id === edge.from);
  const target = nodes.find((item) => item.id === edge.to);
  if (source?.type === 'instruction' && supportsInstructionRefs(target) && supportsInstructionRefs(node) && node.id === target.id) return { ...node, instructionRefs: removeInstructionRef(node.instructionRefs, instructionReferenceTarget(source)) } as PipelineNode;
  if (target?.type === 'instruction' && supportsInstructionRefs(source) && supportsInstructionRefs(node) && node.id === source.id) return { ...node, instructionRefs: removeInstructionRef(node.instructionRefs, instructionReferenceTarget(target)) } as PipelineNode;
  if (source?.type === 'role' && supportsRoleRefs(target) && supportsRoleRefs(node) && node.id === target.id) return { ...node, roleRefs: removeRoleRef(node.roleRefs, roleReferenceTarget(source)) } as PipelineNode;
  if (target?.type === 'role' && supportsRoleRefs(source) && supportsRoleRefs(node) && node.id === source.id) return { ...node, roleRefs: removeRoleRef(node.roleRefs, roleReferenceTarget(target)) } as PipelineNode;
  if (node.type === 'agent' && node.id === edge.from && target?.type === 'agent') return { ...node, calls: node.calls?.filter((id) => id !== target.id), handoffs: node.handoffs?.filter((handoff) => handoff.agent !== target.id) };
  if (node.type === 'prompt' && node.id === edge.from && target?.type === 'agent') return { ...node, startAgent: node.startAgent === target.id ? undefined : node.startAgent };
  if (node.type === 'agent' && node.id === edge.from && target?.type === 'artifact') return { ...node, outputs: node.outputs?.filter((path) => path !== target.path), artifactUsages: node.artifactUsages?.filter((usage) => usage.path !== target.path) };
  if (node.type === 'agent' && node.id === edge.to && source?.type === 'artifact') return { ...node, inputs: node.inputs?.filter((path) => path !== source.path), artifactUsages: node.artifactUsages?.filter((usage) => usage.path !== source.path) };
  if (node.type === 'prompt' && node.id === edge.from && target?.type === 'artifact') return { ...node, requiredArtifacts: node.requiredArtifacts?.filter((path) => path !== target.path), artifactUsages: node.artifactUsages?.filter((usage) => usage.path !== target.path) };
  if (node.type === 'prompt' && node.id === edge.to && source?.type === 'artifact') return { ...node, requiredArtifacts: node.requiredArtifacts?.filter((path) => path !== source.path), artifactUsages: node.artifactUsages?.filter((usage) => usage.path !== source.path) };
  if (supportsRequiredArtifactRefs(node) && node.id === edge.from && target?.type === 'artifact') return { ...node, requiredArtifacts: node.requiredArtifacts?.filter((path) => path !== target.path), artifactUsages: node.artifactUsages?.filter((usage) => usage.path !== target.path) } as PipelineNode;
  if (supportsRequiredArtifactRefs(node) && node.id === edge.to && source?.type === 'artifact') return { ...node, requiredArtifacts: node.requiredArtifacts?.filter((path) => path !== source.path), artifactUsages: node.artifactUsages?.filter((usage) => usage.path !== source.path) } as PipelineNode;
  return node;
}

function instructionConnectionEdge(source: PipelineNode, target: PipelineNode): PipelineEdge | undefined {
  const reference = instructionReferenceForConnection(source, target);
  if (!reference) return undefined;
  return {
    id: `${reference.instructionNode.id}-instruction-${reference.referencingNode.id}`,
    from: reference.instructionNode.id,
    to: reference.referencingNode.id,
    kind: 'instruction',
    label: 'instructs',
    artifact: undefined
  };
}

function roleConnectionEdge(source: PipelineNode, target: PipelineNode): PipelineEdge | undefined {
  const reference = roleReferenceForConnection(source, target);
  if (!reference) return undefined;
  return {
    id: `${reference.roleNode.id}-role-${reference.referencingNode.id}`,
    from: reference.roleNode.id,
    to: reference.referencingNode.id,
    kind: 'role',
    label: 'role',
    artifact: undefined
  };
}

function instructionReferenceForConnection(source: PipelineNode, target: PipelineNode): { instructionNode: Extract<PipelineNode, { type: 'instruction' }>; referencingNode: PipelineNode; target: string } | undefined {
  if (source.type === 'instruction' && supportsInstructionRefs(target)) return { instructionNode: source, referencingNode: target, target: instructionReferenceTarget(source) };
  if (target.type === 'instruction' && supportsInstructionRefs(source)) return { instructionNode: target, referencingNode: source, target: instructionReferenceTarget(target) };
  return undefined;
}

function supportsInstructionRefs(node: PipelineNode | undefined): node is Extract<PipelineNode, { type: 'agent' | 'prompt' | 'instruction' }> {
  return node?.type === 'agent' || node?.type === 'prompt' || node?.type === 'instruction';
}

function supportsRequiredArtifactRefs(node: PipelineNode | undefined): node is Extract<PipelineNode, { type: 'instruction' | 'skill' }> {
  return node?.type === 'instruction' || node?.type === 'skill';
}

function roleReferenceForConnection(source: PipelineNode, target: PipelineNode): { roleNode: Extract<PipelineNode, { type: 'role' }>; referencingNode: PipelineNode; target: string } | undefined {
  if (source.type === 'role' && supportsRoleRefs(target)) return { roleNode: source, referencingNode: target, target: roleReferenceTarget(source) };
  if (target.type === 'role' && supportsRoleRefs(source)) return { roleNode: target, referencingNode: source, target: roleReferenceTarget(target) };
  return undefined;
}

function supportsRoleRefs(node: PipelineNode | undefined): node is Extract<PipelineNode, { type: 'agent' | 'prompt' }> {
  return node?.type === 'agent' || node?.type === 'prompt';
}

function instructionReferenceTarget(node: Extract<PipelineNode, { type: 'instruction' }>): string {
  return node.instructionFile ?? `.github/instructions/${node.id}.instructions.md`;
}

function roleReferenceTarget(node: Extract<PipelineNode, { type: 'role' }>): string {
  return node.roleFile ?? `.github/roles/${node.id}.md`;
}

function removeInstructionRef(refs: ReferenceInstruction[] | undefined, target: string): ReferenceInstruction[] {
  return refs?.filter((ref) => ref.target !== target) ?? [];
}

function removeRoleRef(refs: ReferenceRole[] | undefined, target: string): ReferenceRole[] {
  return refs?.filter((ref) => ref.target !== target) ?? [];
}

function inferReferenceEdgeKind(sourceId: string, targetId: string, nodes: PipelineNode[]): PipelineEdge['kind'] {
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  if (source?.type === 'instruction' || target?.type === 'instruction') return 'instruction';
  if (source?.type === 'role' || target?.type === 'role') return 'role';
  if (source?.type === 'artifact' || target?.type === 'artifact') return 'artifact';
  if (source?.type === 'prompt' && target?.type === 'agent') return 'prompt';
  return 'flow';
}

function managedPath(value: string | undefined, prefix: string, suffix: string): boolean {
  return Boolean(value?.startsWith(prefix) && value.endsWith(suffix) && value.slice(prefix.length, -suffix.length).length > 0 && !value.slice(prefix.length, -suffix.length).includes('/'));
}

function managedSkillPath(value: string | undefined): boolean {
  return Boolean(value?.startsWith('.github/skills/') && value.endsWith('/SKILL.md') && value.slice('.github/skills/'.length, -'/SKILL.md'.length).length > 0 && !value.slice('.github/skills/'.length, -'/SKILL.md'.length).includes('/'));
}

function fileExtension(value: string): string {
  const name = value.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

function slugFileStem(label: string, fallback: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}
