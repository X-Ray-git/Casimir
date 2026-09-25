# Casimir architecture

## Purpose

Casimir is a personal Manifest V3 Chrome extension for small, explicit research-reading and ChatGPT workflow automations. It currently performs four jobs:

1. Redirect a first visit from an arXiv abstract or matched DAIR.AI paper page
   to its PDF, using shared PDF visit history across sources.
2. Turn a newly created blank Chrome Split View pane beside a supported paper into ChatGPT.
3. Attach the exact arXiv, alphaXiv, Nature, ACL Anthology, or OpenReview paper content to the paired ChatGPT composer without entering a prompt or sending a message, with scoped MHTML capture for supported page-based fallbacks.
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

Runs at `document_start` on arXiv abstract pages and at `document_idle` on
DAIR.AI paper detail pages. It normalizes the paper ID by removing a trailing
version suffix and checks shared local PDF visit history. An unseen arXiv abstract
replaces `/abs/` with `/pdf/`. An unseen DAIR.AI page must contain an arXiv PDF
link whose normalized ID exactly matches the ID suffix in the current DAIR.AI URL;
it uses ordinary navigation so Back returns to a now-preserved DAIR.AI page.

The service worker also records arXiv PDF URLs observed in tab navigation, so a
PDF opened directly or from another source suppresses later automatic redirects.
This history remains separate from the old Tampermonkey script.

### `arxiv-split-view.js`

The service worker listens for newly created tabs and waits briefly for Chrome to assign a valid `splitViewId`. A candidate is accepted only when:

- it was created recently;
- it remains in the original window;
- it belongs to a real Split View;
- its URL is still a recognized blank or Chrome Split View placeholder page; and
- another tab in the same Split View resolves to a supported paper PDF.

Before navigating the blank pane, the worker stores a short-lived attachment task keyed by the exact target tab ID. It then navigates that tab directly to `https://chatgpt.com/`.

Each candidate allows only one evaluation in flight, starting before the first
asynchronous lookup and ending after navigation or failure cleanup. Overlapping
tab events cannot repeat navigation or delete another evaluation's upload task;
an unsuccessful evaluation releases the guard so later events can retry.

The same worker accepts a named runtime port from the ChatGPT upload content script. It validates the sender tab by looking up only that tab's pending task, fetches the public PDF without credentials, checks its type and size, and streams base64-encoded chunks over the port. Strictly matched Nature PDF requests add Nature's same-origin `error=cookies_not_supported` return hint so a public file can be reached without following the initial redirect through `idp.nature.com`; the response still must identify itself as a PDF. For an alphaXiv blog or any Nature body-PDF URL, a failed fetch or non-PDF response falls back to `pageCapture.saveAsMHTML()` on the exact source tab. Nature filename conventions are not treated as proof of whether a PDF is public.

### `paper-source.js`

Runs only on alphaXiv paper routes, Nature article routes, ACL Anthology paper routes,
OpenReview forum routes, and X Article routes. alphaXiv PDFs are
resolved from validated `citation_pdf_url` metadata; blog pages also expose a
linked original-paper candidate, their page type, and title. Nature PDFs are resolved
from the semantic body-PDF download link rather than supplemental-material
links or the site's misleading citation PDF URL. Both public `_reference.pdf`
links and normal article `.pdf` links must exactly match the current article
identifier. Resolved URLs are validated again by the service worker against the
source page hostname and path contract.
ACL Anthology uses its canonical `citation_pdf_url`, which must be the current
paper ID plus `.pdf` at the site root. OpenReview uses the same metadata, whose
`/pdf?id=` value must exactly equal the current `/forum?id=` value. These rules
exclude ACL checklists and attachments as well as PDFs from other OpenReview notes.
Because OpenReview may require its browser challenge or site session even for a
paper PDF, only this exact forum-matched request uses `credentials: "include"`.
The extension never reads cookie values, and all other PDF sources continue to
use `credentials: "omit"`.
For X, it verifies that the dedicated Article container and a substantial rendered
body are present; ordinary posts and unrendered loading shells remain unsupported.

### `chatgpt-pdf-upload.js`

Runs on ChatGPT and claims a pending attachment task for its own tab. Tabs without a matching task receive no data and exit immediately.

Chrome may retain address-bar focus after Split View navigation. Browser-focus
restoration waits for composer readiness, validates the exact active split target,
and uses a short-lived debugger connection to bring the page forward and focus
the composer. The required `debugger` manifest permission has been added with
user approval. On 2026-09-17 the user reported success in Chrome, with worker logs
confirming `focused: true`, detachment, and PDF transfer. This is a verified case,
not a guarantee across Chrome versions; simulated tests alone cannot validate native focus.
Readiness waits for both upload controls and the visible prompt; attachment completion
does not disconnect the port until that bounded preparation finishes. Page interaction
or a transition to hidden cancels preparation. Offers, requests, and preparation
skips are logged in the service worker alongside browser-focus results.

