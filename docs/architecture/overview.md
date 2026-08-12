# Casimir architecture

## Purpose

Casimir is a personal Manifest V3 Chrome extension for small, explicit arXiv and ChatGPT workflow automations. It currently performs three jobs:

1. Redirect an arXiv abstract page to its PDF on the first visit to a paper.
2. Turn a newly created blank Chrome Split View pane beside an arXiv PDF into ChatGPT.
3. Attach that exact arXiv PDF to the paired ChatGPT composer without entering a prompt or sending a message.

ChatGPT keyboard shortcuts and local custom prompt shortcuts are a separate page-level module.

## Repository layout

```text
Casimir/
├── manifest.json
├── package.json
├── assets/
│   ├── icon.svg
│   ├── readme-icon.png
│   └── icons/
├── src/
│   ├── background/
│   │   └── arxiv-split-view.js
│   └── content/
│       ├── arxiv-first-visit.js
│       ├── chatgpt-pdf-upload.js
│       ├── chatgpt-rate-limit-dismiss.js
│       └── chatgpt-shortcuts.js
├── tests/
├── scripts/
├── docs/
│   ├── architecture/
│   ├── operations/
│   └── status/
├── .github/workflows/
├── CHANGELOG.md
└── README.md
```

The repository root is also the unpacked-extension root. Source files need no
bundling or transpilation; packaging archives `manifest.json`, `src/`, and the
generated icon assets. `assets/icon.svg` is the editable icon source.

## Module responsibilities

### `arxiv-first-visit.js`

Runs at `document_start` on arXiv abstract pages. It normalizes the paper ID by removing a trailing version suffix, checks local visit history, records an unseen paper, and replaces `/abs/` with `/pdf/`.

It never runs on PDF pages and does not share visit history with the old Tampermonkey script.

### `arxiv-split-view.js`

The service worker listens for newly created tabs and waits briefly for Chrome to assign a valid `splitViewId`. A candidate is accepted only when:

- it was created recently;
- it remains in the original window;
- it belongs to a real Split View;
- its URL is still a recognized blank or Chrome Split View placeholder page; and
- another tab in the same Split View is an `https://arxiv.org/pdf/` URL.

Before navigating the blank pane, the worker stores a short-lived PDF task keyed by the exact target tab ID. It then navigates that tab to `https://chatgpt.com/`.

The same worker accepts a named runtime port from the ChatGPT upload content script. It validates the sender tab by looking up only that tab's pending task, fetches the public PDF, checks its type and size, and streams base64-encoded chunks over the port.

### `chatgpt-pdf-upload.js`

Runs on ChatGPT and claims a pending PDF task for its own tab. Tabs without a matching task receive no data and exit immediately.

For a matching task, the script:

1. Receives PDF metadata and chunks.
2. Reconstructs a browser `File` in memory.
3. Waits for ChatGPT's unified composer and `#upload-files` input.
4. Assigns the file with `DataTransfer`.
5. Dispatches `input` and `change` so ChatGPT performs its normal upload.
6. Confirms the semantic attachment tile appears, replaying one missed `change`
   event before reporting a failure.

It does not inspect conversation messages, fill the prompt, click the send button, or call a private ChatGPT upload endpoint.

### `chatgpt-shortcuts.js`

Captures the documented Casimir keyboard combinations before the page handles them. Site actions are isolated in small DOM adapters. New-chat navigation deliberately uses the stable ChatGPT root URL rather than clicking one of several duplicated responsive sidebar elements.

The settings panel is rendered in a Shadow DOM host to avoid leaking styles into ChatGPT.

### `chatgpt-rate-limit-dismiss.js`

Observes ChatGPT for the dedicated
`data-testid="modal-conversation-history-rate-limit"` notice. When its open
dialog contains exactly one enabled action, the script clicks that native
acknowledgement button. It does not inspect conversation content, dismiss other
dialogs, poll conversation history, or claim to know when the server-side limit
has ended.

## Split View and PDF data flow

```text
arXiv PDF tab
    │
    │ Cmd+Option+N
    ▼
new blank Split View tab
    │
    │ service worker validates splitViewId and peer PDF
    ▼
chrome.storage.session[pendingPdfUpload:<targetTabId>]
    │
    ├── target tab navigates to chatgpt.com
    │
    ▼
ChatGPT content script claims its exact tab task
    │
    ▼
service worker fetches arXiv PDF and streams chunks
    │
    ▼
File → DataTransfer → #upload-files → input/change
    │
    ▼
ChatGPT displays and uploads the attachment
```

## Storage

### `chrome.storage.local`

| Key | Owner | Value | Lifetime |
| --- | --- | --- | --- |
| `arxivVisitedPaperIds` | arXiv first visit | Array of normalized paper IDs | Until extension data is cleared |
| `casimirCustomShortcuts` | ChatGPT shortcuts | Array of shortcut and prompt records | Until extension data is cleared |
| `casimirPendingPrompt` | ChatGPT shortcuts | Prompt plus creation timestamp | Consumed within 15 seconds |

### `chrome.storage.session`

| Key | Owner | Value | Lifetime |
| --- | --- | --- | --- |
| `pendingPdfUpload:<tabId>` | service worker | Source PDF URL plus creation timestamp | Consumed once, expires after two minutes, or cleared when the tab closes |

Session storage allows the task to survive Manifest V3 service-worker suspension without persisting it across a browser restart.

## In-memory state

The service worker keeps recent candidate tabs, processed tab IDs, and retry timers in memory. Losing this state after service-worker suspension is safe: only the short-lived PDF handoff must survive, and it is stored in session storage.

## Permissions and trust boundaries

- `tabs` is used to inspect tab URLs and `splitViewId`, query Split View peers, and navigate the qualifying blank pane.
- `storage` is used for user settings, visit history, and short-lived handoff records.
- `https://arxiv.org/*` permits the first-visit script and background PDF fetch.
- `https://chatgpt.com/*` permits ChatGPT content scripts.

PDF bytes travel only in extension memory from public arXiv to the exact paired ChatGPT tab. ChatGPT then handles the actual external upload. Casimir does not retain the PDF, write it to disk, or send a message.

## Limits and brittle interfaces

- Chrome 140 or newer is required for `tabs.splitViewId`.
- Native Split View behavior is currently tested on macOS.
- A PDF transfer is capped at 100 MB.
- A pending transfer expires after two minutes.
- ChatGPT file attachment depends on the current `#upload-files` DOM contract.
- ChatGPT keyboard actions depend on a small set of current test IDs and accessibility labels.
- Automatic conversation-history rate-limit acknowledgement depends on its
  dedicated modal test ID and single-action dialog structure.

When ChatGPT changes its DOM, prefer a deterministic URL or stable input contract over positional selectors and visible text.
