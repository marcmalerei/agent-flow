import { describe, expect, it } from 'vitest';
import { graphNeighborhoodNodeIds, graphSearchResults } from '../src/webview/graphSearch';
import type { AgentPipeline } from '../src/pipeline/types';

const pipeline: AgentPipeline = {
  version: 1,
  name: 'navigation test',
  nodes: [
    { id: 'start', type: 'prompt', label: 'Start request', promptFile: '.github/prompts/start.prompt.md', tools: ['read'], workflow: [], constraints: [] },
    { id: 'router', type: 'agent', label: 'Router agent', agentFile: '.github/agents/router.agent.md', tools: ['read', 'search/searchWorkspaceSymbols'], calls: [], inputs: [], outputs: [] },
    { id: 'release-notes', type: 'artifact', label: 'Release notes', path: '.github/artifacts/release-notes.md' },
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
});
