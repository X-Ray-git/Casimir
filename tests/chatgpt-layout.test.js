const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");

const fixture = fs.readFileSync(`${__dirname}/fixtures/chatgpt-2026-09.html`, "utf8");
const read = path => fs.readFileSync(`${__dirname}/../${path}`, "utf8");

function harness(file, names, html = fixture) {
  const { window } = parseHTML(html);
  const { document } = window;
  window.HTMLElement.prototype.getClientRects = () => [{}];
  const context = {
    document, window, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, console,
    chrome: {
      storage: { local: { get: async () => ({}) } },
      runtime: { connect: () => ({
        onMessage: { addListener() {} }, postMessage() {},
      }) },
    },
  };
  vm.runInNewContext(read(file).replace(/\}\)\(\);\s*$/, `globalThis.api = {${names.join(",")}};})();`), context);
  return { ...context.api, document };
}

test("new layout selects general file input despite media pickers appearing first", () => {
  const h = harness("src/content/chatgpt-pdf-upload.js", ["getUploadInput", "uploadInputIsReady", "getPromptInput"]);
  const input = h.getUploadInput();
  assert.equal(input.id, "_r_a_");
  assert.equal(h.uploadInputIsReady(input), true);
  assert.equal(h.getPromptInput().getAttribute("role"), "textbox");
  input.id = "a-different-generated-id";
  assert.equal(h.getUploadInput(), input);
  h.document.querySelector('[data-composer-navigation-target]').setAttribute("aria-disabled", "true");
  assert.equal(h.uploadInputIsReady(input), false);
  input.remove();
  assert.equal(h.getUploadInput(), null, "must not fall back to an image/video picker");
});

test("recognizes filename button only inside composer, not removal button or other page text", () => {
  const h = harness("src/content/chatgpt-pdf-upload.js", ["attachmentIsVisible"]);
  assert.equal(h.attachmentIsVisible("sample.pdf"), true);
  assert.equal(h.attachmentIsVisible("sample"), false);
  const card = h.document.querySelector('[aria-label="sample.pdf"]');
  h.document.body.append(card);
  assert.equal(h.attachmentIsVisible("sample.pdf"), false);
});

test("legacy upload and attachment contracts remain supported", () => {
  const h = harness("src/content/chatgpt-pdf-upload.js", ["getUploadInput", "getPromptInput", "uploadInputIsReady", "attachmentIsVisible"], `
    <html><body><form data-type="unified-composer">
      <input id="upload-files" type="file"><div id="prompt-textarea" contenteditable="true"></div>
      <button data-testid="composer-plus-btn"></button><div role="group" aria-label="sample.pdf"></div>
    </form></body></html>`);
  assert.equal(h.uploadInputIsReady(h.getUploadInput()), true);
  assert.equal(h.getPromptInput().id, "prompt-textarea");
  assert.equal(h.attachmentIsVisible("sample.pdf"), true);
});

test("new layout shortcuts find editable prompt, sidebar and temporary chat", () => {
  const h = harness("src/content/chatgpt-shortcuts.js", ["getPromptInput", "findSidebarToggle", "findTemporaryChatButton"]);
  assert.equal(h.getPromptInput().getAttribute("data-composer-markdown"), "");
  assert.equal(h.findSidebarToggle().getAttribute("aria-controls"), "app-shell-sidebar");
  h.document.querySelector('[aria-controls="app-shell-sidebar"]').setAttribute("inert", "");
  assert.equal(h.findSidebarToggle().getAttribute("aria-controls"), "browser-sidebar-popover");
  assert.equal(h.findTemporaryChatButton().getAttribute("aria-label"), "临时聊天");
});

test("background debugger expressions accept new composer and respect user interaction", () => {
  const { document } = parseHTML(fixture);
  const prompt = document.querySelector('[data-composer-markdown]');
  prompt.getClientRects = () => [{}];
  document.activeElement = document.body;
  document.hasFocus = () => document.activeElement === prompt;
  prompt.focus = () => { document.activeElement = prompt; };
  const navigator = { userActivation: { hasBeenActive: false } };
  const expressions = [...read("src/background/arxiv-split-view.js").matchAll(/expression: `([^`]+)`/g)].map(m => m[1]);
  assert.equal(expressions.length, 2);
  for (const expression of expressions) assert.equal(vm.runInNewContext(expression, { document, navigator }), true);
  navigator.userActivation.hasBeenActive = true;
  for (const expression of expressions) assert.equal(vm.runInNewContext(expression, { document, navigator }), false);
});

test("confirms only a new exact or numbered filename card", () => {
  const h = harness("src/content/chatgpt-pdf-upload.js", ["attachmentCount", "attachmentIsVisible"]);
  const before = h.attachmentCount("sample.pdf");
  assert.equal(before, 1);
  assert.equal(h.attachmentIsVisible("sample.pdf", before), false);
  const card = h.document.createElement("button");
  card.type = "button";
  h.document.querySelector("form").append(card);
  for (const label of ["sample(5).pdf", "sample (12).pdf"]) {
    card.setAttribute("aria-label", label);
    assert.equal(h.attachmentIsVisible("sample.pdf", before), true);
  }
  for (const label of ["sample2.pdf", "sample(5).txt", "sample(copy).pdf", "移除 sample(5).pdf"]) {
    card.setAttribute("aria-label", label);
    assert.equal(h.attachmentIsVisible("sample.pdf", before), false);
  }
  card.setAttribute("aria-label", "sample(5).pdf");
  h.document.body.append(card);
  assert.equal(h.attachmentIsVisible("sample.pdf", before), false);
});
