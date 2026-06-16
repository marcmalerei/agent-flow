import { describe, expect, it } from 'vitest';
import {
  artifactRelationshipSummary,
  graphFocusModes,
  graphNeighborhoodNodeIds,
  graphSearchResults,
  graphTypeFilterOptions,
  visibleGraphNodeIdsForFocus,
  visibleGraphNodeIdsForTypes
} from '../src/webview/graphSearch';
import type { AgentPipeline } from '../src/pipeline/types';

const pipeline: AgentPipeline = {
  version: 1,
  name: 'navigation test',
  nodes: [
    { id: 'start', type: 'prompt', label: 'Start request', promptFile: '.github/prompts/start.prompt.md', tools: ['read'], workflow: [], constraints: [] },
    { id: 'router', type: 'agent', label: 'Router agent', agentFile: '.github/agents/router.agent.md', tools: ['read', 'search/searchWorkspaceSymbols'], calls: [], inputs: [], outputs: [] },
    { id: 'release-notes', type: 'artifact', label: 'Release notes', path: '.github/artifacts/release-notes.md', producers: ['router'], consumers: ['start'] },
    { id: 'review-policy', type: 'instruction', label: 'Review policy', instructionFile: '.github/instructions/review.instructions.md', applyTo: '**/*.ts', rules: [] }
  ],
  edges: [
    { id: 'start-router', from: 'start', to: 'router', kind: 'prompt' },
    { id: 'router-release', from: 'router', to: 'release-notes', kind: 'artifact' },
    { id: 'policy-router', from: 'review-policy', to: 'router', kind: 'instruction' }
  ]
};

describe('graph search and focus helpers', () => {
  it('matches nodes by label, file path, type, artifact path, and tool id', () => {
    expect(graphSearchResults(pipeline, 'release').map((result) => result.nodeId)).toEqual(['release-notes']);
    expect(graphSearchResults(pipeline, 'searchworkspace').map((result) => result.nodeId)).toEqual(['router']);
    expect(graphSearchResults(pipeline, 'instruction').map((result) => result.nodeId)).toEqual(['review-policy']);
    expect(graphSearchResults(pipeline, '.GITHUB/AGENTS/ROUTER').map((result) => result.nodeId)).toEqual(['router']);
  });

  it('returns selected node neighborhoods in stable graph order', () => {
    expect(graphNeighborhoodNodeIds(pipeline, 'router')).toEqual(['start', 'router', 'release-notes', 'review-policy']);
    expect(graphNeighborhoodNodeIds(pipeline, 'release-notes')).toEqual(['router', 'release-notes']);
    expect(graphNeighborhoodNodeIds(pipeline, 'missing')).toEqual([]);
  });

  it('counts graph node types and filters visible nodes by selected types', () => {
    expect(graphTypeFilterOptions(pipeline)).toEqual([
      { type: 'agent', label: 'Agents', count: 1 },
      { type: 'prompt', label: 'Prompts', count: 1 },
      { type: 'instruction', label: 'Instructions', count: 1 },
      { type: 'artifact', label: 'Artifacts', count: 1 }
    ]);
    expect(visibleGraphNodeIdsForTypes(pipeline, ['agent', 'artifact'])).toEqual(['router', 'release-notes']);
    expect(visibleGraphNodeIdsForTypes(pipeline, [])).toEqual([]);
  });

  it('filters visible nodes by semantic graph focus mode without mutating pipeline state', () => {
    expect(graphFocusModes.map((mode) => mode.id)).toEqual(['full', 'selected-neighborhood', 'active-run', 'execution-path']);
    expect(visibleGraphNodeIdsForFocus(pipeline, 'full', 'router', [])).toEqual(['start', 'router', 'release-notes', 'review-policy']);
    expect(visibleGraphNodeIdsForFocus(pipeline, 'selected-neighborhood', 'release-notes', [])).toEqual(['router', 'release-notes']);
    expect(visibleGraphNodeIdsForFocus(pipeline, 'active-run', '', ['router', 'release-notes'])).toEqual(['router', 'release-notes']);
    expect(visibleGraphNodeIdsForFocus(pipeline, 'execution-path', '', [])).toEqual(['start', 'router', 'release-notes']);
    expect(pipeline.nodes.map((node) => node.id)).toEqual(['start', 'router', 'release-notes', 'review-policy']);
  });

  it('summarizes artifact producers and consumers from explicit metadata and edges', () => {
    expect(artifactRelationshipSummary(pipeline, 'release-notes')).toEqual({
      artifactId: 'release-notes',
      path: '.github/artifacts/release-notes.md',
      producers: [{ id: 'router', label: 'Router agent', type: 'agent' }],
      consumers: [{ id: 'start', label: 'Start request', type: 'prompt' }],
      referencedBy: []
    });
    expect(artifactRelationshipSummary(pipeline, 'router')).toBeUndefined();
  });
});
