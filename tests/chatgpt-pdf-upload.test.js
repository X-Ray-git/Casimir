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

test("injects the transferred PDF into ChatGPT's file input without sending", async () => {
  const dispatchedEvents = [];

  class FakeInput {}
  const input = new FakeInput();
  input.type = "file";
  input.files = [];
  input.dispatchEvent = (event) => dispatchedEvents.push(event.type);

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
    createElement() {
      return {
        id: "",
        style: {},
        textContent: "",
        remove() {},
      };
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
    HTMLInputElement: FakeInput,
    Uint8Array,
    window: { setTimeout() {} },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, "claim");

  onMessage.emit({
    type: "start",
    filename: "1706.03762.pdf",
    contentType: "application/pdf",
  });
  onMessage.emit({ type: "chunk", data: "JVBERg==" });
  onMessage.emit({ type: "done", totalBytes: 4 });
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  assert.equal(input.files.length, 1);
  assert.equal(input.files[0].name, "1706.03762.pdf");
  assert.equal(input.files[0].type, "application/pdf");
  assert.equal(input.files[0].size, 4);
  assert.deepEqual(dispatchedEvents, ["input", "change"]);
  assert.equal(disconnected, true);
});
