# Changelog

All notable Casimir changes are recorded here. Versions before the repository split
were developed under the ChatFlow name.

## Unreleased

### Added

- Attach PDFs from alphaXiv special-paper pages and publicly downloadable Nature
  articles through the existing exact-tab Split View workflow.
- Prefer an alphaXiv blog's trusted original-paper link and fall back to an
  in-memory MHTML snapshot of the matched page when that PDF is unavailable.
- Capture a fully rendered X Article directly as MHTML through the exact-tab
  Split View workflow while ignoring ordinary X posts.

### Fixed

- Support Nature article pages whose PDF link depends on the reader's current
  institutional access by capturing the rendered page as MHTML, and fall back
  to the same exact-tab capture when a public Nature PDF cannot be fetched.

## [0.5.0] - 2026-08-12

### Changed

- Extract the extension from the `workflow-tools` monorepo into the independent
  Casimir repository.
- Rename the extension and its internal log and storage namespaces from ChatFlow
  to Casimir.
- Add standalone project scripts, manifest validation, packaging, CI, and a
  maintenance-oriented documentation index.
- Add a macOS-style rounded Casimir icon and the standard Chrome extension icon
  sizes.
- Adopt the MIT License for the independent public repository.
- Align the extension, package, and GitHub descriptions with Casimir's focused
  arXiv and ChatGPT positioning.
- Raise Casimir's automatic PDF transfer limit from 50 MB to 100 MB and clarify
  that it is separate from ChatGPT's file limit.

### Fixed

- Restore `Cmd/Ctrl+Shift+N` on the current Chinese ChatGPT UI by recognizing
  its neutral `临时聊天` and `临时对话` button labels.
- Automatically dismiss PDF fetch and attachment error messages after five
  seconds instead of leaving them permanently over the ChatGPT page.
- Confirm that ChatGPT renders the PDF attachment and replay a missed upload
  event once instead of reporting success before the composer accepts the file.

### Added

- Automatically acknowledge ChatGPT's dedicated conversation-history
  rate-limit notice while leaving other dialogs untouched.

## [0.4.1] - 2026-07-25

### Fixed

- Make `Cmd/Ctrl+O` use ChatGPT's active native new-chat entry for smooth in-app navigation, while ignoring inert or hidden duplicates and retaining direct navigation as a fallback.
- Consume pending custom prompts after ChatGPT's native SPA new-chat transition without relying on a page reload.
- Insert custom prompts via a synthetic `paste` event instead of `execCommand("insertText")`, matching ChatGPT's native paste path and preventing the page from freezing on long prompts.

## [0.4.0] - 2026-07-22

### Added

- Fetch the matched public arXiv PDF after creating a native Chrome Split View.
- Transfer PDF bytes in base64-encoded chunks from the service worker to the exact paired ChatGPT tab.
- Attach the reconstructed `File` to ChatGPT's `#upload-files` input without entering a prompt or sending a message.
- Display lightweight fetching, success, and failure status messages on ChatGPT.
- Expire pending PDF tasks after two minutes and reject files larger than 50 MB.
- Add background transfer and ChatGPT file-input regression tests.

### Changed

- Document that Split View now prepares both ChatGPT and the source PDF attachment.

## [0.3.1] - 2026-07-22

### Fixed

- Make `Cmd/Ctrl+O` navigate directly to `https://chatgpt.com/` instead of clicking one of several duplicated sidebar links.
- Preserve custom prompts across a new-chat navigation with a short-lived local pending-prompt record.

## [0.3.0] - 2026-07-16

### Added

- Add the ChatGPT shortcut content script.
- Support new chat, prompt focus, sidebar toggle, and temporary chat shortcuts.
- Add a local custom shortcut and prompt settings panel opened with `Cmd/Ctrl+Shift+,`.
- Support `{{clipboard}}` substitution and optional new-chat behavior for custom prompts.

## [0.2.0] - 2026-07-16

### Added

- Migrate the arXiv first-visit redirect into ChatFlow.
- Store visited arXiv paper IDs locally and treat paper versions as the same paper.
- Restore the arXiv and ChatGPT host permissions used by the proven Split View implementation.

## [0.1.0] - 2026-07-16

### Added

- Establish the ChatFlow Manifest V3 extension structure.
- Migrate the original arXiv Split View to ChatGPT service worker.
- Add tests for positive, delayed, and defensive Split View scenarios.
