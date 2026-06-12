# Publishing

This guide covers Marketplace packaging and release hygiene for Agent Flow Studio.

## Marketplace Package

Build the uploadable Marketplace package with:

```bash
npm run package:marketplace
```

The script builds the extension and creates:

```txt
copilot-agent-flow-studio.vsix
```

The package includes the compiled extension, webview assets, Marketplace icon, preview GIF, README, changelog, license, support file, and user-facing docs. It excludes source, tests, smoke fixtures, examples, local `.github` customization files, local Playwright capture output, and development-only scripts.

## Version Bump Hook

The repository uses a Husky `pre-push` hook to patch the extension version before pushing.

The hook:

1. Requires a clean working tree.
2. Runs `npm version patch --no-git-tag-version`.
3. Commits the updated `package.json` and `package-lock.json`.
4. Stops the current push.
5. Asks you to run `git push` again so the generated version commit is included intentionally.

Bypass the hook only when explicitly needed:

```bash
AGENTFLOW_SKIP_VERSION_BUMP=1 git push
```

## Pre-Publish Checklist

Before publishing a new VSIX:

1. Run `npm run check`.
2. Run `npm run package:marketplace`.
3. Install the generated VSIX in a clean VS Code window.
4. Open a disposable workspace and run `Agent Flow: Create Default Pipeline`.
5. Run `Agent Flow: Open Pipeline`.
6. Confirm nodes, edges, diagnostics, tool selection, auto-save, and Markdown references behave as expected.
7. Confirm `README.md`, `CHANGELOG.md`, `LICENSE`, `SUPPORT.md`, `media/icon.png`, and `media/agent-flow-preview.gif` are present in the VSIX.

Inspect package contents with:

```bash
unzip -l copilot-agent-flow-studio.vsix
```
