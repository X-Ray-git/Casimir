const LOG_PREFIX = "[casimir:arxiv-split-view]";
const CHATGPT_URL = "https://chatgpt.com/";
const RECENT_TAB_WINDOW_MS = 3000;
const CANDIDATE_TTL_MS = 10000;
const RETRY_DELAYS_MS = [0, 80, 200, 500, 1000, 2000];
const PDF_UPLOAD_PORT = "casimir-pdf-upload";
const PDF_TASK_PREFIX = "pendingPdfUpload:";
const PDF_TASK_TTL_MS = 2 * 60 * 1000;
const MAX_PDF_BYTES = 50 * 1024 * 1024;

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

async function setPendingPdfUpload(targetTabId, sourceUrl) {
  await chrome.storage.session.set({
    [pdfTaskKey(targetTabId)]: {
      sourceUrl,
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
  const pathname = new URL(url).pathname;
  const lastSegment = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "paper");
  const basename = lastSegment.replace(/\.pdf$/i, "") || "paper";
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

async function transferPdf(port, targetTabId, task) {
  try {
    port.postMessage({ type: "status", status: "fetching" });
    const response = await fetch(task.sourceUrl, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) throw new Error(`arXiv returned HTTP ${response.status}`);

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_PDF_BYTES) {
      throw new Error("PDF exceeds Casimir's 50 MB transfer limit");
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
          throw new Error("PDF exceeds Casimir's 50 MB transfer limit");
        }
        port.postMessage({ type: "chunk", data: bytesToBase64(value) });
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      totalBytes = bytes.byteLength;
      if (totalBytes > MAX_PDF_BYTES) {
        throw new Error("PDF exceeds Casimir's 50 MB transfer limit");
      }
      port.postMessage({ type: "chunk", data: bytesToBase64(bytes) });
    }

    await clearPendingPdfUpload(targetTabId);
    port.postMessage({ type: "done", totalBytes });
    log("[PDF transferred]", {
      targetTabId,
      sourceUrl: task.sourceUrl,
      totalBytes,
    });
  } catch (error) {
    await clearPendingPdfUpload(targetTabId);
    log("[PDF transfer failed]", {
      targetTabId,
      sourceUrl: task.sourceUrl,
      error: String(error),
    });
    try {
      port.postMessage({ type: "error", message: String(error) });
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

  const sourceTab = splitTabs.find(
    (peer) => peer.id !== tab.id && isArxivPdfUrl(tabUrl(peer)),
  );

  if (!sourceTab) {
    skip(tab, "no arXiv PDF in the same Split View", {
      trigger,
      splitViewId: tab.splitViewId,
    });
    return;
  }

  // Mark first so overlapping tab events cannot issue duplicate navigations.
  candidate.processed = true;
  processedTabIds.add(tabId);
  clearRetryTimers(tabId);

  log("[matched arxiv]", {
    sourceTabId: sourceTab.id,
    sourceUrl: tabUrl(sourceTab),
    targetTabId: tab.id,
  });

  try {
    await setPendingPdfUpload(tab.id, tabUrl(sourceTab));
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
  if (port.name !== PDF_UPLOAD_PORT) return;

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
