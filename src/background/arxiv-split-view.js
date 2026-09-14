const LOG_PREFIX = "[casimir:paper-split-view]";
const CHATGPT_URL = "https://chatgpt.com/";
const RECENT_TAB_WINDOW_MS = 3000;
const CANDIDATE_TTL_MS = 10000;
const RETRY_DELAYS_MS = [0, 80, 200, 500, 1000, 2000];
const ATTACHMENT_UPLOAD_PORT = "casimir-attachment-upload";
const PDF_SOURCE_REQUEST = "casimir-resolve-pdf-source";
const PDF_TASK_PREFIX = "pendingPdfUpload:";
const PDF_TASK_TTL_MS = 2 * 60 * 1000;
const MAX_PDF_MIB = 100;
const MAX_PDF_BYTES = MAX_PDF_MIB * 1024 * 1024;
const ARXIV_VISITED_STORAGE_KEY = "arxivVisitedPaperIds";

// tabId -> { createdAt, windowId, initialUrl, seenSplitViewId, processed }
const recentTabs = new Map();
const processedTabIds = new Set();
const retryTimers = new Map();

function log(event, details = {}) {
  console.log(`${LOG_PREFIX} ${event}`, details);
}

function tabUrl(tab) {
  return tab?.pendingUrl || tab?.url || "";
}

function isArxivPdfUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "arxiv.org" &&
      parsed.pathname.startsWith("/pdf/")
    );
  } catch {
    return false;
  }
}

function arxivPaperIdFromPdfUrl(candidate) {
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "arxiv.org"
    ) {
      return null;
    }

    const rawPaperId = url.pathname.match(/^\/pdf\/(.+?)(?:\.pdf)?\/?$/)?.[1];
    const paperId = rawPaperId?.replace(/v\d+$/i, "");
    return /^\d{4}\.\d{4,5}$/.test(paperId || "") ||
      /^[a-z-]+(?:\.[a-z-]+)?\/\d{7}$/i.test(paperId || "")
      ? paperId
      : null;
  } catch {
    return null;
  }
}

async function recordArxivPdfVisit(candidateUrl) {
  const paperId = arxivPaperIdFromPdfUrl(candidateUrl);
  if (!paperId) return;

  try {
    const stored = await chrome.storage.local.get(ARXIV_VISITED_STORAGE_KEY);
    const visited = Array.isArray(stored[ARXIV_VISITED_STORAGE_KEY])
      ? stored[ARXIV_VISITED_STORAGE_KEY]
      : [];
    if (visited.includes(paperId)) return;

    await chrome.storage.local.set({
      [ARXIV_VISITED_STORAGE_KEY]: [...visited, paperId],
    });
    log("[arXiv PDF visited]", { paperId });
  } catch (error) {
    log("[arXiv PDF visit history failed]", {
      paperId,
      error: String(error),
    });
  }
}

function isResolvablePaperPageUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;

    const hostname = parsed.hostname.toLowerCase();
    return (
      (hostname === "www.alphaxiv.org" &&
        /^\/(?:abs|pdf)\/[^/]+\/?$/.test(parsed.pathname)) ||
      (hostname === "www.nature.com" &&
        /^\/articles\/[^/]+\/?$/.test(parsed.pathname)) ||
      (hostname === "aclanthology.org" &&
        /^\/[^/]+\/?$/.test(parsed.pathname)) ||
      (hostname === "openreview.net" &&
        parsed.pathname === "/forum" &&
        Boolean(parsed.searchParams.get("id"))) ||
      (hostname === "x.com" &&
        /^\/[^/]+\/article\/\d+\/?$/.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}

function validatedResolvedSource(pageUrl, resolution) {
  if (!resolution || typeof resolution !== "object") return null;

  try {
    const page = new URL(pageUrl);
    if (page.protocol !== "https:") return null;

    const hostname = page.hostname.toLowerCase();
    if (hostname === "www.alphaxiv.org") {
      const linkedPdf = new URL(resolution.linkedPdfUrl || "", pageUrl);
      if (
        resolution.pageType === "blog" &&
        linkedPdf.protocol === "https:" &&
        linkedPdf.hostname.toLowerCase() === "cdn.openai.com" &&
        linkedPdf.pathname.toLowerCase().endsWith(".pdf")
      ) {
        return {
          kind: "alphaXiv",
          sourceUrl: linkedPdf.href,
          fallbackMhtml: true,
          pageTitle: resolution.pageTitle,
        };
      }

      const pdf = new URL(resolution.pdfUrl || "", pageUrl);
      if (
        pdf.protocol === "https:" &&
        pdf.hostname.toLowerCase() === hostname &&
        /^\/abs\/[^/]+\.pdf$/.test(pdf.pathname)
      ) {
        return {
          kind: "alphaXiv",
          sourceUrl: pdf.href,
          fallbackMhtml: resolution.pageType === "blog",
          pageTitle: resolution.pageTitle,
        };
      }

      if (resolution.pageType === "blog") {
        return {
          kind: "alphaXiv",
          sourceUrl: null,
          fallbackMhtml: true,
          pageTitle: resolution.pageTitle,
        };
      }
    }

    if (hostname === "www.nature.com") {
      const articleMatch = /^\/articles\/([^/]+)\/?$/.exec(page.pathname);
      if (!articleMatch) return null;

      const articleId = articleMatch[1];
      const pdf = new URL(resolution.pdfUrl || "", pageUrl);
      if (
        pdf.protocol === "https:" &&
        pdf.hostname.toLowerCase() === hostname &&
        pdf.pathname === `/articles/${articleId}_reference.pdf`
      ) {
        return {
          kind: "Nature",
          sourceUrl: pdf.href,
          fallbackMhtml: true,
          pageTitle: resolution.pageTitle,
        };
      }

      if (
        pdf.protocol === "https:" &&
        pdf.hostname.toLowerCase() === hostname &&
        pdf.pathname === `/articles/${articleId}.pdf`
      ) {
        return {
          kind: "Nature",
          sourceUrl: null,
          directMhtml: true,
          pageTitle: resolution.pageTitle,
        };
      }
    }

    if (hostname === "aclanthology.org") {
      const paperId = /^\/([^/]+)\/?$/.exec(page.pathname)?.[1];
      const pdf = new URL(resolution.pdfUrl || "", pageUrl);
      if (
        paperId &&
        pdf.protocol === "https:" &&
        pdf.hostname.toLowerCase() === hostname &&
        pdf.pathname === `/${paperId}.pdf`
      ) {
        return { kind: "ACL Anthology", sourceUrl: pdf.href };
      }
    }

    if (hostname === "openreview.net") {
      const forumId =
        page.pathname === "/forum" ? page.searchParams.get("id") : null;
      const pdf = new URL(resolution.pdfUrl || "", pageUrl);
      if (
        forumId &&
        pdf.protocol === "https:" &&
        pdf.hostname.toLowerCase() === hostname &&
        pdf.pathname === "/pdf" &&
        pdf.searchParams.get("id") === forumId
      ) {
        return {
          kind: "OpenReview",
          sourceUrl: pdf.href,
          useSiteSession: true,
        };
      }
    }

    if (
      hostname === "x.com" &&
      resolution.pageType === "x-article" &&
      resolution.ready === true
    ) {
      return {
        kind: "X Article",
        sourceUrl: null,
        directMhtml: true,
        pageTitle: resolution.pageTitle,
      };
    }
  } catch {
    // Ignore malformed or unsupported page-provided URLs.
  }

  return null;
}

async function resolvePdfSource(tab) {
  const pageUrl = tabUrl(tab);
  if (isArxivPdfUrl(pageUrl)) {
    return { kind: "arXiv", sourceUrl: pageUrl };
  }
  if (!isResolvablePaperPageUrl(pageUrl)) return null;

  try {
    const resolution = await chrome.tabs.sendMessage(tab.id, {
      type: PDF_SOURCE_REQUEST,
    });
    const source = validatedResolvedSource(pageUrl, resolution);
    return source ? { ...source, sourceTabId: tab.id } : null;
  } catch (error) {
    skip(tab, "paper source resolver unavailable", { error: String(error) });
    return null;
  }
}

function isChatGptUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "chatgpt.com"
    );
  } catch {
    return false;
  }
}

function isBlankNewTabUrl(url) {
  if (!url) return true;

  const normalized = url.toLowerCase();
  return (
    normalized === "about:blank" ||
    normalized === "chrome://newtab/" ||
    normalized === "chrome://new-tab-page/" ||
    normalized === "chrome://tab-search.top-chrome/split_new_tab_page.html" ||
    normalized === "edge://newtab/"
  );
}

function hasValidSplitViewId(tab) {
  return (
    Number.isInteger(tab?.splitViewId) &&
    tab.splitViewId !== -1 &&
    tab.splitViewId !== chrome.tabs.SPLIT_VIEW_ID_NONE
  );
}

