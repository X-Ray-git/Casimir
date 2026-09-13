const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  new URL("../src/background/arxiv-split-view.js", `file://${__filename}`),
  "utf8",
);

function event() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      for (const listener of listeners) listener(...args);
    },
  };
}

function createHarness(
  initialTabs,
  fetchImpl = async () => {
    throw new Error("Unexpected fetch");
  },
  resolveSource = async () => {
    throw new Error("No paper source content script");
  },
  captureMhtml = async () => {
    throw new Error("Unexpected MHTML capture");
  },
) {
  const tabs = new Map(initialTabs.map((tab) => [tab.id, { ...tab }]));
  const updates = [];
  const onCreated = event();
  const onUpdated = event();
  const onActivated = event();
  const onRemoved = event();
  const onConnect = event();
  const sessionStorage = {};

  const chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: sessionStorage[key] };
        },
        async set(update) {
          Object.assign(sessionStorage, update);
        },
        async remove(key) {
          delete sessionStorage[key];
        },
      },
    },
    runtime: { onConnect },
    pageCapture: { saveAsMHTML: captureMhtml },
    tabs: {
      SPLIT_VIEW_ID_NONE: -1,
      onCreated,
      onUpdated,
      onActivated,
      onRemoved,
      async get(tabId) {
        if (!tabs.has(tabId)) throw new Error("No tab");
        return { ...tabs.get(tabId) };
      },
      async query(query) {
        return [...tabs.values()].filter(
          (tab) =>
            tab.windowId === query.windowId &&
            tab.splitViewId === query.splitViewId,
        );
      },
      async sendMessage(tabId, message) {
        return resolveSource(tabId, message);
      },
      async update(tabId, change) {
        updates.push({ tabId, change: { ...change } });
        tabs.set(tabId, { ...tabs.get(tabId), ...change });
        return { ...tabs.get(tabId) };
      },
    },
  };

  const immediateTimers = [];
  const context = {
    chrome,
    fetch: fetchImpl,
    btoa,
    Blob,
    Uint8Array,
    URL,
    console: { log() {} },
    setTimeout(callback, delay) {
      if (delay === 0) immediateTimers.push(callback);
      return Symbol("timer");
    },
    clearTimeout() {},
  };

  vm.runInNewContext(source, context, {
    filename: "arxiv-split-view.js",
  });

  async function flush() {
    while (immediateTimers.length) {
      immediateTimers.shift()();
      await new Promise(setImmediate);
    }
    await new Promise(setImmediate);
  }

  return {
    onConnect,
    onCreated,
    onUpdated,
    sessionStorage,
    tabs,
    updates,
    flush,
  };
}

async function transferWithDeclaredLength(contentLength) {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  let arrayBufferCalls = 0;
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://arxiv.org/pdf/1706.03762",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const harness = createHarness([sourceTab, targetTab], async () => ({
    ok: true,
    status: 200,
    body: null,
    headers: {
      get(name) {
        if (name === "content-length") return String(contentLength);
        if (name === "content-type") return "application/pdf";
        return null;
      },
    },
    async arrayBuffer() {
      arrayBufferCalls += 1;
      return pdfBytes.buffer;
    },
  }));

  harness.onCreated.emit(targetTab);
  await harness.flush();

  const messages = [];
  const port = {
    name: "casimir-attachment-upload",
    sender: { tab: { id: targetTab.id } },
    onMessage: event(),
    postMessage(message) {
      messages.push(message);
    },
    disconnect() {},
  };
  harness.onConnect.emit(port);
  port.onMessage.emit({ type: "claim" });
  await harness.flush();
  await harness.flush();

  return { arrayBufferCalls, harness, messages };
}

test("navigates a new blank pane beside an arXiv PDF", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://arxiv.org/pdf/1706.03762",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const harness = createHarness([sourceTab, targetTab]);

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, [
    { tabId: 2, change: { url: "https://chatgpt.com/" } },
  ]);
  assert.equal(
    harness.sessionStorage["pendingPdfUpload:2"].sourceUrl,
    "https://arxiv.org/pdf/1706.03762",
  );
});

