const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  new URL("../src/content/arxiv-first-visit.js", `file://${__filename}`),
  "utf8",
);

async function runScript(url, initialVisited = [], links = []) {
  const parsed = new URL(url);
  const storage = { arxivVisitedPaperIds: [...initialVisited] };
  const redirects = [];
  const assignments = [];

  const location = {
    href: parsed.href,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    replace(target) {
      redirects.push(target);
    },
    assign(target) {
      assignments.push(target);
    },
  };

  const context = {
    URL,
    window: { location },
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, 'a[href]');
        return links.map((href) => ({ href }));
      },
    },
    chrome: {
      storage: {
        local: {
          async get(key) {
            return { [key]: storage[key] };
          },
          async set(update) {
            Object.assign(storage, update);
          },
        },
      },
    },
    console: { log() {}, error() {} },
  };

  vm.runInNewContext(source, context, {
    filename: "arxiv-first-visit.js",
  });
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  return { assignments, redirects, storage };
}

test("redirects an unseen abstract page to its PDF", async () => {
  const result = await runScript("https://arxiv.org/abs/2302.00014");

  assert.deepEqual(result.redirects, ["https://arxiv.org/pdf/2302.00014"]);
  assert.deepEqual(Array.from(result.storage.arxivVisitedPaperIds), [
    "2302.00014",
  ]);
});

test("preserves an abstract page after the paper was visited", async () => {
  const result = await runScript("https://arxiv.org/abs/2302.00014", [
    "2302.00014",
  ]);

  assert.deepEqual(result.redirects, []);
  assert.deepEqual(Array.from(result.storage.arxivVisitedPaperIds), [
    "2302.00014",
  ]);
});

test("treats arXiv versions as the same paper", async () => {
  const result = await runScript("https://arxiv.org/abs/2302.00014v3", [
    "2302.00014",
  ]);

  assert.deepEqual(result.redirects, []);
});

test("redirects an unseen DAIR.AI paper while preserving browser history", async () => {
  const result = await runScript(
    "https://academy.dair.ai/papers/procedural-graphs-self-evolving-execution-structures-for-llm-agents-2609.09153",
    [],
    [
      "https://arxiv.org/abs/2609.09153",
      "https://arxiv.org/pdf/2609.09153",
    ],
  );

  assert.deepEqual(result.redirects, []);
  assert.deepEqual(result.assignments, [
    "https://arxiv.org/pdf/2609.09153",
  ]);
  assert.deepEqual(Array.from(result.storage.arxivVisitedPaperIds), [
    "2609.09153",
  ]);
});

test("preserves a DAIR.AI paper after its arXiv PDF was visited", async () => {
  const result = await runScript(
    "https://academy.dair.ai/papers/frognano-training-a-4b-coding-agent-via-online-task-synthesis-2609.07925",
    ["2609.07925"],
    ["https://arxiv.org/pdf/2609.07925"],
  );

  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.redirects, []);
});

test("does not follow a mismatched arXiv PDF from a DAIR.AI page", async () => {
  const result = await runScript(
    "https://academy.dair.ai/papers/procedural-graphs-self-evolving-execution-structures-for-llm-agents-2609.09153",
    [],
    ["https://arxiv.org/pdf/2609.07925"],
  );

  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.storage.arxivVisitedPaperIds, []);
});
