---
name: Example Implementation Prompt
description: Starts the example implementation workflow.
argument-hint: Describe the implementation request
model: GPT-5 mini (copilot)
tools:
  - read
  - search
---

# Example Implementation Prompt

Start with `Example Orchestrator`.

# Required artifacts

- Read `.github/artifacts/example-input.md`: Use this as the request source.

# Referenced instructions

- Follow `.github/instructions/shared.instructions.md`: Apply shared rules before implementation.