test("streams the matched arXiv PDF only to the paired ChatGPT tab", async () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://arxiv.org/pdf/1706.03762",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const harness = createHarness([sourceTab, targetTab], async () => ({
    ok: true,
    status: 200,
    body: null,
    headers: {
      get(name) {
        if (name === "content-length") return String(pdfBytes.byteLength);
        if (name === "content-type") return "application/pdf";
        return null;
      },
    },
    async arrayBuffer() {
      return pdfBytes.buffer;
    },
  }));

  harness.onCreated.emit(targetTab);
  await harness.flush();

  const messages = [];
  const port = {
    name: "casimir-attachment-upload",
    sender: { tab: { id: 2 } },
    onMessage: event(),
    postMessage(message) {
      messages.push(message);
    },
    disconnect() {},
  };
  harness.onConnect.emit(port);
  port.onMessage.emit({ type: "claim" });
  await harness.flush();
  await harness.flush();

  assert.deepEqual(
    messages.map((message) => message.type),
    ["status", "start", "chunk", "done"],
  );
  assert.equal(messages[1].filename, "1706.03762.pdf");
  assert.equal(messages[2].data, "JVBERg==");
  assert.equal(harness.sessionStorage["pendingPdfUpload:2"], undefined);
});

test("navigates beside an alphaXiv special paper and stores its PDF", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://www.alphaxiv.org/pdf/2609.compose-cl",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const harness = createHarness(
    [sourceTab, targetTab],
    undefined,
    async (tabId, message) => {
      assert.equal(tabId, sourceTab.id);
      assert.equal(message.type, "casimir-resolve-pdf-source");
      return {
        pdfUrl: "https://www.alphaxiv.org/abs/2609.compose-cl.pdf",
      };
    },
  );

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, [
    { tabId: targetTab.id, change: { url: "https://chatgpt.com/" } },
  ]);
  assert.equal(
    harness.sessionStorage["pendingPdfUpload:2"].sourceUrl,
    "https://www.alphaxiv.org/abs/2609.compose-cl.pdf",
  );
  assert.equal(
    harness.sessionStorage["pendingPdfUpload:2"].sourceKind,
    "alphaXiv",
  );
});

test("prefers a trusted paper linked from an alphaXiv blog", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://www.alphaxiv.org/abs/2609.navier-stokes-solution",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const harness = createHarness(
    [sourceTab, targetTab],
    undefined,
    async () => ({
      pdfUrl:
        "https://www.alphaxiv.org/abs/2609.navier-stokes-solution.pdf",
      linkedPdfUrl:
        "https://cdn.openai.com/pdf/example/navier-stokes.pdf",
      pageType: "blog",
      pageTitle: "On the Navier-Stokes Millennium Prize Problem | alphaXiv",
    }),
  );

  harness.onCreated.emit(targetTab);
  await harness.flush();

  const task = harness.sessionStorage["pendingPdfUpload:2"];
  assert.equal(
    task.sourceUrl,
    "https://cdn.openai.com/pdf/example/navier-stokes.pdf",
  );
  assert.equal(task.sourceTabId, sourceTab.id);
  assert.equal(task.fallbackMhtml, true);
});

