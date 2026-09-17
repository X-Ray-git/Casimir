# Casimir troubleshooting

## First checks

1. Open `chrome://extensions/` and confirm Casimir is enabled.
2. Confirm the displayed version matches `manifest.json` and the README.
3. Reload Casimir after source changes.
4. Refresh already-open ChatGPT, arXiv, and supported source tabs.
5. Keep the old Tampermonkey counterparts disabled while testing Casimir.

## Log locations

### Service worker

Open Casimir's Service Worker inspector from `chrome://extensions/`.

Main prefix:

```text
[casimir:paper-split-view]
```

Successful Split View and PDF flow:

```text
[onCreated]
[splitView detected]
[matched paper]
[update to ChatGPT]
[PDF transferred]
[MHTML transferred]
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
[casimir:chatgpt-attachment-upload]
```

### arXiv or DAIR.AI page

Prefix:

```text
[casimir:arxiv-first-visit]
```

## Split View does not open ChatGPT

Check that:

- Chrome is version 140 or newer.
- The source is an arXiv PDF, an alphaXiv `/abs/` or `/pdf/` paper, a Nature
  article with a semantic body-PDF download link, an ACL Anthology paper page,
  an OpenReview `/forum?id=...` page, or a fully rendered X Article at
  `x.com/<account>/article/<numeric-id>`.
- `Cmd+Option+N` creates Chrome's native Split View rather than a normal tab.
- The new pane was blank and created less than three seconds before Chrome exposed its Split View state.

Look for `[skip]` and its `reason` field in the service-worker console.

## ChatGPT opens but the attachment is missing

Repeated `[matched paper]` messages for the same target followed by one
`[update to ChatGPT]` and `Navigation rejected.` errors can indicate an older
concurrent-evaluation bug: a failed duplicate navigation removed the pending
upload task, so ChatGPT showed no attachment status. Reload Casimir with the
fixed source and create a fresh split pane; refreshing the old ChatGPT pane
cannot restore a deleted task. The worker now serializes candidate evaluation.

## ChatGPT opens but the address bar keeps focus

This is separate from attachment transfer. In the user's Chrome, a fresh native
split beside `https://arxiv.org/pdf/2609.17523` successfully displayed the PDF
attachment while the address bar remained selected. Page-level focus requests
and an extension redirect bridge did not resolve it; the bridge also caused a
white flash and has been removed. Direct navigation is restored. The current
browser-level focus implementation was reported working by the user on 2026-09-17,
with logs confirming focus and debugger detachment. If it is skipped or fails,
clicking the composer remains a manual fallback. The Node harness does not exercise
Chrome's native focus.

For browser-level focus, keep the worker inspector open **before**
creating a fresh split. The console now records `[composer focus offered]` (including
whether the loaded manifest enables the feature), `[composer focus requested]`,
or `[composer focus preparation skipped]` with a cancellation/timeout reason.
Subsequent `[composer focus skipped]`, `[composer focus failed]`, `[composer focus]`,
and `[composer focus detached]` describe the browser step. A successful PDF transfer
alone does not prove focus succeeded. Query `chrome.runtime.getManifest().permissions`
in the worker console to check the manifest actually loaded by Chrome.

## Attachment checks

1. Check the ChatGPT page for a Casimir status message.
2. Check the service worker for `[PDF transferred]`, `[MHTML transferred]`, or `[PDF transfer failed]`.
3. Confirm the PDF or MHTML is no larger than Casimir's 100 MB automatic transfer limit.
4. Confirm the ChatGPT page loaded within the two-minute task lifetime.
5. For alphaXiv papers, confirm `citation_pdf_url` points to an alphaXiv `/abs/*.pdf` URL.
   For alphaXiv blogs, look for `[PDF unavailable; capturing MHTML]` when the trusted linked PDF fails.
6. For Nature, confirm the article has a `data-test="download-pdf"` body-PDF link.
   Any HTTP failure or non-PDF response should log
   `[PDF unavailable; capturing MHTML]` before the exact Nature tab is captured.
7. For ACL Anthology, confirm `citation_pdf_url` is the current paper ID plus `.pdf`.
   For OpenReview, confirm its PDF `id` exactly matches the current forum `id`.
8. For X Article, confirm the page shows the full article heading and body; ordinary `/status/`
   pages intentionally do not trigger.
9. Inspect the ChatGPT DOM for a file input with ID `upload-files`.

If the worker reports a successful transfer but the attachment is absent, ChatGPT likely changed its file-input DOM or event handling. Capture the page URL, Casimir version, ChatGPT console logs, and the current file-input markup.

## The wrong ChatGPT tab receives a PDF

This should be prevented by the session key `pendingPdfUpload:<targetTabId>`. Record:

- source paper URL;
- target and unexpected ChatGPT URLs;
- `[matched paper]` details;
- `[PDF transferred]` details.

Do not weaken the tab-ID binding as a workaround.

## `Cmd/Ctrl+O` opens an existing conversation

Version 0.3.1 and later navigate directly to `https://chatgpt.com/` and no longer click sidebar links. Confirm the extension version and refresh the affected ChatGPT tab after reloading.

## A shortcut does nothing

- Refresh the ChatGPT page after reloading Casimir.
- Check for another extension or enabled userscript using the same shortcut.
- Inspect `[casimir:chatgpt-shortcuts]` warnings.
- For custom shortcuts, reopen `Cmd/Ctrl+Shift+,` and confirm the entry was saved.

## arXiv or DAIR.AI repeatedly redirects

Casimir stores normalized arXiv PDF IDs in `arxivVisitedPaperIds`. Opening an
arXiv PDF directly, from an arXiv abstract, or from a matching DAIR.AI paper page
uses the same record. On DAIR.AI, the page URL suffix and its arXiv PDF link must
contain the same ID; mismatched pages are preserved without redirecting.

The Tampermonkey script has separate storage, so do not enable both implementations simultaneously.

If local extension data was cleared or the extension was uninstalled, papers will be considered unseen again.

## Information to include in a bug report

- Casimir version.
- Chrome version and operating system.
- Triggering page URL.
- Expected and actual behavior.
- Relevant `[casimir:...]` logs.
- Whether the extension was reloaded and the page refreshed.
