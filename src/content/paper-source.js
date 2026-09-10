(() => {
  "use strict";

  const REQUEST_TYPE = "casimir-resolve-pdf-source";

  function validatedUrl(candidate, predicate) {
    if (!candidate) return null;

    try {
      const url = new URL(candidate, window.location.href);
      return url.protocol === "https:" && predicate(url) ? url.href : null;
    } catch {
      return null;
    }
  }

  function resolveAlphaXivSource() {
    const citationCandidate = document.querySelector(
      'meta[name="citation_pdf_url"]',
    )?.content;
    const blog = document.querySelector(".markdown-content.blog-post");
    const linkedCandidate = blog
      ? [...blog.querySelectorAll('a[href]')].find((link) => {
          try {
            return new URL(link.href, window.location.href).pathname
              .toLowerCase()
              .endsWith(".pdf");
          } catch {
            return false;
          }
        })?.href
      : null;

    return {
      pdfUrl: validatedUrl(
        citationCandidate,
        (url) =>
          url.hostname.toLowerCase() === "www.alphaxiv.org" &&
          /^\/abs\/[^/]+\.pdf$/.test(url.pathname),
      ),
      linkedPdfUrl: validatedUrl(
        linkedCandidate,
        (url) => url.pathname.toLowerCase().endsWith(".pdf"),
      ),
      pageType: blog ? "blog" : "paper",
      pageTitle: document.title || "alphaXiv article",
    };
  }

  function resolveNaturePdf() {
    const candidate = document.querySelector(
      'a[data-test="download-pdf"][data-article-pdf="true"]',
    )?.href;

    return validatedUrl(
      candidate,
      (url) =>
        url.hostname.toLowerCase() === "www.nature.com" &&
        /^\/articles\/[^/]+_reference\.pdf$/.test(url.pathname),
    );
  }

  function resolveXArticleSource() {
    const article =
      document.querySelector('article[data-testid="twitterArticleReadView"]') ||
      document.querySelector("article");
    const articleText = article?.innerText?.trim() || "";
    if (!article || articleText.length < 200) {
      return { pageType: "x-article", ready: false };
    }

    const firstLine = articleText
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    const pageTitle =
      firstLine ||
      document.querySelector('meta[property="og:title"]')?.content ||
      document.title ||
      "X Article";

    return {
      pageType: "x-article",
      ready: true,
      pageTitle,
    };
  }

  function resolveSource() {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname === "www.alphaxiv.org") return resolveAlphaXivSource();
    if (hostname === "www.nature.com") {
      return { pdfUrl: resolveNaturePdf() };
    }
    if (hostname === "x.com") return resolveXArticleSource();
    return { pdfUrl: null };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== REQUEST_TYPE) return;
    sendResponse(resolveSource());
  });
})();