test("captures an alphaXiv blog as MHTML when its linked PDF fails", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://www.alphaxiv.org/abs/2609.navier-stokes-solution",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const capturedTabIds = [];
  const harness = createHarness(
    [sourceTab, targetTab],
    async () => ({
      ok: false,
      status: 404,
      headers: { get() { return null; } },
    }),
    async () => ({
      pdfUrl:
        "https://www.alphaxiv.org/abs/2609.navier-stokes-solution.pdf",
      linkedPdfUrl:
        "https://cdn.openai.com/pdf/example/navier-stokes.pdf",
      pageType: "blog",
      pageTitle: "On the Navier-Stokes Millennium Prize Problem | alphaXiv",
    }),
    async ({ tabId }) => {
      capturedTabIds.push(tabId);
      return new Blob(["MHTML"], { type: "multipart/related" });
    },
  );

  harness.onCreated.emit(targetTab);
  await harness.flush();

  const messages = [];
  const port = {
    name: "casimir-attachment-upload",
    sender: { tab: { id: targetTab.id } },
    onMessage: event(),
    postMessage(message) {
      messages.push(message);
    },
    disconnect() {},
  };
  harness.onConnect.emit(port);
  port.onMessage.emit({ type: "claim" });
  for (let attempt = 0; attempt < 5; attempt += 1) await harness.flush();

  assert.deepEqual(capturedTabIds, [sourceTab.id]);
  assert.deepEqual(
    messages.map((message) => message.type),
    ["status", "status", "start", "chunk", "done"],
  );
  assert.equal(messages[2].attachmentKind, "MHTML");
  assert.equal(
    messages[2].filename,
    "On the Navier-Stokes Millennium Prize Problem.mhtml",
  );
  assert.equal(messages[3].data, "TUhUTUw=");
  assert.equal(harness.sessionStorage["pendingPdfUpload:2"], undefined);
});

test("stores an MHTML-only fallback for an alphaXiv blog without a PDF", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://www.alphaxiv.org/abs/2609.blog-without-paper",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const harness = createHarness(
    [sourceTab, targetTab],
    undefined,
    async () => ({
      pdfUrl: null,
      linkedPdfUrl: "https://example.com/untrusted.pdf",
      pageType: "blog",
      pageTitle: "Blog without paper | alphaXiv",
    }),
  );

  harness.onCreated.emit(targetTab);
  await harness.flush();

  const task = harness.sessionStorage["pendingPdfUpload:2"];
  assert.equal(task.sourceUrl, null);
  assert.equal(task.sourceTabId, sourceTab.id);
  assert.equal(task.fallbackMhtml, true);
});

test("captures a rendered X Article directly as MHTML", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://x.com/vllm_project/article/2097427730983776758",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  let fetchCalls = 0;
  const capturedTabIds = [];
  const harness = createHarness(
    [sourceTab, targetTab],
    async () => {
      fetchCalls += 1;
      throw new Error("X Article must not be fetched as a PDF");
    },
    async () => ({
      pageType: "x-article",
      ready: true,
      pageTitle: "vLLM x AgentX: Optimizing for Real-World Agentic Serving",
    }),
    async ({ tabId }) => {
      capturedTabIds.push(tabId);
      return new Blob(["X ARTICLE"], { type: "multipart/related" });
    },
  );

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, [
    { tabId: targetTab.id, change: { url: "https://chatgpt.com/" } },
  ]);
  const task = harness.sessionStorage["pendingPdfUpload:2"];
  assert.equal(task.sourceKind, "X Article");
  assert.equal(task.directMhtml, true);

  const messages = [];
  const port = {
    name: "casimir-attachment-upload",
    sender: { tab: { id: targetTab.id } },
    onMessage: event(),
    postMessage(message) {
      messages.push(message);
    },
    disconnect() {},
  };
  harness.onConnect.emit(port);
  port.onMessage.emit({ type: "claim" });
  for (let attempt = 0; attempt < 5; attempt += 1) await harness.flush();

  assert.equal(fetchCalls, 0);
  assert.deepEqual(capturedTabIds, [sourceTab.id]);
  assert.deepEqual(
    messages.map((message) => message.type),
    ["status", "start", "chunk", "done"],
  );
  assert.equal(messages[0].direct, true);
  assert.equal(
    messages[1].filename,
    "vLLM x AgentX- Optimizing for Real-World Agentic Serving.mhtml",
  );
  assert.equal(messages[1].attachmentKind, "MHTML");
});

test("ignores an ordinary X status page", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://x.com/vllm_project/status/2097427730983776758",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const harness = createHarness([sourceTab, targetTab]);

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, []);
  assert.equal(harness.sessionStorage["pendingPdfUpload:2"], undefined);
});

