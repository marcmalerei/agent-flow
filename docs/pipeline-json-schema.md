# Pipeline JSON Schema

The pipeline source of truth lives at `.agent-pipeline/pipeline.json`.

```json
{
  "version": 1,
  "name": "Default Agent Pipeline",
  "nodes": [],
  "edges": []
}
```

## Nodes

All nodes share:

- `id`: stable identifier used by edges and generated file names
- `type`: `agent`, `prompt`, `instruction`, `skill`, `artifact`, `gate`, or `hook`
- `label`: display label
- `description`: optional human-readable summary
- `position`: optional canvas coordinates

### Agent nodes

Agent nodes generate `.github/agents/<id>.agent.md` and can define tools, called subagents, input artifacts, output artifacts, rules, context budget, edit rules, verification rules, allowed skills, forbidden changes, and command safety policies.

### Prompt nodes

Prompt nodes generate `.github/prompts/<id>.prompt.md` and define the start agent, workflow, constraints/non-goals, required artifacts, and definition of done.

### Instruction nodes

Instruction nodes generate `.github/instructions/<id>.instructions.md` and include `applyTo` plus scoped rules.

### Skill nodes

Skill nodes generate `.github/skills/<id>/SKILL.md` and include description, argument hint, activation criteria, do-not-use conditions, procedure, and resource references.

### Artifact nodes

Artifact nodes represent files under `.agent-output`. They document explicit handoff boundaries between agents.

### Gate and hook nodes

Gate nodes model decisions such as approval or tests passing. Hook nodes model guardrails for future automation but do not execute in the MVP.

## Edges

Edges use:

- `id`
- `from`
- `to`
- `kind`: `flow`, `artifact`, `prompt`, `skill`, or `gate`
- `artifact`: optional artifact path
- `label`: optional display label
