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
} = {}) {
  const dispatchedEvents = [];
  let attachmentVisible = false;
  let changeCount = 0;

  class FakeElement {}
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
      return name === "aria-label" ? filename : null;
    },
  };
  const composer = {
    contains(candidate) {
      return candidate === input;
    },
    querySelectorAll() {
      return attachmentVisible ? [attachment] : [];
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
      sentMessages.push(message);
    },
    disconnect() {
      disconnected = true;
    },
  };

  const document = {
    documentElement: { appendChild() {} },
    getElementById(id) {
      return id === "upload-files" ? input : null;
    },
    querySelector(selector) {
      if (selector === 'form[data-type="unified-composer"]') return composer;
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
    console: { log() {}, error() {} },
    DataTransfer: FakeDataTransfer,
    Date,
    document,
    Event: FakeEvent,
    File: FakeFile,
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInput,
    Uint8Array,
    window: {
      setTimeout(callback) {
        callback();
      },
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, "claim");

  onMessage.emit({
    type: "start",
    filename,
    contentType,
    attachmentKind,
  });
  onMessage.emit({ type: "chunk", data: "JVBERg==" });
  onMessage.emit({ type: "done", totalBytes: 4 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise(setImmediate);
  }

  return {
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

test("replays a missed ChatGPT file change event once", async () => {
  const result = await runPdfInjection({ attachOnChange: 2 });

  assert.equal(result.changeCount, 2);
  assert.deepEqual(result.dispatchedEvents, ["input", "change", "change"]);
  assert.match(result.statusHost.textContent, /^PDF 已添加：/);
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

test("reports failure when ChatGPT never confirms the attachment", async () => {
  const result = await runPdfInjection({ attachOnChange: Number.POSITIVE_INFINITY });

  assert.equal(result.changeCount, 2);
  assert.deepEqual(result.dispatchedEvents, ["input", "change", "change"]);
  assert.equal(
    result.statusHost.textContent,
    "PDF 添加失败：ChatGPT did not confirm the PDF attachment",
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
    console: { log() {}, error() {} },
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
