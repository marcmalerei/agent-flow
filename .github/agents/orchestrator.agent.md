---
name: Example Orchestrator
description: Coordinates the example AgentFlow workspace data.
argument-hint: Describe the repository task to coordinate
model:
  - GPT-5 (copilot)
  - Claude Sonnet 4.5 (copilot)
target: vscode
user-invocable: true
disable-model-invocation: false
tools:
  - agent
  - read
  - search
agents:
  - .github/agents/worker.agent.md
handoffs:
  - label: Quality Review
    agent: .github/agents/qa.agent.md
    prompt: Review the worker output and note risks.
    send: false
    model: GPT-4o (copilot)
hooks:
  SessionStart:
    - type: command
      command: echo "Agent Flow example started"
mcp-servers:
  - name: filesystem-example
    command: npx
    args: ["-y","@modelcontextprotocol/server-filesystem","."]
---

# Example Orchestrator

Read `.github/artifacts/example-input.md` before delegating.

Write `.github/artifacts/example-plan.md`: Summarize the plan, selected agents, and risks.

Read `.github/prompts/implementation.prompt.md` when a prompt handoff is needed.

Read `.github/instructions/shared.instructions.md` for repository rules.

Read `.github/agents/worker.agent.md` for worker scope.

Read `.github/skills/repo-audit/SKILL.md` when the request involves repository-wide analysis.

Use `@repo-audit` for repository-wide analysis.
