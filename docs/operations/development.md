# Casimir development

## Local installation

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the repository root, the directory containing `manifest.json`.

## Development reload cycle

After changing extension files:

1. Open `chrome://extensions/`.
2. Reload Casimir.
3. Refresh existing ChatGPT and arXiv tabs so updated content scripts are injected.
4. Repeat the target workflow.

Reload means the circular-arrow control on the **Casimir card**, not the page's
top-level **Update** button. For a fresh split test, opening a new source PDF and
creating a new blank pane avoids reusing old content scripts or consumed tasks.

Uninstalling is normally unnecessary and may clear local extension data.

## Verification

Run the complete standalone verification suite from the repository root:

```sh
npm ci
npm run check
```

The check command validates the Manifest and referenced files, checks JavaScript
syntax, and runs the Node test suite.

Run an individual layer when investigating a failure:

```sh
npm run check:manifest
npm run check:syntax
npm test
```

Build the distributable archive:

```sh
npm run package
```

The archive is written to `dist/casimir-<version>.zip`. The repository root
remains the canonical directory for unpacked development.

## Manual regression checklist

### arXiv first visit

- An unseen `/abs/` page redirects to `/pdf/`.
- A previously visited paper remains on `/abs/`.
- Versioned URLs are treated as the same paper.

### Split View

- arXiv PDF plus a newly created blank Split View pane opens ChatGPT.
- A normal webpage does not trigger ChatGPT.
- An existing webpage is never overwritten.
- An ordinary new tab outside Split View is never changed.

### PDF attachment

- The PDF appears in the exact paired ChatGPT tab.
- The original arXiv PDF remains unchanged.
- A progress or error status appears on ChatGPT.
- No prompt is inserted and no message is sent.
- Other already-open ChatGPT tabs receive no attachment.

### New-pane composer focus

- Keep the Casimir worker console open before creating the split; foreground the
  source Chrome window while ChatGPT loads.
- Without clicking ChatGPT, type disposable test text and confirm it enters the
  composer rather than the address bar; clear the text without sending it.
- Check focus, debugger detachment and attachment logs separately. A DOM-only
  focus result or a successful PDF transfer does not replace the keyboard check.
- Switching away or interacting during preparation must prevent late focus theft.
- See the [investigation record](2026-09-17-split-view-investigation.md) for failed
  approaches, test limitations and potential interference from other debuggers.

### shortcuts

- `Cmd/Ctrl+O` starts a new chat without a full-page reload and never opens an existing conversation.
- `Cmd/Ctrl+O` still opens the ChatGPT root when its native new-chat entry is unavailable.
- `Cmd/Ctrl+I` focuses the composer.
- `Cmd/Ctrl+L` toggles the sidebar.
- `Cmd/Ctrl+Shift+N` toggles temporary chat.
- `Cmd/Ctrl+Shift+,` opens the settings panel.
- A custom prompt and `{{clipboard}}` replacement still work.
- A custom shortcut configured to start a new chat inserts its prompt after the in-app transition.

## Versioning

Create a stable source checkpoint after a group of changes has been manually
verified. Casimir does not require a GitHub Release or Git tag while it is
installed directly from the repository.

Run `npm run version:set -- <major.minor.patch>` to update the three JSON
version fields together:

1. `manifest.json` version.
2. `package.json` and `package-lock.json` versions.

The manifest check rejects version drift between all three JSON files. Update
the version displayed in the README installation instructions and move the
accumulated changelog entries from `Unreleased` to a dated version section in
the same commit.

Use patch versions for compatible fixes, minor versions for new personal-toolbox capabilities, and major versions only for intentionally incompatible storage or workflow changes.

## Implementation guidelines

- Keep background, arXiv, ChatGPT shortcut, and ChatGPT upload responsibilities separated.
- Bind automation to exact tab IDs instead of searching globally for a ChatGPT tab.
- Preserve user pages unless a newly created tab is still explicitly blank.
- Prefer stable URLs, IDs, test IDs, and accessibility contracts over positional selectors.
- Do not call undocumented ChatGPT backend endpoints.
- Do not automatically send prompts without a separate explicit product decision.
- Add a defensive test whenever a DOM or event-order regression is fixed.

## Release and commit workflow

Casimir is currently loaded directly from this repository rather than published
to the Chrome Web Store. A normal stable-version checkpoint is:

1. Implement and test the change.
2. Update documentation and version metadata.
3. Reload and manually verify in Chrome.
4. Run `npm run package` and verify the generated archive can be loaded.
5. Commit the source, tests, and documentation together.
6. Push the branch.

Do not create a Git tag, GitHub Release, or store package unless the installation
strategy changes or the user explicitly requests one.
