import { describe, expect, it } from 'vitest';
import { applyNodePatch } from '../src/webview/nodeMarkdownSync';
import { PipelineNode } from '../src/pipeline/types';

describe('webview node markdown synchronization', () => {
  it('updates agent markdown when instruction reference fields change', () => {
    const node: PipelineNode = {
      id: 'test',
      type: 'agent',
      label: 'test',
      tools: [],
      calls: [],
      markdown: `---
name: "test"
---

# Artifact work

None.

# Referenced instructions

None.`
    };

    const next = applyNodePatch(node, {
      instructionRefs: [{ target: '.github/instructions/test-instruction.instructions.md', instruction: 'Load this role $instruction bla bla.' }]
    });

    expect(next.markdown).toContain('<!--agent-flow:begin instruction-ref target=".github/instructions/test-instruction.instructions.md"-->');
    expect(next.markdown).toContain('Load this role `.github/instructions/test-instruction.instructions.md` bla bla.');
  });

  it('updates agent instruction reference fields when markdown changes', () => {
    const node: PipelineNode = { id: 'test', type: 'agent', label: 'test', tools: [], calls: [] };

    const next = applyNodePatch(node, {
      markdown: `---
name: "test"
---

# Referenced instructions

<!--agent-flow:begin instruction-ref target=".github/instructions/test-instruction.instructions.md"-->
Load this role \`.github/instructions/test-instruction.instructions.md\` bla bla.
<!--agent-flow:end instruction-ref-->`
    });

    expect(next.type).toBe('agent');
    expect(next.instructionRefs).toEqual([
      { target: '.github/instructions/test-instruction.instructions.md', instruction: 'Load this role $instruction bla bla.' }
    ]);
  });

  it('updates agent markdown when artifact reference fields change', () => {
    const node: PipelineNode = {
      id: 'test',
      type: 'agent',
      label: 'test',
      tools: [],
      calls: [],
      markdown: `---
name: "test"
---

# Artifact work

None.

# Referenced instructions

None.`
    };

    const next = applyNodePatch(node, {
      outputs: ['.github/artifacts/test.md'],
      artifactUsages: [{ path: '.github/artifacts/test.md', action: 'write', instruction: 'Write the result to $artifact bla bla.' }]
    });

    expect(next.markdown).toContain('<!--agent-flow:begin artifact-ref action="write" path=".github/artifacts/test.md"-->');
    expect(next.markdown).toContain('Write the result to `.github/artifacts/test.md` bla bla.');
  });

  it('updates agent artifact reference fields when markdown changes', () => {
    const node: PipelineNode = { id: 'test', type: 'agent', label: 'test', tools: [], calls: [] };

    const next = applyNodePatch(node, {
      markdown: `---
name: "test"
---

# Artifact work

<!--agent-flow:begin artifact-ref action="read" path=".github/artifacts/test.md"-->
Read \`.github/artifacts/test.md\` before planning bla bla.
<!--agent-flow:end artifact-ref-->`
    });

    expect(next.type).toBe('agent');
    expect(next.inputs).toEqual(['.github/artifacts/test.md']);
    expect(next.outputs).toEqual([]);
    expect(next.artifactUsages).toEqual([
      { path: '.github/artifacts/test.md', action: 'read', instruction: 'Read $artifact before planning bla bla.' }
    ]);
  });

  it('syncs instruction artifact references in both directions', () => {
    const node: PipelineNode = {
      id: 'test-instruction',
      type: 'instruction',
      label: 'Test Instruction',
      markdown: `---
name: "Test Instruction"
---

# Required artifacts

None.`
    };

    const fromConfig = applyNodePatch(node, {
      requiredArtifacts: ['.github/artifacts/test.md'],
      artifactUsages: [{ path: '.github/artifacts/test.md', action: 'validate', instruction: 'Validate $artifact before applying this instruction.' }]
    });

    expect(fromConfig.markdown).toContain('<!--agent-flow:begin artifact-ref action="validate" path=".github/artifacts/test.md"-->');
    expect(fromConfig.markdown).toContain('Validate `.github/artifacts/test.md` before applying this instruction.');

    const fromMarkdown = applyNodePatch(node, {
      markdown: `---
name: "Test Instruction"
---

# Required artifacts

<!--agent-flow:begin artifact-ref action="read" path=".github/artifacts/test.md"-->
Read \`.github/artifacts/test.md\` before applying this instruction.
<!--agent-flow:end artifact-ref-->`
    });

    expect(fromMarkdown.type).toBe('instruction');
    expect(fromMarkdown.requiredArtifacts).toEqual(['.github/artifacts/test.md']);
    expect(fromMarkdown.artifactUsages).toEqual([
      { path: '.github/artifacts/test.md', action: 'read', instruction: 'Read $artifact before applying this instruction.' }
    ]);
  });

  it('syncs skill artifact references in both directions', () => {
    const node: PipelineNode = {
      id: 'review-skill',
      type: 'skill',
      label: 'Review Skill',
      markdown: `---
name: "review-skill"
---

# Required artifacts

None.`
    };

    const fromConfig = applyNodePatch(node, {
      requiredArtifacts: ['.github/artifacts/review.md'],
      artifactUsages: [{ path: '.github/artifacts/review.md', action: 'write', instruction: 'Write skill notes to $artifact.' }]
    });

    expect(fromConfig.markdown).toContain('<!--agent-flow:begin artifact-ref action="write" path=".github/artifacts/review.md"-->');
    expect(fromConfig.markdown).toContain('Write skill notes to `.github/artifacts/review.md`.');

    const fromMarkdown = applyNodePatch(node, {
      markdown: `---
name: "review-skill"
---

# Required artifacts

<!--agent-flow:begin artifact-ref action="append" path=".github/artifacts/review.md"-->
Append skill notes to \`.github/artifacts/review.md\`.
<!--agent-flow:end artifact-ref-->`
    });

    expect(fromMarkdown.type).toBe('skill');
    expect(fromMarkdown.requiredArtifacts).toEqual(['.github/artifacts/review.md']);
    expect(fromMarkdown.artifactUsages).toEqual([
      { path: '.github/artifacts/review.md', action: 'append', instruction: 'Append skill notes to $artifact.' }
    ]);
  });
});
