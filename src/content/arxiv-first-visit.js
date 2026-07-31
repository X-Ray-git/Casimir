(() => {
  "use strict";

  const LOG_PREFIX = "[casimir:arxiv-first-visit]";
  const STORAGE_KEY = "arxivVisitedPaperIds";

  function getPaperId(pathname) {
    const match = pathname.match(/^\/abs\/([^/?#]+)/);
    return match?.[1]?.replace(/v\d+$/i, "") || null;
  }

  function pdfUrlFor(location) {
    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/^\/abs\//, "/pdf/");
    return url.href;
  }

  async function redirectOnFirstVisit() {
    const paperId = getPaperId(window.location.pathname);
    if (!paperId) return;

    let stored;
    try {
      stored = await chrome.storage.local.get(STORAGE_KEY);
    } catch (error) {
      console.error(LOG_PREFIX, "Failed to read visit history.", error);
      return;
    }

    const visited = Array.isArray(stored[STORAGE_KEY])
      ? stored[STORAGE_KEY]
      : [];

    if (visited.includes(paperId)) {
      console.log(LOG_PREFIX, "Already visited; preserving abstract page.", {
        paperId,
      });
      return;
    }

    const nextVisited = [...visited, paperId];
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: nextVisited });
    } catch (error) {
      console.error(LOG_PREFIX, "Failed to save visit history.", error);
      return;
    }

    const targetUrl = pdfUrlFor(window.location);
    console.log(LOG_PREFIX, "First visit; redirecting to PDF.", {
      paperId,
      targetUrl,
    });
    window.location.replace(targetUrl);
  }

  void redirectOnFirstVisit();
})();
