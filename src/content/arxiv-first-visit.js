(() => {
  "use strict";

  const LOG_PREFIX = "[casimir:arxiv-first-visit]";
  const STORAGE_KEY = "arxivVisitedPaperIds";

  function normalizePaperId(candidate) {
    if (!candidate) return null;
    const withoutVersion = candidate.replace(/v\d+$/i, "");
    return /^\d{4}\.\d{4,5}$/.test(withoutVersion) ||
      /^[a-z-]+(?:\.[a-z-]+)?\/\d{7}$/i.test(withoutVersion)
      ? withoutVersion
      : null;
  }

  function getArxivAbstractPaperId(pathname) {
    const match = pathname.match(/^\/abs\/([^/?#]+)/);
    return normalizePaperId(match?.[1]);
  }

  function arxivPdfUrlFor(location) {
    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/^\/abs\//, "/pdf/");
    return url.href;
  }

  function resolveDairPaper() {
    const slugPaperId = normalizePaperId(
      window.location.pathname.match(/-(\d{4}\.\d{4,5}(?:v\d+)?)\/?$/)?.[1],
    );
    if (!slugPaperId) return null;

    for (const link of document.querySelectorAll('a[href]')) {
      try {
        const url = new URL(link.href, window.location.href);
        const linkPaperId =
          url.protocol === "https:" &&
          url.hostname.toLowerCase() === "arxiv.org"
            ? normalizePaperId(url.pathname.match(/^\/pdf\/([^/?#]+)/)?.[1])
            : null;
        if (linkPaperId === slugPaperId) {
          return { paperId: slugPaperId, targetUrl: url.href };
        }
      } catch {
        // Ignore malformed or unrelated page links.
      }
    }

    return null;
  }

  function resolveCurrentPaper() {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname === "arxiv.org") {
      const paperId = getArxivAbstractPaperId(window.location.pathname);
      return paperId
        ? {
            paperId,
            targetUrl: arxivPdfUrlFor(window.location),
            preserveHistory: false,
          }
        : null;
    }

    if (hostname === "academy.dair.ai") {
      const paper = resolveDairPaper();
      return paper ? { ...paper, preserveHistory: true } : null;
    }

    return null;
  }

  async function redirectOnFirstVisit() {
    const paper = resolveCurrentPaper();
    if (!paper) return;

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

    if (visited.includes(paper.paperId)) {
      console.log(LOG_PREFIX, "PDF already visited; preserving source page.", {
        paperId: paper.paperId,
      });
      return;
    }

    const nextVisited = [...visited, paper.paperId];
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: nextVisited });
    } catch (error) {
      console.error(LOG_PREFIX, "Failed to save visit history.", error);
      return;
    }

    console.log(LOG_PREFIX, "First visit; redirecting to PDF.", {
      paperId: paper.paperId,
      targetUrl: paper.targetUrl,
    });
    if (paper.preserveHistory) {
      window.location.assign(paper.targetUrl);
    } else {
      window.location.replace(paper.targetUrl);
    }
  }

  void redirectOnFirstVisit();
})();
