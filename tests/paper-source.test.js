const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  new URL("../src/content/paper-source.js", `file://${__filename}`),
  "utf8",
);

function resolveFromPage({
  href,
  citationPdfUrl = null,
  citationTitle = null,
  downloadPdfUrl = null,
  blogPdfUrl = null,
  pageTitle = "Example | alphaXiv",
  xArticle = null,
}) {
  let listener = null;
  const location = new URL(href);
  const document = {
    title: pageTitle,
    querySelector(selector) {
      if (selector === 'meta[name="citation_pdf_url"]' && citationPdfUrl) {
        return { content: citationPdfUrl };
      }
      if (selector === 'meta[name="citation_title"]' && citationTitle) {
        return { content: citationTitle };
      }
      if (
        selector ===
          'a[data-test="download-pdf"][data-article-pdf="true"]' &&
        downloadPdfUrl
      ) {
        return { href: downloadPdfUrl };
      }
      if (selector === ".markdown-content.blog-post" && blogPdfUrl) {
        return {
          querySelectorAll(innerSelector) {
            assert.equal(innerSelector, 'a[href]');
            return [{ href: blogPdfUrl }];
          },
        };
      }
      if (
        (selector === 'article[data-testid="twitterArticleReadView"]' ||
          selector === "article") &&
        xArticle
      ) {
        return {
          innerText: xArticle.text,
        };
      }
      if (selector === 'meta[property="og:title"]' && xArticle?.ogTitle) {
        return { content: xArticle.ogTitle };
      }
      return null;
    },
  };

  vm.runInNewContext(source, {
    chrome: {
      runtime: {
        onMessage: {
          addListener(callback) {
            listener = callback;
          },
        },
      },
    },
    document,
    URL,
    URLSearchParams,
    window: { location },
  });

  let response = null;
  listener({ type: "casimir-resolve-pdf-source" }, {}, (value) => {
    response = value;
  });
  return response;
}

test("resolves an alphaXiv special paper from citation metadata", () => {
  const paperView = resolveFromPage({
    href: "https://www.alphaxiv.org/pdf/2609.compose-cl",
    citationPdfUrl: "https://www.alphaxiv.org/abs/2609.compose-cl.pdf",
  });
  const abstractView = resolveFromPage({
    href: "https://www.alphaxiv.org/abs/2609.compose-cl",
    citationPdfUrl: "https://www.alphaxiv.org/abs/2609.compose-cl.pdf",
  });

  assert.equal(
    paperView.pdfUrl,
    "https://www.alphaxiv.org/abs/2609.compose-cl.pdf",
  );
  assert.equal(
    abstractView.pdfUrl,
    "https://www.alphaxiv.org/abs/2609.compose-cl.pdf",
  );
});

test("describes an alphaXiv blog with its linked paper and MHTML metadata", () => {
  const result = resolveFromPage({
    href: "https://www.alphaxiv.org/abs/2609.navier-stokes-solution",
    citationPdfUrl:
      "https://www.alphaxiv.org/abs/2609.navier-stokes-solution.pdf",
    blogPdfUrl:
      "https://cdn.openai.com/pdf/example/navier-stokes.pdf",
    pageTitle: "On the Navier-Stokes Millennium Prize Problem | alphaXiv",
  });

  assert.equal(result.pageType, "blog");
  assert.equal(
    result.linkedPdfUrl,
    "https://cdn.openai.com/pdf/example/navier-stokes.pdf",
  );
  assert.equal(
    result.pageTitle,
    "On the Navier-Stokes Millennium Prize Problem | alphaXiv",
  );
});

test("recognizes a fully rendered X Article for direct MHTML capture", () => {
  const result = resolveFromPage({
    href: "https://x.com/vllm_project/article/2097427730983776758",
    pageTitle: "Fallback X title",
    xArticle: {
      ogTitle: "(1) X",
      text:
        "vLLM x AgentX: Optimizing for Real-World Agentic Serving\n" +
        "A".repeat(500),
    },
  });

  assert.equal(result.pageType, "x-article");
  assert.equal(result.ready, true);
  assert.equal(
    result.pageTitle,
    "vLLM x AgentX: Optimizing for Real-World Agentic Serving",
  );
});