function summarizeTab(tab) {
  return {
    id: tab?.id,
    windowId: tab?.windowId,
    url: tab?.url,
    pendingUrl: tab?.pendingUrl,
    splitViewId: tab?.splitViewId,
    active: tab?.active,
  };
}

function skip(tab, reason, details = {}) {
  log("[skip]", { tabId: tab?.id, reason, ...details });
}

function pdfTaskKey(tabId) {
  return `${PDF_TASK_PREFIX}${tabId}`;
}

async function setPendingPdfUpload(targetTabId, source) {
  await chrome.storage.session.set({
    [pdfTaskKey(targetTabId)]: {
      sourceUrl: source.sourceUrl,
      sourceKind: source.kind,
      sourceTabId: source.sourceTabId,
      fallbackMhtml: source.fallbackMhtml === true,
      directMhtml: source.directMhtml === true,
      useSiteSession: source.useSiteSession === true,
      pageTitle: source.pageTitle,
      createdAt: Date.now(),
    },
  });
}

async function getPendingPdfUpload(targetTabId) {
  const key = pdfTaskKey(targetTabId);
  const stored = await chrome.storage.session.get(key);
  const task = stored[key];

  if (!task || Date.now() - task.createdAt > PDF_TASK_TTL_MS) {
    if (task) await chrome.storage.session.remove(key);
    return null;
  }

  return task;
}

async function clearPendingPdfUpload(targetTabId) {
  await chrome.storage.session.remove(pdfTaskKey(targetTabId));
}

function pdfFilename(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname;
  const lastSegment = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "paper");
  const queryId = parsed.searchParams.get("id");
  const basename =
    lastSegment.toLowerCase() === "pdf" && /^[A-Za-z0-9_-]+$/.test(queryId || "")
      ? queryId
      : lastSegment.replace(/\.pdf$/i, "") || "paper";
  return `${basename}.pdf`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

function pdfSizeLimitError() {
  return new Error(
    `PDF exceeds Casimir's ${MAX_PDF_MIB} MB automatic transfer limit`,
  );
}

function attachmentSizeLimitError() {
  return new Error(
    `Attachment exceeds Casimir's ${MAX_PDF_MIB} MB automatic transfer limit`,
  );
}

function mhtmlFilename(title) {
  const withoutSiteName = String(title || "Captured article")
    .replace(/\s*\|\s*alphaXiv\s*$/i, "")
    .trim();
  const safeTitle = withoutSiteName
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 140)
    .trim();
  return `${safeTitle || "Captured article"}.mhtml`;
}

async function postBlob(port, blob, metadata) {
  if (blob.size > MAX_PDF_BYTES) throw attachmentSizeLimitError();

  port.postMessage({
    type: "start",
    filename: metadata.filename,
    contentType: metadata.contentType,
    expectedBytes: blob.size || null,
    attachmentKind: metadata.attachmentKind,
  });

  let totalBytes = 0;
  const reader = blob.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PDF_BYTES) {
      await reader.cancel();
      throw attachmentSizeLimitError();
    }
    port.postMessage({ type: "chunk", data: bytesToBase64(value) });
  }
  return totalBytes;
}

async function captureMhtml(port, task) {
  if (!Number.isInteger(task.sourceTabId)) {
    throw new Error("Source tab is unavailable for MHTML capture");
  }

  port.postMessage({
    type: "status",
    status: "capturing",
    sourceKind: task.sourceKind || "alphaXiv",
    direct: task.directMhtml === true,
  });
  const blob = await chrome.pageCapture.saveAsMHTML({
    tabId: task.sourceTabId,
  });
  if (!(blob instanceof Blob)) {
    throw new Error("Chrome did not return an MHTML snapshot");
  }

  return postBlob(port, blob, {
    filename: mhtmlFilename(task.pageTitle),
    contentType: "multipart/related",
    attachmentKind: "MHTML",
  });
}

