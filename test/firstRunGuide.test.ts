import { describe, expect, it } from 'vitest';
import { createDefaultPipeline } from '../src/pipeline/defaultPipeline';
import { isDefaultSamplePipeline } from '../src/webview/firstRunGuide';

describe('first-run guide', () => {
  it('recognizes the generated default sample pipeline', () => {
    expect(isDefaultSamplePipeline(createDefaultPipeline())).toBe(true);
  });

  it('does not show for renamed or incomplete pipelines', () => {
    const pipeline = createDefaultPipeline();
    expect(isDefaultSamplePipeline({ ...pipeline, name: 'custom flow' })).toBe(false);
    expect(isDefaultSamplePipeline({ ...pipeline, nodes: pipeline.nodes.filter((node) => node.id !== 'artifact-result-md') })).toBe(false);
  });
});
