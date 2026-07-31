const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  new URL("../src/content/arxiv-first-visit.js", `file://${__filename}`),
  "utf8",
);

async function runScript(url, initialVisited = []) {
  const parsed = new URL(url);
  const storage = { arxivVisitedPaperIds: [...initialVisited] };
  const redirects = [];

  const location = {
    href: parsed.href,
    pathname: parsed.pathname,
    replace(target) {
      redirects.push(target);
    },
  };

  const context = {
    URL,
    window: { location },
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

  return { redirects, storage };
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