async function transferPdf(port, targetTabId, task) {
  if (task.directMhtml) {
    try {
      const totalBytes = await captureMhtml(port, task);
      await clearPendingPdfUpload(targetTabId);
      port.postMessage({ type: "done", totalBytes });
      log("[MHTML transferred]", {
        targetTabId,
        sourceTabId: task.sourceTabId,
        totalBytes,
      });
    } catch (error) {
      await clearPendingPdfUpload(targetTabId);
      log("[MHTML transfer failed]", {
        targetTabId,
        sourceTabId: task.sourceTabId,
        error: String(error),
      });
      try {
        port.postMessage({
          type: "error",
          message: String(error),
          attachmentKind: "MHTML",
        });
      } catch {
        // The ChatGPT tab may have closed during capture.
      }
    }
    return;
  }

  try {
    if (!task.sourceUrl) throw new Error("No usable PDF source was found");

    port.postMessage({
      type: "status",
      status: "fetching",
      sourceKind: task.sourceKind || "paper source",
    });
    const response = await fetch(task.sourceUrl, {
      cache: "no-store",
      credentials: task.useSiteSession ? "include" : "omit",
    });
    if (!response.ok) throw new Error(`PDF source returned HTTP ${response.status}`);

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_PDF_BYTES) {
      throw pdfSizeLimitError();
    }

    const contentType = response.headers.get("content-type") || "application/pdf";
    if (!contentType.toLowerCase().includes("pdf")) {
      throw new Error(`unexpected content type: ${contentType}`);
    }

    port.postMessage({
      type: "start",
      filename: pdfFilename(task.sourceUrl),
      contentType: "application/pdf",
      expectedBytes: contentLength || null,
      attachmentKind: "PDF",
    });

    let totalBytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_PDF_BYTES) {
          await reader.cancel();
          throw pdfSizeLimitError();
        }
        port.postMessage({ type: "chunk", data: bytesToBase64(value) });
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      totalBytes = bytes.byteLength;
      if (totalBytes > MAX_PDF_BYTES) throw pdfSizeLimitError();
      port.postMessage({ type: "chunk", data: bytesToBase64(bytes) });
    }

    await clearPendingPdfUpload(targetTabId);
    port.postMessage({ type: "done", totalBytes });
    log("[PDF transferred]", {
      targetTabId,
      sourceUrl: task.sourceUrl,
      totalBytes,
    });
  } catch (pdfError) {
    if (task.fallbackMhtml && !String(pdfError).includes("transfer limit")) {
      try {
        log("[PDF unavailable; capturing MHTML]", {
          targetTabId,
          sourceUrl: task.sourceUrl,
          error: String(pdfError),
        });
        const totalBytes = await captureMhtml(port, task);
        await clearPendingPdfUpload(targetTabId);
        port.postMessage({ type: "done", totalBytes });
        log("[MHTML transferred]", {
          targetTabId,
          sourceTabId: task.sourceTabId,
          totalBytes,
        });
        return;
      } catch (mhtmlError) {
        pdfError = new Error(
          `${String(pdfError)}; MHTML fallback failed: ${String(mhtmlError)}`,
        );
      }
    }

    await clearPendingPdfUpload(targetTabId);
    log("[PDF transfer failed]", {
      targetTabId,
      sourceUrl: task.sourceUrl,
      error: String(pdfError),
    });
    try {
      port.postMessage({
        type: "error",
        message: String(pdfError),
        attachmentKind: task.fallbackMhtml ? "附件" : "PDF",
      });
    } catch {
      // The ChatGPT tab may have closed while the PDF was being fetched.
    }
  }
}

function clearRetryTimers(tabId) {
  const timers = retryTimers.get(tabId) || [];
  for (const timer of timers) clearTimeout(timer);
  retryTimers.delete(tabId);
}

function cleanupExpiredCandidates() {
  const cutoff = Date.now() - CANDIDATE_TTL_MS;

  for (const [tabId, candidate] of recentTabs) {
    if (candidate.createdAt < cutoff) {
      recentTabs.delete(tabId);
      processedTabIds.delete(tabId);
      clearRetryTimers(tabId);
    }
  }
}

