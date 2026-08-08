const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  new URL("../src/content/chatgpt-shortcuts.js", `file://${__filename}`),
  "utf8",
);

class MockDataTransfer {
  constructor() {
    this._data = {};
  }
  setData(format, data) {
    this._data[format] = data;
  }
  getData(format) {
    return this._data[format] || "";
  }
}

class MockClipboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles || false;
    this.cancelable = init.cancelable || false;
    this.clipboardData = init.clipboardData || null;
    this.defaultPrevented = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {}
  stopImmediatePropagation() {}
}

async function createHarness({
  href = "https://chatgpt.com/c/existing-chat",
  customShortcuts = [],
  newChatButtons = [],
  temporaryChatButtons = [],
  promptInput = null,
  clipboardText = "",
} = {}) {
  const parsed = new URL(href);
  const listeners = new Map();
  const navigations = [];
  const clicks = [];
  const timers = [];
  const storage = { casimirCustomShortcuts: customShortcuts };

  const buttonElements = newChatButtons.map(
    ({ id, inert = false, visible = true, navigateTo = null }) => ({
      closest(selector) {
        return selector === "[inert]" && inert ? {} : null;
      },
      getClientRects() {
        return visible ? [{}] : [];
      },
      click() {
        clicks.push(id);
        if (navigateTo) {
          const target = new URL(navigateTo);
          window.location.href = target.href;
          window.location.pathname = target.pathname;
          window.location.search = target.search;
        }
      },
    }),
  );

  const temporaryButtonElements = temporaryChatButtons.map(
    ({ id, ariaLabel, inert = false, visible = true }) => ({
      ariaLabel,
      element: {
        closest(selector) {
          return selector === "[inert]" && inert ? {} : null;
        },
        getClientRects() {
          return visible ? [{}] : [];
        },
        click() {
          clicks.push(id);
        },
      },
    }),
  );

  const document = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    getElementById(id) {
      if (id === "prompt-textarea") return promptInput;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-testid="create-new-chat-button"][href="/"]') {
        return buttonElements;
      }
      return temporaryButtonElements
        .filter(({ ariaLabel }) => selector === `[aria-label="${ariaLabel}"]`)
        .map(({ element }) => element);
    },
  };

  const window = {
    location: {
      href: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname,
      search: parsed.search,
      assign(target) {
        navigations.push(target);
      },
    },
    setTimeout(callback) {
      timers.push(callback);
    },
  };

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(keys.map((key) => [key, storage[key]]));
        },
        async set(update) {
          Object.assign(storage, update);
        },
        async remove(key) {
          delete storage[key];
        },
      },
    },
  };

  vm.runInNewContext(source, {
    chrome,
    console: { log() {}, warn() {}, error() {} },
    Date,
    document,
    navigator: { clipboard: { async readText() { return clipboardText; } } },
    window,
    DataTransfer: MockDataTransfer,
    ClipboardEvent: MockClipboardEvent,
  });
  await new Promise(setImmediate);

  function keydown(overrides = {}) {
    const event = {
      defaultPrevented: false,
      isComposing: false,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      code: "KeyO",
      key: "o",
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      stopImmediatePropagation() {},
      ...overrides,
    };
    listeners.get("keydown")(event);
    return event;
  }

  async function flushTimers(limit = 200) {
    let completed = 0;
    while (timers.length > 0 && completed < limit) {
      timers.shift()();
      completed += 1;
      await new Promise(setImmediate);
    }
    return completed;
  }

  return { clicks, flushTimers, keydown, navigations, storage };
}

test("Cmd+O uses ChatGPT's visible native new-chat entry", async () => {
  const harness = await createHarness({
    newChatButtons: [
      { id: "inert-sidebar", inert: true },
      { id: "active-sidebar" },
    ],
  });

  const event = harness.keydown();

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.clicks, ["active-sidebar"]);
  assert.deepEqual(harness.navigations, []);
});

test("Cmd+O navigates directly when the native entry is unavailable", async () => {
  const harness = await createHarness({
    newChatButtons: [{ id: "hidden-sidebar", visible: false }],
  });

  harness.keydown();

  assert.deepEqual(harness.clicks, []);
  assert.deepEqual(harness.navigations, ["https://chatgpt.com/"]);
});

