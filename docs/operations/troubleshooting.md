# Casimir troubleshooting

## First checks

1. Open `chrome://extensions/` and confirm Casimir is enabled.
2. Confirm the displayed version matches `manifest.json` and the README.
3. Reload Casimir after source changes.
4. Refresh already-open ChatGPT and arXiv tabs.
5. Keep the old Tampermonkey counterparts disabled while testing Casimir.

## Log locations

### Service worker

Open Casimir's Service Worker inspector from `chrome://extensions/`.

Main prefix:

```text
[casimir:arxiv-split-view]
```

Successful Split View and PDF flow:

```text
[onCreated]
[splitView detected]
[matched arxiv]
[update to ChatGPT]
[PDF transferred]
```

Failures and safe skips use:

```text
[skip]
[update failed]
[PDF transfer failed]
```

### ChatGPT page

Open the ChatGPT tab's DevTools console.

Prefixes:

```text
[casimir:chatgpt-shortcuts]
[casimir:chatgpt-pdf-upload]
```

### arXiv page

Prefix:

```text
[casimir:arxiv-first-visit]
```

## Split View does not open ChatGPT

Check that:

- Chrome is version 140 or newer.
- The source URL begins with `https://arxiv.org/pdf/`.
- `Cmd+Option+N` creates Chrome's native Split View rather than a normal tab.
- The new pane was blank and created less than three seconds before Chrome exposed its Split View state.

Look for `[skip]` and its `reason` field in the service-worker console.

## ChatGPT opens but the PDF is missing

1. Check the ChatGPT page for a Casimir status message.
2. Check the service worker for `[PDF transferred]` or `[PDF transfer failed]`.
3. Confirm the PDF is no larger than 50 MB.
4. Confirm the ChatGPT page loaded within the two-minute task lifetime.
5. Inspect the ChatGPT DOM for a file input with ID `upload-files`.

If the worker reports a successful transfer but the attachment is absent, ChatGPT likely changed its file-input DOM or event handling. Capture the page URL, Casimir version, ChatGPT console logs, and the current file-input markup.

## The wrong ChatGPT tab receives a PDF

This should be prevented by the session key `pendingPdfUpload:<targetTabId>`. Record:

- source arXiv URL;
- target and unexpected ChatGPT URLs;
- `[matched arxiv]` details;
- `[PDF transferred]` details.

Do not weaken the tab-ID binding as a workaround.

## `Cmd/Ctrl+O` opens an existing conversation

Version 0.3.1 and later navigate directly to `https://chatgpt.com/` and no longer click sidebar links. Confirm the extension version and refresh the affected ChatGPT tab after reloading.

## A shortcut does nothing

- Refresh the ChatGPT page after reloading Casimir.
- Check for another extension or enabled userscript using the same shortcut.
- Inspect `[casimir:chatgpt-shortcuts]` warnings.
- For custom shortcuts, reopen `Cmd/Ctrl+Shift+,` and confirm the entry was saved.

## arXiv repeatedly redirects

Casimir stores normalized IDs in `arxivVisitedPaperIds`. The Tampermonkey script has separate storage, so do not enable both implementations simultaneously.

If local extension data was cleared or the extension was uninstalled, papers will be considered unseen again.

## Information to include in a bug report

- Casimir version.
- Chrome version and operating system.
- Triggering page URL.
- Expected and actual behavior.
- Relevant `[casimir:...]` logs.
- Whether the extension was reloaded and the page refreshed.