For a matching task, the script:

1. Receives PDF or MHTML metadata and chunks.
2. Reconstructs a browser `File` in memory.
3. Waits for the legacy unified composer or `form[data-chatgpt-composer]`, then selects its general file input (legacy `#upload-files` or an input without an `accept` restriction). Image/video-only pickers are excluded.
4. Assigns the file with `DataTransfer`.
5. Dispatches `input` and `change` so ChatGPT performs its normal upload.
6. Waits up to about 20 seconds for the semantic attachment tile. Missing DOM
   confirmation produces an uncertainty notice, never an automatic replay of
   `change`: the first event may already have added the file. Duplicate transfer
   completion messages are ignored.

The new layout uses `[data-composer-markdown][contenteditable="true"][role="textbox"]`
inside `form[data-chatgpt-composer]` instead of `#prompt-textarea`. Content scripts
and debugger focus expressions support both contracts. Attachment confirmation
accepts the filename or its numbered variant (e.g. `paper(5).pdf`) as an
`aria-label` on a group or a `button[type="button"]` inside the composer.
The matching count must increase from the pre-upload baseline; existing cards,
removal buttons and filenames elsewhere do not confirm the new attachment.
Sidebar shortcuts also recognize buttons controlling `app-shell-sidebar` or
`browser-sidebar-popover`, retaining the legacy selectors.

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
File → DataTransfer → composer general file input → input/change
    │
    ▼
ChatGPT displays and uploads the attachment
```

## Storage

### `chrome.storage.local`

| Key | Owner | Value | Lifetime |
| --- | --- | --- | --- |
| `arxivVisitedPaperIds` | arXiv/DAIR.AI first visit and service worker | Array of normalized arXiv PDF IDs | Until extension data is cleared |
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
- `pageCapture` captures a matched X Article directly, and captures the matched
  alphaXiv or Nature tab when its PDF fetch fails or returns non-PDF content.
- `storage` is used for user settings, visit history, and short-lived handoff records.
- `https://arxiv.org/*` permits the first-visit script and background PDF fetch.
- `https://www.alphaxiv.org/*` permits alphaXiv metadata resolution and public PDF fetches.
- `https://cdn.openai.com/*` permits the currently supported alphaXiv blog's trusted original-paper fetch without granting all-sites access.
- `https://www.nature.com/*` permits Nature body-PDF link resolution, public PDF
  fetches through its same-origin no-cookie return path, and exact-tab capture of
  already-rendered article content. No permission is granted to `idp.nature.com`.
- `https://aclanthology.org/*` permits canonical public paper-PDF resolution and fetches.
- `https://openreview.net/*` permits forum-matched paper-PDF resolution and the
  same-site request needed to satisfy OpenReview's browser access checks.
- `https://x.com/*` permits rendered X Article validation and exact-tab capture; ordinary status routes are rejected.
- `https://chatgpt.com/*` permits ChatGPT content scripts.

Attachment bytes travel only in extension memory from the supported source to the exact paired ChatGPT tab. ChatGPT then handles the actual external upload. Casimir does not retain the attachment, write it to disk, read or reuse Nature login credentials, bypass access controls, or send a message. An MHTML attachment contains the alphaXiv, Nature, or X page content and resources rendered at capture time.

## Limits and brittle interfaces

- Chrome 140 or newer is required for `tabs.splitViewId`.
- Native Split View behavior is currently tested on macOS.
- A PDF or MHTML transfer is capped at 100 MB.
- A pending transfer expires after two minutes.
- Nature body PDFs are always tried without credentials. When the response is not
  a valid PDF, Casimir captures only the content already rendered in the exact
  source tab; a preview page therefore remains a preview.
- alphaXiv, Nature, ACL Anthology, and OpenReview resolution depend on current
  metadata or semantic download-link contracts.
- X Article support depends on its dedicated semantic `<article>` remaining available after rendering.
- ChatGPT file attachment depends on semantic composer/file-input DOM contracts; both the legacy and September 2026 layouts are supported.
- ChatGPT keyboard actions depend on a small set of current test IDs and accessibility labels.
- Automatic conversation-history rate-limit acknowledgement depends on its
  dedicated modal test ID and single-action dialog structure.

When ChatGPT changes its DOM, prefer a deterministic URL or stable input contract over positional selectors and visible text.