async function evaluateCandidate(tabId, trigger) {
  cleanupExpiredCandidates();

  const candidate = recentTabs.get(tabId);
  if (!candidate) return;

  if (candidate.processed || processedTabIds.has(tabId)) return;

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    recentTabs.delete(tabId);
    clearRetryTimers(tabId);
    skip({ id: tabId }, "tab no longer exists", { trigger, error: String(error) });
    return;
  }

  if (Date.now() - candidate.createdAt > RECENT_TAB_WINDOW_MS) {
    skip(tab, "tab is outside the recent-creation window", { trigger });
    return;
  }

  if (tab.windowId !== candidate.windowId) {
    skip(tab, "tab moved to another window", { trigger });
    return;
  }

  if (!hasValidSplitViewId(tab)) return;

  candidate.seenSplitViewId = tab.splitViewId;

  const targetUrl = tabUrl(tab);
  if (isChatGptUrl(targetUrl)) {
    candidate.processed = true;
    processedTabIds.add(tabId);
    clearRetryTimers(tabId);
    skip(tab, "target is already ChatGPT", { trigger });
    return;
  }

  if (!isBlankNewTabUrl(targetUrl)) {
    skip(tab, "new Split View tab is not blank; preserving user page", {
      trigger,
      targetUrl,
    });
    return;
  }

  let splitTabs;
  try {
    splitTabs = await chrome.tabs.query({
      windowId: tab.windowId,
      splitViewId: tab.splitViewId,
    });
  } catch (error) {
    skip(tab, "failed to query Split View", { trigger, error: String(error) });
    return;
  }

  log("[splitView detected]", {
    trigger,
    splitViewId: tab.splitViewId,
    tabs: splitTabs.map(summarizeTab),
  });

  let sourceTab = null;
  let source = null;
  for (const peer of splitTabs) {
    if (peer.id === tab.id) continue;
    const resolved = await resolvePdfSource(peer);
    if (!resolved) continue;
    sourceTab = peer;
    source = resolved;
    break;
  }

  if (!sourceTab || !source) {
    skip(tab, "no supported paper source in the same Split View", {
      trigger,
      splitViewId: tab.splitViewId,
    });
    return;
  }

  // Mark first so overlapping tab events cannot issue duplicate navigations.
  candidate.processed = true;
  processedTabIds.add(tabId);
  clearRetryTimers(tabId);

  log("[matched paper]", {
    sourceKind: source.kind,
    sourceTabId: sourceTab.id,
    sourcePageUrl: tabUrl(sourceTab),
    sourceUrl: source.sourceUrl,
    targetTabId: tab.id,
  });

  try {
    await setPendingPdfUpload(tab.id, source);
    await chrome.tabs.update(tab.id, { url: CHATGPT_URL });
    log("[update to ChatGPT]", { targetTabId: tab.id, url: CHATGPT_URL });
  } catch (error) {
    await clearPendingPdfUpload(tab.id);
    candidate.processed = false;
    processedTabIds.delete(tabId);
    log("[update failed]", { targetTabId: tab.id, error: String(error) });
  }
}

function scheduleEvaluation(tabId, trigger) {
  if (!recentTabs.has(tabId)) return;

  clearRetryTimers(tabId);
  const timers = RETRY_DELAYS_MS.map((delay) =>
    setTimeout(() => void evaluateCandidate(tabId, `${trigger}+${delay}ms`), delay),
  );
  retryTimers.set(tabId, timers);
}

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id == null) return;

  void recordArxivPdfVisit(tabUrl(tab));

  recentTabs.set(tab.id, {
    createdAt: Date.now(),
    windowId: tab.windowId,
    initialUrl: tabUrl(tab),
    seenSplitViewId: tab.splitViewId,
    processed: false,
  });

  log("[onCreated]", summarizeTab(tab));
  scheduleEvaluation(tab.id, "onCreated");
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  log("[onUpdated]", {
    tabId,
    changeInfo,
    tab: summarizeTab(tab),
  });

  void recordArxivPdfVisit(changeInfo.url || tabUrl(tab));

  if (recentTabs.has(tabId)) {
    scheduleEvaluation(tabId, "onUpdated");
  }
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  log("[onActivated]", { tabId, windowId });
  if (recentTabs.has(tabId)) scheduleEvaluation(tabId, "onActivated");
});

chrome.tabs.onRemoved.addListener((tabId) => {
  recentTabs.delete(tabId);
  processedTabIds.delete(tabId);
  clearRetryTimers(tabId);
  void clearPendingPdfUpload(tabId);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ATTACHMENT_UPLOAD_PORT) return;

  const targetTabId = port.sender?.tab?.id;
  if (!Number.isInteger(targetTabId)) {
    port.disconnect();
    return;
  }

  let started = false;
  port.onMessage.addListener((message) => {
    if (message?.type !== "claim" || started) return;
    started = true;

    void getPendingPdfUpload(targetTabId).then((task) => {
      if (!task) {
        port.postMessage({ type: "none" });
        return;
      }
      return transferPdf(port, targetTabId, task);
    });
  });
});

log("[service worker started]", {
  target: CHATGPT_URL,
  recentTabWindowMs: RECENT_TAB_WINDOW_MS,
});
