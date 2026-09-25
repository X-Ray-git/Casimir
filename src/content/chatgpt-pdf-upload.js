(() => {
  "use strict";

  const LOG_PREFIX = "[casimir:chatgpt-attachment-upload]";
  const PORT_NAME = "casimir-attachment-upload";
  const COMPOSER_SELECTOR = 'form[data-type="unified-composer"], form[data-chatgpt-composer]';

  function getPromptInput() {
    return document.querySelector(COMPOSER_SELECTOR)?.querySelector(
      '#prompt-textarea, [data-composer-markdown][contenteditable="true"][role="textbox"]',
    );
  }

  function getUploadInput() {
    // The new composer has separate image/video pickers with generated IDs.
    return document.querySelector(COMPOSER_SELECTOR)?.querySelector(
      '#upload-files, input[type="file"]:not([accept]), input[type="file"][accept=""]',
    );
  }
  const ATTACHMENT_CONFIRM_ATTEMPTS = 200;
  const ATTACHMENT_POLL_MS = 100;
  const chunks = [];
  let metadata = null;
  let statusHost = null;
  let focusPrepared = false;
  let attachmentStarted = false;
  let focusPreparation = Promise.resolve();

  async function prepareComposerFocus() {
    if (focusPrepared) return;
    focusPrepared = true;
    let cancelled = null;
    const cancel = () => { cancelled = "user interaction"; };
    const onVisibilityChange = () => {
      if (document.hidden) cancelled = "page hidden";
    };
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", cancel, true);
    document.addEventListener("visibilitychange", onVisibilityChange, true);
    try {
      // Upload controls can mount before the editable composer. Wait for both.
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (cancelled) break;
        const input = getUploadInput();
        const prompt = getPromptInput();
        const composer = document.querySelector(COMPOSER_SELECTOR);
        if (uploadInputIsReady(input) && prompt && composer?.contains(prompt) &&
            prompt.getClientRects().length && !document.hidden) {
          port.postMessage({ type: "composer-ready" });
          return;
        }
        await new Promise(resolve => window.setTimeout(resolve, 100));
      }
      port.postMessage({ type: "composer-focus-skipped", reason: cancelled || "composer timeout" });
    } catch (error) {
      console.log(LOG_PREFIX, "Composer focus request skipped.", String(error));
    } finally {
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", cancel, true);
      document.removeEventListener("visibilitychange", onVisibilityChange, true);
    }
  }

  function showStatus(message, kind = "progress", autoHide = false) {
    if (!statusHost) {
      statusHost = document.createElement("div");
      statusHost.id = "casimir-pdf-upload-status";
      statusHost.style.cssText = [
        "position:fixed",
        "right:20px",
        "bottom:20px",
        "z-index:2147483647",
        "max-width:340px",
        "padding:12px 16px",
        "border-radius:12px",
        "box-shadow:0 8px 30px rgba(0,0,0,.28)",
        "font:13px/1.45 system-ui,sans-serif",
        "color:white",
      ].join(";");
      document.documentElement.appendChild(statusHost);
    }

    statusHost.textContent = message;
    statusHost.style.background = kind === "error" ? "#b91c1c" : kind === "warning" ? "#92400e" : "#1f2937";
    if (autoHide) window.setTimeout(() => statusHost?.remove(), 5000);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function uploadInputIsReady(input) {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    const plusButton = composer?.querySelector('[data-testid="composer-plus-btn"], [data-composer-navigation-target="add-context"]');
    return (
      input instanceof HTMLInputElement &&
      input.type === "file" &&
      input.isConnected !== false &&
      composer?.contains(input) &&
      plusButton instanceof HTMLElement &&
      !input.disabled &&
      !plusButton.disabled &&
      plusButton.getAttribute("aria-disabled") !== "true"
    );
  }

  function waitForUploadInput(attemptsRemaining = 200) {
    const input = getUploadInput();
    if (uploadInputIsReady(input)) {
      return Promise.resolve(input);
    }
    if (attemptsRemaining <= 1) return Promise.resolve(null);
    return new Promise((resolve) => {
      window.setTimeout(
        () => resolve(waitForUploadInput(attemptsRemaining - 1)),
        100,
      );
    });
  }

  function attachmentCount(filename) {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (!composer) return 0;
    const dot = filename.lastIndexOf(".");
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : "";

    return [...composer.querySelectorAll('[role="group"][aria-label], button[type="button"][aria-label]')].filter(
      (element) => {
        const label = element.getAttribute("aria-label");
        if (label === filename) return true;
        if (!label?.startsWith(stem) || !label.endsWith(extension)) return false;
        const suffix = label.slice(stem.length, extension ? -extension.length : undefined);
        // ChatGPT may uniquify filenames, e.g. paper.pdf -> paper(5).pdf.
        return /^ ?\([1-9]\d*\)$/.test(suffix);
      },
    ).length;
  }

  function attachmentIsVisible(filename, previousCount = 0) {
    return attachmentCount(filename) > previousCount;
  }

  async function waitForAttachment(filename, attemptsRemaining, previousCount) {
    if (attachmentIsVisible(filename, previousCount)) return true;
    if (attemptsRemaining <= 1) return false;

    await new Promise((resolve) => {
      window.setTimeout(resolve, ATTACHMENT_POLL_MS);
    });
    return waitForAttachment(filename, attemptsRemaining - 1, previousCount);
  }

  function setInputFile(input, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const filesSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "files",
    )?.set;

    if (filesSetter) {
      filesSetter.call(input, transfer.files);
    } else {
      input.files = transfer.files;
    }
  }

  function dispatchUploadEvents(input, includeInputEvent) {
    if (includeInputEvent) {
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  async function attachFile() {
    const input = await waitForUploadInput();
    if (!input) throw new Error("ChatGPT general file input was not found");

    const file = new File(chunks, metadata.filename, {
      type: metadata.contentType,
      lastModified: Date.now(),
    });
    const previousCount = attachmentCount(file.name);
    setInputFile(input, file);
    dispatchUploadEvents(input, true);

    const attached = await waitForAttachment(file.name, ATTACHMENT_CONFIRM_ATTEMPTS, previousCount);
    const attachmentKind = metadata.attachmentKind || "PDF";
    if (!attached) {
      // Missing DOM confirmation does not prove the upload was rejected. Replaying
      // change can add a second copy when ChatGPT already consumed the first one.
      console.warn(LOG_PREFIX, "Attachment confirmation timed out; upload was not repeated.");
      showStatus(`${attachmentKind} 已交给 ChatGPT，但未能确认附件卡片。请检查页面；为避免重复，未再次添加。`, "warning", true);
      return;
    }

    console.log(LOG_PREFIX, "File attachment confirmed by ChatGPT.", {
      filename: file.name,
      size: file.size,
    });
    showStatus(`${attachmentKind} 已添加：${file.name}。请等待 ChatGPT 上传完成。`, "success", true);
  }

  const port = chrome.runtime.connect({ name: PORT_NAME });
  port.onMessage.addListener((message) => {
    if (message?.type === "prepare-focus") {
      if (!focusPrepared) focusPreparation = prepareComposerFocus();
      return;
    }
    if (message?.type === "none") {
      port.disconnect();
      return;
    }
    if (message?.type === "status" && message.status === "fetching") {
      showStatus(`Casimir 正在从 ${message.sourceKind} 获取 PDF…`);
      return;
    }
    if (message?.type === "status" && message.status === "capturing") {
      showStatus(
        message.direct
          ? `正在将 ${message.sourceKind} 保存为 MHTML…`
          : `原始 PDF 不可用，正在保存 ${message.sourceKind} 页面为 MHTML…`,
      );
      return;
    }
    if (message?.type === "start") {
      metadata = message;
      chunks.length = 0;
      showStatus(`正在准备 ${message.filename}…`);
      return;
    }
    if (message?.type === "chunk") {
      chunks.push(base64ToBytes(message.data));
      return;
    }
    if (message?.type === "done") {
      if (attachmentStarted) return;
      attachmentStarted = true;
      void attachFile()
        .catch((error) => {
          console.error(LOG_PREFIX, error);
          showStatus(
            `${metadata?.attachmentKind || "文件"} 添加失败：${error.message}`,
            "error",
            true,
          );
        })
        .finally(async () => {
          // A fast upload must not close the port while the composer is mounting.
          await focusPreparation;
          port.disconnect();
        });
      return;
    }
    if (message?.type === "error") {
      console.error(LOG_PREFIX, message.message);
      showStatus(
        `${message.attachmentKind || "PDF"} 获取失败：${message.message}`,
        "error",
        true,
      );
    }
  });
  port.postMessage({ type: "claim" });
})();