test("stores a public Nature body PDF with an MHTML fallback", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://www.nature.com/articles/s41746-026-03084-5",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const harness = createHarness(
    [sourceTab, targetTab],
    undefined,
    async () => ({
      pdfUrl:
        "https://www.nature.com/articles/s41746-026-03084-5_reference.pdf",
      pageTitle:
        "Toward expert-level medical text validation with language models",
    }),
  );

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, [
    { tabId: targetTab.id, change: { url: "https://chatgpt.com/" } },
  ]);
  assert.equal(
    harness.sessionStorage["pendingPdfUpload:2"].sourceUrl,
    "https://www.nature.com/articles/s41746-026-03084-5_reference.pdf",
  );
  assert.equal(
    harness.sessionStorage["pendingPdfUpload:2"].sourceKind,
    "Nature",
  );
  assert.equal(
    harness.sessionStorage["pendingPdfUpload:2"].fallbackMhtml,
    true,
  );
  assert.equal(
    harness.sessionStorage["pendingPdfUpload:2"].sourceTabId,
    sourceTab.id,
  );
});

test("captures an access-aware Nature article directly as MHTML", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://www.nature.com/articles/s41591-026-04539-8",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  let fetchCalls = 0;
  const capturedTabIds = [];
  const harness = createHarness(
    [sourceTab, targetTab],
    async () => {
      fetchCalls += 1;
      throw new Error("Access-aware Nature PDFs must not be fetched");
    },
    async () => ({
      pdfUrl: "https://www.nature.com/articles/s41591-026-04539-8.pdf",
      pageTitle: "Toward a test of medical AI superintelligence",
    }),
    async ({ tabId }) => {
      capturedTabIds.push(tabId);
      return new Blob(["NATURE ARTICLE"], { type: "multipart/related" });
    },
  );

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, [
    { tabId: targetTab.id, change: { url: "https://chatgpt.com/" } },
  ]);
  const task = harness.sessionStorage["pendingPdfUpload:2"];
  assert.equal(task.sourceKind, "Nature");
  assert.equal(task.sourceUrl, null);
  assert.equal(task.directMhtml, true);
  assert.equal(task.sourceTabId, sourceTab.id);

  const messages = [];
  const port = {
    name: "casimir-attachment-upload",
    sender: { tab: { id: targetTab.id } },
    onMessage: event(),
    postMessage(message) {
      messages.push(message);
    },
    disconnect() {},
  };
  harness.onConnect.emit(port);
  port.onMessage.emit({ type: "claim" });
  for (let attempt = 0; attempt < 5; attempt += 1) await harness.flush();

  assert.equal(fetchCalls, 0);
  assert.deepEqual(capturedTabIds, [sourceTab.id]);
  assert.deepEqual(
    messages.map((message) => message.type),
    ["status", "start", "chunk", "done"],
  );
  assert.equal(
    messages[1].filename,
    "Toward a test of medical AI superintelligence.mhtml",
  );
  assert.equal(messages[1].attachmentKind, "MHTML");
});

test("falls back to the exact Nature tab when a public PDF fetch fails", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://www.nature.com/articles/s41746-026-03084-5",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const capturedTabIds = [];
  const harness = createHarness(
    [sourceTab, targetTab],
    async () => ({
      ok: false,
      status: 403,
      headers: { get() { return null; } },
    }),
    async () => ({
      pdfUrl:
        "https://www.nature.com/articles/s41746-026-03084-5_reference.pdf",
      pageTitle:
        "Toward expert-level medical text validation with language models",
    }),
    async ({ tabId }) => {
      capturedTabIds.push(tabId);
      return new Blob(["NATURE FALLBACK"], { type: "multipart/related" });
    },
  );

  harness.onCreated.emit(targetTab);
  await harness.flush();

  const messages = [];
  const port = {
    name: "casimir-attachment-upload",
    sender: { tab: { id: targetTab.id } },
    onMessage: event(),
    postMessage(message) {
      messages.push(message);
    },
    disconnect() {},
  };
  harness.onConnect.emit(port);
  port.onMessage.emit({ type: "claim" });
  for (let attempt = 0; attempt < 5; attempt += 1) await harness.flush();

  assert.deepEqual(capturedTabIds, [sourceTab.id]);
  assert.deepEqual(
    messages.map((message) => message.type),
    ["status", "status", "start", "chunk", "done"],
  );
  assert.equal(messages[2].attachmentKind, "MHTML");
});