test("accepts a rendered X Article that has section h2 elements but no h1", () => {
  const result = resolveFromPage({
    href: "https://x.com/vllm_project/article/2097427730983776758",
    pageTitle: "(1) X",
    xArticle: {
      text: "Article title without an h1\nSection text\n" + "B".repeat(500),
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.pageTitle, "Article title without an h1");
});

test("keeps an unrendered X Article unavailable for a later retry", () => {
  const result = resolveFromPage({
    href: "https://x.com/vllm_project/article/2097427730983776758",
  });

  assert.equal(result.pageType, "x-article");
  assert.equal(result.ready, false);
});

test("resolves Nature's article PDF download instead of citation metadata", () => {
  const result = resolveFromPage({
    href: "https://www.nature.com/articles/s41746-026-03084-5",
    citationPdfUrl:
      "https://www.nature.com/articles/s41746-026-03084-5.pdf",
    downloadPdfUrl:
      "https://www.nature.com/articles/s41746-026-03084-5_reference.pdf",
  });

  assert.equal(
    result.pdfUrl,
    "https://www.nature.com/articles/s41746-026-03084-5_reference.pdf",
  );
});

test("resolves Nature's access-aware article PDF for MHTML capture", () => {
  const result = resolveFromPage({
    href: "https://www.nature.com/articles/s41591-026-04539-8",
    citationTitle: "Toward a test of medical AI superintelligence",
    downloadPdfUrl:
      "https://www.nature.com/articles/s41591-026-04539-8.pdf",
  });

  assert.equal(
    result.pdfUrl,
    "https://www.nature.com/articles/s41591-026-04539-8.pdf",
  );
  assert.equal(
    result.pageTitle,
    "Toward a test of medical AI superintelligence",
  );
});

test("resolves ACL Anthology's canonical paper PDF", () => {
  const result = resolveFromPage({
    href: "https://aclanthology.org/2026.acl-long.200/",
    citationPdfUrl: "https://aclanthology.org/2026.acl-long.200.pdf",
    citationTitle:
      "Thermometer of Thoughts: Enhancing LLM's Exploration via Attention Temperature Modulation",
  });

  assert.equal(
    result.pdfUrl,
    "https://aclanthology.org/2026.acl-long.200.pdf",
  );
});

test("resolves OpenReview's forum paper PDF", () => {
  const result = resolveFromPage({
    href: "https://openreview.net/forum?id=x6u2BQ7xcq",
    citationPdfUrl: "https://openreview.net/pdf?id=x6u2BQ7xcq",
    citationTitle: "Tag2Text: Guiding Vision-Language Model via Image Tagging",
  });

  assert.equal(
    result.pdfUrl,
    "https://openreview.net/pdf?id=x6u2BQ7xcq",
  );
});

test("rejects cross-origin and non-article PDF candidates", () => {
  const crossOrigin = resolveFromPage({
    href: "https://www.alphaxiv.org/abs/2609.compose-cl",
    citationPdfUrl: "https://example.com/paper.pdf",
  });
  const supplement = resolveFromPage({
    href: "https://www.nature.com/articles/s41746-026-03084-5",
    downloadPdfUrl:
      "https://www.nature.com/articles/s41746-026-03084-5-supplement.pdf",
  });
  const differentArticle = resolveFromPage({
    href: "https://www.nature.com/articles/s41746-026-03084-5",
    downloadPdfUrl:
      "https://www.nature.com/articles/s41591-026-04539-8.pdf",
  });
  const aclChecklist = resolveFromPage({
    href: "https://aclanthology.org/2026.acl-long.200/",
    citationPdfUrl:
      "https://aclanthology.org/attachments/2026.acl-long.200.checklist.pdf",
  });
  const differentForum = resolveFromPage({
    href: "https://openreview.net/forum?id=x6u2BQ7xcq",
    citationPdfUrl: "https://openreview.net/pdf?id=Gd9rjL3Nrf",
  });

  assert.equal(crossOrigin.pdfUrl, null);
  assert.equal(supplement.pdfUrl, null);
  assert.equal(differentArticle.pdfUrl, null);
  assert.equal(aclChecklist.pdfUrl, null);
  assert.equal(differentForum.pdfUrl, null);
});
