# Graph Visual Grammar

This guide defines the shared visual rules for Agent Flow graph nodes, edges, badges, labels, activity, and recovery states. Changes to graph rendering should preserve these contracts before adding local exceptions.

## Type Color

- A node type uses one color across the graph border, token badge, inspector type badge, and related accents.
- Edge markers inherit the target node type color so direction and destination type reinforce each other.
- Colors must keep basic contrast against the VS Code dark editor background and remain distinguishable in high-contrast mode.

## Reserved Regions

- Node cards reserve separate regions for metadata, title/body, and status.
- Token badges live in the metadata region and never overlap the title.
- Activity chips, dirty markers, stale markers, and warning badges live in the status region.
- Long labels wrap or truncate inside the body region and expose the full value through a tooltip.
- Secondary nodes, including handoff nodes and reference-like nodes, may be smaller than primary work nodes but must remain clickable and keyboard accessible.

## Edge Label Visibility

- Edge direction is always visible through the path and marker.
- Handoff and primary flow labels may stay subtle in the default overview.
- Support labels for artifact, instruction, role, skill, and reference edges use the shared `edgeLabelVisibilityClass` helper and are hidden until hover, focus, selection, or activity makes them useful.
- Edge labels must be placed outside source and target node bounds and should not compete with node text, token badges, or activity chips.

## Activity States

- Fresh activity is bright, temporary, and tied to the active edge or node.
- Recent activity is subdued and can remain in node status or the activity trail.
- Stale activity moves to history/timeline surfaces and should not occupy prime label space.
- Active handoff, read, write, artifact, and error states use distinct classes rather than one generic animation.

## Debug And Recovery

- Empty, loading, recovery, and debug states use VS Code panel language and explain what state the graph is in.
- Debug overlays should not cover important graph content by default.
- Recovery actions must be explicit, such as fit graph, open diagnostics, scan workspace, or copy debug snapshot.
