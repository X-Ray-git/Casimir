const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  new URL(
    "../src/content/chatgpt-rate-limit-dismiss.js",
    `file://${__filename}`,
  ),
  "utf8",
);

function createModal({ buttonCount = 1, disabled = false, state = "open" } = {}) {
  let clicks = 0;
  const buttons = Array.from({ length: buttonCount }, () => ({
    disabled,
    click() {
      clicks += 1;
    },
  }));
  const dialog = {
    getAttribute(name) {
      return name === "data-state" ? state : null;
    },
    querySelectorAll(selector) {
      return selector === "button" ? buttons : [];
    },
  };

  return {
    element: {
      querySelector(selector) {
        return selector === '[role="dialog"]' ? dialog : null;
      },
    },
    get clicks() {
      return clicks;
    },
  };
}

function createHarness(initialModals = []) {
  let modals = initialModals.map(({ element }) => element);
  let observerCallback = null;
  let observed = null;

  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }
    observe(target, options) {
      observed = { target, options };
    }
  }

  const documentElement = {};
  const document = {
    documentElement,
    querySelectorAll(selector) {
      return selector ===
        '[data-testid="modal-conversation-history-rate-limit"]'
        ? modals
        : [];
    },
  };

  vm.runInNewContext(source, {
    console: { log() {} },
    document,
    MutationObserver: FakeMutationObserver,
    WeakSet,
  });

  return {
    notify(nextModals) {
      modals = nextModals.map(({ element }) => element);
      observerCallback();
    },
    observed,
  };
}

test("dismisses an existing conversation-history rate-limit notice", () => {
  const modal = createModal();
  const harness = createHarness([modal]);

  assert.equal(modal.clicks, 1);
  assert.equal(harness.observed.options.childList, true);
  assert.equal(harness.observed.options.subtree, true);
});

test("dismisses a notice added after the content script loads", () => {
  const modal = createModal();
  const harness = createHarness();

  assert.equal(modal.clicks, 0);
  harness.notify([modal]);
  assert.equal(modal.clicks, 1);

  harness.notify([modal]);
  assert.equal(modal.clicks, 1);
});

test("leaves ambiguous or inactive modal content untouched", () => {
  const ambiguous = createModal({ buttonCount: 2 });
  const inactive = createModal({ state: "closed" });
  const disabled = createModal({ disabled: true });

  createHarness([ambiguous, inactive, disabled]);

  assert.equal(ambiguous.clicks, 0);
  assert.equal(inactive.clicks, 0);
  assert.equal(disabled.clicks, 0);
});