test("rejects a page-provided PDF URL outside its supported source", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://www.nature.com/articles/s41746-026-03084-5",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const harness = createHarness(
    [sourceTab, targetTab],
    undefined,
    async () => ({ pdfUrl: "https://example.com/untrusted.pdf" }),
  );

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, []);
  assert.equal(harness.sessionStorage["pendingPdfUpload:2"], undefined);
});

test("accepts a PDF declared at the 100 MB automatic transfer limit", async () => {
  const result = await transferWithDeclaredLength(100 * 1024 * 1024);

  assert.deepEqual(
    result.messages.map((message) => message.type),
    ["status", "start", "chunk", "done"],
  );
  assert.equal(result.arrayBufferCalls, 1);
});

test("rejects a PDF declared above the 100 MB automatic transfer limit", async () => {
  const result = await transferWithDeclaredLength(100 * 1024 * 1024 + 1);

  assert.deepEqual(
    result.messages.map((message) => message.type),
    ["status", "error"],
  );
  assert.equal(
    result.messages[1].message,
    "Error: PDF exceeds Casimir's 100 MB automatic transfer limit",
  );
  assert.equal(result.arrayBufferCalls, 0);
  assert.equal(result.harness.sessionStorage["pendingPdfUpload:2"], undefined);
});

test("does not navigate a blank pane beside a non-arXiv page", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://example.com/",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "about:blank",
    splitViewId: 42,
  };
  const harness = createHarness([sourceTab, targetTab]);

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, []);
});

test("does not navigate beside an arXiv abstract page", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://arxiv.org/abs/1706.03762",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: 42,
  };
  const harness = createHarness([sourceTab, targetTab]);

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, []);
});

test("never overwrites an existing web page beside an arXiv PDF", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://arxiv.org/pdf/1706.03762.pdf",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "https://example.com/notes",
    splitViewId: 42,
  };
  const harness = createHarness([sourceTab, targetTab]);

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, []);
});

test("does not navigate an ordinary new tab outside Split View", async () => {
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: -1,
  };
  const harness = createHarness([targetTab]);

  harness.onCreated.emit(targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, []);
});

test("reacts when splitViewId appears in a later update", async () => {
  const sourceTab = {
    id: 1,
    windowId: 10,
    url: "https://arxiv.org/pdf/1706.03762",
    splitViewId: 42,
  };
  const targetTab = {
    id: 2,
    windowId: 10,
    url: "chrome://newtab/",
    splitViewId: -1,
  };
  const harness = createHarness([sourceTab, targetTab]);

  harness.onCreated.emit(targetTab);
  await harness.flush();
  assert.deepEqual(harness.updates, []);

  targetTab.splitViewId = 42;
  harness.tabs.set(2, { ...targetTab });
  harness.onUpdated.emit(2, { splitViewId: 42 }, targetTab);
  await harness.flush();

  assert.deepEqual(harness.updates, [
    { tabId: 2, change: { url: "https://chatgpt.com/" } },
  ]);
});

test("recognizes Chrome's native Split View placeholder page", async () => {
  const sourceTab = {
    id: 846289244,
    windowId: 846287707,
    url: "https://arxiv.org/pdf/1706.03762",
    splitViewId: 7,
  };
  const targetTab = {
    id: 846289247,
    windowId: 846287707,
    url: "",
    pendingUrl: "chrome://tab-search.top-chrome/split_new_tab_page.html",
    splitViewId: -1,
  };
  const harness = createHarness([sourceTab, targetTab]);

  harness.onCreated.emit(targetTab);
  await harness.flush();
  assert.deepEqual(harness.updates, []);

  targetTab.splitViewId = 7;
  harness.tabs.set(targetTab.id, { ...targetTab });
  harness.onUpdated.emit(
    targetTab.id,
    { splitViewId: 7 },
    { ...targetTab },
  );
  await harness.flush();

  assert.deepEqual(harness.updates, [
    { tabId: targetTab.id, change: { url: "https://chatgpt.com/" } },
  ]);
});
