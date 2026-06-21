# Inject Agent Flow Activity Reporting Into Generated Content

Ticket: `ticket-inject-agent-flow-activity-reporting-into-generated-prompts-agents-instr`
GitHub issue: [#246](https://github.com/marcmalerei/agent-flow/issues/246)
Priority: P0
Owner role: `engineer-agent`
Status: ready for implementation

## User Value

Operators need graph activity to stay visible when generated Agent Flow content runs, even if optional debug-log ingestion is incomplete, disabled, or unavailable. A generated workflow should therefore teach agents and prompts to emit short, structured Agent Flow activity updates from the first run.

## Current Context

Agent Flow already contributes `agentflow_report_activity` and `agentflow_complete_node` as VS Code language model tools, and `docs/activity.md` documents activity tools as the production-supported ingestion path. The remaining gap is generation: default and regenerated `.github` content must consistently include the reporting tools and matching safe-use guidance.

Use the current underscore tool ids for this ticket:

- `agentflow_report_activity`
- `agentflow_complete_node`

Do not switch to slash-style ids such as `agentflow/reportActivity` in this implementation. That naming standardization is a separate compatibility project.

## Scope

- Inject reporting tools into generated agent and prompt tool lists.
- Inject matching reporting guidance into generated agent, prompt, instruction, skill, and closely related generated Markdown content where models read workflow instructions.
- Preserve existing saved pipelines and manually selected tools as much as possible.
- Keep the reporting contract short, structured, and safe for workspace-local activity telemetry.

## Acceptance Criteria

1. Generated agent files include `agentflow_report_activity` and `agentflow_complete_node` in `tools`.
2. Generated prompt files include `agentflow_report_activity` and `agentflow_complete_node` in `tools`.
3. Tool injection is additive: existing tool ids are retained, unknown tool ids are retained, and duplicate reporting tools are not produced.
4. Default pipelines and regenerated saved pipelines receive reporting tools even when an agent or prompt already has a custom tool list.
5. Instructions and skills do not receive unsupported `tools` frontmatter; instead their generated Markdown includes a concise activity-reporting guidance section.
6. Generated agent and prompt Markdown includes the same concise guidance section so models know when and how to report progress.
7. Existing custom Markdown bodies are preserved, with the reporting guidance section inserted or replaced deterministically rather than appended repeatedly.
8. Guidance tells models to report sanitized updates at meaningful workflow boundaries: node start, tool use, file/artifact work, handoff, completion, failure, or cancellation.
9. Guidance explicitly forbids raw prompts, secrets, credentials, private transcript text, and full file contents in reported summaries.
10. Guidance identifies the minimal structured fields models should provide: `node` or `nodeFile`, `phase`, `summary`, and optional `toolName`, `artifactPath`, `targetNode`, `durationMs`, and `severity` when relevant.
11. The accepted phase names match the current activity schema: `queued`, `started`, `thinking`, `tool`, `file`, `artifact`, `handoff`, `completed`, `failed`, and `cancelled`.
12. The implementation does not make optional Copilot, Claude Code, or Codex debug-log adapters a required path for normal activity visibility.
13. Regenerating files remains deterministic for the same pipeline input.
14. Generated-file docs are updated to describe the injected reporting tools and safe guidance contract without claiming slash-style ids.

## Suggested Implementation Targets

- `src/pipeline/generators/agentGenerator.ts`
- `src/pipeline/generators/promptGenerator.ts`
- `src/pipeline/generators/instructionGenerator.ts`
- `src/pipeline/generators/skillGenerator.ts`
- `src/pipeline/generators/shared.ts`
- `src/pipeline/defaultPipeline.ts`
- `src/pipeline/toolNormalization.ts` or a nearby helper if normalization is already centralized there
- `docs/generated-files.md`
- `docs/activity.md` only if the final contract wording changes

## Verification Expectations

- Add or update generator tests in `test/pipeline.test.ts` covering default nodes and nodes with explicit custom tool lists.
- Add a regression test for custom Markdown bodies proving the reporting section is stable across repeated generation.
- Add or update package/tool contribution tests only if the language model tool schema changes.
- Run `npm test -- --run test/pipeline.test.ts`.
- Run `npm run compile`.
- If docs or package contribution behavior changes, run the narrow affected tests, for example `npm test -- --run test/packageContributions.test.ts test/setupValidator.test.ts`.

## Follow-Up Question

Should saved workspace files that omit reporting tools be auto-normalized on scan, or only updated when the user explicitly runs `Agent Flow: Generate Files` or edits the node? Default recommendation: inject on generation and webview save first, then consider scan-time normalization only if operators still see stale pipelines.

## Operational Handoff

Recipient: `engineer-agent`

Context: Issue #246 is shaped as a P0 implementation task. Agent Flow already has the activity tools and storage path; the missing product behavior is deterministic injection of reporting tools and safe guidance into generated workflow content.

Next action: Implement the acceptance criteria above, keeping the current underscore tool ids and adding focused generator tests.

Traceable artifact: `ticket-inject-agent-flow-activity-reporting-into-generated-prompts-agents-instr`, GitHub issue #246.
