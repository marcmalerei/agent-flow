# Legacy Pipeline JSON Schema

Agent Flow now uses `.github` Markdown customization files as the source of truth. The old `.agent-pipeline/pipeline.json` format is retained only for development fixtures and migration fallback when a workspace has no `.github` customization files yet.

```json
{
  "version": 1,
  "name": "Default Agent Pipeline",
  "nodes": [],
  "edges": []
}
```

## Nodes

Legacy JSON nodes share:

- `id`: stable identifier used by edges and generated file names
- `type`: `agent`, `prompt`, `instruction`, `skill`, `role`, `artifact`, `gate`, `hook`, `handoff`, or `mcp-server`
- `label`: display label
- `description`: optional human-readable summary
- `position`: optional legacy canvas coordinates. Current webview layouts are calculated automatically and are not persisted.

## Edges

Legacy JSON edges use:

- `id`
- `from`
- `to`
- `kind`: `flow`, `artifact`, `prompt`, `skill`, `role`, `gate`, `handoff`, `hook`, `mcp-server`, or `instruction`
- `artifact`: optional artifact path
- `label`: optional display label

Prefer creating or editing the corresponding `.github` Markdown files instead of authoring this JSON directly.
