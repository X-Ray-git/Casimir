# Casimir architecture

## Purpose

Casimir is a personal Manifest V3 Chrome extension for small, explicit research-reading and ChatGPT workflow automations. It currently performs four jobs:

1. Redirect an arXiv abstract page to its PDF on the first visit to a paper.
2. Turn a newly created blank Chrome Split View pane beside a supported paper into ChatGPT.
3. Attach the exact arXiv, alphaXiv, or public Nature body PDF to the paired ChatGPT composer without entering a prompt or sending a message, with an MHTML fallback for alphaXiv blogs whose paper PDF is unavailable.
4. Capture a rendered X Article directly as MHTML for the paired ChatGPT composer.

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
│       ├── paper-source.js
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
- another tab in the same Split View resolves to a supported paper PDF.

Before navigating the blank pane, the worker stores a short-lived attachment task keyed by the exact target tab ID. It then navigates that tab to `https://chatgpt.com/`.

The same worker accepts a named runtime port from the ChatGPT upload content script. It validates the sender tab by looking up only that tab's pending task, fetches the public PDF without credentials, checks its type and size, and streams base64-encoded chunks over the port. For an alphaXiv blog, it prefers a trusted linked paper PDF; if that fetch fails, `pageCapture.saveAsMHTML()` captures the exact source tab and streams the snapshot instead.

### `paper-source.js`

Runs only on alphaXiv paper routes, Nature article routes, and X Article routes. alphaXiv PDFs are
resolved from validated `citation_pdf_url` metadata; blog pages also expose a
linked original-paper candidate, their page type, and title. Nature PDFs are resolved
from the semantic body-PDF download link rather than supplemental-material
links or the site's misleading citation PDF URL. Resolved URLs are validated
again by the service worker against the source page hostname and path contract.
For X, it verifies that the dedicated Article container and a substantial rendered
body are present; ordinary posts and unrendered loading shells remain unsupported.

### `chatgpt-pdf-upload.js`

Runs on ChatGPT and claims a pending attachment task for its own tab. Tabs without a matching task receive no data and exit immediately.

For a matching task, the script:

1. Receives PDF or MHTML metadata and chunks.
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
supported paper tab
    │
    │ Cmd+Option+N
    ▼
new blank Split View tab
    │
    │ service worker validates splitViewId and resolves the peer PDF
    ▼
chrome.storage.session[pendingPdfUpload:<targetTabId>]
    │
    ├── target tab navigates to chatgpt.com
    │
    ▼
ChatGPT content script claims its exact tab task
    │
    ▼
service worker fetches the public PDF without credentials and streams chunks
    │
    ├── alphaXiv blog only: failed PDF → capture exact source tab as MHTML
    ├── X Article: capture exact source tab directly as MHTML
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
| `pendingPdfUpload:<tabId>` | service worker | Source URL, exact source tab, fallback metadata, and creation timestamp | Consumed once, expires after two minutes, or cleared when the tab closes |

Session storage allows the task to survive Manifest V3 service-worker suspension without persisting it across a browser restart.

## In-memory state

The service worker keeps recent candidate tabs, processed tab IDs, and retry timers in memory. Losing this state after service-worker suspension is safe: only the short-lived PDF handoff must survive, and it is stored in session storage.

## Permissions and trust boundaries

- `tabs` is used to inspect tab URLs and `splitViewId`, query Split View peers, and navigate the qualifying blank pane.
- `pageCapture` captures a matched X Article directly, or the matched alphaXiv
  blog tab after its paper PDF fails.
- `storage` is used for user settings, visit history, and short-lived handoff records.
- `https://arxiv.org/*` permits the first-visit script and background PDF fetch.
- `https://www.alphaxiv.org/*` permits alphaXiv metadata resolution and public PDF fetches.
- `https://cdn.openai.com/*` permits the currently supported alphaXiv blog's trusted original-paper fetch without granting all-sites access.
- `https://www.nature.com/*` permits Nature body-PDF link resolution and public PDF fetches.
- `https://x.com/*` permits rendered X Article validation and exact-tab capture; ordinary status routes are rejected.
- `https://chatgpt.com/*` permits ChatGPT content scripts.

Attachment bytes travel only in extension memory from the supported source to the exact paired ChatGPT tab. ChatGPT then handles the actual external upload. Casimir does not retain the attachment, write it to disk, reuse Nature login credentials, bypass access controls, or send a message. An MHTML attachment contains the alphaXiv or X page content and resources rendered at capture time.

## Limits and brittle interfaces

- Chrome 140 or newer is required for `tabs.splitViewId`.
- Native Split View behavior is currently tested on macOS.
- A PDF or MHTML transfer is capped at 100 MB.
- A pending transfer expires after two minutes.
- Nature support is limited to body PDFs downloadable without authentication.
- alphaXiv and Nature resolution depend on current metadata and semantic download-link contracts.
- X Article support depends on its dedicated semantic `<article>` remaining available after rendering.
- ChatGPT file attachment depends on the current `#upload-files` DOM contract.
- ChatGPT keyboard actions depend on a small set of current test IDs and accessibility labels.
- Automatic conversation-history rate-limit acknowledgement depends on its
  dedicated modal test ID and single-action dialog structure.

When ChatGPT changes its DOM, prefer a deterministic URL or stable input contract over positional selectors and visible text.