test("Cmd+O does not navigate when already on a new chat page", async () => {
  const harness = await createHarness({ href: "https://chatgpt.com/" });

  harness.keydown();

  assert.deepEqual(harness.clicks, []);
  assert.deepEqual(harness.navigations, []);
});

test("Cmd+Shift+N clicks ChatGPT's current Chinese temporary chat button", async () => {
  const harness = await createHarness({
    temporaryChatButtons: [
      { id: "temporary-chat", ariaLabel: "临时聊天" },
    ],
  });

  const event = harness.keydown({
    shiftKey: true,
    code: "KeyN",
    key: "N",
  });

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.clicks, ["temporary-chat"]);
});

test("Cmd+Shift+N supports the neutral Chinese temporary conversation label", async () => {
  const harness = await createHarness({
    temporaryChatButtons: [
      { id: "temporary-conversation", ariaLabel: "临时对话" },
    ],
  });

  harness.keydown({ shiftKey: true, code: "KeyN", key: "N" });

  assert.deepEqual(harness.clicks, ["temporary-conversation"]);
});

test("a custom new-chat shortcut stores its prompt before navigation", async () => {
  const harness = await createHarness({
    customShortcuts: [
      {
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        code: "KeyJ",
        key: "j",
        prompt: "Summarize {{clipboard}}",
        newChat: true,
      },
    ],
  });

  harness.keydown({ code: "KeyJ", key: "j" });
  await new Promise(setImmediate);

  assert.equal(harness.storage.casimirPendingPrompt.prompt, "Summarize ");
  assert.equal(typeof harness.storage.casimirPendingPrompt.createdAt, "number");
  assert.deepEqual(harness.navigations, ["https://chatgpt.com/"]);
});

test("a custom new-chat shortcut inserts its prompt after native SPA navigation", async () => {
  const dispatched = [];
  const promptInput = {
    focus() {},
    dispatchEvent(event) {
      dispatched.push(event);
      event.preventDefault();
      return false;
    },
    textContent: "",
  };
  const harness = await createHarness({
    newChatButtons: [
      {
        id: "native-new-chat",
        navigateTo: "https://chatgpt.com/",
      },
    ],
    customShortcuts: [
      {
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        code: "KeyJ",
        key: "j",
        prompt: "Summarize this",
        newChat: true,
      },
    ],
    promptInput,
  });

  harness.keydown({ code: "KeyJ", key: "j" });
  await new Promise(setImmediate);
  await harness.flushTimers();

  assert.deepEqual(harness.clicks, ["native-new-chat"]);
  assert.deepEqual(harness.navigations, []);
  assert.equal(harness.storage.casimirPendingPrompt, undefined);
  assert.equal(dispatched.length, 1);
  assert.equal(
    dispatched[0].clipboardData.getData("text/plain"),
    "Summarize this",
  );
});

test("a custom shortcut pastes the prompt via a synthetic paste event", async () => {
  const dispatched = [];
  const promptInput = {
    focus() {},
    dispatchEvent(event) {
      dispatched.push(event);
      event.preventDefault();
      return false;
    },
    textContent: "",
  };

  const harness = await createHarness({
    customShortcuts: [
      {
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        code: "KeyJ",
        key: "j",
        prompt: "Summarize this",
        newChat: false,
      },
    ],
    promptInput,
  });

  harness.keydown({ code: "KeyJ", key: "j" });
  await new Promise(setImmediate);

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, "paste");
  assert.equal(
    dispatched[0].clipboardData.getData("text/plain"),
    "Summarize this",
  );
});

test("a custom shortcut substitutes {{clipboard}} before pasting", async () => {
  const dispatched = [];
  const promptInput = {
    focus() {},
    dispatchEvent(event) {
      dispatched.push(event);
      event.preventDefault();
      return false;
    },
    textContent: "",
  };

  const harness = await createHarness({
    customShortcuts: [
      {
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        code: "KeyJ",
        key: "j",
        prompt: "Summarize {{clipboard}}",
        newChat: false,
      },
    ],
    promptInput,
    clipboardText: "clipboard content",
  });

  harness.keydown({ code: "KeyJ", key: "j" });
  await new Promise(setImmediate);

  assert.equal(dispatched.length, 1);
  assert.equal(
    dispatched[0].clipboardData.getData("text/plain"),
    "Summarize clipboard content",
  );
});
