# Validation Rules

AgentFlow validates pipeline structure, Copilot file references, tool risks, artifact boundaries, and context risk.

## Structural rules

- Edges must reference known nodes.
- Agents must call known subagents.
- Prompts must reference known start agents.
- Cycles should include a gate with `maxIterations`.

## Artifact rules

- Agents should write at least one output artifact.
- Artifacts read by agents should be written by an upstream agent.
- Artifacts written but never consumed are reported as informational findings.

## Scope and permission rules

- `applyTo: "**/*"` is broad and risky.
- `applyTo: "**/*.md"` can affect agents, prompts, and skills.
- Agents with both `editFiles` and `runCommands` are marked risky.
- Agents with `runCommands` should define command safety policies.
- Docs agents should restrict edits to documentation.
- Review agents should be read-only.

## Skill and prompt rules

- Skills should have specific descriptions.
- Skills should define activation criteria.
- Prompts should define constraints and non-goals.

## Context Risk Score

The score considers:

- long always-on Copilot instructions
- broad `applyTo` patterns
- agents with `runCommands`
- generic skill descriptions
- example-heavy skills
- missing context budgets
- missing artifact boundaries
- large pipelines
- cycles

The score is heuristic. It is meant to highlight context-cost and safety pressure, not to block all work.
