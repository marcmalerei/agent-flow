# Copilot Customization Frontmatter

AgentFlow generates Markdown files for current VS Code and GitHub Copilot customization formats. The supported fields are based on the official documentation for [custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents), [prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files), [custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions), [agent skills](https://code.visualstudio.com/docs/agent-customization/agent-skills), and GitHub's [custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration).

## Supported fields

| File type | Generated path | Frontmatter fields |
| --- | --- | --- |
| Agent | `.github/agents/*.agent.md` | `name`, `description`, `argument-hint`, `model`, `target`, `user-invocable`, `disable-model-invocation`, `handoffs`, `tools`, `agents` |
| Prompt | `.github/prompts/*.prompt.md` | `name`, `description`, `argument-hint`, `agent`, `model`, `tools` |
| Instructions | `.github/instructions/*.instructions.md` | `name`, `description`, `applyTo`, `excludeAgent` |
| Skill | `.github/skills/*/SKILL.md` | `name`, `description`, `argument-hint`, `user-invocable`, `disable-model-invocation`, `context` |

AgentFlow uses the node label as the generated `name` for agents, prompts, and instructions. Skill `name` uses the node id so it can match the skill directory name.

## Intentional gaps

- Retired fields such as `infer` are not generated.
- Agent `mcp-servers`, `metadata`, and preview `hooks` are not first-class UI fields yet because they are raw object-shaped configuration or preview-only behavior. Use a node Markdown override when one of these fields is required.
- AgentFlow does not parse existing Markdown frontmatter into the JSON model yet; the pipeline JSON remains the source of truth for generated files.
