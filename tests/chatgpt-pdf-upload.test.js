const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  new URL("../src/content/chatgpt-pdf-upload.js", `file://${__filename}`),
  "utf8",
);

function eventChannel() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(message) {
      for (const listener of listeners) listener(message);
    },
  };
}

async function runPdfInjection({
  attachOnChange = 1,
  filename = "1706.03762.pdf",
  contentType = "application/pdf",
  attachmentKind = "PDF",
  prepareFocus = false,
  userInteracts = false,
  promptDelay = 0,
  visibilityTransition = null,
  attachmentDelay = 0,
  duplicateDone = false,
  displayedFilename = filename,
} = {}) {
  const dispatchedEvents = [];
  let attachmentVisible = false;
  let changeCount = 0;
  let ticks = 0;
  const listeners = new Map();

  class FakeElement { getAttribute() { return null; } }
  class FakeInput extends FakeElement {}
  const input = new FakeInput();
  input.type = "file";
  input.files = [];
  input.isConnected = true;
  input.dispatchEvent = (event) => {
    dispatchedEvents.push(event.type);
    if (event.type === "change") {
      changeCount += 1;
      if (changeCount >= attachOnChange) attachmentVisible = true;
    }
    return true;
  };

  const attachment = {
    getAttribute(name) {
      return name === "aria-label" ? displayedFilename : null;
    },
  };
  const prompt = { getClientRects: () => [{}] };
  const composer = {
    querySelector(selector) {
      if (selector.startsWith('#upload-files')) return input;
      if (selector.startsWith('#prompt-textarea')) return ticks >= promptDelay ? prompt : null;
      if (selector.startsWith('[data-testid="composer-plus-btn"]')) return plusButton;
      return null;
    },
    contains(candidate) {
      return candidate === input || candidate === prompt;
    },
    querySelectorAll() {
      return attachmentVisible && ticks >= attachmentDelay ? [attachment] : [];
    },
  };
  const plusButton = new FakeElement();
  plusButton.disabled = false;

  class FakeFile {
    constructor(chunks, name, options) {
      this.name = name;
      this.type = options.type;
      this.lastModified = options.lastModified;
      this.size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    }
  }

  class FakeDataTransfer {
    constructor() {
      this.files = [];
      this.items = {
        add: (file) => this.files.push(file),
      };
    }
  }

  class FakeEvent {
    constructor(type) {
      this.type = type;
    }
  }

  const onMessage = eventChannel();
  const sentMessages = [];
  let disconnected = false;
  const statusHost = {
    id: "",
    style: {},
    textContent: "",
    remove() {},
  };
  const port = {
    onMessage,
    postMessage(message) {
      assert.equal(disconnected, false, "readiness must arrive before the upload port closes");
      sentMessages.push(message);
    },
    disconnect() {
      disconnected = true;
    },
  };

  const document = {
    hidden: visibilityTransition === "shown",
    addEventListener(type, listener) {
      listeners.set(type, listener);
      if (userInteracts && type === "keydown") listener();
    },
    removeEventListener(type) { listeners.delete(type); },
    documentElement: { appendChild() {} },
    getElementById(id) {
      if (id === "prompt-textarea") return ticks >= promptDelay ? prompt : null;
      return id === "upload-files" ? input : null;
    },
    querySelector(selector) {
      if (selector === 'form[data-type="unified-composer"], form[data-chatgpt-composer]') return composer;
      if (selector === '[data-testid="composer-plus-btn"]') return plusButton;
      return null;
    },
    createElement() {
      return statusHost;
    },
  };

  vm.runInNewContext(source, {
    atob,
    chrome: { runtime: { connect: () => port } },
    console: { log() {}, error() {}, warn() {} },
    DataTransfer: FakeDataTransfer,
    Date,
    document,
    Event: FakeEvent,
    File: FakeFile,
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInput,
    Uint8Array,
    window: {
      setTimeout(callback, delay) {
        if (delay === 100) {
          setImmediate(() => {
            ticks += 1;
            if (ticks === 1 && visibilityTransition) {
              document.hidden = visibilityTransition === "hidden";
              listeners.get("visibilitychange")?.();
            }
            callback();
          });
        } else {
          callback();
        }
      },
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, "claim");

  if (prepareFocus) {
    onMessage.emit({ type: "prepare-focus" });
    onMessage.emit({ type: "prepare-focus" });
  }
  onMessage.emit({
    type: "start",
    filename,
    contentType,
    attachmentKind,
  });
  onMessage.emit({ type: "chunk", data: "JVBERg==" });
  onMessage.emit({ type: "done", totalBytes: 4 });
  if (duplicateDone) onMessage.emit({ type: "done", totalBytes: 4 });
  for (let attempt = 0; attempt < 250 && !disconnected; attempt += 1) {
    await new Promise(setImmediate);
  }

  return {
    sentMessages,
    changeCount,
    disconnected,
    dispatchedEvents,
    input,
    statusHost,
  };
}

test("confirms the transferred PDF in ChatGPT before reporting success", async () => {
  const result = await runPdfInjection();

  assert.equal(result.input.files.length, 1);
  assert.equal(result.input.files[0].name, "1706.03762.pdf");
  assert.equal(result.input.files[0].type, "application/pdf");
  assert.equal(result.input.files[0].size, 4);
  assert.deepEqual(result.dispatchedEvents, ["input", "change"]);
  assert.match(result.statusHost.textContent, /^PDF 已添加：/);
  assert.equal(result.disconnected, true);
});

test("waits for delayed confirmation without adding a second attachment", async () => {
  const result = await runPdfInjection({ attachmentDelay: 50 });
  assert.equal(result.changeCount, 1);
  assert.deepEqual(result.dispatchedEvents, ["input", "change"]);
  assert.match(result.statusHost.textContent, /^PDF 已添加：/);
});

test("ignores duplicate transfer completion messages", async () => {
  const result = await runPdfInjection({ duplicateDone: true });
  assert.equal(result.changeCount, 1);
});

test("requests browser focus once only when offered and without page interaction", async () => {
  const ready = await runPdfInjection({ prepareFocus: true });
  assert.equal(ready.sentMessages.filter(m => m.type === "composer-ready").length, 1);
  assert.match(ready.statusHost.textContent, /^PDF 已添加：/);
  for (const options of [{}, { prepareFocus: true, userInteracts: true }]) {
    const result = await runPdfInjection(options);
    assert.equal(result.sentMessages.some(m => m.type === "composer-ready"), false);
  }
});

test("keeps the port open when the prompt mounts after attachment confirmation", async () => {
  const result = await runPdfInjection({ prepareFocus: true, promptDelay: 3 });
  assert.equal(result.sentMessages.filter(m => m.type === "composer-ready").length, 1);
  assert.match(result.statusHost.textContent, /^PDF 已添加：/);
  assert.equal(result.disconnected, true);
});

test("allows initial visibility but cancels focus when the page is hidden", async () => {
  const shown = await runPdfInjection({ prepareFocus: true, visibilityTransition: "shown" });
  assert.equal(shown.sentMessages.filter(m => m.type === "composer-ready").length, 1);
  const hidden = await runPdfInjection({
    prepareFocus: true, promptDelay: 3, visibilityTransition: "hidden",
  });
  assert.equal(hidden.sentMessages.some(m => m.type === "composer-ready"), false);
  assert.equal(hidden.sentMessages.find(m => m.type === "composer-focus-skipped").reason, "page hidden");
  assert.equal(hidden.disconnected, true);
});

test("reports a missing composer and closes the port after the bounded wait", async () => {
  const result = await runPdfInjection({ prepareFocus: true, promptDelay: Infinity });
  assert.equal(result.sentMessages.some(m => m.type === "composer-ready"), false);
  assert.equal(result.sentMessages.find(m => m.type === "composer-focus-skipped").reason, "composer timeout");
  assert.equal(result.disconnected, true);
});

test("attaches a captured alphaXiv MHTML file through the same input", async () => {
  const result = await runPdfInjection({
    filename: "On the Navier-Stokes Millennium Prize Problem.mhtml",
    contentType: "multipart/related",
    attachmentKind: "MHTML",
  });

  assert.equal(result.input.files[0].name.endsWith(".mhtml"), true);
  assert.equal(result.input.files[0].type, "multipart/related");
  assert.match(result.statusHost.textContent, /^MHTML 已添加：/);
});

test("reports uncertain confirmation without retrying or claiming failure", async () => {
  const result = await runPdfInjection({ attachOnChange: Number.POSITIVE_INFINITY });

  assert.equal(result.changeCount, 1);
  assert.deepEqual(result.dispatchedEvents, ["input", "change"]);
  assert.equal(
    result.statusHost.textContent,
    "PDF 已交给 ChatGPT，但未能确认附件卡片。请检查页面；为避免重复，未再次添加。",
  );
  assert.equal(result.disconnected, true);
});

test("automatically hides a PDF fetch error after five seconds", () => {
  const onMessage = eventChannel();
  const timers = [];
  const sentMessages = [];
  let removed = false;
  const statusHost = {
    id: "",
    style: {},
    textContent: "",
    remove() {
      removed = true;
    },
  };
  const port = {
    onMessage,
    postMessage(message) {
      sentMessages.push(message);
    },
    disconnect() {},
  };

  vm.runInNewContext(source, {
    atob,
    chrome: { runtime: { connect: () => port } },
    console: { log() {}, error() {}, warn() {} },
    document: {
      documentElement: { appendChild() {} },
      createElement() {
        return statusHost;
      },
    },
    Uint8Array,
    window: {
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
      },
    },
  });

  assert.equal(sentMessages[0].type, "claim");

  onMessage.emit({
    type: "error",
    message:
      "Error: PDF exceeds Casimir's 100 MB automatic transfer limit",
  });

  assert.equal(
    statusHost.textContent,
    "PDF 获取失败：Error: PDF exceeds Casimir's 100 MB automatic transfer limit",
  );
  assert.equal(statusHost.style.background, "#b91c1c");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 5000);
  assert.equal(removed, false);

  timers[0].callback();

  assert.equal(removed, true);
});

test("confirms a filename uniquified by ChatGPT without replaying upload", async () => {
  const result = await runPdfInjection({ filename: "sample.pdf", displayedFilename: "sample(5).pdf" });
  assert.equal(result.changeCount, 1);
  assert.match(result.statusHost.textContent, /^PDF 已添加：/);
});
